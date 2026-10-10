"use client";

import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import * as React from "react";
import { ArrowRight, ArrowUpRight, Zap } from "lucide-react";
import { cn } from "cn";
import { apiGet, type MeResponse, type UserProfile } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHeading } from "@/components/common/SectionHeading";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { SignInBanner } from "@/components/common/SignInBanner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { AddressChip } from "@/components/common/AddressChip";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { useApiQuery } from "@/components/common/useApiQuery";
import { ageSeconds, chainLabel, displayName, explorerUrl, formatAge, formatDate, formatDateTime, formatPoints } from "@/components/common/format";
import { BadgeGrid, BadgePreviewGrid } from "@/components/profile/BadgeGrid";
import { BadgeMedallion, MedallionFrame } from "@/components/plays/PlayCard";
import { partnerPageHref } from "@/components/plays/play-meta";
import { SEASON_POINTS_HINT, type PointsHistoryRow } from "@/lib/games/ledger-policy";
import { signedPoints, starterPointsHint } from "@/hooks/session-helpers";

/** The server sends up to 20 rows; the list never shows more. */
const HISTORY_LIMIT = 20;
const HISTORY_EMPTY = "No points yet. Your starter points appear after you sign in.";

/** `profile.history` read defensively: null when the server did not send it (older server). */
function historyRows(history: unknown): PointsHistoryRow[] | null {
  if (!Array.isArray(history)) return null;
  return history
    .filter(
      (r): r is PointsHistoryRow =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as PointsHistoryRow).label === "string" &&
        typeof (r as PointsHistoryRow).delta === "number" &&
        Number.isFinite((r as PointsHistoryRow).delta) &&
        typeof (r as PointsHistoryRow).ts === "string",
    )
    .slice(0, HISTORY_LIMIT);
}

export default function ProfilePage() {
  const { session } = useSession();
  const q = useApiQuery((signal) => apiGet<MeResponse>("/api/v1/season/me", { signal }), session?.userId ?? "");

  if (q.loading) return <ProfileSkeleton />;
  if (q.error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader className="mb-0" title="Profile" />
        <ErrorState title="Couldn't load your profile" message={q.error} onRetry={q.refetch} />
      </div>
    );
  }

  const profile = q.data?.signedIn ? q.data.profile : null;
  return profile ? <ProfileBody profile={profile} /> : <SignedOut />;
}

/** Rows on 1px rules (no panel, no zebra): a rule above each row and one under the last. */
const LIST = "border-b border-rule [&>li]:border-t [&>li]:border-rule";
/** The round ink well for a quest without its own art (docs/DESIGN.md logo well). */
const ICON_WELL = "flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-4 text-foreground ring-1 ring-rule-2 ring-inset";


/** What a profile keeps, said once each on the rules: the signed-out page's three lanes. */
const PERKS = [
  { title: "Season points", text: "Every settled prediction, weekly competition (virtual cash) finish and quest adds to your Season points." },
  { title: "Your rank", text: "See where you stand on the Season leaderboard. House bots never rank there." },
  { title: "Quests completed", text: "Each one with the proof behind it, read from your own wallets." },
];

