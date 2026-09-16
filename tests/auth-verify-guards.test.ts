import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/auth/verify guards (16 Sep points policy): the per-network new-account limiter,
// the house bot refusal and the welcome block. The signature checks are mocked to pass; the
// route's own order (limit -> resolve -> bot refusal -> starter grant -> cookie) is pinned.
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  db: {
    authNonce: { findUnique: vi.fn(), deleteMany: vi.fn() },
    wallet: { findUnique: vi.fn(), create: vi.fn() },
    user: { create: vi.fn(), findUnique: vi.fn() },
    leagueAccount: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  getSession: vi.fn(),
  createSessionCookie: vi.fn(),
  ensureStarterPoints: vi.fn(),
  runForUser: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/server/env", () => ({ env: () => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }) }));
vi.mock("@/lib/adapters/solana", () => ({ verifyEd25519: () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession, createSessionCookie: mocks.createSessionCookie }));
vi.mock("@/lib/auth/siws", () => ({ parseSiwsMessage: () => ({ nonce: "nonce-1" }) }));
vi.mock("@/lib/auth/siws-verify", () => ({
  checkSiwsMessage: () => ({ ok: true }),
  decodeBase58: () => new Uint8Array(64),
  isSolanaAddress: () => true,
  siwsSignedBytes: () => new Uint8Array([1, 2, 3]),
}));
vi.mock("@/lib/cron/tick", () => ({ runForUser: mocks.runForUser }));
vi.mock("@/lib/games/starter", () => ({ ensureStarterPoints: mocks.ensureStarterPoints }));

import { POST } from "@/app/api/v1/auth/verify/route";
import {
  NEW_ACCOUNT_LIMIT_MESSAGE,
  assertNewAccountAllowed,
  isBotOwnedUser,
  newAccountLimiter,
  welcomePayload,
} from "@/app/api/v1/auth/verify/guards";
import { STARTER_POINTS, VIRTUAL_CASH_USD } from "@/lib/games/ledger-policy";
import { ApiError } from "@/lib/server/api";
import { createRateLimiter } from "@/lib/server/rate-limit";

const ADDRESS = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";
const REAL_WALLET = { id: "w1", userId: "u_real", chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", address: ADDRESS };
const BOT_WALLET = { ...REAL_WALLET, id: "w_bot", userId: "bot-league-4" };

function signIn(body: Record<string, unknown> = {}, ip = "203.0.113.7") {
  return POST(
    new Request("http://localhost:3000/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ address: ADDRESS, message: "Sign in to Dulo", signature: "sig", ...body }),
    }),
    undefined,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  newAccountLimiter.reset();
  mocks.getSession.mockResolvedValue(null);
  mocks.createSessionCookie.mockImplementation(async (_session: unknown, res: Response) => res);
  mocks.db.authNonce.findUnique.mockResolvedValue({ nonce: "nonce-1", expiresAt: new Date(Date.now() + 60_000) });
  mocks.db.authNonce.deleteMany.mockResolvedValue({ count: 1 });
  mocks.db.wallet.findUnique.mockResolvedValue(REAL_WALLET);
  mocks.db.leagueAccount.count.mockResolvedValue(0);
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db));
  mocks.db.user.create.mockResolvedValue({ id: "u_new" });
  mocks.db.wallet.create.mockResolvedValue({ ...REAL_WALLET, id: "w_new", userId: "u_new" });
  mocks.ensureStarterPoints.mockResolvedValue({ granted: false, seasonId: "s0", reason: "already_granted" });
  mocks.runForUser.mockResolvedValue({});
});

