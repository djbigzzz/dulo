import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWebhookSpec,
  createHookHealth,
  createSeenSignatures,
  createWebhook,
  parseSolamiDelivery,
  updateWebhook,
  verifySolamiSignature,
} from "@/lib/adapters/solami";

// Solami webhook: the signature check, the payload walk, the replay guard, the webhook spec,
// and the /api/hooks/solami route (a delivery is only a trigger for runForUser).

const SECRET = "whsec_test_secret_value";
const WALLET = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

const hmacHex = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");
const hmacB64 = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");

describe("verifySolamiSignature", () => {
  const body = JSON.stringify({ signature: SIG });

  it("accepts hex, base64 and a sha256= prefix", () => {
    expect(verifySolamiSignature(body, hmacHex(body), SECRET)).toBe(true);
    expect(verifySolamiSignature(body, hmacB64(body), SECRET)).toBe(true);
    expect(verifySolamiSignature(body, `sha256=${hmacHex(body)}`, SECRET)).toBe(true);
  });

  it("refuses a wrong secret, a tampered body, and empty inputs", () => {
    expect(verifySolamiSignature(body, hmacHex(body, "another-secret"), SECRET)).toBe(false);
    expect(verifySolamiSignature(body + " ", hmacHex(body), SECRET)).toBe(false);
    expect(verifySolamiSignature(body, null, SECRET)).toBe(false);
    expect(verifySolamiSignature(body, "", SECRET)).toBe(false);
    expect(verifySolamiSignature(body, hmacHex(body), "")).toBe(false);
    expect(verifySolamiSignature(body, "not-a-signature", SECRET)).toBe(false);
  });
});

describe("parseSolamiDelivery", () => {
  it("collects signatures and candidate addresses from nested envelopes, whatever the field names", () => {
    const payload = [
      {
        signature: SIG,
        slot: 1,
        payload_kind: "enriched",
        token_transfers: [{ from_user_account: OTHER, to_user_account: WALLET, mint: MINT, amount: "1.5" }],
      },
      { signature: SIG, events: { transfer: { owner: WALLET } } },
    ];
    const d = parseSolamiDelivery(payload);
    expect(d.signatures).toEqual([SIG]);
    expect(new Set(d.candidateAddresses)).toEqual(new Set([WALLET, OTHER, MINT]));
  });

  it("ignores non-base58 strings and non-objects", () => {
    expect(parseSolamiDelivery({ note: "hello", n: 5, flag: true, sig: "0OIl" })).toEqual({ signatures: [], candidateAddresses: [] });
    expect(parseSolamiDelivery(null)).toEqual({ signatures: [], candidateAddresses: [] });
  });
});

describe("createSeenSignatures", () => {
  it("flags a full repeat inside the window only", () => {
    const seen = createSeenSignatures({ windowMs: 1_000 });
    expect(seen.allSeen(["a"], 0)).toBe(false);
    expect(seen.allSeen(["a"], 500)).toBe(true);
    expect(seen.allSeen(["a", "b"], 600)).toBe(false);
    expect(seen.allSeen(["a"], 2_000)).toBe(false);
    expect(seen.allSeen([], 2_000)).toBe(false);
  });

  it("stays bounded", () => {
    const seen = createSeenSignatures({ windowMs: 60_000, maxEntries: 2 });
    seen.allSeen(["a"], 0);
    seen.allSeen(["b"], 1);
    seen.allSeen(["c"], 2);
    expect(seen.allSeen(["a"], 3)).toBe(false);
  });
});

describe("buildWebhookSpec and the management client", () => {
  const spec = buildWebhookSpec({ hookUrl: "https://app.example/api/hooks/solami", addresses: [WALLET, OTHER, WALLET], mints: [MINT] });

  it("watches each wallet once, token transfers of the issuers' mints only, enriched, successful txs", () => {
    expect(spec.addresses).toEqual([OTHER, WALLET].sort());
    expect(spec.transfer_filter).toEqual({ mints: [MINT], native: false, tokens: true });
    expect(spec.payload_kind).toBe("enriched");
    expect(spec.tx_status).toEqual({ succeeded: true, failed: false });
    expect(spec.url).toBe("https://app.example/api/hooks/solami");
  });

  it("posts to /webhooks/create and /webhooks/update with the key in the query, and never echoes the URL on failure", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ data: { id: "wh_1", secret: "whsec_x" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const created = await createWebhook({ apiKey: "key-123", fetchImpl }, spec);
    expect(created).toEqual({ id: "wh_1", secret: "whsec_x" });
    await updateWebhook({ apiKey: "key-123", apiUrl: "https://fra.api.solami.dev/", fetchImpl }, "wh_1", spec);
    expect(calls[0].url).toBe("https://api.solami.dev/webhooks/create?api_key=key-123");
    expect(calls[1].url).toBe("https://fra.api.solami.dev/webhooks/update?api_key=key-123");
    expect(calls[1].body).toMatchObject({ id: "wh_1", label: "dulo-quests" });

    const failing = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(createWebhook({ apiKey: "key-123", fetchImpl: failing }, spec)).rejects.toThrow(/HTTP 403/);
    await expect(createWebhook({ apiKey: "key-123", fetchImpl: failing }, spec)).rejects.not.toThrow(/key-123/);
  });
});

