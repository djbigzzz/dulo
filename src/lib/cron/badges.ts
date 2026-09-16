/**
 * Cron step "badges" — mint pending soulbound Badges (docs/HANDOFF.md §3.5).
 *
 *   1. League podium: every user holding a PointsEvent whose ref matches
 *      `league:<id>:rank:1|2|3` gets a Badge row with playKey "league_top3" (createMany
 *      skipDuplicates against @@unique(userId, playKey), so re-runs are no-ops). Bots
 *      never receive League points, so they never get the badge either.
 *   2. Pending rows (mint null, oldest first, at most `limit` per tick) are minted to the
 *      user's display wallet (primary, else oldest Solana wallet) through lib/badges/mint
 *      and updated with { mint, txSig }. Each row is isolated: a failure is logged and the
 *      row stays pending for the next tick.
 *   3. Without SERVER_WALLET_SECRET nothing is minted: the step logs once per process and
 *      returns { skipped: true }; the profile shows "Minting soon" for pending rows.
 *
 * Server-only. `opts.mint` / `opts.enabled` exist for tests.
 */
import { BadgeMintingDisabledError, isBadgeMintingEnabled, mintBadge, type MintBadgeInput, type MintBadgeResult } from "@/lib/badges/mint";
import { isBadgeKey, type BadgeKey } from "@/lib/badges/keys";
import { db } from "@/lib/server/db";
import { pickDisplayWallet } from "@/lib/server/queries";
import { describeError } from "./util";

const LOG_PREFIX = "[cron/badges]";

export const LEAGUE_TOP3_BADGE_KEY: BadgeKey = "league_top3";
/** PointsEvent refs written by lib/games/league rollover for the podium. */
export const LEAGUE_TOP3_REF_RE = /^league:[^:]+:rank:[123]$/;
/**
 * Mints attempted per tick. Each is a confirmed transaction paid from the funded server wallet;
 * two per 5-minute tick keeps the tick inside its budget and caps the wallet's burn if a bad
 * row loops (15 Sep review M-L). A backlog drains at 24 an hour.
 */
export const DEFAULT_MINT_LIMIT = 2;

export interface MintPendingOptions {
  limit?: number;
  /** Test hook: replaces lib/badges/mint. */
  mint?: (input: MintBadgeInput) => Promise<MintBadgeResult>;
  /** Test hook: overrides isBadgeMintingEnabled(). */
  enabled?: boolean;
}

export interface MintFailure {
  badgeId: string;
  userId: string;
  playKey: string;
  error: string;
}

export interface MintPendingResult {
  /** league_top3 rows created in this run. */
  leagueTop3Created: number;
  /** Pending rows picked up in this run (at most `limit`). */
  pending: number;
  minted: number;
  failed: MintFailure[];
  /** True when minting is disabled (no server wallet); pending rows were left untouched. */
  skipped: boolean;
  reason: string | null;
  took: number;
}

let warnedDisabled = false;

/** Create the league_top3 Badge row for every podium finisher that lacks one. Returns rows created. */
export async function ensureLeagueTop3Badges(): Promise<number> {
  const events = await db.pointsEvent.findMany({
    where: { source: "league", ref: { contains: ":rank:" } },
    select: { userId: true, ref: true },
  });
  const userIds = [...new Set(events.filter((e) => LEAGUE_TOP3_REF_RE.test(e.ref)).map((e) => e.userId))];
  if (userIds.length === 0) return 0;
  const r = await db.badge.createMany({
    data: userIds.map((userId) => ({ userId, playKey: LEAGUE_TOP3_BADGE_KEY })),
    skipDuplicates: true,
  });
  return r.count;
}

/** The design key for a Badge row: its playKey when that is a design, else the Play's badgeKey. */
async function resolveBadgeKey(playKey: string): Promise<BadgeKey | null> {
  if (isBadgeKey(playKey)) return playKey;
  const play = await db.play.findUnique({ where: { key: playKey }, select: { badgeKey: true } });
  const key = play?.badgeKey ?? null;
  return key && isBadgeKey(key) ? key : null;
}

/**
 * Award podium badges, then mint up to `limit` pending Badge rows. Never throws for a
 * single row; throws only when the shared reads fail (the tick isolates that).
 */
export async function mintPendingBadges(now: Date = new Date(), opts: MintPendingOptions = {}): Promise<MintPendingResult> {
  void now; // the step is clock-independent today; `now` keeps the signature aligned with the other steps
  const started = Date.now();
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_MINT_LIMIT));
  const out: MintPendingResult = { leagueTop3Created: 0, pending: 0, minted: 0, failed: [], skipped: false, reason: null, took: 0 };

  out.leagueTop3Created = await ensureLeagueTop3Badges();

  const pending = await db.badge.findMany({
    where: { mint: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      playKey: true,
      user: { select: { wallets: { select: { address: true, chainId: true, isPrimary: true, createdAt: true } } } },
    },
  });
  out.pending = pending.length;
  if (pending.length === 0) {
    out.took = Date.now() - started;
    return out;
  }

  const enabled = opts.enabled ?? isBadgeMintingEnabled();
  if (!enabled) {
    if (!warnedDisabled) {
      console.warn(`${LOG_PREFIX} SERVER_WALLET_SECRET is empty; ${pending.length} Badge(s) stay pending ("Minting soon")`);
      warnedDisabled = true;
    }
    out.skipped = true;
    out.reason = "SERVER_WALLET_SECRET is empty";
    out.took = Date.now() - started;
    return out;
  }

  const mint = opts.mint ?? mintBadge;
  for (const row of pending) {
    try {
      const wallet = pickDisplayWallet(row.user.wallets.filter((w) => w.chainId.startsWith("solana:")));
      if (!wallet) throw new Error("user has no Solana wallet");
      const key = await resolveBadgeKey(row.playKey);
      if (!key) throw new Error(`no badge design for ${row.playKey}`);
      const r = await mint({ ownerAddress: wallet.address, badgeKey: key });
      await db.badge.update({ where: { id: row.id }, data: { mint: r.mint, txSig: r.txSig } });
      out.minted += 1;
      console.log(`${LOG_PREFIX} minted ${key} for ${row.userId}: mint ${r.mint} tx ${r.txSig}`);
    } catch (e) {
      if (e instanceof BadgeMintingDisabledError) {
        out.skipped = true;
        out.reason = e.message;
        break;
      }
      const error = describeError(e);
      out.failed.push({ badgeId: row.id, userId: row.userId, playKey: row.playKey, error });
      console.error(`${LOG_PREFIX} badge ${row.id} (${row.playKey} for ${row.userId}) failed: ${error}`);
    }
  }

  out.took = Date.now() - started;
  return out;
}

/** Test hook. */
export function resetBadgesCronMemory(): void {
  warnedDisabled = false;
}
