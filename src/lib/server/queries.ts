/**
 * Read queries for /api/v1 handlers. Server-only (imports Prisma).
 *
 * Everything returned here is already in wire shape (ISO strings, plain JSON)
 * so route handlers can hand it straight to ok(). The shapes are the ones
 * exported from src/lib/api-client.ts, which the UI shares.
 *
 * The pure helpers (groupPlaysByPartner, rankLeaderboard, seasonPhase, ...)
 * are exported for unit tests and take plain rows, never Prisma clients.
 */

import { db } from "@/lib/server/db";
import { issuerSourceForPartner, listCorporateActions } from "@/lib/corporate-actions";
import type { Prisma } from "@prisma/client";
import type { AssetId, PriceQuote } from "@/lib/core";
import { isAssetId } from "@/lib/core";
import { BOT_USER_ID_PREFIX } from "@/lib/games/bots";
import {
  NON_SCORING_SOURCES,
  ledgerRowLabel,
  openStakePrefix,
  parseLedgerRef,
  summariseLedger,
  type PointsHistoryRow,
  type PointsSummary,
} from "@/lib/games/ledger-policy";
import { allocationFromLegs, allocationFromSnapshot, isConcentrated, pnlBetween, type Allocation } from "@/lib/mirror/allocation";
import { getPublicMirrorTarget, type ReadPublicWalletOptions } from "@/lib/mirror/public";
import { HIDDEN_PARTNER_SLUGS, isListedPartnerSlug } from "@/lib/plays/partners";
import type { PlayRule } from "@/lib/plays/rules";
import { getPrices } from "@/lib/price";
import type {
  BadgeView,
  CampaignGroup,
  CompletedPlayView,
  LeaderboardRow,
  MirrorIndexRow,
  MirrorPnlView,
  MirrorTargetView,
  PartnerDetail,
  PartnerGroup,
  PartnerLinks,
  PartnerListItem,
  PartnerSummary,
  PlayStatus,
  PlayView,
  SeasonPhase,
  SeasonView,
  UserProfile,
  WalletView,
} from "@/lib/api-client";

export type {
  BadgeView,
  CampaignGroup,
  CompletedPlayView,
  LeaderboardRow,
  PartnerDetail,
  PartnerGroup,
  PartnerListItem,
  PartnerSummary,
  PlayStatus,
  PlayView,
  SeasonView,
  UserProfile,
  WalletView,
};

// ---------------------------------------------------------------------------
// JSON shaping helpers (pure)
// ---------------------------------------------------------------------------

export function seasonPhase(startsAt: Date, endsAt: Date, now: Date = new Date()): SeasonPhase {
  if (now < startsAt) return "upcoming";
  if (now > endsAt) return "ended";
  return "active";
}

export function toSeasonView(
  s: { id: string; name: string; chainScope: unknown; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): SeasonView {
  return {
    id: s.id,
    name: s.name,
    chainScope: toStringArray(s.chainScope),
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    phase: seasonPhase(s.startsAt, s.endsAt, now),
  };
}

/** Coerce a JSON column into a string[] (drops non-strings, never throws). */
export function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Coerce the Partner.links JSON column into the known link set (only http(s) strings survive). */
export function toPartnerLinks(v: unknown): PartnerLinks {
  const out: PartnerLinks = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  for (const k of ["website", "x", "docs"] as const) {
    const val = o[k];
    if (typeof val === "string" && /^https?:\/\//i.test(val)) out[k] = val;
  }
  return out;
}

/** The Play.rule JSON column as a PlayRule. Malformed rules degrade to a harmless shape rather than throwing. */
export function toPlayRule(v: unknown): PlayRule {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { type?: unknown }).type === "string") {
    return v as PlayRule;
  }
  // Unknown rule: keep the raw value under a sentinel type so the UI can still render a generic hint.
  return { type: "unknown", raw: v } as unknown as PlayRule;
}

export function toPartnerSummary(p: {
  slug: string;
  name: string;
  logoUrl: string | null;
  blurb: string;
  links: unknown;
}): PartnerSummary {
  return { slug: p.slug, name: p.name, logoUrl: p.logoUrl ?? null, blurb: p.blurb, links: toPartnerLinks(p.links) };
}

// ---------------------------------------------------------------------------
// Pure grouping / ranking
// ---------------------------------------------------------------------------

/** Minimal Play row shape needed to build the /plays board. */
export interface PlayRowInput {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  rule: unknown;
  sortOrder: number;
  /** false = listed but not verifiable yet ("coming soon"). Defaults to true when absent. */
  isActive?: boolean;
  campaign: {
    id: string;
    title: string;
    startsAt: Date;
    partner: { slug: string; name: string; logoUrl: string | null; blurb: string; links: unknown; sortOrder: number };
  };
}

export interface ProgressRowInput {
  playKey: string;
  status: string;
  completedAt: Date | null;
  proof: unknown;
}

