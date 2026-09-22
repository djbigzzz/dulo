import { beforeEach, describe, expect, it, vi } from "vitest";

// queries.ts imports the Prisma client; the DB-backed functions under test get a mocked
// client so the tests can pin the exact where-clauses (bot hygiene lives in the queries,
// not in post-processing). The pure helpers never touch it.
const mocks = vi.hoisted(() => ({
  db: {
    season: { findFirst: vi.fn(), findUnique: vi.fn() },
    pointsEvent: { groupBy: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    partner: { findMany: vi.fn(), findUnique: vi.fn() },
    play: { findMany: vi.fn(), count: vi.fn() },
    playProgress: { groupBy: vi.fn(), findMany: vi.fn() },
    market: { findMany: vi.fn() },
  },
  getPrices: vi.fn(),
  getSession: vi.fn(),
  clearSessionCookie: vi.fn(),
  listCorporateActions: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession, clearSessionCookie: mocks.clearSessionCookie }));
vi.mock("@/lib/price", () => ({ getPrices: mocks.getPrices }));
// lib/corporate-actions reads the asset registry (issuer APIs) and the chain adapter: a unit test
// of the queries must never reach either, so the list is mocked and the issuer test is the real one.
vi.mock("@/lib/corporate-actions", () => ({
  listCorporateActions: mocks.listCorporateActions,
  issuerSourceForPartner: (slug: string) => (slug === "xstocks" || slug === "prestocks" ? slug : null),
}));

import {
  REAL_USER_WHERE,
  getLeaderboard,
  getPartner,
  getPointsSummary,
  getUserProfile,
  listPartners,
  pickDisplayWallet,
  rankLeaderboard,
  seasonPhase,
  seasonScoreWhere,
} from "@/lib/server/queries";
import { GET as getMe } from "@/app/api/v1/auth/me/route";

describe("getPartner", () => {
  it("has no Partner page for the hidden house Partner: null without a database read, so the page and API 404", async () => {
    expect(await getPartner("dulo")).toBeNull();
    expect(mocks.db.partner.findUnique).not.toHaveBeenCalled();
  });

  it("looks up a listed slug", async () => {
    mocks.db.partner.findUnique.mockResolvedValue(null);
    expect(await getPartner("xstocks")).toBeNull();
    expect(mocks.db.partner.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.db.partner.findUnique.mock.calls[0][0].where).toEqual({ slug: "xstocks" });
  });

  const SPACEX_SPLIT = {
    assetId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    symbol: "SPACEX",
    source: "prestocks",
    kind: "split",
    multiplierBefore: 1,
    multiplierAfter: 5,
    ratio: 5,
    effectiveAt: "2026-06-10T04:30:00.000Z",
    effective: true,
  };
  const partnerRow = (slug: string) => ({ slug, name: slug, logoUrl: null, blurb: "", links: {}, chainIds: [], sortOrder: 1, campaigns: [] });

  it("carries an issuer Partner's corporate actions from the shared list, read once for that source", async () => {
    mocks.db.partner.findUnique.mockResolvedValue(partnerRow("prestocks"));
    mocks.listCorporateActions.mockResolvedValue([SPACEX_SPLIT]);
    const detail = await getPartner("prestocks");
    expect(detail?.corporateActions).toEqual([SPACEX_SPLIT]);
    expect(mocks.listCorporateActions).toHaveBeenCalledTimes(1);
    expect(mocks.listCorporateActions).toHaveBeenCalledWith("prestocks");
  });

  it("gives every non-issuer Partner an empty list without asking the chain", async () => {
    mocks.db.partner.findUnique.mockResolvedValue(partnerRow("jupiter"));
    const detail = await getPartner("jupiter");
    expect(detail?.corporateActions).toEqual([]);
    expect(mocks.listCorporateActions).not.toHaveBeenCalled();
  });
});

const SEASON = {
  id: "season_0",
  name: "Stocks Season",
  chainScope: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2026-10-31T00:00:00.000Z"),
};
const CREATED = new Date("2026-09-10T00:00:00.000Z");

/** Season points exclude these sources (lib/games/ledger-policy NON_SCORING_SOURCES). */
const NOT_SCORING = { notIn: ["starter", "admin"] };
const REAL_USERS_ONLY = { leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.season.findFirst.mockResolvedValue(SEASON);
  // No open prediction unless a test says so.
  mocks.db.market.findMany.mockResolvedValue([]);
});

