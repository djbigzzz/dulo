import { describe, expect, it, vi } from "vitest";

// calls.ts and league.ts are server modules; only their pure ref builders are used here.
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/price", () => ({
  getPriceBySymbol: vi.fn(),
  getPrices: vi.fn(),
  getPricesBySymbols: vi.fn(),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));

import { payoutRef, refundRef, stakeRef } from "@/lib/games/calls";
import { seedGrantRef } from "@/lib/games/calls-seed";
import { STARTING_CASH_USD, awardRef } from "@/lib/games/league";
import {
  MIN_TRADES_FOR_WEEKLY_POINTS,
  NON_SCORING_SOURCES,
  STARTER_POINTS,
  STARTER_SOURCE,
  VIRTUAL_CASH_USD,
  WELCOME_COPY,
  WELCOME_OFFER_LINE,
  isScoringRow,
  ledgerRowLabel,
  openStakePrefix,
  parseLedgerRef,
  starterRef,
  summariseLedger,
  type LedgerRowInput,
} from "@/lib/games/ledger-policy";
import { auditLedger, isLocalDatabaseUrl, type AuditMarketRow, type AuditPointsRow, type AuditPositionRow } from "../scripts/check-ledger";
import { purgeBotPoints } from "../scripts/purge-bot-points";

const U = "cku1user";
const M1 = "ckm1open";
const M2 = "ckm2settled";

describe("ledger refs", () => {
  it("starterRef and openStakePrefix have the documented shapes", () => {
    expect(starterRef("s0")).toBe("starter:s0");
    expect(openStakePrefix(M1)).toBe(`call:${M1}:stake:`);
    // Every points-in ref of that market starts with the prefix, top-ups included.
    expect(stakeRef(M1, U, "yes").startsWith(openStakePrefix(M1))).toBe(true);
    expect(stakeRef(M1, U, "no", 3).startsWith(openStakePrefix(M1))).toBe(true);
    // ...and no other market's ref does.
    expect(stakeRef(`${M1}x`, U, "yes").startsWith(openStakePrefix(M1))).toBe(false);
  });

  it("parseLedgerRef round-trips every ref builder", () => {
    expect(parseLedgerRef(starterRef("s0"))).toEqual({ kind: "starter" });
    expect(parseLedgerRef("play:first_position")).toEqual({ kind: "quest", playKey: "first_position" });
    expect(parseLedgerRef(stakeRef(M1, U, "yes"))).toEqual({ kind: "pointsIn", marketId: M1, side: "yes", seq: 1 });
    expect(parseLedgerRef(stakeRef(M1, "bot-league-3", "no", 3))).toEqual({ kind: "pointsIn", marketId: M1, side: "no", seq: 3 });
    expect(parseLedgerRef(payoutRef(M2, U))).toEqual({ kind: "pointsBack", marketId: M2 });
    expect(parseLedgerRef(refundRef(M2, U, "no"))).toEqual({ kind: "refund", marketId: M2, side: "no" });
    expect(parseLedgerRef(awardRef("L1", 1))).toEqual({ kind: "competition", leagueId: "L1", rank: 1 });
    expect(parseLedgerRef(awardRef("clg9", 10))).toEqual({ kind: "competition", leagueId: "clg9", rank: 10 });
    expect(parseLedgerRef(seedGrantRef(M1, "bot-league-1"))).toEqual({ kind: "seed" });
  });

  it("anything else is unknown, never a throw", () => {
    for (const ref of ["", "starter", "play:", "call:m:stake:u:maybe", "call:m:refund:u", "league:L1:rank:x", "admin:other"]) {
      expect(parseLedgerRef(ref).kind, ref).toBe("unknown");
    }
  });
});

// ---------------------------------------------------------------------------
// The two numbers
// ---------------------------------------------------------------------------

const starter: LedgerRowInput = { source: "starter", ref: starterRef("s0"), delta: STARTER_POINTS };
const quest: LedgerRowInput = { source: "play", ref: "play:oracle", delta: 50 };
const finish: LedgerRowInput = { source: "league", ref: awardRef("L1", 2), delta: 700 };
const OPEN = new Set([M1]);