describe("guards", () => {
  it("assertNewAccountAllowed allows 20 new accounts per key per hour and refuses the 21st with a 429", () => {
    const limiter = createRateLimiter({ limit: 20, windowMs: 3_600_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(() => assertNewAccountAllowed("203.0.113.7", limiter, t0 + i)).not.toThrow();
    let err: unknown = null;
    try {
      assertNewAccountAllowed("203.0.113.7", limiter, t0 + 20);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toBe("Too many new accounts from this network. Try again later.");
    // Another network is unaffected, and the window resets after an hour.
    expect(() => assertNewAccountAllowed("198.51.100.1", limiter, t0 + 21)).not.toThrow();
    expect(() => assertNewAccountAllowed("203.0.113.7", limiter, t0 + 3_600_000)).not.toThrow();
  });

  it("isBotOwnedUser is true for the bot id prefix without a query, and for an isBot competition account", async () => {
    const client = { leagueAccount: { count: vi.fn().mockResolvedValue(0) } };
    expect(await isBotOwnedUser("bot-league-1", client as never)).toBe(true);
    expect(client.leagueAccount.count).not.toHaveBeenCalled();

    expect(await isBotOwnedUser("u_real", client as never)).toBe(false);
    expect(client.leagueAccount.count).toHaveBeenCalledWith({ where: { userId: "u_real", isBot: true } });

    client.leagueAccount.count.mockResolvedValue(1);
    expect(await isBotOwnedUser("u_house", client as never)).toBe(true);
  });

  it("welcomePayload is the grant only for the request that wrote it", () => {
    expect(welcomePayload(true)).toEqual({ starterPoints: 1000, virtualCashUsd: 10_000 });
    expect(welcomePayload(true)).toEqual({ starterPoints: STARTER_POINTS, virtualCashUsd: VIRTUAL_CASH_USD });
    expect(welcomePayload(false)).toBeNull();
  });
});

describe("POST /api/v1/auth/verify", () => {
  it("grants starter points synchronously and returns the welcome block with the session", async () => {
    mocks.ensureStarterPoints.mockResolvedValue({ granted: true, seasonId: "s0" });

    const res = await signIn();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.session).toMatchObject({ userId: "u_real", walletId: "w1", address: ADDRESS });
    expect(json.data.welcome).toEqual({ starterPoints: 1000, virtualCashUsd: 10_000 });
    expect(mocks.ensureStarterPoints).toHaveBeenCalledWith("u_real", expect.any(Date));
    // Written before the cookie is set and the response returns (not in after()).
    expect(mocks.ensureStarterPoints.mock.invocationCallOrder[0]).toBeLessThan(mocks.createSessionCookie.mock.invocationCallOrder[0]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("returns welcome: null on a later sign-in, and a failed grant never fails the sign-in", async () => {
    let json = await (await signIn()).json();
    expect(json.data.welcome).toBeNull();

    mocks.ensureStarterPoints.mockRejectedValue(new Error("pool timeout"));
    const res = await signIn();
    json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.welcome).toBeNull();
    expect(mocks.createSessionCookie).toHaveBeenCalledTimes(2);
  });

  it("refuses a house bot wallet with a 403 before any cookie or grant", async () => {
    mocks.db.wallet.findUnique.mockResolvedValue(BOT_WALLET);
    const res = await signIn();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "House bot wallets cannot sign in" });
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(mocks.ensureStarterPoints).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("refuses a user with an isBot competition account, and a switch into a bot account", async () => {
    mocks.db.leagueAccount.count.mockResolvedValue(1);
    expect((await signIn()).status).toBe(403);

    mocks.db.leagueAccount.count.mockResolvedValue(0);
    mocks.getSession.mockResolvedValue({ userId: "u_real", walletId: "w1", address: "Other", chainId: REAL_WALLET.chainId });
    mocks.db.wallet.findUnique.mockResolvedValue(BOT_WALLET);
    const res = await signIn({ switch: true });
    expect(res.status).toBe(403);
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it("counts only brand-new accounts against the per-network limit: the 21st new account is a 429", async () => {
    mocks.db.wallet.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i++) expect((await signIn({}, "203.0.113.50")).status).toBe(200);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(20);

    const res = await signIn({}, "203.0.113.50");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(NEW_ACCOUNT_LIMIT_MESSAGE);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(20);

    // Signing back in to an existing account from the same network still works.
    mocks.db.wallet.findUnique.mockResolvedValue(REAL_WALLET);
    expect((await signIn({}, "203.0.113.50")).status).toBe(200);
    // A different network can still open an account.
    mocks.db.wallet.findUnique.mockResolvedValue(null);
    expect((await signIn({}, "198.51.100.9")).status).toBe(200);
  });

  it("keys IPv6 clients on their /64, so rotating addresses inside one prefix shares the budget", async () => {
    mocks.db.wallet.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i++) expect((await signIn({}, `2001:db8:1:2::${(i + 1).toString(16)}`)).status).toBe(200);
    expect((await signIn({}, "2001:db8:1:2::ffff")).status).toBe(429);
  });
});
