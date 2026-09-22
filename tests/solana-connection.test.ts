import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// How the adapter builds its web3.js Connection (docs/REVIEW-2026-09-14.md M2, L12): rate-limit
// retries stay with the adapter's own bounded backoff, and an RPC url (which may carry the
// Helius key in its query string) never leaks into an error message.

const ctor = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  class FakeConnection {
    constructor(...args: unknown[]) {
      ctor.calls.push(args);
    }
    async getSlot() {
      return 1;
    }
    async getMultipleParsedAccounts() {
      return { context: { slot: 1 }, value: [null] };
    }
    async getParsedTokenAccountsByOwner() {
      return { context: { slot: 1 }, value: [] };
    }
    async getBlockTime() {
      return null;
    }
  }
  return { ...actual, Connection: FakeConnection };
});

const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const KEYED_URL = "https://mainnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE";

/**
 * The first import of the adapter pulls in the real @solana/web3.js through the mock factory,
 * which can take seconds on a loaded machine. Doing that inside a test put it under vitest's
 * 5-second per-test budget: under load the first test timed out mid-import, the runner moved on,
 * and the first test's straggling continuation constructed its "confirmed" Connection inside the
 * second test's window -- so both failed, one run in five, only in the full suite. Importing once
 * in beforeAll (with its own generous budget) keeps each test measuring only adapter behaviour.
 */
let mod: typeof import("@/lib/adapters/solana");
beforeAll(async () => {
  mod = await import("@/lib/adapters/solana");
}, 60_000);

beforeEach(() => {
  ctor.calls.length = 0;
});

describe("createSolanaAdapter Connection", () => {
  it("disables web3.js's built-in 429 retry so a rate-limited wallet fails fast into the adapter's own backoff", async () => {
    const { createSolanaAdapter } = mod;
    const adapter = createSolanaAdapter(KEYED_URL, { sleep: async () => {} });
    await adapter.getMintMultiplier(TSLAX);
    expect(ctor.calls).toHaveLength(1);
    expect(ctor.calls[0]).toEqual([KEYED_URL, { commitment: "confirmed", disableRetryOnRateLimit: true }]);
  });

  it("honours a custom commitment while keeping the retry switch", async () => {
    const { createSolanaAdapter } = mod;
    const adapter = createSolanaAdapter(KEYED_URL, { commitment: "finalized", sleep: async () => {} });
    await adapter.getMintMultiplier(TSLAX);
    expect(ctor.calls[0]?.[1]).toEqual({ commitment: "finalized", disableRetryOnRateLimit: true });
  });

  it("names only the host, never the url, when the RPC url is rejected", async () => {
    const { createSolanaAdapter, SolanaAdapterError } = mod;
    const err = await createSolanaAdapter("ws://mainnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE")
      .getMintMultiplier(TSLAX)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SolanaAdapterError);
    expect((err as Error).message).toBe("Invalid Solana RPC url (host mainnet.helius-rpc.com): expected http(s)");
    expect((err as Error).message).not.toContain("SECRET-KEY-VALUE");

    const empty = await createSolanaAdapter("").getMintMultiplier(TSLAX).catch((e: unknown) => e);
    expect((empty as Error).message).toContain("(host <empty>)");
    const junk = await createSolanaAdapter("not a url ?api-key=SECRET-KEY-VALUE").getMintMultiplier(TSLAX).catch((e: unknown) => e);
    expect((junk as Error).message).toContain("(host <unparseable>)");
    expect((junk as Error).message).not.toContain("SECRET-KEY-VALUE");
    expect(ctor.calls).toHaveLength(0);
  });
});
