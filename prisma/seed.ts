/**
 * Dulo seed — Season 0 "Stocks Season".
 *
 *   npx prisma db seed        (or: npx tsx prisma/seed.ts)
 *
 * Idempotent: every write is an upsert on a natural key, so it is safe to re-run. The one
 * exception is a delete-if-present of the two retired "Stocklana Builder" placeholders
 * (RETIRED_PLACEHOLDERS) so a database seeded before 15 Sep 2026 converges.
 *   Season    by id            "season-0"
 *   Partner   by slug
 *   Campaign  by id            "camp-<slug>-season-0"   (one per Partner per Season)
 *   Play      by key
 *   League    by (seasonId, weekStart)
 *
 * Convention: catalogue entries flagged `comingSoon` are written with Play.isActive = false.
 * The rule JSON stays pure (PlayRuleSchema only); the engine skips inactive Plays and the UI
 * renders them as "coming soon". Every rule is validated with PlayRuleSchema before writing.
 *
 * Does NOT create users, bots, snapshots or points. Those belong to their modules.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { SEASON0, SEASON0_PARTNERS } from "../src/lib/plays/partners";
import { SEASON0_ASSET_SOURCE, SEASON0_PLAYS } from "../src/lib/plays/catalogue";
import { PlayRuleSchema } from "../src/lib/plays/rules";
import { seedLeague } from "./seed-league";
import { seedCalls } from "./seed-calls";

// Same bounds as src/lib/server/db.ts, and for the same reason: seeding a remote pooled Postgres
// that scales to zero blows straight through Prisma's 5s default on the bot writes.
const prisma = new PrismaClient({
  log: ["warn", "error"],
  transactionOptions: { timeout: 20_000, maxWait: 10_000 },
});

/** Strip `undefined` so an optional rule field never reaches the JSON column. */
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Fixed-width cell for the summary table. */
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * League week containing `now`: Monday 00:00 UTC to Friday 20:00 UTC (US close).
 * If `now` is already past that Friday close (i.e. a weekend), roll forward to the next
 * week so the seeded League is actually open rather than instantly settleable.
 */
export function leagueWeekFor(now: Date): { weekStart: Date; weekEnd: Date; rolledForward: boolean } {
  const dayUtc = now.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dayUtc + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  const weekEnd = new Date(monday.getTime() + 4 * DAY_MS + 20 * 60 * 60 * 1000);
  if (now.getTime() >= weekEnd.getTime()) {
    const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
    return {
      weekStart: nextMonday,
      weekEnd: new Date(nextMonday.getTime() + 4 * DAY_MS + 20 * 60 * 60 * 1000),
      rolledForward: true,
    };
  }
  return { weekStart: monday, weekEnd, rolledForward: false };
}

type SummaryRow = { entity: string; key: string; action: "created" | "updated" | "deleted"; detail: string };
export type SeedRow = SummaryRow;

/**
 * The two "Stocklana Builder" placeholder Partners seeded before 15 Sep 2026 and since removed.
 * The seed does not prune in general; it deletes exactly these known rows (by natural key, if
 * present) so a database seeded earlier converges. Do not add anything else here.
 */
export const RETIRED_PLACEHOLDERS = Object.freeze({
  partnerSlugs: ["stocklana-builder-1", "stocklana-builder-2"],
  campaignIds: ["camp-stocklana-builder-1-season-0", "camp-stocklana-builder-2-season-0"],
  playKeys: ["stocklana_builder_1", "stocklana_builder_2"],
} as const);

/** The Prisma delegates pruneRetiredPlaceholders needs (a PrismaClient satisfies it; tests pass a stub). */
export interface PruneDb {
  play: { deleteMany(args: { where: { key: { in: string[] } } }): Promise<{ count: number }> };
  campaign: { deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }> };
  partner: { deleteMany(args: { where: { slug: { in: string[] } } }): Promise<{ count: number }> };
}

/**
 * Delete the retired placeholder Plays, Campaigns and Partners if present. Children first, so it
 * does not rely on the Partner -> Campaign -> Play cascade (Play -> PlayProgress still cascades;
 * the placeholders were never live). The points ledger is untouched: PointsEvent has no foreign
 * key to Play. A no-op on a fresh database.
 */
