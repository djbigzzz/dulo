import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, assertCronSecret } from "@/lib/server/api";

// docs/REVIEW-2026-09-14.md L10 / M1: the cron guard is header-first, constant-time, and the
// `?secret=` poke is a development convenience that must not reach production request logs.

const SECRET = "test-cron-secret-1234567890";

function req(opts: { bearer?: string; query?: string; authorization?: string } = {}): Request {
  const url = new URL("http://localhost:3000/api/cron/tick");
  if (opts.query !== undefined) url.searchParams.set("secret", opts.query);
  const headers = new Headers();
  if (opts.authorization !== undefined) headers.set("authorization", opts.authorization);
  else if (opts.bearer !== undefined) headers.set("authorization", `Bearer ${opts.bearer}`);
  return new Request(url, { headers });
}

function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertCronSecret", () => {
  it("accepts the Bearer header, case-insensitively on the scheme, and trims whitespace", () => {
    expect(statusOf(() => assertCronSecret(req({ bearer: SECRET }), SECRET))).toBeNull();
    expect(statusOf(() => assertCronSecret(req({ authorization: `bearer ${SECRET}` }), SECRET))).toBeNull();
    expect(statusOf(() => assertCronSecret(req({ authorization: `Bearer   ${SECRET}  ` }), SECRET))).toBeNull();
  });

  it("rejects a wrong, empty, prefix, or longer Bearer value with 401", () => {
    expect(statusOf(() => assertCronSecret(req({ bearer: "nope" }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ authorization: "Bearer " }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ bearer: SECRET.slice(0, -1) }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ bearer: `${SECRET}x` }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ authorization: `Basic ${SECRET}` }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req(), SECRET))).toBe(401);
  });

  it("refuses every request when the configured secret is empty", () => {
    expect(statusOf(() => assertCronSecret(req({ bearer: "" }), ""))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ query: "" }), ""))).toBe(401);
  });

  it("accepts ?secret= outside production (vitest runs with NODE_ENV=test)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(statusOf(() => assertCronSecret(req({ query: SECRET }), SECRET))).toBeNull();
    expect(statusOf(() => assertCronSecret(req({ query: "wrong" }), SECRET))).toBe(401);
  });

  it("ignores ?secret= in production: the header is the only way in", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(statusOf(() => assertCronSecret(req({ query: SECRET }), SECRET))).toBe(401);
    expect(statusOf(() => assertCronSecret(req({ bearer: SECRET }), SECRET))).toBeNull();
    // A bad header never falls through to the query string, in any environment.
    expect(statusOf(() => assertCronSecret(req({ bearer: "wrong", query: SECRET }), SECRET))).toBe(401);
  });

  it("honours an explicit allowQuery override in both directions", () => {
    expect(statusOf(() => assertCronSecret(req({ query: SECRET }), SECRET, { allowQuery: false }))).toBe(401);
    vi.stubEnv("NODE_ENV", "production");
    expect(statusOf(() => assertCronSecret(req({ query: SECRET }), SECRET, { allowQuery: true }))).toBeNull();
  });
});

describe("env().CRON_SECRET floor", () => {
  async function loadEnv(cronSecret: string) {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/d");
    vi.stubEnv("JWT_SECRET", "test-secret-with-at-least-32-characters");
    vi.stubEnv("CRON_SECRET", cronSecret);
    return import("@/lib/server/env");
  }

  it("refuses a CRON_SECRET shorter than 16 characters and names the key", async () => {
    const { env, CRON_SECRET_MIN_LENGTH } = await loadEnv("short-secret");
    expect(CRON_SECRET_MIN_LENGTH).toBe(16);
    expect(() => env()).toThrow(/Invalid environment: .*CRON_SECRET/);
  });

  it("accepts exactly 16 characters", async () => {
    const { env } = await loadEnv("0123456789abcdef");
    expect(env().CRON_SECRET).toBe("0123456789abcdef");
  });
});
