import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/cron/solami-sync: when the Solami webhook is created, updated or left alone, and that it
// only ever watches real players' wallets (REAL_USER_WHERE), never house bots.

const mocks = vi.hoisted(() => ({
  env: {
    SOLAMI_API_KEY: "",
    SOLAMI_API_URL: "https://api.solami.dev",
    SOLAMI_WEBHOOK_ID: "",
    NEXT_PUBLIC_APP_URL: "https://dulo-iota.vercel.app",
  },
  findMany: vi.fn(),
  unionMintSet: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({ env: () => mocks.env }));
vi.mock("@/lib/server/db", () => ({ db: { wallet: { findMany: mocks.findMany } } }));
vi.mock("@/lib/assets/registry", () => ({ unionMintSet: mocks.unionMintSet }));

import { syncSolamiWebhook } from "@/lib/cron/solami-sync";

const WALLET = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";
const MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";

function fakeFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "wh_9", secret: "whsec_new" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("syncSolamiWebhook", () => {
  beforeEach(() => {
    mocks.env.SOLAMI_API_KEY = "";
    mocks.env.SOLAMI_WEBHOOK_ID = "";
    mocks.findMany.mockReset().mockResolvedValue([{ address: WALLET }]);
    mocks.unionMintSet.mockReset().mockResolvedValue(new Set([MINT]));
  });

  it("does nothing without a key", async () => {
    const r = await syncSolamiWebhook();
    expect(r).toMatchObject({ skipped: true, reason: "SOLAMI_API_KEY is empty" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("never creates a webhook from a sign-in (no id, no createIfMissing)", async () => {
    mocks.env.SOLAMI_API_KEY = "key";
    const { impl, calls } = fakeFetch();
    const r = await syncSolamiWebhook({ fetchImpl: impl });
    expect(r).toMatchObject({ skipped: true, reason: "SOLAMI_WEBHOOK_ID is empty" });
    expect(calls).toHaveLength(0);
  });

  it("creates once from the script and returns the secret, pointing at /api/hooks/solami", async () => {
    mocks.env.SOLAMI_API_KEY = "key";
    const { impl, calls } = fakeFetch();
    const r = await syncSolamiWebhook({ fetchImpl: impl, createIfMissing: true });
    expect(r).toEqual({ skipped: false, reason: null, created: true, webhookId: "wh_9", addresses: 1, mints: 1, secret: "whsec_new" });
    expect(calls[0].url).toContain("/webhooks/create");
    expect(calls[0].body.url).toBe("https://dulo-iota.vercel.app/api/hooks/solami");
    expect(mocks.findMany.mock.calls[0][0].where.user).toMatchObject({ leagueAccounts: { none: { isBot: true } } });
  });

  it("updates the existing webhook and never returns a secret", async () => {
    mocks.env.SOLAMI_API_KEY = "key";
    mocks.env.SOLAMI_WEBHOOK_ID = "wh_1";
    const { impl, calls } = fakeFetch();
    const r = await syncSolamiWebhook({ fetchImpl: impl });
    expect(r.created).toBe(false);
    expect(r).not.toHaveProperty("secret");
    expect(calls[0].url).toContain("/webhooks/update");
    expect(calls[0].body).toMatchObject({ id: "wh_1", addresses: [WALLET] });
  });

  it("skips while no real player has linked a wallet", async () => {
    mocks.env.SOLAMI_API_KEY = "key";
    mocks.env.SOLAMI_WEBHOOK_ID = "wh_1";
    mocks.findMany.mockResolvedValue([]);
    expect(await syncSolamiWebhook()).toMatchObject({ skipped: true, reason: "no real player wallet yet" });
  });
});
