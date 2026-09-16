import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adversarial ledger review (17 Sep 2026), sign-in part.
 *
 * Bug: the house bot refusal in POST /api/v1/auth/verify is keyed on the Wallet ROW's owner
 * (isBotOwnedUser). A house bot's key is public (Keypair.fromSeed(sha256(handle)), handle shown
 * on the competition board), so while that bot's Wallet row does not exist yet (the window
 * between the Vercel deploy and `prisma db seed`, or after a BOT_HANDLES rename until the next
 * seedBots) anyone can sign in with the bot's address. That creates an ordinary real account at
 * the bot's address, which then receives starter points and quest points, and seedBots' wallet
 * upsert (update: {}) leaves the address with that account for good. The refusal must also key
 * on the planned bot addresses themselves.
 */
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
// Partial: lib/games/league (imported below for the bot identities) pulls lib/price, which needs `solana`.
vi.mock("@/lib/adapters/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/solana")>()),
  verifyEd25519: () => true,
}));
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
import { newAccountLimiter } from "@/app/api/v1/auth/verify/guards";
import { BOT_HANDLES, botUserId, botWalletAddress } from "@/lib/games/league";

const CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BOT_ADDRESS = botWalletAddress(BOT_HANDLES[0]);
const LAST_BOT_ADDRESS = botWalletAddress(BOT_HANDLES[BOT_HANDLES.length - 1]);
const REAL_ADDRESS = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";

function signIn(address: string, body: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost:3000/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify({ address, message: "Sign in to Dulo", signature: "sig", ...body }),
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
  // The bot has not been seeded yet: no Wallet row at its address.
  mocks.db.wallet.findUnique.mockResolvedValue(null);
  mocks.db.leagueAccount.count.mockResolvedValue(0);
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db));
  mocks.db.user.create.mockResolvedValue({ id: "u_squatter" });
  mocks.db.user.findUnique.mockResolvedValue({ id: "u_real" });
  mocks.db.wallet.create.mockImplementation(async ({ data }: { data: { userId: string; address: string } }) => ({
    id: "w_new",
    userId: data.userId,
    chainId: CHAIN,
    address: data.address,
  }));
  mocks.ensureStarterPoints.mockResolvedValue({ granted: true, seasonId: "season-0" });
  mocks.runForUser.mockResolvedValue({});
});

describe("adversarial ledger review — a house bot address before its Wallet row exists", () => {
  it("the planned bot identity is public and deterministic (the premise of the attack)", () => {
    expect(botUserId(0)).toBe("bot-league-1");
    expect(botWalletAddress(BOT_HANDLES[0])).toBe(BOT_ADDRESS);
    expect(BOT_ADDRESS).not.toBe(REAL_ADDRESS);
  });

  it("refuses a signed-out sign-in with a bot address: no account, no starter points, no cookie", async () => {
    const res = await signIn(BOT_ADDRESS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "House bot wallets cannot sign in" });
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.db.wallet.create).not.toHaveBeenCalled();
    expect(mocks.ensureStarterPoints).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it("refuses linking a bot address to a signed-in real account", async () => {
    mocks.getSession.mockResolvedValue({ userId: "u_real", walletId: "w1", address: REAL_ADDRESS, chainId: CHAIN });
    const res = await signIn(LAST_BOT_ADDRESS);
    expect(res.status).toBe(403);
    expect(mocks.db.wallet.create).not.toHaveBeenCalled();
    expect(mocks.ensureStarterPoints).not.toHaveBeenCalled();
  });

  it("still lets an ordinary new wallet in and grants its starter points once", async () => {
    const res = await signIn(REAL_ADDRESS);
    expect(res.status).toBe(200);
    expect(mocks.db.user.create).toHaveBeenCalledTimes(1);
    expect(mocks.ensureStarterPoints).toHaveBeenCalledWith("u_squatter", expect.any(Date));
  });
});