function identityHolds(rows: LedgerRowInput[], open: ReadonlySet<string>) {
  const s = summariseLedger(rows, open);
  expect(s.balance).toBe(rows.reduce((sum, r) => sum + r.delta, 0));
  expect(s.balance).toBe(s.seasonPoints + s.starterPoints + s.adminPoints - s.inPredictions);
  return s;
}

describe("summariseLedger", () => {
  it("an open prediction: the points in leave the balance but not Season points", () => {
    const rows = [starter, quest, { source: "call", ref: stakeRef(M1, U, "yes"), delta: -100 }];
    const s = identityHolds(rows, OPEN);
    expect(s).toEqual({ balance: 950, seasonPoints: 50, starterPoints: 1000, adminPoints: 0, inPredictions: 100 });
  });

  it("top-ups on both sides of an open prediction all count as points in", () => {
    const rows = [
      starter,
      { source: "call", ref: stakeRef(M1, U, "yes"), delta: -100 },
      { source: "call", ref: stakeRef(M1, U, "yes", 2), delta: -50 },
      { source: "call", ref: stakeRef(M1, U, "no"), delta: -25 },
    ];
    const s = identityHolds(rows, OPEN);
    expect(s).toMatchObject({ balance: 825, seasonPoints: 0, inPredictions: 175 });
  });

  it("a settled loss counts against Season points, which may go negative", () => {
    const rows = [starter, { source: "call", ref: stakeRef(M2, U, "no"), delta: -200 }];
    const s = identityHolds(rows, OPEN); // M2 is not open any more
    expect(s).toEqual({ balance: 800, seasonPoints: -200, starterPoints: 1000, adminPoints: 0, inPredictions: 0 });
  });

  it("a settled win nets the points back against the points in", () => {
    const rows = [starter, quest, finish, { source: "call", ref: stakeRef(M2, U, "yes"), delta: -100 }, { source: "call", ref: payoutRef(M2, U), delta: 180 }];
    const s = identityHolds(rows, OPEN);
    expect(s).toEqual({ balance: 1830, seasonPoints: 830, starterPoints: 1000, adminPoints: 0, inPredictions: 0 });
  });

  it("a void market refunds to zero in both numbers", () => {
    const rows = [starter, { source: "call", ref: stakeRef(M2, U, "yes"), delta: -300 }, { source: "call", ref: refundRef(M2, U, "yes"), delta: 300 }];
    const s = identityHolds(rows, OPEN);
    expect(s).toEqual({ balance: 1000, seasonPoints: 0, starterPoints: 1000, adminPoints: 0, inPredictions: 0 });
  });

  it("a real user holds no admin points; a house bot's grant nets to zero until it settles", () => {
    const real = identityHolds([starter, quest, finish], OPEN);
    expect(real.adminPoints).toBe(0);

    const bot = identityHolds(
      [
        { source: "admin", ref: seedGrantRef(M1, "bot-league-1"), delta: 600 },
        { source: "call", ref: stakeRef(M1, "bot-league-1", "yes"), delta: -600 },
      ],
      OPEN,
    );
    expect(bot).toEqual({ balance: 0, seasonPoints: 0, starterPoints: 0, adminPoints: 600, inPredictions: 600 });
  });

  it("an empty ledger is all zeros", () => {
    expect(identityHolds([], OPEN)).toEqual({ balance: 0, seasonPoints: 0, starterPoints: 0, adminPoints: 0, inPredictions: 0 });
  });
});