export async function pruneRetiredPlaceholders(prisma: PruneDb): Promise<SummaryRow[]> {
  const plays = await prisma.play.deleteMany({ where: { key: { in: [...RETIRED_PLACEHOLDERS.playKeys] } } });
  const campaigns = await prisma.campaign.deleteMany({ where: { id: { in: [...RETIRED_PLACEHOLDERS.campaignIds] } } });
  const partners = await prisma.partner.deleteMany({ where: { slug: { in: [...RETIRED_PLACEHOLDERS.partnerSlugs] } } });
  const rows: SummaryRow[] = [];
  if (plays.count > 0) rows.push({ entity: "Play", key: RETIRED_PLACEHOLDERS.playKeys.join(","), action: "deleted", detail: `${plays.count} retired placeholder Plays` });
  if (campaigns.count > 0) rows.push({ entity: "Campaign", key: "camp-stocklana-builder-*", action: "deleted", detail: `${campaigns.count} retired placeholder Campaigns` });
  if (partners.count > 0) rows.push({ entity: "Partner", key: RETIRED_PLACEHOLDERS.partnerSlugs.join(","), action: "deleted", detail: `${partners.count} retired placeholder Partners` });
  return rows;
}

async function main() {
  const startedAt = Date.now();
  const rows: SummaryRow[] = [];

  // ----- 0. Validate the whole catalogue before touching the DB ---------------
  const seenKeys = new Set<string>();
  for (const play of SEASON0_PLAYS) {
    if (seenKeys.has(play.key)) throw new Error(`Duplicate Play key in catalogue: ${play.key}`);
    seenKeys.add(play.key);
    const parsed = PlayRuleSchema.safeParse(play.rule);
    if (!parsed.success) {
      throw new Error(`Play "${play.key}" has an invalid rule: ${JSON.stringify(parsed.error.issues)}`);
    }
    if (!Number.isInteger(play.points) || play.points <= 0) {
      throw new Error(`Play "${play.key}" must award a positive integer number of points`);
    }
    if (!SEASON0_PARTNERS.some((p) => p.slug === play.partnerSlug)) {
      throw new Error(`Play "${play.key}" references unknown partner "${play.partnerSlug}"`);
    }
  }

  // ----- 1. Season ----------------------------------------------------------
  const seasonData = {
    name: SEASON0.name,
    chainScope: toJson(SEASON0.chainScope),
    startsAt: new Date(SEASON0.startsAt),
    endsAt: new Date(SEASON0.endsAt),
  };
  const existingSeason = await prisma.season.findUnique({ where: { id: SEASON0.id } });
  const season = await prisma.season.upsert({
    where: { id: SEASON0.id },
    create: { id: SEASON0.id, ...seasonData },
    update: seasonData,
  });
  rows.push({
    entity: "Season",
    key: season.id,
    action: existingSeason ? "updated" : "created",
    detail: `${season.name} ${season.startsAt.toISOString().slice(0, 10)} → ${season.endsAt.toISOString().slice(0, 10)}`,
  });

  // ----- 1b. Retired placeholders (exactly two known slugs; no general pruning) --
  for (const r of await pruneRetiredPlaceholders(prisma)) rows.push(r);

  // ----- 2. Partners + Campaigns ---------------------------------------------
  const campaignIdBySlug = new Map<string, string>();
  for (const p of SEASON0_PARTNERS) {
    const partnerData = {
      name: p.name,
      logoUrl: p.logoUrl,
      blurb: p.blurb,
      links: toJson(p.links),
      chainIds: toJson(p.chainIds),
      sortOrder: p.sortOrder,
    };
    const existingPartner = await prisma.partner.findUnique({ where: { slug: p.slug } });
    const partner = await prisma.partner.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...partnerData },
      update: partnerData,
    });
    rows.push({
      entity: "Partner",
      key: partner.slug,
      action: existingPartner ? "updated" : "created",
      detail: `${partner.name}${p.hidden ? " (house, hidden from listings)" : ""}`,
    });

    const campaignData = {
      partnerId: partner.id,
      seasonId: season.id,
      title: p.campaign.title,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
    };
    const existingCampaign = await prisma.campaign.findUnique({ where: { id: p.campaign.id } });
    const campaign = await prisma.campaign.upsert({
      where: { id: p.campaign.id },
      create: { id: p.campaign.id, ...campaignData },
      update: campaignData,
    });
    campaignIdBySlug.set(p.slug, campaign.id);
    rows.push({
      entity: "Campaign",
      key: campaign.id,
      action: existingCampaign ? "updated" : "created",
      detail: campaign.title,
    });
  }

  // ----- 3. Plays -------------------------------------------------------------
  for (const play of SEASON0_PLAYS) {
    const campaignId = campaignIdBySlug.get(play.partnerSlug);
    if (!campaignId) throw new Error(`No campaign for partner ${play.partnerSlug}`);
    const rule = PlayRuleSchema.parse(play.rule); // validated again: this is what gets written
    const isActive = !play.comingSoon; // comingSoon -> isActive=false (see header comment)
    const playData = {
      campaignId,
      assetSource: SEASON0_ASSET_SOURCE,
      title: play.title,
      desc: play.desc,
      points: play.points,
      badgeKey: play.badgeKey ?? null,
      rule: toJson(rule),
      sortOrder: play.sortOrder,
      isActive,
    };
    const existingPlay = await prisma.play.findUnique({ where: { key: play.key } });
    const row = await prisma.play.upsert({
      where: { key: play.key },
      create: { key: play.key, ...playData },
      update: playData,
    });
    rows.push({
      entity: "Play",
      key: row.key,
      action: existingPlay ? "updated" : "created",
      detail: `${row.points} pts · ${rule.type}${row.badgeKey ? " · badge" : ""}${row.isActive ? "" : " · coming soon"}`,
    });
  }

  // ----- 4. First League (current week) -------------------------------------
  const now = new Date();
  const { weekStart, weekEnd, rolledForward } = leagueWeekFor(now);
  const existingLeague = await prisma.league.findUnique({
    where: { seasonId_weekStart: { seasonId: season.id, weekStart } },
  });
  // Never overwrite `status` on re-run: a League the cron has settled stays settled.
  const league = await prisma.league.upsert({
    where: { seasonId_weekStart: { seasonId: season.id, weekStart } },
    create: { seasonId: season.id, weekStart, weekEnd, status: "open" },
    update: { weekEnd },
  });
  rows.push({
    entity: "League",
    key: league.id,
    action: existingLeague ? "updated" : "created",
    detail: `${league.weekStart.toISOString()} → ${league.weekEnd.toISOString()} · ${league.status}${rolledForward ? " · rolled to next week (seeded on a weekend)" : ""}`,
  });

  // ----- Game seeds (own files so P2/P3 can evolve independently) -------------
  for (const r of await seedLeague(prisma, season.id)) rows.push(r);
  for (const r of await seedCalls(prisma, season.id)) rows.push(r);

  // ----- Summary -------------------------------------------------------------
  const created = rows.filter((r) => r.action === "created").length;
  const deleted = rows.filter((r) => r.action === "deleted").length;
  const updated = rows.length - created - deleted;
  const w = {
    entity: Math.max(6, ...rows.map((r) => r.entity.length)),
    key: Math.max(3, ...rows.map((r) => r.key.length)),
    action: 7,
  };
  console.log("");
  console.log(`Dulo seed — ${SEASON0.name} (${season.id})`);
  console.log(`${pad("ENTITY", w.entity)}  ${pad("KEY", w.key)}  ${pad("ACTION", w.action)}  DETAIL`);
  console.log(`${"-".repeat(w.entity)}  ${"-".repeat(w.key)}  ${"-".repeat(w.action)}  ${"-".repeat(40)}`);
  for (const r of rows) {
    console.log(`${pad(r.entity, w.entity)}  ${pad(r.key, w.key)}  ${pad(r.action, w.action)}  ${r.detail}`);
  }
  console.log("");
  console.log(
    `${rows.length} rows (${created} created, ${updated} updated${deleted > 0 ? `, ${deleted} deleted` : ""}) · ` +
      `${SEASON0_PARTNERS.length} partners · ${SEASON0_PLAYS.length} plays ` +
      `(${SEASON0_PLAYS.filter((p) => !p.comingSoon).length} active, ${SEASON0_PLAYS.filter((p) => p.comingSoon).length} coming soon) · ` +
      `${Date.now() - startedAt}ms`,
  );
}

// Only run when executed directly (`tsx prisma/seed.ts` / `prisma db seed`), so the
// helpers above can be imported by tests without touching a database.
const isDirectRun = /[\\/]seed\.ts$/.test(process.argv[1] ?? "");

if (isDirectRun) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("Seed failed:", e instanceof Error ? e.message : e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