describe("rankLeaderboard", () => {
  it("assigns competition ranks (1224) and breaks ties by userId asc, matching the DB orderBy", () => {
    const rows = rankLeaderboard([
      { userId: "u_b", handle: "alpha", address: null, points: 100 },
      { userId: "u_c", handle: null, address: "9zzz", points: 250 },
      { userId: "u_a", handle: "zulu", address: null, points: 100 },
      { userId: "u_d", handle: null, address: null, points: 50 },
    ]);
    expect(rows.map((r) => [r.rank, r.userId])).toEqual([
      [1, "u_c"],
      [2, "u_a"], // same points as u_b: userId asc wins, not the handle
      [2, "u_b"],
      [4, "u_d"],
    ]);
  });

  it("is independent of input order", () => {
    const a = rankLeaderboard([
      { userId: "u2", handle: null, address: null, points: 10 },
      { userId: "u1", handle: null, address: null, points: 10 },
    ]);
    const b = rankLeaderboard([
      { userId: "u1", handle: null, address: null, points: 10 },
      { userId: "u2", handle: null, address: null, points: 10 },
    ]);
    expect(a).toEqual(b);
    expect(a.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });

  it("handles an empty board", () => {
    expect(rankLeaderboard([])).toEqual([]);
  });
});

describe("seasonPhase", () => {
  const start = new Date("2026-09-01T00:00:00.000Z");
  const end = new Date("2026-09-30T00:00:00.000Z");
  it("classifies now against the season window", () => {
    expect(seasonPhase(start, end, new Date("2026-08-31T23:59:59.000Z"))).toBe("upcoming");
    expect(seasonPhase(start, end, new Date("2026-09-14T12:00:00.000Z"))).toBe("active");
    expect(seasonPhase(start, end, new Date("2026-10-01T00:00:00.000Z"))).toBe("ended");
  });
});

describe("pickDisplayWallet", () => {
  it("prefers the primary wallet, else the oldest", () => {
    const older = { address: "old", isPrimary: false, createdAt: new Date("2026-01-01T00:00:00.000Z") };
    const newer = { address: "new", isPrimary: false, createdAt: new Date("2026-02-01T00:00:00.000Z") };
    const primary = { address: "pri", isPrimary: true, createdAt: new Date("2026-03-01T00:00:00.000Z") };
    expect(pickDisplayWallet([newer, older, primary])?.address).toBe("pri");
    expect(pickDisplayWallet([newer, older])?.address).toBe("old");
    expect(pickDisplayWallet([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bot hygiene (docs/REVIEW-2026-09-14.md H2): the exclusion is in the DB query
// ---------------------------------------------------------------------------

describe("REAL_USER_WHERE", () => {
  it("is the bot exclusion on the User relation: no LeagueAccount with isBot = true", () => {
    expect(REAL_USER_WHERE).toEqual({ leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } });
  });
});

describe("seasonScoreWhere", () => {
  it("excludes starter and admin rows, and omits NOT when no prediction is open", () => {
    expect(seasonScoreWhere("season_0", [])).toEqual({ seasonId: "season_0", source: NOT_SCORING });
    expect(seasonScoreWhere("season_0", [])).not.toHaveProperty("NOT");
  });

  it("excludes the points-in rows of every open market by ref prefix", () => {
    expect(seasonScoreWhere("season_0", ["m_nvda", "m_tsla"])).toEqual({
      seasonId: "season_0",
      source: NOT_SCORING,
      NOT: [{ ref: { startsWith: "call:m_nvda:stake:" } }, { ref: { startsWith: "call:m_tsla:stake:" } }],
    });
  });
});

describe("getLeaderboard", () => {
  it("excludes bots in the groupBy where-clause (before take, so the cut leaves no holes) and ranks the rest", async () => {
    mocks.db.pointsEvent.groupBy.mockResolvedValue([
      { userId: "u_real", _sum: { delta: 150 } },
      { userId: "u_other", _sum: { delta: 50 } },
    ]);
    mocks.db.user.findMany.mockResolvedValue([
      { id: "u_real", handle: "player_one", wallets: [{ address: "Addr1", isPrimary: true, createdAt: CREATED }] },
      { id: "u_other", handle: null, wallets: [] },
    ]);

    const { rows, season } = await getLeaderboard(undefined, 10);

    expect(season?.id).toBe("season_0");
    expect(mocks.db.pointsEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0]).toEqual({
      by: ["userId"],
      // Season points only: no starter/admin rows, and bots never.
      where: { seasonId: "season_0", source: NOT_SCORING, user: { leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } } },
      _sum: { delta: true },
      having: { delta: { _sum: { gt: 0 } } },
      orderBy: [{ _sum: { delta: "desc" } }, { userId: "asc" }],
      take: 10,
    });
    // The open markets are read for this Season only, before the sums.
    expect(mocks.db.market.findMany).toHaveBeenCalledWith({ where: { seasonId: "season_0", outcome: null }, select: { id: true } });
    expect(mocks.db.market.findMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.pointsEvent.groupBy.mock.invocationCallOrder[0]);
    expect(rows).toEqual([
      { rank: 1, userId: "u_real", handle: "player_one", address: "Addr1", points: 150 },
      { rank: 2, userId: "u_other", handle: null, address: null, points: 50 },
    ]);
  });

  it("leaves points in open predictions out: two open markets produce the NOT startsWith list", async () => {
    mocks.db.market.findMany.mockResolvedValue([{ id: "m_nvda" }, { id: "m_spy" }]);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);

    await getLeaderboard();

    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0].where).toEqual({
      seasonId: "season_0",
      source: NOT_SCORING,
      NOT: [{ ref: { startsWith: "call:m_nvda:stake:" } }, { ref: { startsWith: "call:m_spy:stake:" } }],
      user: REAL_USERS_ONLY,
    });
  });

  it("returns an empty board when only bots hold points (the database filtered them out)", async () => {
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);
    const { rows } = await getLeaderboard();
    expect(rows).toEqual([]);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("listPartners", () => {
  it("counts completions for real users only (bots never count as attribution)", async () => {
    mocks.db.partner.findMany.mockResolvedValue([
      { id: "p1", slug: "xstocks", name: "xStocks", logoUrl: null, blurb: "Tokenized stocks", links: {}, chainIds: [], sortOrder: 0 },
    ]);
    mocks.db.play.findMany.mockResolvedValue([
      { key: "diversified", campaign: { partnerId: "p1" } },
      { key: "first_position", campaign: { partnerId: "p1" } },
    ]);
    mocks.db.playProgress.groupBy.mockResolvedValue([{ playKey: "first_position", _count: { _all: 2 } }]);

    const partners = await listPartners();

    expect(mocks.db.playProgress.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.db.playProgress.groupBy.mock.calls[0][0]).toEqual({
      by: ["playKey"],
      where: { status: "complete", playKey: { in: ["diversified", "first_position"] }, user: { leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } } },
      _count: { _all: true },
    });
    expect(partners).toHaveLength(1);
    expect(partners[0]).toMatchObject({ slug: "xstocks", playCount: 2, completions: 2 });
  });

  it("hides the house Partner ('dulo', Dulo games) in the database: neither the Partner nor its Plays are read", async () => {
    mocks.db.partner.findMany.mockResolvedValue([]);
    mocks.db.play.findMany.mockResolvedValue([]);

    expect(await listPartners()).toEqual([]);

    expect(mocks.db.partner.findMany.mock.calls[0][0]).toEqual({
      where: { slug: { notIn: ["dulo"] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    expect(mocks.db.play.findMany.mock.calls[0][0]).toMatchObject({
      where: { campaign: { partner: { slug: { notIn: ["dulo"] } } } },
    });
    // No Plays -> no completions query at all.
    expect(mocks.db.playProgress.groupBy).not.toHaveBeenCalled();
  });
});

describe("getUserProfile", () => {
  const OPEN_MARKET = "m_nvda";
  const ROWS = [
    { source: "play", ref: "play:oracle", delta: 50, ts: new Date("2026-09-16T10:02:00.000Z") },
    { source: "call", ref: `call:${OPEN_MARKET}:stake:u_real:yes`, delta: -100, ts: new Date("2026-09-16T10:01:00.000Z") },
    { source: "starter", ref: "starter:season_0", delta: 1000, ts: new Date("2026-09-16T10:00:00.000Z") },
  ];

  function realUser(id = "u_real") {
    mocks.db.user.findUnique.mockResolvedValue({ id, handle: "player_one", createdAt: CREATED, wallets: [], badges: [] });
    mocks.db.playProgress.findMany.mockResolvedValue([]);
    mocks.db.play.count.mockResolvedValue(8);
  }

  it("splits the ledger into Season points, balance, starter points and points in predictions, and ranks on Season points", async () => {
    realUser();
    mocks.db.pointsEvent.findMany.mockResolvedValue(ROWS);
    mocks.db.market.findMany.mockImplementation(async ({ where }: { where: { id?: unknown; outcome?: null } }) => {
      if (where.id) return [{ id: OPEN_MARKET, ticker: "NVDA" }];
      return [{ id: OPEN_MARKET }];
    });
    mocks.db.play.findMany.mockResolvedValue([{ key: "oracle", title: "First Prediction" }]);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: 50 } });
    // One real user strictly ahead -> rank 2. A bot with more points would not be returned by Postgres.
    mocks.db.pointsEvent.groupBy.mockResolvedValue([{ userId: "u_a", _sum: { delta: 400 } }]);

    const profile = await getUserProfile("u_real");

    expect(profile).toMatchObject({
      userId: "u_real",
      points: 50,
      balance: 950,
      starterPoints: 1000,
      inPredictions: 100,
      pointsAllTime: 50,
      rank: 2,
      playsCompleted: 0,
      playsTotal: 8,
    });
    // The Season rows are read once, newest first.
    expect(mocks.db.pointsEvent.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.findMany.mock.calls[0][0]).toEqual({
      where: { userId: "u_real", seasonId: "season_0" },
      select: { source: true, ref: true, delta: true, ts: true },
      orderBy: { ts: "desc" },
    });
    // The rank groupBy carries the same where-clause as the board, with the bot exclusion.
    expect(mocks.db.pointsEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0]).toEqual({
      by: ["userId"],
      where: {
        seasonId: "season_0",
        source: NOT_SCORING,
        NOT: [{ ref: { startsWith: "call:m_nvda:stake:" } }],
        user: REAL_USERS_ONLY,
      },
      _sum: { delta: true },
      having: { delta: { _sum: { gt: 50 } } },
    });
    // All-time points: scoring sources only, every open market's points in excluded (all Seasons).
    expect(mocks.db.pointsEvent.aggregate.mock.calls[0][0]).toEqual({
      _sum: { delta: true },
      where: { userId: "u_real", source: NOT_SCORING, NOT: [{ ref: { startsWith: "call:m_nvda:stake:" } }] },
    });
    expect(mocks.db.market.findMany).toHaveBeenCalledWith({ where: { outcome: null }, select: { id: true } });
  });

  it("lists the points history newest first with plain labels", async () => {
    realUser();
    mocks.db.pointsEvent.findMany.mockResolvedValue([
      ...ROWS,
      // House funding never shows for anyone (real users never hold it; the filter is belt and braces).
      { source: "admin", ref: `admin:seed:${OPEN_MARKET}:u_real`, delta: 500, ts: new Date("2026-09-15T00:00:00.000Z") },
    ]);
    mocks.db.market.findMany.mockImplementation(async ({ where }: { where: { id?: unknown } }) => (where.id ? [{ id: OPEN_MARKET, ticker: "NVDA" }] : [{ id: OPEN_MARKET }]));
    mocks.db.play.findMany.mockResolvedValue([{ key: "oracle", title: "First Prediction" }]);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: 50 } });
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);

    const profile = await getUserProfile("u_real");

    expect(profile?.history).toEqual([
      { label: "Quest: First Prediction", delta: 50, ts: "2026-09-16T10:02:00.000Z", kind: "quest" },
      { label: "Points into a prediction (NVDAx)", delta: -100, ts: "2026-09-16T10:01:00.000Z", kind: "pointsIn" },
      { label: "Starter points", delta: 1000, ts: "2026-09-16T10:00:00.000Z", kind: "starter" },
    ]);
    // One title read and one ticker read, keyed on what the rows reference.
    expect(mocks.db.play.findMany).toHaveBeenCalledWith({ where: { key: { in: ["oracle"] } }, select: { key: true, title: true } });
    expect(mocks.db.market.findMany).toHaveBeenCalledWith({ where: { id: { in: [OPEN_MARKET] } }, select: { id: true, ticker: true } });
  });

  it("caps the history at 20 rows", async () => {
    realUser();
    const many = Array.from({ length: 30 }, (_, i) => ({ source: "play", ref: `play:q${i}`, delta: 1, ts: new Date(Date.UTC(2026, 8, 16, 0, 30 - i)) }));
    mocks.db.pointsEvent.findMany.mockResolvedValue(many);
    mocks.db.play.findMany.mockResolvedValue([]);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: 30 } });
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);

    const profile = await getUserProfile("u_real");

    expect(profile?.history).toHaveLength(20);
    expect(profile?.history?.[0]).toMatchObject({ label: "Quest completed", kind: "quest" });
  });

  it("has no rank with only starter points, and shows a settled loss honestly", async () => {
    realUser("u_new");
    mocks.db.pointsEvent.findMany.mockResolvedValue([
      { source: "call", ref: "call:m_old:stake:u_new:no", delta: -200, ts: new Date("2026-09-12T00:00:00.000Z") },
      { source: "starter", ref: "starter:season_0", delta: 1000, ts: new Date("2026-09-11T00:00:00.000Z") },
    ]);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: -200 } });

    const profile = await getUserProfile("u_new");

    expect(profile).toMatchObject({ points: -200, balance: 800, starterPoints: 1000, inPredictions: 0, rank: null });
    expect(mocks.db.pointsEvent.groupBy).not.toHaveBeenCalled();
  });

  it("has no rank without positive Season points", async () => {
    realUser("u_new");
    mocks.db.pointsEvent.findMany.mockResolvedValue([]);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: null } });

    const profile = await getUserProfile("u_new");

    expect(profile).toMatchObject({ points: 0, balance: 0, starterPoints: 0, inPredictions: 0, rank: null, history: [] });
    expect(mocks.db.pointsEvent.groupBy).not.toHaveBeenCalled();
  });
});

