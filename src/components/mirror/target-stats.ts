/** Mirror target header numbers and source chip copy. Client-safe, no React runtime. */
import type { MirrorPnlView, MirrorSource, MirrorTargetView } from "@/lib/api-client";
import type { Stat } from "@/components/common/StatStrip";
import { formatUsd } from "@/components/common/format";
import { formatSignedPct, formatSignedUsd } from "@/components/league/format";
import { sinceLabel } from "@/components/mirror/mirror-format";

export function pnlStat(label: string, pnl: MirrorPnlView | null, now: number): Stat {
  if (!pnl) return { label, value: "—", hint: "Not enough history yet" };
  const tone = Math.abs(pnl.absUsd) < 0.005 ? "default" : pnl.absUsd > 0 ? "positive" : "negative";
  return {
    label,
    value: pnl.pct !== null ? formatSignedPct(pnl.pct, 1) : formatSignedUsd(pnl.absUsd),
    hint: `${pnl.pct !== null ? `${formatSignedUsd(pnl.absUsd)} · ` : ""}${sinceLabel(pnl.since, now)}`,
    tone,
  };
}

function stocksLabel(n: number): string {
  return `${n} ${n === 1 ? "stock" : "stocks"}`;
}

/**
 * Headline numbers per source:
 *   paper    "Paper equity" (cash + positions, what the League ranks on) with "$X invested · N stocks",
 *            and the League rank of that same account (15 Sep review M-O)
 *   public   xStocks value and a plain "not a Dulo player, never scored" stat: no rank, no history
 *   snapshot Portfolio value, Season rank, 7 and 30 day value change
 */
export function targetStats(target: MirrorTargetView, nowMs: number): Stat[] {
  const stocks = stocksLabel(target.legs.length);
  if (target.source === "paper") {
    const equity = target.equityUsd ?? target.totalUsd;
    return [
      { label: "Paper equity", value: formatUsd(equity), hint: `${formatUsd(target.totalUsd)} invested · ${stocks}`, tone: "ember" },
      { label: "Competition rank", value: target.leagueRank !== null ? `#${target.leagueRank}` : "—", hint: "This week" },
    ];
  }
  const value: Stat = { label: "Portfolio value", value: formatUsd(target.totalUsd), hint: stocks, tone: "ember" };
  if (target.source === "public") {
    return [value, { label: "Dulo player", value: "No", hint: "Public wallet, never scored" }];
  }
  return [
    value,
    { label: "Season rank", value: target.rank !== null ? `#${target.rank}` : "—", hint: "By points" },
    pnlStat("7 day change", target.pnl7d, nowMs),
    pnlStat("30 day change", target.pnl30d, nowMs),
  ];
}

export interface SourceChip {
  label: string;
  title: string;
  /** Prefix of the age line, e.g. "Snapshot 3m ago". */
  age: string;
}

const SOURCE_CHIPS: Record<MirrorSource, SourceChip> = {
  paper: { label: "Virtual portfolio", title: "Built from competition positions (virtual cash) at today's prices", age: "Valued" },
  snapshot: { label: "On-chain portfolio", title: "Read from the wallet's latest on-chain snapshot", age: "Snapshot" },
  public: { label: "Public wallet · live read", title: "Read live from Solana. Not a Dulo player, never scored", age: "Read" },
};

export function sourceChip(source: MirrorSource): SourceChip {
  return SOURCE_CHIPS[source] ?? SOURCE_CHIPS.snapshot;
}

/** Empty-allocation copy on /copy/[wallet] per source. */
export function emptyAllocationCopy(source: MirrorSource): string {
  if (source === "paper") return "This paper trader is all cash at the moment.";
  if (source === "public") return "This public wallet holds no xStocks worth $1 or more right now.";
  return "The latest snapshot found no xStocks in this wallet.";
}
