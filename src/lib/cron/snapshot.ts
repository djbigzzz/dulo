/**
 * Cron step 1 — snapshot every wallet's xStocks holdings (docs/HANDOFF.md §4.2).
 *
 * Per wallet (readWalletHoldings, read-only and shared with the public preview): token
 * balances through the Solana ChainAdapter filtered to the xStocks mint set, multiplier from
 * the chain (Token-2022 ScaledUiAmount) with the catalogue's value as fallback, quantity
 * through AssetSource.normaliseQty, price through lib/price (one batched call per wallet).
 * snapshotWallet then writes one Snapshot row. An empty wallet still gets a row:
 * "sold everything" is a fact the Plays engine needs to see.
 *
 * Bot wallets (users with a LeagueAccount.isBot) are never snapshotted: they are unfunded
 * deterministic keypairs, so the row would always be empty, and a snapshot is the first
 * step towards a bot scoring a Play (docs/REVIEW-2026-09-14.md H2). The exclusion lives in
 * the wallet query (REAL_USER_WHERE) so runForUser and the tick agree.
 *
 * Rules: no raw RPC (adapter only), no price fetch outside lib/price, CAIP-19 ids on
 * every Holding. Server-only.
 */
import type { Prisma } from "@prisma/client";
import { solana } from "@/lib/adapters/solana";
import { xstocks } from "@/lib/assets/xstocks";
import {
  SOLANA_MAINNET,
  isSolanaChain,
  solanaTokenAssetId,
  type AssetId,
  type ChainId,
  type Holding,
  type HoldingsSnapshot,
  type PriceQuote,
} from "@/lib/core";
import { getPrices } from "@/lib/price";
import { db } from "@/lib/server/db";
import { REAL_USER_WHERE } from "@/lib/server/queries";
import { describeError, forEachLimited } from "./util";

const LOG_PREFIX = "[cron/snapshot]";

export interface SnapshotWalletInput {
  id: string;
  address: string;
  /** CAIP-2 chain id. Only Solana chains can be snapshotted in Season 0. */
  chainId: string;
}

export interface SnapshotWalletOptions {
  /** Snapshot.takenAt. Defaults to the moment the balances were read. */
  takenAt?: Date;
}

export interface SnapshotFailure {
  walletId: string;
  error: string;
}

export interface SnapshotAllOptions {
  /** Wallets snapshotted in parallel. Default 4 (Helius and Jupiter are shared budgets). */
  concurrency?: number;
  /** Restrict the run to these Wallet ids (runForUser). Default: every wallet. */
  walletIds?: string[];
  /** Snapshot.takenAt for every wallet in the run. Default: per-wallet read time. */
  takenAt?: Date;
}

export interface SnapshotAllResult {
  /** Wallets snapshotted. */
  ok: number;
  /** Wallets whose snapshot threw; each failure is logged and the run continues. */
  failed: SnapshotFailure[];
  /** Wallets on a chain the app cannot read yet (non-Solana). */
  skipped: number;
  /** Wall-clock milliseconds for the whole run. */
  took: number;
}

export interface WalletHoldingsRead {
  address: string;
  chainId: ChainId;
  /** The moment the balances were read (before pricing). */
  readAt: Date;
  holdings: Holding[];
  /** The quote behind each priced holding (source, publishedAt, stale, marketOpen), keyed by CAIP-19 id. */
  quotes: Map<AssetId, PriceQuote>;
}

/**
 * Read one wallet's xStocks holdings and price them. Read-only: nothing is written, so the
 * public preview (GET /api/v1/preview/[address]) and the cron share one read path.
 * Throws on adapter / price failure.
 */
