import { beforeEach, describe, expect, it, vi } from "vitest";

// The helper takes its Prisma client as an argument; this fake honours the unique
// (userId, seasonId, ref) key the way Postgres does, so idempotency is tested for real.
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/price", () => ({ getPrices: vi.fn() }));

import { backfillStarterPoints, ensureStarterPoints, type StarterDb } from "@/lib/games/starter";
import { REAL_USER_WHERE } from "@/lib/server/queries";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const SEASON = { id: "s0", startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2026-10-31T00:00:00.000Z") };

interface Row {
  userId: string;
  seasonId: string;
  source: string;
  ref: string;
  delta: number;
}

type Where = { id?: string; startsAt?: { lte: Date }; endsAt?: { gte: Date } };

function fakeDb(opts: { users?: Record<string, { isBot: boolean }>; seasons?: (typeof SEASON)[] } = {}) {
  const users = opts.users ?? { u1: { isBot: false }, u2: { isBot: false } };
  const seasons = opts.seasons ?? [SEASON];
  const rows: Row[] = [];
  const client = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } & Record<string, unknown> }) => {
        // The helper must filter in the database with the shared bot exclusion.
        expect(where).toMatchObject(REAL_USER_WHERE);
        const u = users[where.id];
        if (!u || u.isBot || where.id.startsWith("bot-league-")) return null;
        return { id: where.id };
      }),
    },
    season: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        const hit = seasons.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (!where.startsAt || s.startsAt <= where.startsAt.lte) &&
            (!where.endsAt || s.endsAt >= where.endsAt.gte),
        );
        return hit ? { id: hit.id } : null;
      }),
    },
    pointsEvent: {
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        expect(skipDuplicates).toBe(true);
        let count = 0;
        for (const r of data) {
          if (rows.some((x) => x.userId === r.userId && x.seasonId === r.seasonId && x.ref === r.ref)) continue;
          rows.push(r);
          count += 1;
        }
        return { count };
      }),
    },
  };
  return { client, rows, db: client as unknown as StarterDb };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureStarterPoints", () => {
  it("writes the grant once; a second call returns granted=false and writes nothing new", async () => {
    const f = fakeDb();

    const first = await ensureStarterPoints("u1", NOW, f.db);
    expect(first).toEqual({ granted: true, seasonId: "s0" });
    expect(f.client.pointsEvent.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", seasonId: "s0", source: "starter", ref: "starter:s0", delta: 1000 }],
      skipDuplicates: true,
    });

    const second = await ensureStarterPoints("u1", NOW, f.db);
    expect(second).toEqual({ granted: false, seasonId: "s0", reason: "already_granted" });
    expect(f.rows).toEqual([{ userId: "u1", seasonId: "s0", source: "starter", ref: "starter:s0", delta: 1000 }]);
  });

  it("concurrent calls for one user write one row, and exactly one of them reports the grant", async () => {
    const f = fakeDb();
    const results = await Promise.all([ensureStarterPoints("u1", NOW, f.db), ensureStarterPoints("u1", NOW, f.db), ensureStarterPoints("u1", NOW, f.db)]);
    expect(results.filter((r) => r.granted)).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
  });

  it("refuses a house bot id with no database access at all", async () => {
    const f = fakeDb({ users: { "bot-league-1": { isBot: true } } });
    expect(await ensureStarterPoints("bot-league-1", NOW, f.db)).toEqual({ granted: false, seasonId: null, reason: "bot" });
    expect(f.client.user.findFirst).not.toHaveBeenCalled();
    expect(f.client.season.findFirst).not.toHaveBeenCalled();
    expect(f.client.pointsEvent.createMany).not.toHaveBeenCalled();
  });

  it("writes nothing for a user REAL_USER_WHERE filters out (an isBot competition account)", async () => {
    const f = fakeDb({ users: { u_house: { isBot: true } } });
    expect(await ensureStarterPoints("u_house", NOW, f.db)).toEqual({ granted: false, seasonId: null, reason: "not_found" });
    expect(f.client.user.findFirst).toHaveBeenCalledWith({ where: { id: "u_house", ...REAL_USER_WHERE }, select: { id: true } });
    expect(f.client.pointsEvent.createMany).not.toHaveBeenCalled();
  });

  it("writes nothing for a user that no longer exists", async () => {
    const f = fakeDb();
    expect((await ensureStarterPoints("u_gone", NOW, f.db)).reason).toBe("not_found");
    expect(f.rows).toEqual([]);
  });

  it("writes nothing without an active Season, and never falls back to an ended one", async () => {
    const ended = { id: "s_old", startsAt: new Date("2026-06-01T00:00:00.000Z"), endsAt: new Date("2026-08-31T00:00:00.000Z") };
    const f = fakeDb({ seasons: [ended] });
    expect(await ensureStarterPoints("u1", NOW, f.db)).toEqual({ granted: false, seasonId: null, reason: "no_season" });
    expect(f.client.season.findFirst.mock.calls[0][0].where).toEqual({ startsAt: { lte: NOW }, endsAt: { gte: NOW } });
    expect(f.client.pointsEvent.createMany).not.toHaveBeenCalled();
  });

  it("a later Season grants again under its own ref", async () => {
    const next = { id: "s1", startsAt: new Date("2026-11-01T00:00:00.000Z"), endsAt: new Date("2026-12-31T00:00:00.000Z") };
    const f = fakeDb({ seasons: [SEASON, next] });
    expect((await ensureStarterPoints("u1", NOW, f.db)).granted).toBe(true);
    expect((await ensureStarterPoints("u1", new Date("2026-11-02T00:00:00.000Z"), f.db)).granted).toBe(true);
    expect(f.rows.map((r) => r.ref)).toEqual(["starter:s0", "starter:s1"]);
  });
});

