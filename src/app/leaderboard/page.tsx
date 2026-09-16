"use client";

import Link from "next/link";
import { cn } from "cn";
import { useSession } from "@/hooks/useSession";
import { rankLabel } from "@/hooks/session-helpers";
import { SEASON_POINTS_HINT } from "@/lib/games/ledger-policy";
import { apiGet, type LeaderboardResponse, type LeagueResponse, type MeResponse, type UserProfile } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { ErrorState } from "@/components/common/ErrorState";
import { SeasonBadge, SeasonBadgeSkeleton } from "@/components/common/SeasonBadge";
import { AddressChip } from "@/components/common/AddressChip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatPoints } from "@/components/common/format";
import { Podium, PodiumSkeleton } from "@/components/leaderboard/Podium";
import { LeaderboardTable, LeaderboardTableSkeleton } from "@/components/leaderboard/LeaderboardTable";
import { LeaguePreview, WaysToScore } from "@/components/leaderboard/EmptyBoard";

const LIMIT = 100;

/**
 * The signed-in player's own tile, shown even when the board is empty: Season points (what the board
 * ranks), the rank or "Not ranked yet", and the spendable balance on a second line.
 */
function YourSeasonPoints({ profile, balance, className }: { profile: UserProfile; balance: number | null; className?: string }) {
  return (
    <section
      aria-labelledby="your-season-points"
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-2xl border border-white/[0.07] bg-card bg-[linear-gradient(90deg,rgb(255_106_42/0.08),transparent_60%)] px-4 py-3 shadow-[inset_2px_0_0_var(--ember)] sm:px-5 sm:py-4",
        className,
      )}
    >
      <h2 id="your-season-points" className="truncate text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your Season points
      </h2>
      <p className="w-fit max-w-full truncate text-2xl font-semibold tracking-tight text-gradient-ember tabular-nums sm:text-[1.9rem] sm:leading-tight">
        {formatPoints(profile.points)}
      </p>
      <p className="text-xs text-muted-foreground/90">
        <span className="font-medium text-foreground tabular-nums">{rankLabel(profile.rank)}</span> · {SEASON_POINTS_HINT}
      </p>
      {balance !== null ? <p className="text-xs text-muted-foreground/90 tabular-nums">Points balance {formatPoints(balance)}</p> : null}
    </section>
  );
}

export default function LeaderboardPage() {
  const { session, user } = useSession();
  const sessionKey = session?.userId ?? "";
  const board = useApiQuery((signal) => apiGet<LeaderboardResponse>(`/api/v1/leaderboard?limit=${LIMIT}`, { signal }), sessionKey);
  // Never blocks the board: an anonymous caller simply gets { signedIn: false }.
  const me = useApiQuery((signal) => apiGet<MeResponse>("/api/v1/season/me", { signal }), sessionKey);
  // Only rendered while the Season board is empty (competition preview); cheap and never blocks.
  const league = useApiQuery((signal) => apiGet<LeagueResponse>("/api/v1/league", { signal }), sessionKey);

  const rows = board.data?.rows ?? [];
  const chainId = board.data?.season?.chainScope[0];
  const profile = me.data?.signedIn ? me.data.profile : null;
  const meUserId = profile?.userId ?? null;
  const onBoard = Boolean(meUserId && rows.some((r) => r.userId === meUserId));

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
          { label: "Players", value: rows.length >= (board.data?.limit ?? LIMIT) ? `${formatPoints(rows.length)}+` : formatPoints(rows.length) },
          { label: "Top points", value: formatPoints(rows[0].points), tone: "gold", hint: "Season points" },
        ]
      : null;

  // Signed in: the player's own tile always shows, next to the board numbers or on its own.
  const headerStats =
    stats || profile ? (
      <div className={cn("grid gap-3", stats && profile && "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        {stats ? <StatStrip stats={stats} /> : null}
        {profile ? <YourSeasonPoints profile={profile} balance={balance} className={stats ? undefined : "sm:max-w-md"} /> : null}
      </div>
    ) : board.loading ? (
      <Skeleton className="h-[74px] w-full rounded-2xl sm:h-[82px]" aria-hidden />
    ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        className="mb-0"
        eyebrow="Season 0"
        title="Leaderboard"
        description="Season points from quests, weekly competition finishes and settled predictions. The starter grant itself doesn't count."
        actions={board.data ? <SeasonBadge season={board.data.season} className="hidden sm:inline-flex" /> : board.loading ? <SeasonBadgeSkeleton className="hidden sm:block" /> : null}
        stats={headerStats}
      />

      {board.loading ? (
        <>
          <PodiumSkeleton />
          <LeaderboardTableSkeleton />
        </>
      ) : board.error ? (
        <ErrorState title="Couldn't load the leaderboard" message={board.error} onRetry={board.refetch} />
      ) : rows.length === 0 ? (
        <>
          <WaysToScore />
          <LeaguePreview data={league.data} loading={league.loading} />
        </>
      ) : (
        <>
          {/* A podium needs three plinths: with one or two players the table alone tells the truth. */}
          {rows.length >= 3 ? (
            <Podium rows={rows} meUserId={meUserId} className="animate-in pt-10 duration-500 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none sm:pt-12" />
          ) : null}

          {profile && profile.rank !== null && !onBoard ? (
            <div
              role="group"
              className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-card bg-[linear-gradient(90deg,rgb(255_106_42/0.10),transparent_55%)] px-4 py-3 text-sm shadow-[inset_2px_0_0_var(--ember)] sm:px-5"
              aria-label={`Your rank: ${profile.rank}, ${formatPoints(profile.points)} Season points`}
            >
              <span className="w-14 shrink-0 text-lg font-semibold tracking-tight text-ember tabular-nums">#{profile.rank}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 rounded-full border border-ember/30 bg-ember/10 px-2 py-0.5 text-xs font-medium text-ember">You</span>
                {profile.handle ? (
                  <span className="truncate font-medium">{profile.handle}</span>
                ) : profile.wallets[0] ? (
                  <AddressChip address={profile.wallets[0].address} chainId={profile.wallets[0].chainId} copy={false} />
                ) : null}
                <span className="hidden text-xs text-muted-foreground sm:inline">outside the top {LIMIT}</span>
              </span>
              <span className="shrink-0 font-semibold tracking-tight tabular-nums">{formatPoints(profile.points)}</span>
            </div>
          ) : profile && profile.rank === null ? (
            <p className="text-sm text-muted-foreground">
              You are not on the board yet.{" "}
              <Link href="/quests" className="font-medium text-foreground underline decoration-white/25 underline-offset-4 transition-colors hover:decoration-ember hover:text-ember">
                Complete a quest
              </Link>{" "}
              to get on it.
            </p>
          ) : null}

          <LeaderboardTable rows={rows} meUserId={meUserId} chainId={chainId} />
          <p className="text-center text-sm text-muted-foreground">
            Top {Math.min(LIMIT, rows.length)} · ties share a rank
          </p>
        </>
      )}
    </div>
  );
}