export async function readWalletHoldings(address: string, chainId: ChainId = SOLANA_MAINNET): Promise<WalletHoldingsRead> {
  if (!isSolanaChain(chainId)) throw new Error(`${chainId} is not a Solana chain; only Solana wallets can be read`);

  const mints = await xstocks.mintSet();
  const balances = await solana.getTokenBalances(address, mints);
  const readAt = new Date();

  // Resolve every balance to its catalogue entry (in-memory after the first call).
  const resolved = await Promise.all(
    balances.map(async (balance) => {
      const assetId = solanaTokenAssetId(balance.mint, chainId);
      const asset = await xstocks.getAsset(assetId);
      if (!asset) console.warn(`${LOG_PREFIX} ${balance.mint} is in the mint set but not in the catalogue; keeping it unpriced`);
      return { balance, assetId, asset };
    }),
  );

  // One batched price call per wallet; lib/price caches for 30s so the fleet shares it.
  const ids: AssetId[] = resolved.map((r) => r.assetId);
  const quotes = ids.length > 0 ? await getPrices(ids) : new Map();

  const holdings: Holding[] = resolved.map(({ balance, assetId, asset }) => {
    const multiplier = balance.multiplier ?? asset?.multiplier ?? 1;
    const qty = xstocks.normaliseQty(balance.amountRaw, balance.decimals, multiplier);
    const quote = quotes.get(assetId);
    const price = quote?.price ?? null;
    return {
      assetId,
      symbol: asset?.symbol ?? balance.mint,
      source: xstocks.name,
      raw: balance.amountRaw,
      multiplier,
      qty,
      price,
      priceSource: quote?.source ?? "none",
      usd: price === null ? 0 : qty * price,
    };
  });

  return { address, chainId, readAt, holdings, quotes };
}

/**
 * Read one wallet's xStocks holdings (readWalletHoldings), persist a Snapshot row and return it.
 * Throws on adapter / database failure; the caller (snapshotAllWallets) isolates that.
 */
export async function snapshotWallet(wallet: SnapshotWalletInput, opts: SnapshotWalletOptions = {}): Promise<HoldingsSnapshot> {
  if (!isSolanaChain(wallet.chainId)) {
    throw new Error(`Wallet ${wallet.id} is on ${wallet.chainId}; only Solana wallets can be snapshotted`);
  }
  const { readAt, holdings } = await readWalletHoldings(wallet.address, wallet.chainId as ChainId);
  const takenAt = opts.takenAt ?? readAt;

  await db.snapshot.create({
    data: {
      walletId: wallet.id,
      takenAt,
      holdings: holdings as unknown as Prisma.InputJsonValue,
    },
  });

  return { walletId: wallet.id, takenAt, holdings };
}

/**
 * Snapshot every real user's Wallet (or the given ids, bot wallets still excluded). One
 * wallet's failure is logged and skipped; the run always resolves. The xStocks catalogue
 * is warmed once up front so the cold load is paid a single time, not once per wallet.
 */
export async function snapshotAllWallets(opts: SnapshotAllOptions = {}): Promise<SnapshotAllResult> {
  const started = Date.now();
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));

  // Warm the catalogue (1h cache, stale-while-revalidate) before the wallets fan out.
  await xstocks.listAssets();

  const wallets = await db.wallet.findMany({
    where: { ...(opts.walletIds ? { id: { in: opts.walletIds } } : {}), user: REAL_USER_WHERE },
    select: { id: true, address: true, chainId: true },
    orderBy: { createdAt: "asc" },
  });

  const failed: SnapshotFailure[] = [];
  let ok = 0;
  let skipped = 0;

  const solanaWallets = wallets.filter((w) => {
    let onSolana = false;
    try {
      onSolana = isSolanaChain(w.chainId);
    } catch {
      onSolana = false;
    }
    if (!onSolana) skipped += 1;
    return onSolana;
  });

  await forEachLimited(solanaWallets, concurrency, async (wallet) => {
    try {
      await snapshotWallet(wallet, { takenAt: opts.takenAt });
      ok += 1;
    } catch (e) {
      const error = describeError(e);
      failed.push({ walletId: wallet.id, error });
      console.error(`${LOG_PREFIX} wallet ${wallet.id} (${wallet.address}) failed: ${error}`);
    }
  });

  return { ok, failed, skipped, took: Date.now() - started };
}