describe("isScoringRow", () => {
  it("excludes starter and admin sources and open points-in rows, and nothing else", () => {
    expect(NON_SCORING_SOURCES).toEqual(["starter", "admin"]);
    expect(STARTER_SOURCE).toBe("starter");
    expect(isScoringRow(starter, OPEN)).toBe(false);
    expect(isScoringRow({ source: "admin", ref: seedGrantRef(M1, "bot-league-1") }, OPEN)).toBe(false);
    expect(isScoringRow({ source: "call", ref: stakeRef(M1, U, "yes", 2) }, OPEN)).toBe(false);
    expect(isScoringRow({ source: "call", ref: stakeRef(M2, U, "yes") }, OPEN)).toBe(true);
    expect(isScoringRow({ source: "call", ref: payoutRef(M1, U) }, OPEN)).toBe(true);
    expect(isScoringRow(quest, OPEN)).toBe(true);
    expect(isScoringRow(finish, OPEN)).toBe(true);
    expect(isScoringRow({ source: "call", ref: stakeRef(M1, U, "yes") }, new Set())).toBe(true);
  });

  it("agrees with summariseLedger row by row", () => {
    const rows: LedgerRowInput[] = [starter, quest, finish, { source: "call", ref: stakeRef(M1, U, "no"), delta: -40 }, { source: "call", ref: stakeRef(M2, U, "no"), delta: -60 }];
    const scoring = rows.filter((r) => isScoringRow(r, OPEN)).reduce((sum, r) => sum + r.delta, 0);
    expect(summariseLedger(rows, OPEN).seasonPoints).toBe(scoring);
  });
});

describe("ledgerRowLabel", () => {
  const lookups = { questTitles: new Map([["oracle", "First Prediction"]]), marketTickers: new Map([[M1, "NVDAx"]]) };

  it("labels every kind in plain words", () => {
    expect(ledgerRowLabel(starter, lookups)).toBe("Starter points");
    expect(ledgerRowLabel(quest, lookups)).toBe("Quest: First Prediction");
    expect(ledgerRowLabel({ ref: stakeRef(M1, U, "yes") }, lookups)).toBe("Points into a prediction (NVDAx)");
    expect(ledgerRowLabel({ ref: payoutRef(M1, U) }, lookups)).toBe("Points back from a prediction (NVDAx)");
    expect(ledgerRowLabel({ ref: refundRef(M1, U, "no") }, lookups)).toBe("Prediction refund (NVDAx)");
    expect(ledgerRowLabel(finish, lookups)).toBe("Competition finish #2");
    expect(ledgerRowLabel({ ref: seedGrantRef(M1, "bot-league-1") }, lookups)).toBe("House grant");
    expect(ledgerRowLabel({ ref: "something:else" }, lookups)).toBe("Points");
  });

  it("never falls back to an internal key or a raw id", () => {
    const empty = { questTitles: new Map<string, string>(), marketTickers: new Map<string, string>() };
    expect(ledgerRowLabel({ ref: "play:scout" }, empty)).toBe("Quest completed");
    expect(ledgerRowLabel({ ref: stakeRef(M1, U, "yes") }, empty)).toBe("Points into a prediction");
    expect(ledgerRowLabel({ ref: payoutRef(M1, U) }, empty)).not.toContain(M1);
  });
});

describe("policy constants", () => {
  it("the virtual cash in the copy is the cash a competition account starts with", () => {
    expect(VIRTUAL_CASH_USD).toBe(STARTING_CASH_USD);
    expect(MIN_TRADES_FOR_WEEKLY_POINTS).toBe(3);
    expect(STARTER_POINTS).toBe(1000);
  });

  it("the welcome copy states the grant, the cash and that points have no cash value", () => {
    for (const text of [WELCOME_COPY, WELCOME_OFFER_LINE]) {
      expect(text).toContain("1,000");
      expect(text).toContain("$10,000");
      expect(text).toContain("no cash value");
    }
  });
});

// ---------------------------------------------------------------------------
// scripts/check-ledger.ts (read-only checker) and scripts/purge-bot-points.ts
// ---------------------------------------------------------------------------

