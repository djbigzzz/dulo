/**
 * Read-only ledger checker (16 Sep 2026 points policy). It never writes a row.
 *
 * Asserts, over every PointsEvent, Market and Position in the database:
 *   1. no (user, Season) balance is below 0;
 *   2. at most one starter row per user per Season, each `starter:<seasonId>` for exactly 1,000;
 *   3. no house bot (a bot-league-* id or a user with an isBot competition account) holds a
 *      starter, quest (play) or competition (league) row;
 *   4. no real user holds an admin row (admin rows only fund house bots' seeded pools);
 *   5. every open market's yesPool / noPool equals its Position sums;
 *   6. every Position's points-in rows (first placement plus top-ups) sum to exactly its points,
 *      and no points-in row exists without a Position;
 *   7. every settled two-sided market paid back exactly its pool (payout rows), with no refunds,
 *      and an open market has neither;
 *   8. every refunded market (void, or settled with an empty side) refunded exactly the points
 *      put in, per user and side, with no payouts.
 * Prints a summary and exits non-zero when any check fails.
 *
 * Usage (local database only; it refuses any DATABASE_URL that is not on localhost)
 *   npx tsx --env-file=.env.local scripts/check-ledger.ts
 *
 * The pure audit (auditLedger) is exported for tests; Prisma is only loaded by main().
 */
import { STARTER_POINTS, STARTER_SOURCE, parseLedgerRef, starterRef } from "@/lib/games/ledger-policy";

export interface AuditPointsRow {
  userId: string;
  seasonId: string;
  source: string;
  ref: string;
  delta: number;
}

export interface AuditMarketRow {
  id: string;
  seasonId: string;
  ticker: string;
  outcome: string | null;
  yesPool: number;
  noPool: number;
}

export interface AuditPositionRow {
  marketId: string;
  userId: string;
  side: string;
  points: number;
}

export interface LedgerAuditInput {
  rows: readonly AuditPointsRow[];
  /** Users that are house bots by either marker. */
  botUserIds: ReadonlySet<string>;
  markets: readonly AuditMarketRow[];
  positions: readonly AuditPositionRow[];
}

export interface LedgerCheck {
  name: string;
  ok: boolean;
  problems: string[];
}

export interface LedgerAuditResult {
  ok: boolean;
  checks: LedgerCheck[];
  stats: {
    rows: number;
    users: number;
    botUsers: number;
    starterRows: number;
    starterUsers: number;
    markets: { open: number; settled: number; refunded: number };
    positions: number;
  };
}

const BOT_ONLY_FORBIDDEN = new Set([STARTER_SOURCE, "play", "league"]);