/**
 * Group Plays by Partner -> Campaign and attach the caller's progress.
 *  - signedIn=false  -> every Play is "locked"
 *  - signedIn=true   -> PlayProgress status when present, else "in_progress"
 *  - isActive=false  -> "coming soon": always "locked" (unless already complete), listed after live Plays
 */
export function groupPlaysByPartner(
  plays: PlayRowInput[],
  progress: ProgressRowInput[],
  completions: Map<string, number>,
  signedIn: boolean,
): PartnerGroup[] {
  const progressByKey = new Map(progress.map((p) => [p.playKey, p]));

  const sorted = [...plays].sort((a, b) => {
    const pa = a.campaign.partner;
    const pb = b.campaign.partner;
    if (pa.sortOrder !== pb.sortOrder) return pa.sortOrder - pb.sortOrder;
    if (pa.slug !== pb.slug) return pa.slug.localeCompare(pb.slug);
    const ca = a.campaign.startsAt.getTime();
    const cb = b.campaign.startsAt.getTime();
    if (ca !== cb) return ca - cb;
    if (a.campaign.id !== b.campaign.id) return a.campaign.id.localeCompare(b.campaign.id);
    const aa = a.isActive !== false;
    const ba = b.isActive !== false;
    if (aa !== ba) return aa ? -1 : 1; // live Plays before "coming soon" ones
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.key.localeCompare(b.key);
  });

  const groups: PartnerGroup[] = [];
  const groupBySlug = new Map<string, PartnerGroup>();
  const campaignById = new Map<string, CampaignGroup>();

  for (const row of sorted) {
    const partner = row.campaign.partner;
    let group = groupBySlug.get(partner.slug);
    if (!group) {
      group = { partner: toPartnerSummary(partner), campaigns: [] };
      groupBySlug.set(partner.slug, group);
      groups.push(group);
    }
    let campaign = campaignById.get(row.campaign.id);
    if (!campaign) {
      campaign = { id: row.campaign.id, title: row.campaign.title, plays: [] };
      campaignById.set(row.campaign.id, campaign);
      group.campaigns.push(campaign);
    }
    campaign.plays.push(toPlayView(row, signedIn ? progressByKey.get(row.key) ?? null : null, signedIn, completions.get(row.key) ?? 0));
  }
  return groups;
}

export function toPlayView(row: PlayRowInput, progress: ProgressRowInput | null, signedIn: boolean, completions: number): PlayView {
  const comingSoon = row.isActive === false;
  let status: PlayStatus = "locked";
  if (signedIn) {
    if (progress?.status === "complete") status = "complete";
    else if (!comingSoon) status = "in_progress";
  }
  return {
    key: row.key,
    title: row.title,
    desc: row.desc,
    points: row.points,
    badgeKey: row.badgeKey ?? null,
    rule: toPlayRule(row.rule),
    status,
    completedAt: status === "complete" && progress?.completedAt ? progress.completedAt.toISOString() : null,
    proof: signedIn && progress ? (progress.proof ?? null) : null,
    completions,
    comingSoon,
  };
}

export interface RankInput {
  userId: string;
  handle: string | null;
  address: string | null;
  points: number;
}

/**
 * Competition ranking ("1224"): equal points share a rank; the next rank skips.
 * Input order does not matter; output is sorted by points desc, then userId asc. The
 * tie-break MUST match getLeaderboard's groupBy orderBy so the in-memory order agrees
 * with the rows the database kept at the `take` boundary.
 */
export function rankLeaderboard(rows: RankInput[]): LeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (a.userId === b.userId) return 0;
    return a.userId < b.userId ? -1 : 1;
  });
  const out: LeaderboardRow[] = [];
  let rank = 0;
  let prevPoints: number | null = null;
  sorted.forEach((r, i) => {
    if (prevPoints === null || r.points !== prevPoints) rank = i + 1;
    prevPoints = r.points;
    out.push({ rank, userId: r.userId, handle: r.handle, address: r.address, points: r.points });
  });
  return out;
}