describe("backfillStarterPoints", () => {
  it("grants every listed real user in one insert, skips bot ids and returns the count", async () => {
    const f = fakeDb();
    const n = await backfillStarterPoints("s0", ["u1", "bot-league-2", "u2", "u1"], NOW, f.db);
    expect(n).toBe(2);
    expect(f.client.pointsEvent.createMany).toHaveBeenCalledTimes(1);
    expect(f.client.pointsEvent.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", seasonId: "s0", source: "starter", ref: "starter:s0", delta: 1000 },
        { userId: "u2", seasonId: "s0", source: "starter", ref: "starter:s0", delta: 1000 },
      ],
      skipDuplicates: true,
    });
    expect(f.rows.some((r) => r.userId.startsWith("bot-league-"))).toBe(false);
  });

  it("is idempotent: users already granted are skipped by the unique key", async () => {
    const f = fakeDb();
    await ensureStarterPoints("u1", NOW, f.db);
    expect(await backfillStarterPoints("s0", ["u1", "u2"], NOW, f.db)).toBe(1);
    expect(await backfillStarterPoints("s0", ["u1", "u2"], NOW, f.db)).toBe(0);
    expect(f.rows).toHaveLength(2);
  });

  it("writes nothing for an ended Season", async () => {
    const f = fakeDb();
    expect(await backfillStarterPoints("s0", ["u1"], new Date("2026-11-15T00:00:00.000Z"), f.db)).toBe(0);
    expect(f.client.season.findFirst.mock.calls[0][0].where).toMatchObject({ id: "s0" });
    expect(f.client.pointsEvent.createMany).not.toHaveBeenCalled();
  });

  it("writes nothing when only bots (or nobody) are listed", async () => {
    const f = fakeDb();
    expect(await backfillStarterPoints("s0", ["bot-league-1", "bot-league-9"], NOW, f.db)).toBe(0);
    expect(await backfillStarterPoints("s0", [], NOW, f.db)).toBe(0);
    expect(f.client.pointsEvent.createMany).not.toHaveBeenCalled();
  });
});