function SignedOut() {
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <PageHeader
        className="mb-0"
        eyebrow="Stocks Season 0"
        title="Profile"
        description="Your points, rank and Badges, built from your own wallets."
      />

      <SignInBanner title="Connect to open your profile." hint="Sign one message with your wallet. Nothing to fill in, no transaction." />

      <section aria-labelledby="profile-keeps" className="flex flex-col gap-4">
        <SectionHeading id="profile-keeps" title="What your profile keeps" />
        <ul className={LIST}>
          {PERKS.map(({ title, text }) => (
            <li key={title} className="grid gap-x-8 gap-y-1 py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-baseline">
              <span className="text-[1.0625rem] font-semibold">{title}</span>
              <span className="text-[0.9375rem] leading-relaxed text-muted-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="badge-preview" className="flex flex-col gap-4">
        <SectionHeading id="badge-preview" title="Badges you can earn" note="Soulbound tokens minted to your wallet. They cannot be sold or transferred." />
        <BadgePreviewGrid />
      </section>
    </div>
  );
}

function ProfileBody({ profile }: { profile: UserProfile }) {
  const primary = profile.wallets.find((w) => w.isPrimary) ?? profile.wallets[0] ?? null;
  const name = displayName(profile.handle, primary?.address ?? null, "Player");
  const minted = profile.badges.filter((b) => b.mint && b.txSig).length;
  // Spendable balance (starter points included); older servers only send Season points.
  const balance = typeof profile.balance === "number" && Number.isFinite(profile.balance) ? profile.balance : profile.points;
  const history = historyRows(profile.history);

  const stats: Stat[] = [
    { label: "Points balance", value: formatPoints(balance), hint: starterPointsHint(profile.starterPoints, balance) },
    { label: "Season points", value: formatPoints(profile.points), hint: SEASON_POINTS_HINT },
    {
      label: "Rank",
      value:
        profile.rank !== null ? (
          `#${formatPoints(profile.rank)}`
        ) : (
          <span className="text-base font-medium text-muted-foreground sm:text-xl">Not ranked yet</span>
        ),
      hint: profile.rank !== null ? "this Season" : "Earn Season points to rank",
    },
    { label: "Quests completed", value: `${profile.playsCompleted}/${profile.playsTotal}` },
    { label: "Badges", value: profile.badges.length, hint: profile.badges.length > 0 ? `${minted} minted` : undefined },
  ];

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <PageHeader
        className="mb-0"
        eyebrow="Your profile · Stocks Season 0"
        title={name}
        description={
          profile.handle && primary ? (
            <AddressChip address={primary.address} chainId={primary.chainId} explorer className="h-auto rounded-none border-0 bg-transparent px-0 text-[0.84375rem] text-muted-foreground" />
          ) : undefined
        }
        actions={
          <Link href="/leaderboard" className={cn(buttonVariants({ variant: "link" }), "text-[0.9375rem]")}>
            See the leaderboard
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        }
        stats={
          <div className="flex flex-col gap-2">
            {/* Five pairs: 2 columns on a phone (Badges spans the last row), one row of five from sm. */}
            <StatStrip stats={stats} />
            <p className="text-[0.8125rem] text-muted-foreground">
              Points only, no cash value.
              {profile.pointsAllTime !== profile.points ? ` All Seasons: ${formatPoints(profile.pointsAllTime)} points.` : ""}
            </p>
          </div>
        }
      />

      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-12">
          {/* Points history: hidden when the server does not send it. */}
          {history ? (
            <section aria-labelledby="points-history" className="flex flex-col gap-3">
              <SectionHeading id="points-history" title="Points history" note="Every change to your points this Season, newest first." />
              {history.length === 0 ? (
                <p className="flex min-h-14 items-center border-y border-rule text-[0.9375rem] text-muted-foreground">{HISTORY_EMPTY}</p>
              ) : (
                <ul className={LIST}>
                  {history.map((row, i) => (
                    <li key={`${row.ts}:${i}`} className="flex min-h-14 items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.label}</p>
                        <p className="truncate">
                          <time dateTime={row.ts} title={formatDateTime(row.ts)} className="mono-meta">
                            {formatAge(ageSeconds(row.ts))}
                          </time>
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[1.0625rem] font-semibold tabular-nums font-stretch-[85%]",
                          row.delta > 0 ? "text-yes" : "text-muted-foreground",
                        )}
                      >
                        {signedPoints(row.delta)}
                        <span className="ml-1 text-[0.8125rem] font-medium text-muted-foreground font-stretch-normal">points</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* Quests completed */}
          <section aria-labelledby="completed" className="flex flex-col gap-3">
            <SectionHeading
              id="completed"
              title="Quests completed"
              action={
                <Link href="/quests" className={cn(buttonVariants({ variant: "link" }), "text-[0.9375rem]")}>
                  See quests
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Link>
              }
            />
            {profile.completedPlays.length === 0 ? (
              <EmptyState
                icon={<Zap aria-hidden />}
                title="No quests completed yet."
                description="Your first prediction completes First Prediction on the spot, and three paper trades complete First Paper Trades."
                action={
                  <Link href="/predictions" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                    Make a prediction
                  </Link>
                }
              />
            ) : (
              <ul className={LIST}>
                {profile.completedPlays.map((p) => (
                  <li key={p.key} className="flex min-h-16 items-center gap-3 py-3 sm:gap-4">
                    {p.badgeKey ? (
                      <MedallionFrame size={40} glow={false}>
                        <BadgeMedallion badgeKey={p.badgeKey} size={34} crop />
                      </MedallionFrame>
                    ) : p.partner ? (
                      <span className="[&_img]:logo-greyscale">
                        <PartnerLogo name={p.partner.name} logoUrl={p.partner.logoUrl} size={40} />
                      </span>
                    ) : (
                      <span className={ICON_WELL} aria-hidden>
                        <Zap className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.96875rem] font-semibold">{p.title}</p>
                      <p className="truncate text-[0.84375rem] text-muted-foreground">
                        {p.partner && partnerPageHref(p.partner.slug) ? (
                          <Link href={partnerPageHref(p.partner.slug)!} className="underline-offset-4 transition-colors hover:text-foreground hover:underline">
                            {p.partner.name}
                          </Link>
                        ) : p.partner ? (
                          p.partner.name
                        ) : (
                          p.campaignTitle
                        )}
                        {p.completedAt ? ` · ${formatDate(p.completedAt)}` : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-baseline gap-1.5">
                      <span className="figure text-[1.625rem] leading-none text-foreground">+{formatPoints(p.points)}</span>
                      <span className="text-[0.8125rem] text-muted-foreground">points</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-12">
          {/* Badges */}
          <section aria-labelledby="badges" className="flex flex-col gap-3">
            <SectionHeading id="badges" title="Badges" note="Soulbound tokens minted to your wallet on a later scheduled run after you earn them." />
            <BadgeGrid badges={profile.badges} />
          </section>

          {/* Wallets */}
          <section aria-labelledby="wallets" className="flex flex-col gap-3">
            <SectionHeading id="wallets" title="Wallets" note="On-chain quests count holdings across every wallet here. Sign in from another wallet to add it." />
            <ul className={LIST}>
              {profile.wallets.map((w) => {
                const href = explorerUrl(w.chainId, w.address);
                return (
                  <li key={w.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    {/* The address is the row's content here (not decoration): mono, with copy. */}
                    <AddressChip address={w.address} chainId={w.chainId} chars={6} className="h-8 rounded-none border-0 bg-transparent px-0 text-[0.875rem]" />
                    {w.isPrimary ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs">
                        Primary
                      </Badge>
                    ) : null}
                    <span className="text-[0.84375rem] text-muted-foreground">{chainLabel(w.chainId)}</span>
                    <span className="ml-auto flex items-center gap-3 text-[0.84375rem] text-muted-foreground">
                      <span className="hidden sm:inline">Added {formatDate(w.createdAt)}</span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-8 items-center gap-1 underline-offset-4 transition-colors hover:text-foreground hover:underline motion-reduce:transition-none"
                        >
                          Solscan
                          <ArrowUpRight className="size-3" aria-hidden />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-8" aria-busy aria-label="Loading profile">
      <div className="flex flex-col gap-3 border-b border-rule-2 pb-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-56" />
      </div>
      <div className="grid grid-cols-2 border-y border-rule sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 py-4 pr-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  );
}
