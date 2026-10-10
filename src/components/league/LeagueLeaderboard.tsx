"use client";

import * as React from "react";
import { cn } from "cn";
import type { LeagueLeaderboardRow } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { explorerUrl, formatUsd, truncateAddress } from "@/components/common/format";
import { RankDelta } from "@/components/league/AccountCard";
import { formatSignedPct, formatUsdWhole, ordinal } from "@/components/league/format";

/**
 * This week's standings (the Broadcast mockup's timing tower): rank, the move since the last
 * update, the player, every return drawn from one zero line ("vs $10,000"), equity and return. House
 * bots are dimmed and carry the bot mark (the legend above the board says how many there are); real
 * players are lit, with a cream rule on the left. An open seat ("Your slot") sits where a new
 * player would start, at 0.00%, carrying Connect. A cream rule after 10th marks the places that
 * earn Season points.
 *
 * Built as an ARIA table on CSS grid rows, so a phone can drop columns (delta, the zero line,
 * equity) while every row stays on one line at 390px. The zero line is decorative: its column is
 * hidden from the table, and every number it draws is in the Return column.
 */

/** Phone: rank · player · return. md: the full board. lg (beside the trade panel): no equity. xl: the full board. */
export const BOARD_COLS =
  "grid grid-cols-[36px_minmax(0,1fr)_76px] items-center gap-x-2 md:grid-cols-[46px_30px_minmax(0,1fr)_168px_118px_92px] lg:grid-cols-[40px_28px_minmax(0,1fr)_112px_84px] xl:grid-cols-[46px_30px_minmax(0,1fr)_168px_118px_92px]";
/** The open seat: its trailing column holds Connect over the equity and return columns (md, xl), or after the player (phone, lg). */
const SLOT_COLS =
  "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-2 md:grid-cols-[46px_30px_minmax(0,1fr)_168px_218px] lg:grid-cols-[40px_28px_minmax(0,1fr)_auto] xl:grid-cols-[46px_30px_minmax(0,1fr)_168px_218px]";

const DELTA_CELL = "hidden md:block";
/** The zero line's column: from md on every row. */
const BAR_CELL = "relative hidden h-full md:block";
/** The open seat's zero line: md and xl only (at lg its trailing column holds Connect instead). */
const SEAT_BAR_CELL = "relative hidden h-full md:block lg:hidden xl:block";
const EQUITY_CELL = "hidden text-right md:block lg:hidden xl:block";

/** Shared with PositionsTable and the settled panel: rows on rules, never a box. */
export const LEAGUE_PANEL = "border-b border-rule";

/** The house-bot glyph from the mockup (15 x 12): a small robot head in the dim grey. Decorative. */
export function BotGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 15 12" fill="none" stroke="currentColor" strokeWidth={1.4} className={cn("h-3 w-[15px] shrink-0", className)} aria-hidden>
      <rect x="1.2" y="3.4" width="12.6" height="7.6" rx="1.6" />
      <path d="M7.5 3.4V1" />
      <circle cx="5" cy="7.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A rank as a scoreboard numeral (Archivo's narrow cut): cream for 1st, muted below it. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-7 shrink-0 items-center justify-center text-lg leading-none font-medium tabular-nums font-stretch-[74%]",
        rank === 1 ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

/**
 * Marker for seeded bot accounts: the bot glyph, plus the visible words "house bot" from 400px
 * (touch screens never show a title tooltip). The competition board passes `words={false}`: its
 * legend says once how many of the players are house bots, and the glyph keeps its label.
 */
export function BotMarker({ className, words = true }: { className?: string; words?: boolean }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-dim", className)}
      title="House bot, never earns points"
      role="img"
      aria-label="House bot, never earns points"
    >
      <BotGlyph />
      {words ? <span className="hidden text-xs whitespace-nowrap text-muted-foreground min-[400px]:inline">house bot</span> : null}
    </span>
  );
}

