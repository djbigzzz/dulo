import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TickResult } from "@/lib/cron/tick";

// /api/cron/tick: the guard, the health summary a pinger reads, and the deploy budget
// (docs/REVIEW-2026-09-14.md M1, M2, L13). lib/cron/tick itself is covered by tests/cron.test.ts.

const SECRET = "route-test-cron-secret-123";
const NOW_MS = Date.parse("2026-09-15T12:00:00.000Z");

const HELIUS_KEY = "helius-key-that-must-never-leak";

const mocks = vi.hoisted(() => ({
  runTick: vi.fn(),
  catalogueOrigin: vi.fn(),
  slotAnchor: vi.fn(),
  env: { CRON_SECRET: "", HELIUS_API_KEY: "", JUPITER_API_KEY: "", NEXT_PUBLIC_RPC: "" },
}));

vi.mock("@/lib/cron/tick", () => {
  const TICK_STEPS = ["games", "snapshot", "evaluate", "badges"] as const;
  return {
    TICK_STEPS,
    isTickStepName: (s: string) => (TICK_STEPS as readonly string[]).includes(s),
    runTick: mocks.runTick,
  };
});
vi.mock("@/lib/assets/xstocks", () => ({ xstocksCatalogueOrigin: mocks.catalogueOrigin }));
vi.mock("@/lib/adapters/solana", () => ({ solana: { slotAnchor: mocks.slotAnchor } }));
// env() is faked; rpcHost/configWarnings are the real functions applied to the fake env.
vi.mock("@/lib/server/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/env")>("@/lib/server/env");
  return {
    env: () => mocks.env,
    rpcHost: () => actual.rpcHost(mocks.env),
    configWarnings: () => actual.configWarnings(mocks.env),
  };
});

function fullResult(): TickResult {
  return {
    ranAt: new Date(NOW_MS).toISOString(),
    steps: [
      { name: "games", ok: true, took: 5, detail: { modules: [{ key: "league", ok: true, took: 5 }] } },
      { name: "snapshot", ok: false, took: 40, detail: { ok: 3, failed: [{ walletId: "w9", error: "429" }], skipped: 1, took: 40 } },
      { name: "evaluate", ok: true, took: 7, detail: { seasonId: "season_0", ok: 4, failed: [], awarded: 2 } },
      { name: "badges", ok: true, took: 1, detail: { leagueTop3Created: 0, pending: 2, minted: 0, failed: [], skipped: true, reason: "no server wallet", took: 1 } },
    ],
  };
}

