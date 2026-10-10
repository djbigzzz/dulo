"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { useSession } from "@/hooks/useSession";
import { rankLabel } from "@/hooks/session-helpers";
import { SEASON_POINTS_HINT } from "@/lib/games/ledger-policy";
import { apiGet, type LeaderboardResponse, type LeaderboardRow, type MeResponse, type SeasonView, type UserProfile } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { displayName, formatDate, formatPoints } from "@/components/common/format";
import { useLeagueQuery } from "@/components/layout/WeekData";
import { Podium, PodiumSkeleton, type OpenSeatCopy } from "@/components/leaderboard/Podium";
import { LeaderboardTable, LeaderboardTableSkeleton } from "@/components/leaderboard/LeaderboardTable";
import { LeaguePreview, WaysToScore } from "@/components/leaderboard/EmptyBoard";
import { SECTION_TITLE } from "@/components/common/SectionHeading";

const LIMIT = 100;

/**
 * The signed-in player's own numbers, shown even when the board is empty: Season points (what the
 * board ranks), the rank or "Not ranked yet", and the spendable balance on a second line. Drawn as a
 * lit row on the rules (a cream rule on its left), never a box beside a box.
 */
function YourSeasonPoints({ profile, balance, className }: { profile: UserProfile; balance: number | null; className?: string }) {
  return (
    <section
      aria-labelledby="your-season-points"
      className={cn("relative flex min-w-0 flex-col gap-1.5 border-y border-rule bg-white/[0.035] py-3 pr-4 pl-5 sm:py-4", className)}
    >
      <span className="absolute inset-y-0 left-0 w-0.5 bg-foreground" aria-hidden />
      <h2 id="your-season-points" className="truncate text-[0.84375rem] leading-tight font-medium text-muted-foreground">
        Your Season points
      </h2>
      <p className="w-fit max-w-full truncate text-[1.625rem] leading-none font-semibold tracking-[-0.01em] tabular-nums font-stretch-[85%]">
        {formatPoints(profile.points)}
      </p>
      <p className="text-[0.8125rem] text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{rankLabel(profile.rank)}</span> · {SEASON_POINTS_HINT}
      </p>
      {balance !== null ? <p className="text-[0.8125rem] text-muted-foreground tabular-nums">Points balance {formatPoints(balance)}</p> : null}
    </section>
  );
}

/** "Stocks Season 0 · Live" and its dates (mono: they are times), on the right of the title. */
function SeasonLine({ season }: { season: SeasonView | null }) {
  if (!season) return <p className="text-[0.9375rem] text-muted-foreground">No Season yet</p>;
  const phase = season.phase === "active" ? "Live" : season.phase === "upcoming" ? "Upcoming" : "Ended";
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <p className="text-[0.9375rem] text-muted-foreground">
        <span className="font-semibold text-foreground">{season.name}</span> · {phase}
      </p>
      <p className="mono-meta">
        {formatDate(season.startsAt)} – {formatDate(season.endsAt)}
      </p>
    </div>
  );
}

/** The quiet link a filled seat carries: copy that wallet's portfolio. */
function seatAction(meUserId: string | null) {
  return function SeatCopy(row: LeaderboardRow) {
    if (!row.address || row.userId === meUserId) return null;
    return (
      <Link
        href={`/copy/${encodeURIComponent(row.address)}`}
        className={cn(buttonVariants({ variant: "link" }), "text-[0.84375rem] text-muted-foreground hover:text-foreground")}
        aria-label={`Copy the portfolio of ${row.handle ?? row.address}`}
      >
        Copy portfolio
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    );
  };
}

/**
 * The Season leaderboard: the serif title with the Season's dates, the board's numbers on rules
 * (and the player's own, lit), then the three Season seats (an open seat wherever nobody sits yet),
 * then the rest of the standings on rules. An empty Season shows three open seats, the three ways
 * to score, and this week's competition (virtual cash) from the shared week read.
 */