/** A signed return in the condensed cut: green for a gain, red for a loss, muted when flat. */
export function ReturnPill({ pct, digits = 2, className }: { pct: number | null; digits?: number; className?: string }) {
  const flat = pct === null || !Number.isFinite(pct) || Math.abs(pct) < 0.005;
  return (
    <span className={cn("font-semibold tabular-nums font-stretch-[85%]", flat ? "text-muted-foreground" : pct > 0 ? "text-yes" : "text-no", className)}>
      {formatSignedPct(pct, digits)}
    </span>
  );
}

/** The return at the 2 decimals the board prints, so the open seat lands where the numbers say it does. */
const atBoardPrecision = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a new player (0.00%) would rank: after every row at or above 0.00%. 1-based; the row count
 * plus one when nobody is below zero.
 */
export function openSeatPlace(rows: readonly Pick<LeagueLeaderboardRow, "pnlPct">[]): number {
  const i = rows.findIndex((r) => Number.isFinite(r.pnlPct) && atBoardPrecision(r.pnlPct) < 0);
  return (i === -1 ? rows.length : i) + 1;
}

/** "15 of 16 are house bots" (said once, above the board); null when there is no house bot on it. */
export function houseBotLegend(rows: readonly Pick<LeagueLeaderboardRow, "isBot">[], limit: number): string | null {
  const bots = rows.filter((r) => r.isBot).length;
  if (bots === 0) return null;
  if (rows.length >= limit) return `${bots} of the top ${limit} are house bots`;
  if (bots === rows.length) return bots === 1 ? "The one player is a house bot" : `All ${bots} are house bots`;
  return `${bots} of ${rows.length} are house bots`;
}

export interface OpenSeat {
  /** Signed out: Connect (the view's one gold action). Signed in without an account: nothing, or a jump to the trade panel. */
  action?: React.ReactNode;
  signedIn: boolean;
}

export interface LeagueLeaderboardProps {
  rows: LeagueLeaderboardRow[];
  /** CAIP-2 chain id for the explorer link on addresses. */
  chainId?: string;
  /** Hide the delta column (settled weeks). */
  showDelta?: boolean;
  /** The week's starting virtual cash: the zero line ("vs $10,000") and the open seat's line. */
  startingCashUsd?: number;
  /** The open seat, inserted where a 0.00% return would rank. Omitted or null: none. */
  seat?: OpenSeat | null;
  /** Draw "In the points" under this rank (10). Null or omitted: no line. */
  pointsCut?: number | null;
  /** The line's sentence ("Top 10 with 3+ paper trades earn Season points"). */
  pointsNote?: React.ReactNode;
  /** The caller's own row when it is not on the board the page holds (ranked below the top 50). */
  extraMe?: LeagueLeaderboardRow | null;
  /** The table's accessible name. */
  label?: string;
  className?: string;
}

export function LeagueLeaderboard({
  rows,
  chainId,
  showDelta = true,
  startingCashUsd = 10_000,
  seat = null,
  pointsCut = null,
  pointsNote,
  extraMe = null,
  label = "This week's standings",
  className,
}: LeagueLeaderboardProps) {
  const all = extraMe ? [...rows, extraMe] : rows;
  // Every return drawn from the same zero; the widest move spans half the column.
  const scale = Math.max(0.25, ...all.map((r) => (Number.isFinite(r.pnlPct) ? Math.abs(r.pnlPct) : 0)));
  const place = seat ? openSeatPlace(rows) : null;
  const cash = formatUsdWhole(startingCashUsd);

  const out: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (seat && place === i + 1) out.push(<SeatRow key="seat" seat={seat} place={place} cash={cash} />);
    if (pointsCut !== null && i === pointsCut && rows.length > pointsCut) out.push(<PointsLine key="points" note={pointsNote} />);
    out.push(<BoardRow key={row.userId} row={row} chainId={chainId} showDelta={showDelta} scale={scale} beyond={pointsCut !== null && row.rank > pointsCut} />);
  });
  if (seat && place === rows.length + 1) out.push(<SeatRow key="seat" seat={seat} place={place} cash={cash} />);
  if (extraMe) {
    out.push(
      <div key="gap" role="row" className="flex h-7 items-center border-t border-rule pl-3 text-sm text-dim" aria-hidden>
        <span>⋯</span>
      </div>,
    );
    out.push(<BoardRow key={`me:${extraMe.userId}`} row={extraMe} chainId={chainId} showDelta={showDelta} scale={scale} beyond />);
  }

  return (
    <div role="table" aria-label={label} data-slot="league-board" className={cn(LEAGUE_PANEL, className)}>
      <div role="rowgroup">
        <div role="row" className={cn(BOARD_COLS, "h-[34px] text-[0.78125rem] leading-none font-medium text-dim max-md:sr-only")}>
          <span role="columnheader" className="pl-2 md:pl-3">
            #
          </span>
          <span role="columnheader" className={DELTA_CELL}>
            <span className="sr-only">Move since the last update</span>
          </span>
          <span role="columnheader">Player</span>
          <span className="hidden h-full items-center justify-center md:flex" aria-hidden>
            vs {cash}
          </span>
          <span role="columnheader" className={EQUITY_CELL}>
            Equity
          </span>
          <span role="columnheader" className="pr-0.5 text-right">
            Return
          </span>
        </div>
      </div>
      <div role="rowgroup">{out}</div>
    </div>
  );
}

