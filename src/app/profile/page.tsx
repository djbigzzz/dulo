"use client";

import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import * as React from "react";
import { ArrowRight, CheckCircle2, ExternalLink, History, Medal, Sparkles, Wallet, Zap } from "lucide-react";
import { cn } from "cn";
import { apiGet, type MeResponse, type UserProfile } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { AddressChip } from "@/components/common/AddressChip";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { useApiQuery } from "@/components/common/useApiQuery";
import { ageSeconds, chainLabel, displayName, explorerUrl, formatAge, formatDate, formatDateTime, formatPoints } from "@/components/common/format";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { BadgeGrid, BadgePreviewGrid, ShelfGlow } from "@/components/profile/BadgeGrid";
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

const SECTION_TITLE = "font-display text-2xl leading-tight font-normal sm:text-3xl";
const LIST = "divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-card";
const ICON_TILE =
  "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";
const DIVIDER = "h-px bg-gradient-to-r from-transparent via-white/10 to-transparent";

function SectionHead({ id, title, hint, action }: { id: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className={SECTION_TITLE}>
            {title}
          </h2>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="h-px bg-gradient-to-r from-white/[0.12] via-white/[0.05] to-transparent" aria-hidden />
    </div>
  );
}

function SignedOut() {
  const perks = [
    { icon: Sparkles, title: "Season points", text: "Every quest you complete adds to your Season points." },
    { icon: Medal, title: "Your rank", text: "See where you stand on the Season leaderboard." },
    { icon: CheckCircle2, title: "Quests completed", text: "Each one with the proof behind it." },
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader className="mb-0" eyebrow="Season 0" title="Profile" description="Your points, rank and Badges, built from your own wallets." />

      <section
        aria-labelledby="badge-preview"
        className="border-gradient relative flex flex-col overflow-hidden rounded-3xl bg-card ember-glow px-5 py-8 animate-in duration-500 fade-in-0 slide-in-from-bottom-2 sm:px-10 sm:py-12"
      >
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-gold uppercase">
            <span className="h-px w-5 bg-gradient-to-r from-gold/0 to-gold/80" aria-hidden />
            Soulbound Badges
            <span className="h-px w-5 bg-gradient-to-l from-gold/0 to-gold/80" aria-hidden />
          </p>
          <h2 id="badge-preview" className="font-display text-4xl leading-[1.02] font-normal tracking-[-0.015em] sm:text-5xl">
            Badges you can <span className="text-gradient-ember italic">earn</span>
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            Soulbound tokens minted to your wallet. They cannot be sold or transferred.
          </p>
        </div>

        <div className="relative mt-10">
          <ShelfGlow className="-inset-x-4 -inset-y-8" />
          <BadgePreviewGrid className="relative" />
          <div className="relative mx-auto mt-8 h-px max-w-3xl bg-gradient-to-r from-transparent via-gold/30 to-transparent" aria-hidden />
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-3 sm:gap-6">
          {perks.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3">
              <span className={ICON_TILE} aria-hidden>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold tracking-tight">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className={cn(DIVIDER, "mt-8")} aria-hidden />
        <div className="mt-6 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted-foreground">Connect a wallet and sign once. Nothing to fill in.</p>
          <ConnectButton size="lg" className="h-11 w-full px-5 sm:w-auto" />
        </div>
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
    { label: "Points balance", value: formatPoints(balance), tone: "ember", hint: starterPointsHint(profile.starterPoints, balance) },
    { label: "Season points", value: formatPoints(profile.points), tone: "gold", hint: SEASON_POINTS_HINT },
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
        eyebrow="Profile"
        title={<span className={cn(!profile.handle && "font-mono")}>{name}</span>}
        description={profile.handle && primary ? <AddressChip address={primary.address} chainId={primary.chainId} explorer /> : undefined}
        stats={
          <div className="flex flex-col gap-2">
            {/* Five tiles: 2 columns up to lg (Badges spans the last row), one row of five from lg. */}
            <StatStrip
              stats={stats}
              className="md:grid-cols-2 md:[&>div:last-child]:col-span-2 lg:grid-cols-5 lg:[&>div:last-child]:col-span-1"
            />
            <p className="text-xs text-muted-foreground">
              Points only, no cash value.
              {profile.pointsAllTime !== profile.points ? ` All Seasons: ${formatPoints(profile.pointsAllTime)} pts.` : ""}
            </p>
          </div>
        }
      />

      {/* Points history: hidden when the server does not send it. */}
      {history ? (
        <section aria-labelledby="points-history" className="flex flex-col gap-3">
          <SectionHead id="points-history" title="Points history" hint="Every change to your points this Season, newest first." />
          {history.length === 0 ? (
            <p className={cn(LIST, "flex min-h-14 items-center gap-3 px-4 py-3 text-sm text-muted-foreground sm:px-5")}>
              <History className="size-4 shrink-0 text-gold" aria-hidden />
              <span className="min-w-0">{HISTORY_EMPTY}</span>
            </p>
          ) : (
            <ul className={LIST}>
              {history.map((row, i) => (
                <li key={`${row.ts}:${i}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-200 hover:bg-white/[0.03] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <time dateTime={row.ts} title={formatDateTime(row.ts)}>
                        {formatAge(ageSeconds(row.ts))}
                      </time>
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tracking-tight tabular-nums sm:text-base",
                      row.delta > 0 ? "text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    {signedPoints(row.delta)}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Quests completed */}
      <section aria-labelledby="completed" className="flex flex-col gap-3">
        <SectionHead
          id="completed"
          title="Quests completed"
          action={
            <Link href="/quests" className={cn(buttonVariants({ variant: "ghost" }), "group/link h-10 shrink-0 sm:h-8")}>
              See quests
              <ArrowRight data-icon="inline-end" className="transition-transform group-hover/link:translate-x-0.5" aria-hidden />
            </Link>
          }
        />
        {profile.completedPlays.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden />}
            title="No quests completed yet."
            description="Your first prediction completes First Prediction on the spot, and three paper trades complete First Paper Trades."
            action={
              <Link href="/predictions" className={buttonVariants({ variant: "outline" })}>
                Make a prediction
              </Link>
            }
          />
        ) : (
          <ul className={LIST}>
            {profile.completedPlays.map((p) => (
              <li key={p.key} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-white/[0.03] sm:gap-4 sm:px-5">
                {p.badgeKey ? (
                  <MedallionFrame size={42} glow={false}>
                    <BadgeMedallion badgeKey={p.badgeKey} size={36} crop />
                  </MedallionFrame>
                ) : p.partner ? (
                  <PartnerLogo name={p.partner.name} logoUrl={p.partner.logoUrl} size={40} />
                ) : (
                  <span className={ICON_TILE} aria-hidden>
                    <Zap className="size-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.partner && partnerPageHref(p.partner.slug) ? (
                      <Link href={partnerPageHref(p.partner.slug)!} className="transition-colors hover:text-foreground">
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
                <span className="shrink-0 text-base font-semibold tracking-tight text-emerald-400 tabular-nums">
                  +{formatPoints(p.points)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Badges */}
      <section aria-labelledby="badges" className="flex flex-col gap-3">
        <SectionHead id="badges" title="Badges" hint="Soulbound tokens minted to your wallet a few minutes after you earn them." />
        <BadgeGrid badges={profile.badges} />
      </section>

      {/* Wallets */}
      <section aria-labelledby="wallets" className="flex flex-col gap-3">
        <SectionHead id="wallets" title="Wallets" hint="On-chain quests count holdings across every wallet here. Sign in from another wallet to add it." />
        <ul className={LIST}>
          {profile.wallets.map((w) => {
            const href = explorerUrl(w.chainId, w.address);
            return (
              <li key={w.id} className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-200 hover:bg-white/[0.03] sm:px-5">
                <span className={cn(ICON_TILE, "hidden size-9 text-muted-foreground sm:flex")} aria-hidden>
                  <Wallet className="size-4" />
                </span>
                <AddressChip address={w.address} chainId={w.chainId} chars={6} className="font-mono" />
                <span className="inline-flex h-6 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-muted-foreground">
                  {chainLabel(w.chainId)}
                </span>
                {w.isPrimary ? (
                  <span className="inline-flex h-6 items-center rounded-full border border-gold/20 bg-gold/[0.06] px-2 text-xs font-medium text-gold">Primary</span>
                ) : null}
                <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Added {formatDate(w.createdAt)}</span>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 transition-colors hover:text-foreground">
                      Solscan
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-8" aria-busy aria-label="Loading profile">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16 bg-white/[0.05]" />
        <Skeleton className="h-12 w-48 bg-white/[0.05]" />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl bg-white/[0.05]" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48 bg-white/[0.05]" />
        <Skeleton className="h-16 rounded-2xl bg-white/[0.05]" />
        <Skeleton className="h-16 rounded-2xl bg-white/[0.05]" />
      </div>
    </div>
  );
}