describe("createHookHealth", () => {
  it("counts deliveries and keeps the last run", () => {
    const h = createHookHealth();
    h.delivery(new Date("2026-10-01T10:00:00Z"));
    h.duplicate();
    h.matched();
    h.rejected();
    h.run({ at: "2026-10-01T10:00:03Z", users: 1, tookMs: 2400, newlyCompleted: 1 });
    expect(h.snapshot()).toEqual({
      deliveries: 1,
      rejected: 1,
      duplicates: 1,
      matched: 1,
      lastDeliveryAt: "2026-10-01T10:00:00.000Z",
      lastRun: { at: "2026-10-01T10:00:03Z", users: 1, tookMs: 2400, newlyCompleted: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  runForUser: vi.fn(),
  findMany: vi.fn(),
  env: { SOLAMI_WEBHOOK_SECRET: "" },
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/server/db", () => ({ db: { wallet: { findMany: mocks.findMany } } }));
vi.mock("@/lib/server/env", () => ({ env: () => mocks.env }));
vi.mock("@/lib/cron/tick", () => ({ runForUser: mocks.runForUser }));

// Imported once, outside any test's time budget (a cold import of the route can take seconds).
// Route state (the replay guard) therefore persists across tests: each test uses its own signature.
import { GET, POST } from "@/app/api/hooks/solami/route";

let sigCounter = 0;
/** A distinct base58 transaction signature per call. */
function nextSig(): string {
  sigCounter += 1;
  return SIG.slice(0, -2) + "ABCDEFGHJK"[sigCounter % 10] + "LMNPQRSTUV"[Math.floor(sigCounter / 10) % 10];
}

describe("/api/hooks/solami", () => {
  beforeEach(() => {
    mocks.after.mockReset();
    mocks.runForUser.mockReset().mockResolvedValue({ evaluate: { newlyCompleted: 1 } });
    mocks.findMany.mockReset();
    mocks.env.SOLAMI_WEBHOOK_SECRET = SECRET;
  });

  async function post(payload: unknown, signature?: string) {
    const body = JSON.stringify(payload);
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("x-webhook-signature", signature ?? hmacHex(body));
    const res = await POST(new Request("http://localhost:3000/api/hooks/solami", { method: "POST", body, headers }), undefined);
    return { status: res.status, body: await res.json() };
  }

  let delivery: { signature: string; token_transfers: Array<{ to_user_account: string; mint: string }> };
  beforeEach(() => {
    delivery = { signature: nextSig(), token_transfers: [{ to_user_account: WALLET, mint: MINT }] };
  });

  it("is 503 without a configured secret", async () => {
    mocks.env.SOLAMI_WEBHOOK_SECRET = "";
    expect((await post(delivery)).status).toBe(503);
  });

  it("refuses a bad signature before reading the database", async () => {
    const res = await post(delivery, "deadbeef");
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("matches real players' wallets only and re-reads them after the response", async () => {
    mocks.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u1" }]);
    const res = await post(delivery);
    expect(res).toEqual({ status: 200, body: { ok: true, data: { matched: 1, duplicate: false } } });
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.address.in).toEqual(expect.arrayContaining([WALLET, MINT]));
    expect(where.user).toMatchObject({ leagueAccounts: { none: { isBot: true } } });
    expect(mocks.runForUser).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.runForUser).toHaveBeenCalledTimes(1);
    expect(mocks.runForUser.mock.calls[0][0]).toBe("u1");
  });

  it("acknowledges a retried delivery without a second re-read", async () => {
    mocks.findMany.mockResolvedValue([{ userId: "u1" }]);
    const body = JSON.stringify(delivery);
    const send = () =>
      POST(
        new Request("http://localhost:3000/api/hooks/solami", { method: "POST", body, headers: { "x-webhook-signature": hmacHex(body) } }),
        undefined,
      ).then((r) => r.json());
    expect((await send()).data.duplicate).toBe(false);
    expect((await send()).data).toEqual({ matched: 0, duplicate: true });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a delivery that touches no player", async () => {
    mocks.findMany.mockResolvedValue([]);
    const res = await post(delivery);
    expect(res.body.data).toEqual({ matched: 0, duplicate: false });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("reports health on GET without any secret", async () => {
    const res = await GET(new Request("http://localhost:3000/api/hooks/solami"), undefined);
    const json = await res.json();
    expect(json.data).toMatchObject({ configured: true });
    expect(json.data.deliveries).toBeGreaterThan(0);
    expect(json.data.rejected).toBeGreaterThan(0);
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });
});