function PlayerName({ row, chainId }: { row: LeagueLeaderboardRow; chainId?: string }) {
  const lit = !row.isBot;
  const cls = cn("truncate", lit ? "font-semibold text-foreground" : "text-muted-foreground");
  if (row.handle) return <span className={cls}>{row.handle}</span>;
  if (row.address) {
    const href = chainId ? explorerUrl(chainId, row.address) : null;
    const short = truncateAddress(row.address);
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={row.address}
        aria-label={`${short}, open in the explorer (new tab)`}
        className={cn(cls, "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]")}
      >
        {short}
      </a>
    ) : (
      <span className={cls} title={row.address}>
        {short}
      </span>
    );
  }
  return <span className="truncate text-muted-foreground">Anonymous</span>;
}

/** The return as a bar from the zero line: right and green for a gain, left and red for a loss. Decorative. */
function ZeroLineBar({ pct, scale, dim, className }: { pct: number; scale: number; dim: boolean; className?: string }) {
  const width = Number.isFinite(pct) ? Math.min(50, (Math.abs(pct) / scale) * 50) : 0;
  return (
    <span className={cn(className, "before:absolute before:top-0 before:-bottom-px before:left-1/2 before:w-px before:bg-rule-2")} aria-hidden>
      {width > 0 ? (
        <i
          className={cn("absolute top-1/2 -mt-[3px] h-1.5", pct >= 0 ? "left-1/2 bg-yes" : "right-1/2 bg-no", dim && "opacity-50")}
          style={{ width: `${width.toFixed(2)}%` }}
        />
      ) : null}
    </span>
  );
}