describe("auditLedger", () => {
  const S = "s0";
  const BOT = "bot-league-1";
  const HOUSE = "u_house"; // a bot by its isBot competition account only
  const call = (userId: string, ref: string, delta: number): AuditPointsRow => ({ userId, seasonId: S, source: "call", ref, delta });
  const market = (id: string, outcome: string | null, yesPool: number, noPool: number): AuditMarketRow => ({ id, seasonId: S, ticker: "NVDA", outcome, yesPool, noPool });
  const pos = (marketId: string, userId: string, side: "yes" | "no", points: number): AuditPositionRow => ({ marketId, userId, side, points });

  /** A healthy Season: a real user with starter points, a quest and one open, one settled and one void prediction; a funded bot. */
  function healthy() {
    const rows: AuditPointsRow[] = [
      { userId: U, seasonId: S, source: "starter", ref: starterRef(S), delta: 1000 },
      { userId: U, seasonId: S, source: "play", ref: "play:oracle", delta: 50 },
      // open: U 100 yes (60 + 40 top-up), bot 500 no
      call(U, stakeRef("m_open", U, "yes"), -60),
      call(U, stakeRef("m_open", U, "yes", 2), -40),
      { userId: BOT, seasonId: S, source: "admin", ref: seedGrantRef("m_open", BOT), delta: 500 },
      call(BOT, stakeRef("m_open", BOT, "no"), -500),
      // settled yes: U 200 yes wins the whole 700 pool from the bot's 500 no
      call(U, stakeRef("m_won", U, "yes"), -200),
      { userId: BOT, seasonId: S, source: "admin", ref: seedGrantRef("m_won", BOT), delta: 500 },
      call(BOT, stakeRef("m_won", BOT, "no"), -500),
      call(U, payoutRef("m_won", U), 700),
      // void: U 30 no refunded
      call(U, stakeRef("m_void", U, "no"), -30),
      call(U, refundRef("m_void", U, "no"), 30),
    ];
    const markets = [market("m_open", null, 100, 500), market("m_won", "yes", 200, 500), market("m_void", "void", 0, 30)];
    const positions = [pos("m_open", U, "yes", 100), pos("m_open", BOT, "no", 500), pos("m_won", U, "yes", 200), pos("m_won", BOT, "no", 500), pos("m_void", U, "no", 30)];
    return { rows, markets, positions, botUserIds: new Set([BOT, HOUSE]) };
  }

  function failing(input: ReturnType<typeof healthy>) {
    return auditLedger(input).checks.filter((c) => !c.ok).map((c) => c.name);
  }

  it("passes a healthy ledger and reports its shape", () => {
    const r = auditLedger(healthy());
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats).toMatchObject({ starterRows: 1, starterUsers: 1, botUsers: 2, markets: { open: 1, settled: 1, refunded: 1 }, positions: 5 });
  });

  it("fails a negative balance", () => {
    const input = healthy();
    input.rows.push({ userId: "u_broke", seasonId: S, source: "call", ref: stakeRef("m_x", "u_broke", "yes"), delta: -10 });
    expect(failing(input)).toContain("no negative balance per user per Season");
  });

  it("fails a second starter row, a wrong amount or a wrong ref", () => {
    const twice = healthy();
    twice.rows.push({ userId: U, seasonId: S, source: "starter", ref: "starter:s0:again", delta: 1000 });
    const r = auditLedger(twice).checks.find((c) => c.name.startsWith("one starter row"));
    expect(r?.problems).toEqual([`${U} ${S}: starter row with ref starter:s0:again`, `${U} ${S}: 2 starter rows`]);

    const wrong = healthy();
    wrong.rows[0] = { ...wrong.rows[0], delta: 5000 };
    expect(failing(wrong)).toContain("one starter row of 1,000 per user per Season");
  });

  it("fails when a house bot holds starter, quest or competition points, by either bot marker", () => {
    for (const [userId, source, ref] of [
      [BOT, "starter", starterRef(S)],
      [HOUSE, "starter", starterRef(S)],
      [BOT, "play", "play:scout"],
      [HOUSE, "league", "league:L1:rank:1"],
    ]) {
      const input = healthy();
      input.rows.push({ userId, seasonId: S, source, ref, delta: 1000 });
      expect(failing(input), `${userId} ${source}`).toContain("no house bot holds starter, quest or competition points");
    }
  });

  it("fails when a real user holds admin points", () => {
    const input = healthy();
    input.rows.push({ userId: U, seasonId: S, source: "admin", ref: seedGrantRef("m_open", U), delta: 500 });
    expect(failing(input)).toEqual(["no real user holds admin points"]);
  });

  it("fails an open pool that drifted from its positions", () => {
    const input = healthy();
    input.markets[0] = { ...input.markets[0], yesPool: 90 };
    expect(failing(input)).toEqual(["open prediction pools equal their positions"]);
  });

  it("fails points-in rows that do not match a position, either way", () => {
    const short = healthy();
    short.rows.splice(3, 1); // drop U's 40-point top-up
    expect(failing(short)).toEqual(["points-in rows equal positions"]);

    const orphan = healthy();
    orphan.rows.push(call(U, stakeRef("m_open", U, "no"), -10));
    expect(auditLedger(orphan).checks.find((c) => c.name === "points-in rows equal positions")?.problems).toEqual([
      `m_open ${U} no: points-in rows 10 without a position`,
    ]);
  });

  it("fails a settled market whose points back do not add up to the pool", () => {
    const input = healthy();
    input.rows = input.rows.map((r) => (r.ref === payoutRef("m_won", U) ? { ...r, delta: 699 } : r));
    expect(failing(input)).toEqual(["settled two-sided predictions paid back exactly the pool"]);
  });

  it("fails an open market that already has points back", () => {
    const input = healthy();
    input.rows.push(call(U, payoutRef("m_open", U), 600));
    expect(failing(input)).toContain("settled two-sided predictions paid back exactly the pool");
  });

  it("fails a refund that does not return exactly the points put in, and treats a one-sided settlement as a refund", () => {
    const input = healthy();
    input.rows = input.rows.map((r) => (r.ref === refundRef("m_void", U, "no") ? { ...r, delta: 20 } : r));
    expect(failing(input)).toEqual(["refunded predictions returned exactly the points put in"]);

    // Settled "no" with nobody on yes: every no is refunded, nobody is paid.
    const oneSided = healthy();
    oneSided.markets.push(market("m_empty", "no", 0, 80));
    oneSided.positions.push(pos("m_empty", U, "no", 80));
    oneSided.rows.push(call(U, stakeRef("m_empty", U, "no"), -80), call(U, refundRef("m_empty", U, "no"), 80));
    const r = auditLedger(oneSided);
    expect(r.ok).toBe(true);
    expect(r.stats.markets).toEqual({ open: 1, settled: 1, refunded: 2 });
  });

  it("only accepts a local database url", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@localhost:51214/template1?sslmode=disable")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")).toBe(false);
    expect(isLocalDatabaseUrl("postgres://u:p@localhost.evil.example:5432/db")).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
  });
});