describe("getPointsSummary", () => {
  it("returns balance, Season points, starter points, points in predictions and the rank", async () => {
    mocks.db.pointsEvent.findMany.mockResolvedValue([
      { source: "starter", ref: "starter:season_0", delta: 1000 },
      { source: "play", ref: "play:oracle", delta: 50 },
      { source: "call", ref: "call:m1:stake:u1:yes", delta: -100 },
    ]);
    mocks.db.market.findMany.mockResolvedValue([{ id: "m1" }]);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);

    expect(await getPointsSummary("u1")).toEqual({ seasonId: "season_0", balance: 950, seasonPoints: 50, starterPoints: 1000, inPredictions: 100, rank: 1 });
    expect(mocks.db.pointsEvent.findMany.mock.calls[0][0].where).toEqual({ userId: "u1", seasonId: "season_0" });
    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0].where).toEqual({
      seasonId: "season_0",
      source: NOT_SCORING,
      NOT: [{ ref: { startsWith: "call:m1:stake:" } }],
      user: REAL_USERS_ONLY,
    });
    // Read in order: Season, rows, open markets, rank.
    const order = [mocks.db.season.findFirst, mocks.db.pointsEvent.findMany, mocks.db.market.findMany, mocks.db.pointsEvent.groupBy].map((m) => m.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a fresh account: 1,000 to spend, 0 Season points, not ranked, no rank query", async () => {
    mocks.db.pointsEvent.findMany.mockResolvedValue([{ source: "starter", ref: "starter:season_0", delta: 1000 }]);

    expect(await getPointsSummary("u1")).toEqual({ seasonId: "season_0", balance: 1000, seasonPoints: 0, starterPoints: 1000, inPredictions: 0, rank: null });
    expect(mocks.db.pointsEvent.groupBy).not.toHaveBeenCalled();
  });

  it("is null without any Season", async () => {
    mocks.db.season.findFirst.mockResolvedValue(null);
    expect(await getPointsSummary("u1")).toBeNull();
    expect(mocks.db.pointsEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/auth/me", () => {
  const USER_ROW = { id: "u1", handle: null, wallets: [{ chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", address: "Addr1", isPrimary: true }] };

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ userId: "u1", walletId: "w1", address: "Addr1", chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" });
    mocks.db.user.findUnique.mockResolvedValue(USER_ROW);
  });

  it("adds the caller's points summary to the user", async () => {
    mocks.db.pointsEvent.findMany.mockResolvedValue([{ source: "starter", ref: "starter:season_0", delta: 1000 }]);
    const res = await getMe(new Request("http://localhost:3000/api/v1/auth/me"), undefined);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(json.data.user).toEqual({
      ...USER_ROW,
      points: { seasonId: "season_0", balance: 1000, seasonPoints: 0, starterPoints: 1000, inPredictions: 0, rank: null },
    });
  });

  it("answers points: null when the points read fails, and never fails /me", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.db.pointsEvent.findMany.mockRejectedValue(new Error("pool timeout"));
    const res = await getMe(new Request("http://localhost:3000/api/v1/auth/me"), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).data.user).toEqual({ ...USER_ROW, points: null });
  });

  it("signed out: no user and no points read", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await getMe(new Request("http://localhost:3000/api/v1/auth/me"), undefined);
    expect(await res.json()).toEqual({ ok: true, data: { session: null, user: null } });
    expect(mocks.db.pointsEvent.findMany).not.toHaveBeenCalled();
  });
});