export default function LeaderboardPage() {
  const { session, user } = useSession();
  const sessionKey = session?.userId ?? "";
  const board = useApiQuery((signal) => apiGet<LeaderboardResponse>(`/api/v1/leaderboard?limit=${LIMIT}`, { signal }), sessionKey);
  // Never blocks the board: an anonymous caller simply gets { signedIn: false }.
  const me = useApiQuery((signal) => apiGet<MeResponse>("/api/v1/season/me", { signal }), sessionKey);
  // Only rendered while the Season board is empty (competition preview). The shell's week track reads
  // /api/v1/league already, so this is the same request, never a second one.
  const league = useLeagueQuery(["leaderboard:league", sessionKey]);

  const rows = board.data?.rows ?? [];
  const chainId = board.data?.season?.chainScope[0];
  const profile = me.data?.signedIn ? me.data.profile : null;
  const meUserId = profile?.userId ?? null;
  const onBoard = Boolean(meUserId && rows.some((r) => r.userId === meUserId));
  const ranked = profile !== null && profile.rank !== null;

  // Spendable balance: the profile's own field, else the session's /auth/me summary.
  const balance =
    typeof profile?.balance === "number" && Number.isFinite(profile.balance)
      ? profile.balance
      : typeof user?.points?.balance === "number" && Number.isFinite(user.points.balance)
        ? user.points.balance
        : null;

  const stats: Stat[] | null =
    rows.length > 0
      ? [
          { label: "Players", value: rows.length >= (board.data?.limit ?? LIMIT) ? `${formatPoints(rows.length)}+` : formatPoints(rows.length), hint: "House bots never rank here" },
          { label: "Top points", value: formatPoints(rows[0].points), hint: "Season points" },
        ]
      : null;

  // Signed in: the player's own tile always shows, next to the board numbers or on its own.
  const headerStats =
    stats || profile ? (
      <div className={cn("grid gap-4", stats && profile && "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-6")}>
        {stats ? <StatStrip stats={stats} /> : null}
        {profile ? <YourSeasonPoints profile={profile} balance={balance} className={stats ? undefined : "sm:max-w-md"} /> : null}
      </div>
    ) : board.loading ? (
      <Skeleton className="h-[76px] w-full sm:h-[86px]" aria-hidden />
    ) : null;

  // An open seat says whose it could be: the visitor's, until they are on the board themselves.
  const openSeat: OpenSeatCopy = onBoard ? { title: "Open seat", hint: "Waiting for the next player" } : { title: "Your slot", hint: "Open" };
  const rest = rows.slice(3);

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <PageHeader
        className="mb-0"
        extrasLastOnMobile
        eyebrow="Stocks Season 0"
        title="Leaderboard"
        description="Season points from quests, competition finishes and settled predictions."
        actions={board.data ? <SeasonLine season={board.data.season} /> : board.loading ? <Skeleton className="h-10 w-44" aria-hidden /> : null}
        stats={headerStats}
      />

      {board.loading ? (
        <>
          <PodiumSkeleton />
          <LeaderboardTableSkeleton rows={5} />
        </>
      ) : board.error ? (
        <ErrorState title="Couldn't load the leaderboard" message={board.error} onRetry={board.refetch} />
      ) : rows.length === 0 ? (
        <>
          <section aria-label="Season seats" className="flex flex-col gap-3">
            <Podium rows={rows} aria-label="Season seats, all open" openSeat={openSeat} />
            <p className="text-[0.9375rem] text-muted-foreground">All three games score on one Season leaderboard. House bots never rank here.</p>
          </section>
          <WaysToScore />
          <LeaguePreview data={league.data} loading={league.loading} />
        </>
      ) : (
        <>
          <section aria-labelledby="season-seats" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <h2 id="season-seats" className={SECTION_TITLE}>
                Top of the Season
              </h2>
              <p className="text-[0.9375rem] text-muted-foreground">All three games score here. House bots never rank.</p>
            </div>
            <Podium
              rows={rows}
              meUserId={meUserId}
              openSeat={openSeat}
              renderAction={seatAction(meUserId)}
              className="animate-in duration-500 fade-in-0 motion-reduce:animate-none"
            />
          </section>

          {profile && ranked && !onBoard ? (
            <div
              role="group"
              className="relative flex h-12 items-center gap-3 border-y border-rule bg-white/[0.045] pr-3 pl-4 text-sm sm:pr-4"
              aria-label={`Your rank: ${profile.rank}, ${formatPoints(profile.points)} Season points`}
            >
              <span className="absolute inset-y-0 left-0 w-0.5 bg-foreground" aria-hidden />
              <span className="figure w-12 shrink-0 text-[1.375rem] leading-none text-foreground">{profile.rank}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-semibold text-foreground">{displayName(profile.handle, profile.wallets[0]?.address ?? null, "You")}</span>
                <Badge className="h-5 px-1.5 text-xs font-semibold">You</Badge>
                <span className="hidden text-[0.8125rem] text-muted-foreground sm:inline">outside the top {LIMIT}</span>
              </span>
              <span className="shrink-0 text-[1.0625rem] font-semibold tabular-nums font-stretch-[85%]">{formatPoints(profile.points)}</span>
            </div>
          ) : profile && profile.rank === null ? (
            <p className="border-y border-dashed border-[rgb(243_240_232/0.3)] py-3 text-[0.9375rem] text-muted-foreground">
              You are not on the board yet.{" "}
              <Link href="/quests" className={cn(buttonVariants({ variant: "link" }), "text-[0.9375rem]")}>
                Complete a quest
              </Link>{" "}
              to take a seat.
            </p>
          ) : null}

          {rest.length > 0 ? (
            <section aria-labelledby="season-standings" className="flex flex-col gap-3">
              <h2 id="season-standings" className="text-[1.25rem] leading-tight font-semibold tracking-[-0.01em]">
                Season standings
              </h2>
              <LeaderboardTable rows={rest} meUserId={meUserId} chainId={chainId} />
            </section>
          ) : null}
          <p className="text-[0.84375rem] text-muted-foreground">
            Top {Math.min(LIMIT, rows.length)} · ties share a rank · points only, no cash value
          </p>
        </>
      )}
    </div>
  );
}
