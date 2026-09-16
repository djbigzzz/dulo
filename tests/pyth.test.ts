import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetInfo } from "@/lib/core";

// Hermes requires a Bearer key since 26 Aug 2026. These tests pin the contract:
//   - the header is sent when PYTH_API_KEY is set (and not when it is empty),
//   - env().PYTH_HERMES_URL is tried first, the other known host second,
//   - a 401 never throws out of getPrices: it yields an empty Map so Jupiter takes over.

type PythModule = typeof import("@/lib/prices/pyth");
let pythMod: PythModule;

const TSLA_FEED = "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1";
const TSLAX: AssetInfo = {
  assetId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  symbol: "TSLAx",
  underlying: "TSLA",
  name: "Tesla xStock",
  decimals: 8,
  sector: "Technology",
  logoUrl: null,
  pythFeedId: TSLA_FEED,
  multiplier: 1,
};

function hermesOk(publishTime: number) {
  return {
    parsed: [{ id: TSLA_FEED, price: { price: "25110000000", conf: "1000000", expo: -8, publish_time: publishTime } }],
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/d");
  // env() requires >= 32 chars; a short secret makes env() throw and the Hermes URL/key silently fall back.
  vi.stubEnv("JWT_SECRET", "test-secret-that-is-at-least-32-characters-long");
  vi.stubEnv("CRON_SECRET", "cron-secret-for-pyth-tests"); // env() requires >= 16 chars (lib/server/env)
  vi.stubEnv("PYTH_API_KEY", "test-pyth-key");
  vi.stubEnv("PYTH_HERMES_URL", "https://pyth.dourolabs.app/hermes");
  vi.stubGlobal("fetch", fetchMock);
  pythMod = await import("@/lib/prices/pyth");
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
  pythMod.clearPythCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pyth decimal parsing", () => {
  it("pythDecimal parses mantissa/expo exactly: 24567000000 / -8 === 245.67", () => {
    expect(pythMod.pythDecimal("24567000000", -8)).toBe(245.67);
    expect(pythMod.pythDecimal(24567000000, -8)).toBe(245.67);
    expect(pythMod.pythDecimal(" 24567000000 ", -8)).toBe(245.67);
    expect(pythMod.pythDecimal("25110000000", -8)).toBe(251.1);
    expect(pythMod.pythDecimal("1000000", -8)).toBe(0.01);
    expect(pythMod.pythDecimal("-5", 0)).toBe(-5);
    expect(pythMod.pythDecimal("123", 2)).toBe(12300);
  });

  it("pythDecimal rejects non-integer mantissas, non-integer exponents and non-finite results", () => {
    expect(pythMod.pythDecimal("245.67", 0)).toBeNull();
    expect(pythMod.pythDecimal("1e5", 0)).toBeNull();
    expect(pythMod.pythDecimal("abc", -8)).toBeNull();
    expect(pythMod.pythDecimal("", -8)).toBeNull();
    expect(pythMod.pythDecimal(null, -8)).toBeNull();
    expect(pythMod.pythDecimal(undefined, -8)).toBeNull();
    expect(pythMod.pythDecimal("100", 2.5)).toBeNull();
    expect(pythMod.pythDecimal("100", Number.NaN)).toBeNull();
    expect(pythMod.pythDecimal("100", null)).toBeNull();
    expect(pythMod.pythDecimal("1", 400)).toBeNull(); // Infinity
  });

  it("getPrices returns the exact decimal price and conf, and skips unusable feeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        parsed: [
          { id: TSLA_FEED, price: { price: "24567000000", conf: "1230000", expo: -8, publish_time: 1_789_000_000 } },
          { id: "a".repeat(64), price: { price: "0", conf: "1", expo: -8, publish_time: 1_789_000_000 } }, // <= 0
          { id: "b".repeat(64), price: { price: "245.67", conf: "1", expo: 0, publish_time: 1_789_000_000 } }, // fractional mantissa
          { id: "c".repeat(64), price: { price: "100", conf: "1", expo: 0.5, publish_time: 1_789_000_000 } }, // fractional expo
          { id: "d".repeat(64), price: { price: "100", conf: "1", expo: 0, publish_time: "soon" } }, // bad publish_time
        ],
      }),
    );
    const out = await pythMod.pyth.getPrices([TSLAX]);
    const q = out.get(TSLAX.assetId);
    expect(q?.price).toBe(245.67);
    expect(q?.publishedAt?.toISOString()).toBe(new Date(1_789_000_000 * 1000).toISOString());

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        parsed: [
          { id: TSLA_FEED, price: { price: "24567000000", conf: "1230000", expo: -8, publish_time: 1_789_000_000 } },
          { id: "a".repeat(64), price: { price: "0", conf: "1", expo: -8, publish_time: 1_789_000_000 } },
          { id: "b".repeat(64), price: { price: "245.67", conf: "1", expo: 0, publish_time: 1_789_000_000 } },
        ],
      }),
    );
    const latest = await pythMod.fetchPythLatest([TSLA_FEED, "a".repeat(64), "b".repeat(64)]);
    expect([...latest.keys()]).toEqual([TSLA_FEED]);
    expect(latest.get(TSLA_FEED)!.price).toBe(245.67);
    expect(latest.get(TSLA_FEED)!.conf).toBe(0.0123);
  });
});

describe("pyth hermes auth + fallback", () => {
  it("sends Authorization: Bearer <PYTH_API_KEY> and uses PYTH_HERMES_URL first", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, hermesOk(1_789_000_000)));
    const out = await pythMod.pyth.getPrices([TSLAX]);

    expect(out.get(TSLAX.assetId)?.price).toBeCloseTo(251.1, 6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://pyth.dourolabs.app/hermes/v2/updates/price/latest?")).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-pyth-key");
  });

  it("falls back to the other Hermes host when the primary fails, and returns an empty Map on 401", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));

    await expect(pythMod.pyth.getPrices([TSLAX])).resolves.toEqual(new Map());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const hosts = fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).toEqual(["pyth.dourolabs.app", "hermes.pyth.network"]);
    expect(warn).toHaveBeenCalled();
  });

  it("serves from the fallback host when the primary is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, hermesOk(1_789_000_000)));

    const out = await pythMod.pyth.getPrices([TSLAX]);
    expect(out.get(TSLAX.assetId)?.price).toBeCloseTo(251.1, 6);
    expect(new URL(String(fetchMock.mock.calls[1][0])).host).toBe("hermes.pyth.network");
  });
});