function BoardRow({ row, chainId, showDelta, scale, beyond }: { row: LeagueLeaderboardRow; chainId?: string; showDelta: boolean; scale: number; beyond: boolean }) {
  const lit = !row.isBot;
  return (
    <div
      role="row"
      data-user-id={row.userId}
      data-bot={row.isBot ? "" : undefined}
      aria-current={row.isMe ? "true" : undefined}
      className={cn(
        BOARD_COLS,
        "relative h-[2.625rem] border-t border-rule",
        lit && "bg-white/[0.045] before:absolute before:-top-px before:bottom-0 before:left-0 before:w-0.5 before:bg-foreground",
        beyond && row.isBot && "opacity-70",
      )}
    >
      <span
        role="cell"
        className={cn(
          "pl-2 text-lg leading-none font-medium tabular-nums font-stretch-[72%] md:pl-3 md:text-xl",
          row.rank === 1 || lit ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="sr-only">Rank </span>
        {row.rank}
      </span>
      <span role="cell" className={DELTA_CELL}>
        {showDelta ? <RankDelta delta={row.delta} /> : null}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-2 text-[0.9375rem] leading-none md:gap-[9px] md:text-[0.96875rem]">
        <PlayerName row={row} chainId={chainId} />
        {row.isBot ? <BotMarker words={false} /> : null}
        {row.isMe ? (
          <Badge className="h-[1.375rem] px-1.5 text-xs font-semibold">You</Badge>
        ) : lit ? (
          <Badge variant="outline" className="hidden h-[1.375rem] px-1.5 text-xs md:inline-flex">
            Player
          </Badge>
        ) : null}
      </span>
      <ZeroLineBar pct={row.pnlPct} scale={scale} dim={!lit} className={BAR_CELL} />
      <span role="cell" className={cn(EQUITY_CELL, "text-sm leading-none tabular-nums", lit ? "text-muted-foreground" : "text-dim")}>
        {formatUsd(row.equityUsd)}
      </span>
      <span role="cell" className="pr-0.5 text-right leading-none">
        <ReturnPill pct={row.pnlPct} className="text-base md:text-[1.0625rem]" />
      </span>
    </div>
  );
}

/** The open seat: a dashed outline where a new player would start, at 0.00% on the zero line. */
function SeatRow({ seat, place, cash }: { seat: OpenSeat; place: number; cash: string }) {
  const where = `${ordinal(place)} at 0.00%`;
  return (
    <div
      role="row"
      data-slot="league-open-seat"
      className={cn(SLOT_COLS, "relative my-0.5 min-h-[3.75rem] border border-dashed border-[rgb(243_240_232/0.38)] py-2 [&+[role=row]]:border-t-transparent")}
    >
      <span role="cell" className="pl-1.5 md:pl-[11px]">
        <span className="block size-4 rounded-full border-[1.5px] border-dashed border-muted-foreground md:size-[18px]" aria-hidden />
        <span className="sr-only">Open seat</span>
      </span>
      <span role="cell" className={DELTA_CELL} />
      <span role="cell" className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[0.9375rem] leading-none font-semibold text-foreground">Your slot</span>
        <span className="text-[0.84375rem] leading-snug text-muted-foreground">
          <span className="md:hidden">{cash} virtual cash</span>
          <span className="hidden md:inline">
            {seat.signedIn ? `${cash} virtual cash, your first trade starts you ${ordinal(place)}` : `${cash} virtual cash, you would start ${where}`}
          </span>
        </span>
      </span>
      {/* The zero line runs through the seat, with the starting point on it (md and xl; at lg the seat needs the room for Connect). */}
      <span className={cn(SEAT_BAR_CELL, "before:absolute before:-top-2.5 before:-bottom-2.5 before:left-1/2 before:w-px before:bg-rule-2")} aria-hidden>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-[5px] py-[3px] text-[0.71875rem] leading-none font-medium text-foreground ring-1 ring-rule-2 ring-inset">
          start
        </span>
      </span>
      <span role="cell" className="flex justify-end pr-1.5 md:pr-2">
        {seat.action}
      </span>
    </div>
  );
}

/** The cut for Season points: a cream rule after 10th and one plain sentence. */
function PointsLine({ note }: { note?: React.ReactNode }) {
  return (
    <div role="row" data-slot="league-points-line" className="flex min-h-9 items-center gap-3.5 border-t border-foreground py-2">
      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1">
        <span className="label-caps text-foreground">In the points</span>
        {note ? <span className="text-[0.78125rem] leading-snug text-muted-foreground md:text-[0.84375rem]">{note}</span> : null}
      </span>
    </div>
  );
}

export function LeagueLeaderboardSkeleton({ rows = 10, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(LEAGUE_PANEL, className)} aria-hidden>
      <div className={cn(BOARD_COLS, "h-[34px] max-md:hidden")}>
        <Skeleton className="ml-3 h-3 w-3" />
        <span className={DELTA_CELL} />
        <Skeleton className="h-3 w-12" />
        <span className={BAR_CELL} />
        <span className={EQUITY_CELL} />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn(BOARD_COLS, "h-[2.625rem] border-t border-rule")}>
          <Skeleton className="ml-2 h-4 w-4 md:ml-3" />
          <span className={DELTA_CELL} />
          <Skeleton className="h-4 w-36 max-w-full" />
          <span className={BAR_CELL} />
          <span className={EQUITY_CELL}>
            <Skeleton className="ml-auto h-3.5 w-20" />
          </span>
          <Skeleton className="ml-auto h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

export default LeagueLeaderboard;
