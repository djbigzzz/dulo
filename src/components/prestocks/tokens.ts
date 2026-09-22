import type { CorporateActionView, LeaguePositionView, LeagueSymbolView } from "@/lib/api-client";
import { isPreIpoSymbol } from "@/components/league/symbol-source";

/**
 * Pre-IPO token facts the /prestocks page needs on the client: the name and logo of each of the
 * eight PreStocks tokens, and the small pure helpers behind the board. Client-safe, no React, no
 * server imports: lib/assets/prestocks is server-side (it talks to the issuer API), so the eight
 * entries are repeated here and pinned equal to PRESTOCKS_STATIC by tests/prestocks-page.test.ts.
 *
 * A PreStocks token is a "pre-IPO token": never a share, a stock or equity. The issuer mark and the
 * DEX price are two labelled numbers with their own sources and ages; nothing here computes a
 * difference, a percentage gap or a word that reads as a signal.
 */

export interface PreIpoTokenFacts {
  symbol: string;
  /** The issuer's product name ("SpaceX PreStocks"). */
  name: string;
  /** Token-2022 mint on Solana mainnet. */
  mint: string;
}

/** Issuer logo base; the logo of a token is `${base}/${symbol.toLowerCase()}.png` (lib/assets/prestocks PRESTOCKS_LOGO_BASE). */
export const PRE_IPO_LOGO_BASE = "https://www.prestocks.com/logos";

/** The eight PreStocks tokens (22 Sep 2026), symbol order. Pinned equal to lib/assets/prestocks PRESTOCKS_STATIC. */
export const PRE_IPO_TOKENS: readonly PreIpoTokenFacts[] = Object.freeze([
  { symbol: "ANDURIL", name: "Anduril PreStocks", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { symbol: "ANTHROPIC", name: "Anthropic PreStocks", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { symbol: "FIGUREAI", name: "Figure AI PreStocks", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" },
  { symbol: "KALSHI", name: "Kalshi PreStocks", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { symbol: "NEURALINK", name: "Neuralink PreStocks", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { symbol: "OPENAI", name: "OpenAI PreStocks", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { symbol: "POLYMARKET", name: "Polymarket PreStocks", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { symbol: "SPACEX", name: "SpaceX PreStocks", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
]);

/** The four pre-IPO quests, in the order the page shows them (catalogue keys; two in-platform, two on-chain). */
export const PRE_IPO_QUEST_KEYS: readonly string[] = Object.freeze(["first_preipo_trade", "preipo_trio", "pre_ipo_position", "held_through_split"]);

/** The Partner slug whose detail carries the corporate actions on the PreStocks mints. */
export const PRE_IPO_PARTNER_SLUG = "prestocks";

/** Copy shown once above the board's outbound links and the trade section. */
export const PRE_IPO_BOARD_HINT = "Two prices, two sources: the DEX quote Dulo trades on and the mark the issuer publishes. Each carries its own age.";
export const PRE_IPO_TRADE_NOTE = "Counts on this week's leaderboard alongside your xStock trades. Virtual cash, points only.";

const BY_SYMBOL: ReadonlyMap<string, PreIpoTokenFacts> = new Map(PRE_IPO_TOKENS.map((t) => [t.symbol, t]));

/** The facts for a symbol (case-insensitive), or null for a token this build does not know. */
export function preIpoToken(symbol: string): PreIpoTokenFacts | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** "https://www.prestocks.com/logos/spacex.png" */
export function preIpoLogoUrl(symbol: string): string {
  return `${PRE_IPO_LOGO_BASE}/${symbol.trim().toLowerCase()}.png`;
}

/** The mint of a CAIP-19 Solana token id ("solana:<chain>/token:<mint>"), or null when the id is not one. */
export function mintOfAssetId(assetId: string): string | null {
  const m = /^solana:[^/]+\/token:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(assetId.trim());
  return m ? m[1] : null;
}

/**
 * The Jupiter swap page for a token, USDC to the mint, with no amount: the swap is the viewer's
 * to make from their own wallet (in-app execution stays on the cut list). Null without a mint.
 */
export function jupiterOpenUrl(mint: string | null): string | null {
  if (!mint) return null;
  const params = new URLSearchParams({ sell: "USDC", buy: mint });
  return `https://jup.ag/swap?${params.toString()}`;
}

/** One row of the board: a symbols-endpoint entry joined with its name, logo, mint and any corporate action. */
export interface PreIpoBoardRow {
  view: LeagueSymbolView;
  symbol: string;
  name: string;
  logoUrl: string;
  mint: string | null;
  jupiterUrl: string | null;
  action: CorporateActionView | null;
}

/**
 * The pre-IPO entries of the symbols endpoint as board rows, in the endpoint's order (the static
 * eight, then anything the live API added). An entry the static map does not know still shows,
 * named by its symbol. A corporate action is matched by assetId.
 */
export function preIpoBoardRows(symbols: readonly LeagueSymbolView[], actions: readonly CorporateActionView[] | null | undefined): PreIpoBoardRow[] {
  const byAssetId = new Map((actions ?? []).map((a) => [a.assetId, a]));
  return symbols.filter(isPreIpoSymbol).map((view) => {
    const facts = preIpoToken(view.symbol);
    const mint = facts?.mint ?? mintOfAssetId(view.assetId);
    return {
      view,
      symbol: view.symbol,
      name: facts?.name ?? view.symbol,
      logoUrl: preIpoLogoUrl(view.symbol),
      mint,
      jupiterUrl: jupiterOpenUrl(mint),
      action: byAssetId.get(view.assetId) ?? null,
    };
  });
}

/** The 24h move as the board prints it: "+3.2%" / "−1.4%" / "0.0%", or null when Jupiter gave none. */
export function formatChange24h(change: number | null | undefined): string | null {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  const abs = Math.abs(change).toFixed(1);
  if (Number(abs) === 0) return "0.0%";
  return `${change > 0 ? "+" : "−"}${abs}%`;
}

/** Symbols the competition tags as pre-IPO (upper-cased), for filtering positions and trades. */
export function preIpoSymbolSet(symbols: readonly LeagueSymbolView[] | null | undefined): Set<string> {
  const set = new Set<string>(PRE_IPO_TOKENS.map((t) => t.symbol));
  for (const s of symbols ?? []) if (isPreIpoSymbol(s)) set.add(s.symbol.toUpperCase());
  return set;
}

/** The caller's competition positions in pre-IPO tokens. */
export function preIpoPositions(positions: readonly LeaguePositionView[] | null | undefined, preIpo: ReadonlySet<string>): LeaguePositionView[] {
  return (positions ?? []).filter((p) => preIpo.has(p.symbol.toUpperCase()));
}

/** Sum of the week's P&L over the pre-IPO positions; null when none of them has a live price. */
export function preIpoPnlUsd(positions: readonly LeaguePositionView[]): number | null {
  let sum = 0;
  let priced = false;
  for (const p of positions) {
    if (p.pnlUsd === null) continue;
    sum += p.pnlUsd;
    priced = true;
  }
  return priced ? sum : null;
}