describe("purgeBotPoints", () => {
  function fakePrisma() {
    const count = vi.fn().mockResolvedValue(1);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const pointsDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    return {
      user: { findMany: vi.fn().mockResolvedValue([{ id: "bot-league-1" }, { id: "u_house" }]) },
      wallet: { count },
      pointsEvent: { count, deleteMany: pointsDeleteMany },
      playProgress: { count, deleteMany },
      badge: { count, deleteMany },
      snapshot: { count, deleteMany },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      deleteMany,
      pointsDeleteMany,
    };
  }

  it("finds bots by either marker and also deletes their starter rows", async () => {
    const prisma = fakePrisma();
    const c = await purgeBotPoints(prisma as never, false);

    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ leagueAccounts: { some: { isBot: true } } }, { id: { startsWith: "bot-league-" } }],
    });
    expect(c).toMatchObject({ bots: 2, playPoints: 1, starterPoints: 1 });
    const pointsDeletes = prisma.pointsDeleteMany.mock.calls.map((call) => call[0].where);
    // Admin rows (the bots' seeded pool funding) and points-in rows are never touched.
    expect(pointsDeletes).toEqual([
      { userId: { in: ["bot-league-1", "u_house"] }, source: "play" },
      { userId: { in: ["bot-league-1", "u_house"] }, source: "starter" },
    ]);
  });

  it("a dry run only counts", async () => {
    const prisma = fakePrisma();
    const c = await purgeBotPoints(prisma as never, true);
    expect(c.starterPoints).toBe(1);
    expect(prisma.deleteMany).not.toHaveBeenCalled();
    expect(prisma.pointsDeleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
