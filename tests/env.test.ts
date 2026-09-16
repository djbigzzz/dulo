import { afterEach, describe, expect, it, vi } from "vitest";

// lib/server/env: the production CRON_SECRET placeholder refusal (WIN-PLAN C20), the RPC host
// the tick health prints, and the production config warnings (WIN-PLAN M-I). The 16-character
// floor lives in tests/cron-secret.test.ts.

const PLACEHOLDER = "change-me-to-16-plus-random-characters"; // the .env.example value

async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/d");
  vi.stubEnv("JWT_SECRET", "test-secret-with-at-least-32-characters");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return import("@/lib/server/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CRON_SECRET placeholder", () => {
  it("refuses the .env.example placeholder in production and names the key", async () => {
    const { env } = await loadEnv({ NODE_ENV: "production", CRON_SECRET: PLACEHOLDER });
    expect(() => env()).toThrow(/Invalid environment: .*CRON_SECRET/);
  });

  it("refuses any change-me prefix regardless of case in production", async () => {
    const { env, isPlaceholderCronSecret } = await loadEnv({ NODE_ENV: "production", CRON_SECRET: "Change-Me-please-0123456789" });
    expect(() => env()).toThrow(/CRON_SECRET/);
    expect(isPlaceholderCronSecret("  change-me-x")).toBe(true);
    expect(isPlaceholderCronSecret("0123456789abcdef-change-me")).toBe(false);
  });

  it("accepts the placeholder outside production (local dev copies .env.example)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", CRON_SECRET: PLACEHOLDER });
    expect(env().CRON_SECRET).toBe(PLACEHOLDER);
  });

  it("accepts a real random secret in production", async () => {
    const { env } = await loadEnv({ NODE_ENV: "production", CRON_SECRET: "9f86d081884c7d659a2feaa0c55ad015" });
    expect(env().CRON_SECRET).toBe("9f86d081884c7d659a2feaa0c55ad015");
  });
});

describe("rpcHost / configWarnings", () => {
  const base = { HELIUS_API_KEY: "", JUPITER_API_KEY: "", NEXT_PUBLIC_RPC: "https://api.mainnet-beta.solana.com" };

  it("prints the Helius host without the key, and the fallback host without path, query or credentials", async () => {
    const { rpcHost } = await loadEnv({ CRON_SECRET: "0123456789abcdef" });
    expect(rpcHost({ ...base, HELIUS_API_KEY: "secret-key" })).toBe("mainnet.helius-rpc.com");
    expect(rpcHost(base)).toBe("api.mainnet-beta.solana.com");
    expect(rpcHost({ ...base, NEXT_PUBLIC_RPC: "https://u:p@rpc.example.org:8443/k3y?api-key=x" })).toBe("rpc.example.org:8443");
    expect(rpcHost({ ...base, NEXT_PUBLIC_RPC: "not a url" })).toBe("invalid");
  });

  it("rpcHost() reads env() by default and matches rpcUrl()'s host", async () => {
    const { rpcHost, rpcUrl } = await loadEnv({ CRON_SECRET: "0123456789abcdef", HELIUS_API_KEY: "abc" });
    expect(rpcHost()).toBe(new URL(rpcUrl()).host);
    expect(rpcHost()).not.toContain("abc");
  });

  it("warns only in production, for an empty HELIUS_API_KEY and an empty JUPITER_API_KEY", async () => {
    const { configWarnings } = await loadEnv({ CRON_SECRET: "0123456789abcdef" });
    expect(configWarnings(base, false)).toEqual([]);
    const prod = configWarnings(base, true);
    expect(prod).toHaveLength(2);
    expect(prod[0]).toBe("HELIUS_API_KEY is empty: chain reads fall back to api.mainnet-beta.solana.com, which rate-limits wallet snapshots");
    expect(prod[1]).toMatch(/^JUPITER_API_KEY is empty/);
    expect(configWarnings({ ...base, HELIUS_API_KEY: "h", JUPITER_API_KEY: "j" }, true)).toEqual([]);
  });

  it("defaults to NODE_ENV for the production check", async () => {
    const { configWarnings } = await loadEnv({ CRON_SECRET: "9f86d081884c7d659a2feaa0c55ad015", NODE_ENV: "production" });
    expect(configWarnings()).toHaveLength(2);
  });
});
