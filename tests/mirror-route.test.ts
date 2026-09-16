import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId } from "@/lib/core";

/**
 * GET /api/v1/mirror/[wallet] abuse limits (15 Sep findings): the per-IP limiter is decided
 * before the shared public-read budget, so one client cannot make "Mirror any wallet" 503 for
 * everyone. The chain, catalogue, prices, session and database are mocked.
 */

const mocks = vi.hoisted(() => ({
  db: { wallet: { findFirst: vi.fn() }, play: { findUnique: vi.fn() } },
  getPrices: vi.fn(),
  getTokenBalances: vi.fn(),
  mintSet: vi.fn(),
  getAsset: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/price", () => ({ getPrices: mocks.getPrices }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/adapters/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/solana")>()),
  solana: { getTokenBalances: mocks.getTokenBalances },
}));
vi.mock("@/lib/assets/xstocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets/xstocks")>();
  return { ...actual, xstocks: { mintSet: mocks.mintSet, getAsset: mocks.getAsset, normaliseQty: actual.normaliseQty } };
});

import { PublicKey } from "@solana/web3.js";
import { GET } from "@/app/api/v1/mirror/[wallet]/route";
import { PUBLIC_UNCACHED_READS_PER_MINUTE, resetPublicReadCache } from "@/lib/mirror/public";
import { MIRROR_PUBLIC_PER_IP_PER_MINUTE, mirrorPublicIpLimiter } from "@/lib/mirror/views";

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLA_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const TSLA = `${SOL}/token:${TSLA_MINT}` as AssetId;

async function call(wallet: string, ip: string) {
  const req = new Request(`http://localhost/api/v1/mirror/${wallet}`, { headers: { "x-forwarded-for": ip } });
  const res = await GET(req, { params: Promise.resolve({ wallet }) });
  const body = (await res.json()) as { ok: boolean; error?: string };
  return { res, body };
}

const freshAddresses = (n: number) => Array.from({ length: n }, () => PublicKey.unique().toBase58());

beforeEach(() => {
  vi.resetAllMocks();
  resetPublicReadCache();
  mirrorPublicIpLimiter.reset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getSession.mockResolvedValue(null);
  mocks.db.wallet.findFirst.mockResolvedValue(null); // no address is a Dulo wallet: every lookup is a public read
  mocks.db.play.findUnique.mockResolvedValue(null);
  mocks.mintSet.mockResolvedValue(new Set([TSLA_MINT]));
  mocks.getAsset.mockResolvedValue({ assetId: TSLA, symbol: "TSLAx", multiplier: 1 });
  mocks.getTokenBalances.mockResolvedValue([{ chainId: SOL, mint: TSLA_MINT, account: "a1", amountRaw: "100000000", decimals: 8, program: "token-2022", multiplier: 1 }]);
  mocks.getPrices.mockImplementation(
    async (ids: AssetId[]) =>
      new Map(ids.map((id) => [id, { assetId: id, symbol: "TSLAx", price: 200, source: "jupiter", publishedAt: null, ageSeconds: 10, stale: false, marketOpen: true }])),
  );
});

describe("GET /api/v1/mirror/[wallet] rate limits", () => {
  it("answers the 11th uncached public lookup from one IP with 429 + Retry-After; cached reads and other IPs still answer", async () => {
    const addresses = freshAddresses(MIRROR_PUBLIC_PER_IP_PER_MINUTE + 1);
    for (const a of addresses.slice(0, -1)) expect((await call(a, "198.51.100.1")).res.status).toBe(200);

    const limited = await call(addresses[addresses.length - 1], "198.51.100.1");
    expect(limited.res.status).toBe(429);
    expect(limited.body.ok).toBe(false);
    expect(limited.res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(limited.res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(MIRROR_PUBLIC_PER_IP_PER_MINUTE);

    expect((await call(addresses[0], "198.51.100.1")).res.status).toBe(200);
    expect((await call(addresses[addresses.length - 1], "198.51.100.2")).res.status).toBe(200);
  });

  it("counts IPv6 clients per /64", async () => {
    const addresses = freshAddresses(MIRROR_PUBLIC_PER_IP_PER_MINUTE + 1);
    for (const [i, a] of addresses.slice(0, -1).entries()) expect((await call(a, `2001:db8:7:9::${i + 1}`)).res.status).toBe(200);
    expect((await call(addresses[addresses.length - 1], "2001:db8:7:9:abcd::1")).res.status).toBe(429);
  });

  it("31 addresses from 4 IPs (none over its own limit) get 503 only past the shared per-minute budget", async () => {
    const addresses = freshAddresses(PUBLIC_UNCACHED_READS_PER_MINUTE + 1);
    const statuses: number[] = [];
    for (const [i, a] of addresses.entries()) statuses.push((await call(a, `203.0.113.${(i % 4) + 1}`)).res.status);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(503);
  });

  it("a 429 never spends the shared budget", async () => {
    // One client runs into its own limit: 10 reads spend 10 of the budget, its 5 refusals spend nothing.
    const flood = freshAddresses(MIRROR_PUBLIC_PER_IP_PER_MINUTE + 5);
    const floodStatuses: number[] = [];
    for (const a of flood) floodStatuses.push((await call(a, "192.0.2.50")).res.status);
    expect(floodStatuses.filter((s) => s === 429)).toHaveLength(5);

    // Everyone else still has the rest of the budget: 20 more reads succeed, the next one is past it.
    const rest = PUBLIC_UNCACHED_READS_PER_MINUTE - MIRROR_PUBLIC_PER_IP_PER_MINUTE;
    const addresses = freshAddresses(rest + 1);
    const statuses: number[] = [];
    for (const [i, a] of addresses.entries()) statuses.push((await call(a, `203.0.113.${(i % 4) + 1}`)).res.status);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(503);
  });
});