function add(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function check(name: string, problems: string[]): LedgerCheck {
  return { name, ok: problems.length === 0, problems };
}

/** Every ledger invariant over plain rows. Pure. */
export function auditLedger(input: LedgerAuditInput): LedgerAuditResult {
  const { rows, botUserIds, markets, positions } = input;
  const marketById = new Map(markets.map((m) => [m.id, m]));

  // 1. No negative (user, Season) balance.
  const balances = new Map<string, number>();
  for (const r of rows) add(balances, `${r.userId} ${r.seasonId}`, r.delta);
  const negative = [...balances].filter(([, sum]) => sum < 0).map(([key, sum]) => `${key}: balance ${sum}`);

  // 2. One starter row per user per Season, for exactly STARTER_POINTS, under its own ref.
  const starterRows = rows.filter((r) => r.source === STARTER_SOURCE);
  const starterCount = new Map<string, number>();
  const starterProblems: string[] = [];
  for (const r of starterRows) {
    add(starterCount, `${r.userId} ${r.seasonId}`, 1);
    if (r.delta !== STARTER_POINTS) starterProblems.push(`${r.userId} ${r.seasonId}: starter row for ${r.delta}`);
    if (r.ref !== starterRef(r.seasonId)) starterProblems.push(`${r.userId} ${r.seasonId}: starter row with ref ${r.ref}`);
  }
  for (const [key, n] of starterCount) if (n > 1) starterProblems.push(`${key}: ${n} starter rows`);

  // 3. Bots never hold starter, quest or competition rows.
  const botRows = rows
    .filter((r) => botUserIds.has(r.userId) && BOT_ONLY_FORBIDDEN.has(r.source))
    .map((r) => `${r.userId}: ${r.source} row ${r.ref} (${r.delta})`);

  // 4. Real users never hold admin rows.
  const adminRows = rows.filter((r) => r.source === "admin" && !botUserIds.has(r.userId)).map((r) => `${r.userId}: admin row ${r.ref} (${r.delta})`);

  // Per-market sums from Positions (the source of truth settlement reads).
  const posSum = new Map<string, { yes: number; no: number }>();
  const posByKey = new Map<string, number>();
  for (const p of positions) {
    const s = posSum.get(p.marketId) ?? { yes: 0, no: 0 };
    if (p.side === "no") s.no += p.points;
    else s.yes += p.points;
    posSum.set(p.marketId, s);
    posByKey.set(`${p.marketId} ${p.userId} ${p.side}`, p.points);
  }

  // Ledger sums per market from the call rows.
  const pointsIn = new Map<string, number>();
  const pointsBack = new Map<string, number>();
  const refundTotal = new Map<string, number>();
  const refundByKey = new Map<string, number>();
  for (const r of rows) {
    if (r.source !== "call") continue;
    const parsed = parseLedgerRef(r.ref);
    if (!parsed.marketId) continue;
    if (parsed.kind === "pointsIn") add(pointsIn, `${parsed.marketId} ${r.userId} ${parsed.side}`, -r.delta);
    else if (parsed.kind === "pointsBack") add(pointsBack, parsed.marketId, r.delta);
    else if (parsed.kind === "refund") {
      add(refundTotal, parsed.marketId, r.delta);
      add(refundByKey, `${parsed.marketId} ${r.userId} ${parsed.side}`, r.delta);
    }
  }

  // 5. Open pools equal their Position sums.
  const poolProblems: string[] = [];
  const open = markets.filter((m) => m.outcome === null);
  for (const m of open) {
    const s = posSum.get(m.id) ?? { yes: 0, no: 0 };
    if (m.yesPool !== s.yes || m.noPool !== s.no) {
      poolProblems.push(`${m.ticker} ${m.id}: pools yes ${m.yesPool} / no ${m.noPool}, positions yes ${s.yes} / no ${s.no}`);
    }
  }

  // 6. Points-in rows match Positions exactly, both ways.
  const pointsInProblems: string[] = [];
  for (const [key, points] of posByKey) {
    const inLedger = pointsIn.get(key) ?? 0;
    if (inLedger !== points) pointsInProblems.push(`${key}: position ${points}, points-in rows ${inLedger}`);
  }
  for (const [key, inLedger] of pointsIn) {
    if (!posByKey.has(key)) pointsInProblems.push(`${key}: points-in rows ${inLedger} without a position`);
  }

  // 7 + 8. Settlement rows.
  const settledProblems: string[] = [];
  const refundProblems: string[] = [];
  let settledCount = 0;
  let refundedCount = 0;
  for (const m of markets) {
    const s = posSum.get(m.id) ?? { yes: 0, no: 0 };
    const total = s.yes + s.no;
    const paid = pointsBack.get(m.id) ?? 0;
    const refunded = refundTotal.get(m.id) ?? 0;
    const label = `${m.ticker} ${m.id}`;
    if (m.outcome === null) {
      if (paid !== 0 || refunded !== 0) settledProblems.push(`${label}: open, but ${paid} points back and ${refunded} refunded`);
      continue;
    }
    const isRefund = m.outcome === "void" || s.yes === 0 || s.no === 0;
    if (!isRefund) {
      settledCount += 1;
      if (paid !== total) settledProblems.push(`${label}: pool ${total}, points back ${paid}`);
      if (refunded !== 0) settledProblems.push(`${label}: two-sided, but ${refunded} refunded`);
      continue;
    }
    refundedCount += 1;
    if (refunded !== total) refundProblems.push(`${label}: points in ${total}, refunded ${refunded}`);
    if (paid !== 0) refundProblems.push(`${label}: refunded, but ${paid} points back`);
    for (const p of positions) {
      if (p.marketId !== m.id) continue;
      const got = refundByKey.get(`${m.id} ${p.userId} ${p.side}`) ?? 0;
      if (got !== p.points) refundProblems.push(`${label} ${p.userId} ${p.side}: put in ${p.points}, refunded ${got}`);
    }
  }
  for (const key of refundByKey.keys()) {
    const marketId = key.split(" ")[0];
    if (!marketById.has(marketId)) refundProblems.push(`${key}: refund row for an unknown market`);
  }

  const checks = [
    check("no negative balance per user per Season", negative),
    check("one starter row of 1,000 per user per Season", starterProblems),
    check("no house bot holds starter, quest or competition points", botRows),
    check("no real user holds admin points", adminRows),
    check("open prediction pools equal their positions", poolProblems),
    check("points-in rows equal positions", pointsInProblems),
    check("settled two-sided predictions paid back exactly the pool", settledProblems),
    check("refunded predictions returned exactly the points put in", refundProblems),
  ];
  return {
    ok: checks.every((c) => c.ok),
    checks,
    stats: {
      rows: rows.length,
      users: new Set(rows.map((r) => r.userId)).size,
      botUsers: botUserIds.size,
      starterRows: starterRows.length,
      starterUsers: new Set(starterRows.filter((r) => !botUserIds.has(r.userId)).map((r) => r.userId)).size,
      markets: { open: open.length, settled: settledCount, refunded: refundedCount },
      positions: positions.length,
    },
  };
}

/** True only for a database on this machine. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (run: npx tsx --env-file=.env.local scripts/check-ledger.ts)");
  if (!isLocalDatabaseUrl(url)) throw new Error("check-ledger only runs against a local database (DATABASE_URL must point at localhost)");

  const [{ PrismaClient }, { BOT_USER_ID_PREFIX }, { withPgBouncer }] = await Promise.all([
    import("@prisma/client"),
    import("@/lib/games/bots"),
    import("./purge-bot-points"),
  ]);
  const prisma = new PrismaClient({ datasources: { db: { url: withPgBouncer(url) } }, log: ["warn", "error"] });
  try {
    // Sequential reads, nothing else: this script never writes.
    const rows = await prisma.pointsEvent.findMany({ select: { userId: true, seasonId: true, source: true, ref: true, delta: true } });
    const bots = await prisma.user.findMany({
      where: { OR: [{ id: { startsWith: BOT_USER_ID_PREFIX } }, { leagueAccounts: { some: { isBot: true } } }] },
      select: { id: true },
    });
    const markets = await prisma.market.findMany({ select: { id: true, seasonId: true, ticker: true, outcome: true, yesPool: true, noPool: true } });
    const positions = await prisma.position.findMany({ select: { marketId: true, userId: true, side: true, points: true } });

    const result = auditLedger({ rows, botUserIds: new Set(bots.map((b) => b.id)), markets, positions });
    const s = result.stats;
    console.log(`check-ledger: ${s.rows} ledger rows, ${s.users} users (${s.botUsers} house bots), ${s.positions} positions`);
    console.log(`  starter rows ${s.starterRows} (real users granted: ${s.starterUsers})`);
    console.log(`  markets open ${s.markets.open}, settled ${s.markets.settled}, refunded ${s.markets.refunded}`);
    for (const c of result.checks) {
      console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : ` (${c.problems.length})`}`);
      for (const p of c.problems.slice(0, 20)) console.log(`         ${p}`);
      if (c.problems.length > 20) console.log(`         ... and ${c.problems.length - 20} more`);
    }
    console.log(result.ok ? "check-ledger: all checks passed" : "check-ledger: FAILED");
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly, so auditLedger can be imported by tests.
const isDirectRun = /[\\/]check-ledger\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) {
  main().catch((e) => {
    console.error("check-ledger failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