/** Pick the address to display for a user: the primary wallet, else the oldest wallet, else null. */
export function pickDisplayWallet<T extends { address: string; isPrimary: boolean; createdAt: Date }>(wallets: T[]): T | null {
  if (wallets.length === 0) return null;
  const primary = wallets.find((w) => w.isPrimary);
  if (primary) return primary;
  return [...wallets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

// ---------------------------------------------------------------------------
// Bot hygiene (docs/REVIEW-2026-09-14.md H2)
// ---------------------------------------------------------------------------

/**
 * A bot is a User with any LeagueAccount.isBot = true (lib/games/league seedBots) OR a User id
 * starting with BOT_USER_ID_PREFIX (lib/games/bots), so a bot row that exists without its
 * LeagueAccount still never scores. Bots trade in the paper League so the board is never empty,
 * but they never score: they are not snapshotted, not evaluated, and never counted on the
 * Season leaderboard, in a rank, or in a Play's completions. Spread this fragment into the
 * `user` relation filter of every such query so the exclusion happens in the database (a
 * post-`take` filter would leave holes in the board).
 */
export const REAL_USER_WHERE = {
  leagueAccounts: { none: { isBot: true } },
  NOT: { id: { startsWith: BOT_USER_ID_PREFIX } },
} satisfies Prisma.UserWhereInput;

// ---------------------------------------------------------------------------
// Season points (16 Sep 2026 points policy, lib/games/ledger-policy)
// ---------------------------------------------------------------------------

/**
 * The ledger rows that count toward Season points, as a PointsEvent where-fragment:
 *   - not a starter or admin row (NON_SCORING_SOURCES), and
 *   - not points put into a prediction that is still open (`call:<marketId>:stake:` for every
 *     `openMarketIds` entry). Once a market settles its points-in rows count again, together
 *     with the points-back or refund rows, so a loss counts against you and a void nets to 0.
 * NOT is omitted when no market is open. The pure mirror is isScoringRow (ledger-policy).
 * Every Season points read (board, rank, profile, /copy leaders, /auth/me) uses this fragment
 * with `user: REAL_USER_WHERE`, so they always agree.
 */
export function seasonScoreWhere(seasonId: string, openMarketIds: readonly string[]) {
  const where: {
    seasonId: string;
    source: { notIn: string[] };
    NOT?: Array<{ ref: { startsWith: string } }>;
  } = { seasonId, source: { notIn: [...NON_SCORING_SOURCES] } };
  if (openMarketIds.length > 0) where.NOT = openMarketIds.map((id) => ({ ref: { startsWith: openStakePrefix(id) } }));
  return where satisfies Prisma.PointsEventWhereInput;
}

/**
 * Markets still waiting for their outcome, in one Season or (seasonId null) in every Season.
 * A plain read run just before the sums, never inside an interactive transaction: the only
 * cost is a one-request display skew while a weekly settlement commits.
 */
async function openMarketIds(seasonId: string | null): Promise<string[]> {
  const rows = await db.market.findMany({
    where: seasonId === null ? { outcome: null } : { seasonId, outcome: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** How many rows the profile's points history lists. */
export const POINTS_HISTORY_LIMIT = 20;

interface SeasonLedgerRow {
  source: string;
  ref: string;
  delta: number;
  ts: Date;
}

/**
 * The latest ledger rows as display rows, newest first. Admin rows (house funding) are never
 * listed. Quest titles and market symbols come from one read each, only when needed.
 */
async function pointsHistory(rows: readonly SeasonLedgerRow[]): Promise<PointsHistoryRow[]> {
  const shown = rows.filter((r) => r.source !== "admin").slice(0, POINTS_HISTORY_LIMIT);
  if (shown.length === 0) return [];
  const parsed = shown.map((r) => parseLedgerRef(r.ref));
  const questKeys = [...new Set(parsed.flatMap((p) => (p.playKey ? [p.playKey] : [])))];
  const marketIds = [...new Set(parsed.flatMap((p) => (p.marketId ? [p.marketId] : [])))];
  const quests = questKeys.length > 0 ? await db.play.findMany({ where: { key: { in: questKeys } }, select: { key: true, title: true } }) : [];
  const markets = marketIds.length > 0 ? await db.market.findMany({ where: { id: { in: marketIds } }, select: { id: true, ticker: true } }) : [];
  const lookups = {
    questTitles: new Map(quests.map((q) => [q.key, q.title])),
    // The xStock symbol ("NVDAx"), as the prediction cards name it.
    marketTickers: new Map(markets.map((m) => [m.id, `${m.ticker.toUpperCase()}x`])),
  };
  return shown.map((r, i) => ({ label: ledgerRowLabel(r, lookups), delta: r.delta, ts: r.ts.toISOString(), kind: parsed[i].kind }));
}

// ---------------------------------------------------------------------------
// Prisma-backed queries
// ---------------------------------------------------------------------------

/** The Season whose window contains now; otherwise the latest Season by endsAt. Null when none is seeded. */
export async function getCurrentSeason(now: Date = new Date()): Promise<SeasonView | null> {
  const active = await db.season.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "desc" },
  });
  if (active) return toSeasonView(active, now);
  const latest = await db.season.findFirst({ orderBy: { endsAt: "desc" } });
  return latest ? toSeasonView(latest, now) : null;
}

/** Completed-Play counts per key, real users only (a bot completion is a bug, never a stat). */
async function completionsByPlayKey(keys: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (keys.length === 0) return map;
  const rows = await db.playProgress.groupBy({
    by: ["playKey"],
    where: { status: "complete", playKey: { in: keys }, user: REAL_USER_WHERE },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.playKey, r._count._all);
  return map;
}

const playWithCampaignInclude = {
  campaign: { include: { partner: true } },
} satisfies Prisma.PlayInclude;

/**
 * Plays for the current Season grouped Partner -> Campaign, personalised for `userId`.
 * Inactive Plays are included and flagged `comingSoon` so partner listings show on the board.
 * Anonymous callers see every Play as "locked".
 */
export async function listPlaysForUser(userId: string | null): Promise<PartnerGroup[]> {
  const season = await getCurrentSeason();
  const plays = await db.play.findMany({
    where: season ? { campaign: { seasonId: season.id } } : {},
    include: playWithCampaignInclude,
  });
  const keys = plays.map((p) => p.key);
  const [completions, progress] = await Promise.all([
    completionsByPlayKey(keys),
    userId && keys.length > 0
      ? db.playProgress.findMany({
          where: { userId, playKey: { in: keys } },
          select: { playKey: true, status: true, completedAt: true, proof: true },
        })
      : Promise.resolve([] as ProgressRowInput[]),
  ]);
  return groupPlaysByPartner(plays, progress, completions, userId !== null);
}

/**
 * Season leaderboard: Season points per user (seasonScoreWhere: starter/admin rows and points in
 * open predictions excluded), ranked, with the user's display wallet. Users whose Season points
 * are <= 0 are not on the board; bots (REAL_USER_WHERE) never are.
 */
export async function getLeaderboard(
  seasonId?: string,
  limit = 100,
): Promise<{ rows: LeaderboardRow[]; season: SeasonView | null }> {
  const take = Math.max(1, Math.min(500, Math.floor(limit)));
  const season = seasonId
    ? await db.season.findUnique({ where: { id: seasonId } }).then((s) => (s ? toSeasonView(s) : null))
    : await getCurrentSeason();
  if (!season) return { rows: [], season: null };

  const open = await openMarketIds(season.id);
  const sums = await db.pointsEvent.groupBy({
    by: ["userId"],
    // Bots are excluded here, before `take`, so the board never has holes where a bot was cut.
    where: { ...seasonScoreWhere(season.id, open), user: REAL_USER_WHERE },
    _sum: { delta: true },
    having: { delta: { _sum: { gt: 0 } } },
    // userId breaks ties so the cut at `take` is deterministic; rankLeaderboard sorts the same way.
    orderBy: [{ _sum: { delta: "desc" } }, { userId: "asc" }],
    take,
  });
  if (sums.length === 0) return { rows: [], season };

  const users = await db.user.findMany({
    where: { id: { in: sums.map((s) => s.userId) } },
    select: {
      id: true,
      handle: true,
      wallets: { select: { address: true, isPrimary: true, createdAt: true } },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const rows = rankLeaderboard(
    sums.map((s) => {
      const u = byId.get(s.userId);
      return {
        userId: s.userId,
        handle: u?.handle ?? null,
        address: u ? (pickDisplayWallet(u.wallets)?.address ?? null) : null,
        points: s._sum.delta ?? 0,
      };
    }),
  );
  return { rows, season };
}

/**
 * Listed Partners with their Play count ("coming soon" included) and completions, in sortOrder.
 * The house Partner (HIDDEN_PARTNER_SLUGS: Dulo's own games) is filtered out in the database, so
 * it never shows on /partners or the landing row; its Plays still show on /plays.
 */
export async function listPartners(): Promise<PartnerListItem[]> {
  const listed = { slug: { notIn: [...HIDDEN_PARTNER_SLUGS] } } satisfies Prisma.PartnerWhereInput;
  const [partners, plays] = await Promise.all([
    db.partner.findMany({ where: listed, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.play.findMany({
      where: { campaign: { partner: listed } },
      select: { key: true, isActive: true, campaign: { select: { partnerId: true } } },
    }),
  ]);
  const completions = await completionsByPlayKey(plays.map((p) => p.key));
  const playCount = new Map<string, number>();
  const liveCount = new Map<string, number>();
  const completionCount = new Map<string, number>();
  for (const p of plays) {
    const pid = p.campaign.partnerId;
    playCount.set(pid, (playCount.get(pid) ?? 0) + 1);
    if (p.isActive !== false) liveCount.set(pid, (liveCount.get(pid) ?? 0) + 1);
    completionCount.set(pid, (completionCount.get(pid) ?? 0) + (completions.get(p.key) ?? 0));
  }
  return partners.map((p) => ({
    ...toPartnerSummary(p),
    chainIds: toStringArray(p.chainIds),
    playCount: playCount.get(p.id) ?? 0,
    livePlayCount: liveCount.get(p.id) ?? 0,
    completions: completionCount.get(p.id) ?? 0,
  }));
}

/**
 * One Partner with its Campaigns, listed Plays (live first, then "coming soon") and completion counts.
 * Null when the slug is unknown. An issuer Partner ("prestocks", "xstocks") also carries the
 * corporate actions on its mints (lib/corporate-actions: cached, never throws, [] on a chain
 * read failure); every other Partner gets [].
 */
export async function getPartner(slug: string): Promise<PartnerDetail | null> {
  // The house Partner (Dulo's own games) is not listed, so it has no Partner page either.
  if (!isListedPartnerSlug(slug)) return null;
  const issuerSource = issuerSourceForPartner(slug);
  const [partner, corporateActions] = await Promise.all([
    db.partner.findUnique({
      where: { slug },
      include: {
        campaigns: {
          orderBy: [{ startsAt: "asc" }, { title: "asc" }],
          include: {
            plays: { orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { key: "asc" }] },
          },
        },
      },
    }),
    issuerSource ? listCorporateActions(issuerSource) : Promise.resolve([]),
  ]);
  if (!partner) return null;

  const keys = partner.campaigns.flatMap((c) => c.plays.map((p) => p.key));
  const completions = await completionsByPlayKey(keys);

  let totalPlays = 0;
  let totalCompletions = 0;
  const campaigns = partner.campaigns.map((c) => ({
    id: c.id,
    title: c.title,
    seasonId: c.seasonId,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    plays: c.plays.map((p) => {
      const done = completions.get(p.key) ?? 0;
      totalPlays += 1;
      totalCompletions += done;
      return {
        key: p.key,
        title: p.title,
        desc: p.desc,
        points: p.points,
        badgeKey: p.badgeKey ?? null,
        rule: toPlayRule(p.rule),
        completions: done,
        comingSoon: !p.isActive,
      };
    }),
  }));

  return {
    partner: { ...toPartnerSummary(partner), chainIds: toStringArray(partner.chainIds) },
    campaigns,
    totals: { plays: totalPlays, completions: totalCompletions },
    corporateActions,
  };
}

/**
 * Everything the /profile page shows for one user. Null when the user row is gone.
 *   points         Season points (seasonScoreWhere), what the rank is built from
 *   balance        spendable points: every Season row, starter included
 *   starterPoints  the starter grant this Season (0 or 1,000)
 *   inPredictions  points held in open predictions
 *   pointsAllTime  scoring rows across every Season (open predictions excluded)
 *   history        the latest Season rows, labelled; admin rows are never listed
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      wallets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      badges: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) return null;

  const season = await getCurrentSeason();

  // Ledger reads run one after another (the local Prisma proxy and the pooler dislike fan-out).
  const rows: SeasonLedgerRow[] = season
    ? await db.pointsEvent.findMany({
        where: { userId, seasonId: season.id },
        select: { source: true, ref: true, delta: true, ts: true },
        orderBy: { ts: "desc" },
      })
    : [];
  const open = season ? await openMarketIds(season.id) : [];
  const summary = summariseLedger(rows, new Set(open));

  const openAnywhere = await openMarketIds(null);
  const allTimeSum = await db.pointsEvent.aggregate({
    _sum: { delta: true },
    where: {
      userId,
      source: { notIn: [...NON_SCORING_SOURCES] },
      ...(openAnywhere.length > 0 ? { NOT: openAnywhere.map((id) => ({ ref: { startsWith: openStakePrefix(id) } })) } : {}),
    },
  });

  const [completed, activeCount] = await Promise.all([
    db.playProgress.findMany({
      where: { userId, status: "complete" },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      include: { play: { include: { campaign: { include: { partner: true } } } } },
    }),
    db.play.count({
      where: { isActive: true, ...(season ? { campaign: { seasonId: season.id } } : {}) },
    }),
  ]);

  const points = summary.seasonPoints;
  const pointsAllTime = allTimeSum._sum.delta ?? 0;

  const rank = season && points > 0 ? await rankAmongRealUsers(points, season.id, open) : null;
  const history = await pointsHistory(rows);

  const completedPlays: CompletedPlayView[] = completed.map((pp) => ({
    key: pp.playKey,
    title: pp.play.title,
    points: pp.play.points,
    badgeKey: pp.play.badgeKey ?? null,
    completedAt: pp.completedAt ? pp.completedAt.toISOString() : null,
    proof: pp.proof ?? null,
    campaignTitle: pp.play.campaign.title,
    partner: pp.play.campaign.partner
      ? { slug: pp.play.campaign.partner.slug, name: pp.play.campaign.partner.name, logoUrl: pp.play.campaign.partner.logoUrl ?? null }
      : null,
  }));

  const badgeKeys = user.badges.map((b) => b.playKey);
  const badgePlays =
    badgeKeys.length > 0
      ? await db.play.findMany({ where: { key: { in: badgeKeys } }, select: { key: true, title: true } })
      : [];
  const titleByKey = new Map(badgePlays.map((p) => [p.key, p.title]));
  const badges: BadgeView[] = user.badges.map((b) => ({
    playKey: b.playKey,
    title: titleByKey.get(b.playKey) ?? null,
    mint: b.mint ?? null,
    txSig: b.txSig ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  const wallets: WalletView[] = user.wallets.map((w) => ({
    id: w.id,
    chainId: w.chainId,
    address: w.address,
    isPrimary: w.isPrimary,
    createdAt: w.createdAt.toISOString(),
  }));

  // Same scope as `activeCount` (active Plays in the current Season) so the profile never
  // reads "9 / 8" from completions of retired Plays or earlier Seasons. completedPlays stays all-time.
  const playsCompleted = completed.filter(
    (pp) => pp.play.isActive && (!season || pp.play.campaign.seasonId === season.id),
  ).length;

  return {
    userId: user.id,
    handle: user.handle ?? null,
    season,
    points,
    pointsAllTime,
    balance: summary.balance,
    starterPoints: summary.starterPoints,
    inPredictions: summary.inPredictions,
    history,
    rank,
    wallets,
    completedPlays,
    badges,
    playsCompleted,
    playsTotal: activeCount,
  };
}

// ---------------------------------------------------------------------------
// Mirror targets (docs/HANDOFF.md §3.4 — allocation view + Jupiter deep links)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

interface SnapshotRef {
  id: string;
  takenAt: Date;
  holdings: unknown;
}

const snapshotRefSelect = { id: true, takenAt: true, holdings: true } as const;

/** The wallet's snapshot closest to `at` on either side; null when the wallet has none. */
async function snapshotClosestTo(walletId: string, at: Date): Promise<SnapshotRef | null> {
  const [before, after] = await Promise.all([
    db.snapshot.findFirst({ where: { walletId, takenAt: { lte: at } }, orderBy: { takenAt: "desc" }, select: snapshotRefSelect }),
    db.snapshot.findFirst({ where: { walletId, takenAt: { gt: at } }, orderBy: { takenAt: "asc" }, select: snapshotRefSelect }),
  ]);
  if (before && after) {
    return at.getTime() - before.takenAt.getTime() <= after.takenAt.getTime() - at.getTime() ? before : after;
  }
  return before ?? after ?? null;
}

export interface PaperPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
}

/** LeagueAccount.positions JSON ({ [assetId]: { symbol, qty, avgPrice } }) coerced; malformed / empty entries dropped. */
export function parsePaperPositions(json: unknown): Record<string, PaperPosition> {
  const out: Record<string, PaperPosition> = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [assetId, v] of Object.entries(json as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const p = v as Record<string, unknown>;
    const qty = typeof p.qty === "number" && Number.isFinite(p.qty) ? p.qty : 0;
    if (qty <= 1e-9) continue;
    const avgPrice = typeof p.avgPrice === "number" && Number.isFinite(p.avgPrice) && p.avgPrice > 0 ? p.avgPrice : 0;
    out[assetId] = { symbol: typeof p.symbol === "string" && p.symbol ? p.symbol : assetId, qty, avgPrice };
  }
  return out;
}

/**
 * Competition rank for `points` in a Season: 1 + the number of real users with strictly more
 * Season points. Bots never count as "ahead". Same where-clause as getLeaderboard
 * (seasonScoreWhere + REAL_USER_WHERE), so the profile rank agrees with the board.
 */
async function rankAmongRealUsers(points: number, seasonId: string, open: readonly string[]): Promise<number> {
  const ahead = await db.pointsEvent.groupBy({
    by: ["userId"],
    where: { ...seasonScoreWhere(seasonId, open), user: REAL_USER_WHERE },
    _sum: { delta: true },
    having: { delta: { _sum: { gt: points } } },
  });
  return ahead.length + 1;
}

/** Season points rank of a user (competition rank), null without positive Season points. Bots read null. */
async function seasonRankOf(userId: string, seasonId: string): Promise<number | null> {
  const open = await openMarketIds(seasonId);
  const mine = await db.pointsEvent.aggregate({
    _sum: { delta: true },
    where: { ...seasonScoreWhere(seasonId, open), userId, user: REAL_USER_WHERE },
  });
  const points = mine._sum.delta ?? 0;
  if (points <= 0) return null;
  return rankAmongRealUsers(points, seasonId, open);
}

/**
 * The caller's points for /api/v1/auth/me: spendable balance, Season points, starter points,
 * points in open predictions, and the Season rank (only with positive Season points). Null
 * without a Season. Read-only; reads run in order: Season, the user's rows, open markets, rank.
 */
export async function getPointsSummary(userId: string, now: Date = new Date()): Promise<PointsSummary | null> {
  const season = await getCurrentSeason(now);
  if (!season) return null;
  const rows = await db.pointsEvent.findMany({
    where: { userId, seasonId: season.id },
    select: { source: true, ref: true, delta: true },
  });
  const open = await openMarketIds(season.id);
  const s = summariseLedger(rows, new Set(open));
  const rank = s.seasonPoints > 0 ? await rankAmongRealUsers(s.seasonPoints, season.id, open) : null;
  return {
    seasonId: season.id,
    balance: s.balance,
    seasonPoints: s.seasonPoints,
    starterPoints: s.starterPoints,
    inPredictions: s.inPredictions,
    rank,
  };
}

function pnlView(older: SnapshotRef | null, latest: SnapshotRef, allocation: Allocation): MirrorPnlView | null {
  if (!older || older.id === latest.id) return null;
  const { absUsd, pct } = pnlBetween(allocationFromSnapshot({ holdings: older.holdings }), allocation);
  return { absUsd, pct, since: older.takenAt.toISOString() };
}

/**
 * The Mirror target for a wallet address (Solana). Null when the address is invalid, or when a
 * Dulo wallet has neither a Snapshot nor a League account.
 *   - Source "snapshot" (on-chain allocation from the latest row, plus value change versus
 *     the snapshots closest to 7d and 30d ago) when the latest Snapshot has at least one
 *     leg worth $1+, or when the owner has no League account to fall back to.
 *   - Source "paper" (League bots, users who only paper-trade, an on-chain wallet that has
 *     been snapshotted empty): the most recent League account with positions, valued at
 *     lib/price (avgPrice when no source quotes), labelled "paper allocation" in the UI; no
 *     history, so pnl7d / pnl30d are null. cashUsd / equityUsd and leagueRank come from that
 *     same account (15 Sep review M-O).
 *   - Source "public" (15 Sep review M-D): any other valid Solana address, read
 *     live through lib/mirror/public (10-minute cache, no rows written, never scored). Throws
 *     PublicWalletReadError when that read fails or the lookup budget is spent.
 * Every signed-in wallet is snapshotted within minutes, so the fallback must key on the
 * snapshot's legs, not on its existence (docs/REVIEW-2026-09-14.md H3). Bots never carry a
 * Season rank.
 */
export async function getMirrorTarget(
  walletAddress: string,
  now: Date = new Date(),
  opts: Pick<ReadPublicWalletOptions, "beforeUncachedRead"> = {},
): Promise<MirrorTargetView | null> {
  const address = walletAddress.trim();
  if (!address) return null;
  const wallet = await db.wallet.findFirst({
    where: { address, chainId: { startsWith: "solana:" } },
    select: { id: true, address: true, chainId: true, userId: true, user: { select: { handle: true } } },
  });
  if (!wallet) return getPublicMirrorTarget(address, { beforeUncachedRead: opts.beforeUncachedRead });

  const [season, accounts, latest] = await Promise.all([
    getCurrentSeason(now),
    db.leagueAccount.findMany({
      where: { userId: wallet.userId },
      select: { positions: true, rank: true, isBot: true, cashUsd: true, league: { select: { weekStart: true } } },
      orderBy: { league: { weekStart: "desc" } },
    }),
    db.snapshot.findFirst({ where: { walletId: wallet.id }, orderBy: { takenAt: "desc" }, select: snapshotRefSelect }),
  ]);
  const isBot = accounts.some((a) => a.isBot);
  const rank = season && !isBot ? await seasonRankOf(wallet.userId, season.id) : null;
  const base = {
    address: wallet.address,
    chainId: wallet.chainId,
    handle: wallet.user.handle ?? null,
    isBot,
    rank,
    leagueRank: accounts[0]?.rank ?? null,
  };

  const onChain = latest ? allocationFromSnapshot({ holdings: latest.holdings }) : null;
  if (latest && onChain && (onChain.legs.length > 0 || accounts.length === 0)) {
    const allocation = onChain;
    const [s7, s30] = await Promise.all([
      snapshotClosestTo(wallet.id, new Date(now.getTime() - 7 * DAY_MS)),
      snapshotClosestTo(wallet.id, new Date(now.getTime() - 30 * DAY_MS)),
    ]);
    return {
      ...base,
      source: "snapshot",
      asOf: latest.takenAt.toISOString(),
      totalUsd: allocation.totalUsd,
      legs: allocation.legs,
      pnl7d: pnlView(s7, latest, allocation),
      pnl30d: pnlView(s30, latest, allocation),
      cashUsd: null,
      equityUsd: null,
    };
  }

  const account = accounts.find((a) => Object.keys(parsePaperPositions(a.positions)).length > 0) ?? accounts[0];
  if (!account) return null;
  const positions = parsePaperPositions(account.positions);
  const ids = Object.keys(positions).filter(isAssetId) as AssetId[];
  const quotes = ids.length > 0 ? await getPrices(ids) : new Map<AssetId, PriceQuote>();
  const valued = valuePaperPositions(positions, quotes);
  const allocation = allocationFromLegs(valued);
  const cash = Number(account.cashUsd);
  const cashUsd = Number.isFinite(cash) ? Math.round(cash * 100) / 100 : null;
  const investedUsd = valued.reduce((sum, p) => sum + p.usd, 0);
  return {
    ...base,
    leagueRank: account.rank ?? null,
    source: "paper",
    asOf: now.toISOString(),
    totalUsd: allocation.totalUsd,
    legs: allocation.legs,
    pnl7d: null,
    pnl30d: null,
    cashUsd,
    equityUsd: cashUsd === null ? null : Math.round((cashUsd + investedUsd) * 100) / 100,
  };
}

/** Paper positions valued at lib/price quotes, avgPrice when a quote has no price. Pure. */
export function valuePaperPositions(positions: Record<string, PaperPosition>, quotes: ReadonlyMap<AssetId, PriceQuote>): Array<{ assetId: string; symbol: string; usd: number }> {
  return Object.entries(positions).map(([assetId, p]) => {
    const price = isAssetId(assetId) ? (quotes.get(assetId)?.price ?? null) : null;
    return { assetId, symbol: p.symbol, usd: p.qty * (price !== null && price > 0 ? price : p.avgPrice) };
  });
}

/**
 * Mirrorable wallets for the /mirror index, at most 10 of each:
 *   - leaderboard: the top Season rows (real users only, see getLeaderboard) whose display
 *     wallet's LATEST snapshot holds at least one leg worth $1+ — a wallet that was
 *     snapshotted empty would open on "$0.00 across 0 legs", so it is not offered.
 *   - league: the leaders of the latest League that has accounts, bots included; their
 *     target resolves through the paper branch of getMirrorTarget ("paper allocation"). Shown
 *     as "Model portfolios (paper)"; each row carries its largest leg weight at current prices
 *     and portfolios with a leg above 40% are listed last (15 Sep review).
 * The curated public wallets are added by lib/mirror/views (they need no database read).
 */
export async function listMirrorTargets(now: Date = new Date()): Promise<{ leaderboard: MirrorIndexRow[]; league: MirrorIndexRow[] }> {
  const { rows } = await getLeaderboard(undefined, 25);
  const withAddress = rows.filter((r): r is LeaderboardRow & { address: string } => typeof r.address === "string" && r.address.length > 0);
  const wallets =
    withAddress.length > 0
      ? await db.wallet.findMany({
          where: { address: { in: withAddress.map((r) => r.address) } },
          select: {
            address: true,
            snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { holdings: true } },
            user: { select: { leagueAccounts: { where: { isBot: true }, take: 1, select: { isBot: true } } } },
          },
        })
      : [];
  const walletByAddress = new Map(wallets.map((w) => [w.address, w]));
  const hasLegs = (address: string): boolean => {
    const latest = walletByAddress.get(address)?.snapshots[0];
    return latest !== undefined && allocationFromSnapshot({ holdings: latest.holdings }).legs.length > 0;
  };
  const leaderboard: MirrorIndexRow[] = withAddress
    .filter((r) => hasLegs(r.address))
    .slice(0, 10)
    .map((r) => ({
      address: r.address,
      handle: r.handle,
      // Derived, not assumed: getLeaderboard already excludes bots, so this reads false.
      isBot: (walletByAddress.get(r.address)?.user.leagueAccounts.length ?? 0) > 0,
      rank: r.rank,
      points: r.points,
      equityUsd: null,
    }));

  const league = await db.league.findFirst({
    where: { weekStart: { lte: now }, accounts: { some: {} } },
    orderBy: { weekStart: "desc" },
    select: { id: true },
  });
  let leagueRows: MirrorIndexRow[] = [];
  if (league) {
    const accounts = await db.leagueAccount.findMany({
      where: { leagueId: league.id },
      orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { equityUsd: "desc" }, { userId: "asc" }],
      take: 10,
      select: {
        rank: true,
        equityUsd: true,
        isBot: true,
        positions: true,
        user: { select: { handle: true, wallets: { select: { address: true, isPrimary: true, createdAt: true } } } },
      },
    });
    const parsed = accounts.map((a) => parsePaperPositions(a.positions));
    const ids = [...new Set(parsed.flatMap((p) => Object.keys(p)).filter(isAssetId))] as AssetId[];
    let quotes: ReadonlyMap<AssetId, PriceQuote> = new Map();
    if (ids.length > 0) {
      try {
        quotes = (await getPrices(ids)) ?? new Map();
      } catch (e) {
        // Ordering only: without quotes the weights fall back to avgPrice.
        console.warn(`[queries] listMirrorTargets could not price model portfolios: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const rows = accounts.flatMap((a, i) => {
      const w = pickDisplayWallet(a.user.wallets);
      if (!w) return [];
      const equity = Number(a.equityUsd);
      const topWeight = allocationFromLegs(valuePaperPositions(parsed[i], quotes)).legs[0]?.weight ?? null;
      return [{ address: w.address, handle: a.user.handle ?? null, isBot: a.isBot, rank: a.rank ?? i + 1, points: null, equityUsd: Number.isFinite(equity) ? equity : null, topWeight }];
    });
    // "Model portfolios (paper)": a portfolio with one stock above 40% goes after the diversified ones (stable, rank order kept).
    leagueRows = [...rows.filter((r) => !isConcentrated(r.topWeight)), ...rows.filter((r) => isConcentrated(r.topWeight))];
  }
  return { leaderboard, league: leagueRows };
}