async function call(init: { bearer?: string; query?: Record<string, string> } = {}) {
  const { GET } = await import("@/app/api/cron/tick/route");
  const url = new URL("http://localhost:3000/api/cron/tick");
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers();
  if (init.bearer !== undefined) headers.set("authorization", `Bearer ${init.bearer}`);
  const res = await GET(new Request(url, { headers }), undefined);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
  mocks.runTick.mockReset().mockResolvedValue(fullResult());
  mocks.catalogueOrigin.mockReset().mockReturnValue("api");
  mocks.slotAnchor.mockReset().mockReturnValue({ slot: 100, at: NOW_MS - 1500 });
  mocks.env = { CRON_SECRET: SECRET, HELIUS_API_KEY: HELIUS_KEY, JUPITER_API_KEY: "jup-key", NEXT_PUBLIC_RPC: "https://api.mainnet-beta.solana.com" };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/cron/tick", () => {
  it("declares a 300s budget on the Node runtime (Fluid compute ceiling on Hobby; Pro allows more)", async () => {
    const route = await import("@/app/api/cron/tick/route");
    expect(route.maxDuration).toBe(300);
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.POST).toBe(route.GET);
  });

  it("refuses a missing or wrong Bearer without running the tick", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ bearer: "wrong" })).status).toBe(401);
    expect(mocks.runTick).not.toHaveBeenCalled();
  });

  it("refuses ?secret= in production and accepts it elsewhere", async () => {
    expect((await call({ query: { secret: SECRET } })).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ query: { secret: SECRET } })).status).toBe(401);
    expect((await call({ bearer: SECRET })).status).toBe(200);
  });

  it("returns the steps untouched plus a health summary, with no-store caching", async () => {
    const { status, body, headers } = await call({ bearer: SECRET });
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    // What the pinger evaluates: `.data.steps | all(.ok)` -> false here because snapshot failed a wallet.
    expect(body.data.steps.map((s: { name: string; ok: boolean }) => [s.name, s.ok])).toEqual([
      ["games", true],
      ["snapshot", false],
      ["evaluate", true],
      ["badges", true],
    ]);
    expect(body.data.health).toEqual({
      ok: false,
      took: 0,
      catalogueOrigin: "api",
      slotAnchorAgeMs: 1500,
      rpcHost: "mainnet.helius-rpc.com",
      warnings: [],
      snapshot: { ok: 3, failed: 1, skipped: 1 },
      evaluate: { ok: 4, failed: 0, awarded: 2 },
      badges: { pending: 2, minted: 0, failed: 0, skipped: true, reason: "no server wallet" },
    });
    expect(mocks.runTick).toHaveBeenCalledWith(new Date(NOW_MS), { steps: undefined });
  });

  it("reports null health sections for steps that did not run or threw, and null anchor/origin before first use", async () => {
    mocks.catalogueOrigin.mockReturnValue(null);
    mocks.slotAnchor.mockReturnValue(null);
    mocks.runTick.mockResolvedValue({
      ranAt: new Date(NOW_MS).toISOString(),
      steps: [{ name: "snapshot", ok: false, took: 2, detail: { error: "db offline" } }],
    });
    const { body } = await call({ bearer: SECRET, query: { steps: "snapshot" } });
    expect(mocks.runTick).toHaveBeenCalledWith(new Date(NOW_MS), { steps: ["snapshot"] });
    expect(body.data.health).toEqual({
      ok: false,
      took: 0,
      catalogueOrigin: null,
      slotAnchorAgeMs: null,
      rpcHost: "mainnet.helius-rpc.com",
      warnings: [],
      snapshot: null,
      evaluate: null,
      badges: null,
    });
  });

  it("flags a fallback catalogue and never reports a negative anchor age", async () => {
    mocks.catalogueOrigin.mockReturnValue("fallback");
    mocks.slotAnchor.mockReturnValue({ slot: 1, at: NOW_MS + 10_000 });
    const { body } = await call({ bearer: SECRET });
    expect(body.data.health.catalogueOrigin).toBe("fallback");
    expect(body.data.health.slotAnchorAgeMs).toBe(0);
  });

  it("reports the RPC host only (never the Helius key) and no warnings outside production", async () => {
    const { body } = await call({ bearer: SECRET });
    expect(body.data.health.rpcHost).toBe("mainnet.helius-rpc.com");
    expect(JSON.stringify(body)).not.toContain(HELIUS_KEY);
    // Keyless outside production: the public host, still no warning (local dev is keyless by design).
    mocks.env = { ...mocks.env, HELIUS_API_KEY: "", JUPITER_API_KEY: "" };
    const local = await call({ bearer: SECRET });
    expect(local.body.data.health.rpcHost).toBe("api.mainnet-beta.solana.com");
    expect(local.body.data.health.warnings).toEqual([]);
  });

  it("warns in production when HELIUS_API_KEY is empty and names the public host it fell back to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    mocks.env = { ...mocks.env, HELIUS_API_KEY: "", NEXT_PUBLIC_RPC: "https://user:pw@rpc.example.org/secret-path?api-key=abc" };
    const { body } = await call({ bearer: SECRET });
    expect(body.data.health.rpcHost).toBe("rpc.example.org");
    expect(body.data.health.warnings).toEqual([expect.stringMatching(/^HELIUS_API_KEY is empty: chain reads fall back to rpc\.example\.org/)]);
    const text = JSON.stringify(body);
    for (const secret of ["secret-path", "api-key=abc", "user:pw"]) expect(text).not.toContain(secret);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HELIUS_API_KEY is empty"));

    // With both keys set production is quiet.
    mocks.env = { ...mocks.env, HELIUS_API_KEY: HELIUS_KEY };
    expect((await call({ bearer: SECRET })).body.data.health.warnings).toEqual([]);
    // A keyless Jupiter in production is flagged too (keyless Price v3 429s under click-through, M-I).
    mocks.env = { ...mocks.env, JUPITER_API_KEY: "" };
    expect((await call({ bearer: SECRET })).body.data.health.warnings).toEqual([expect.stringMatching(/^JUPITER_API_KEY is empty/)]);
    warn.mockRestore();
  });

  it("rejects unknown step names with 400 and lists the valid ones in pipeline order", async () => {
    const { status, body } = await call({ bearer: SECRET, query: { steps: "snapshot,mint" } });
    expect(status).toBe(400);
    expect(body.error).toBe("Unknown step(s): mint. Valid: games, snapshot, evaluate, badges");
    expect(mocks.runTick).not.toHaveBeenCalled();
  });
});
