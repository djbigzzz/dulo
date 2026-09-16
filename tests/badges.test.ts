import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Module mocks (hoisted): Prisma and the web3 send are replaced; everything else is real.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  db: {
    pointsEvent: { findMany: vi.fn() },
    badge: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    play: { findUnique: vi.fn(), findMany: vi.fn() },
  },
  sendAndConfirmTransaction: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({ db: mocks.db }));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return { ...actual, sendAndConfirmTransaction: mocks.sendAndConfirmTransaction };
});

import { BADGES, BADGE_KEYS, BADGE_SVGS, badgeMeta, badgeMetadataJson, renderBadgeSvg } from "@/lib/badges/designs";
import { badgeImagePath, badgeInfo, badgeMetadataPath, isBadgeKey, txExplorerUrl } from "@/lib/badges/keys";
import {
  BADGE_MINT_EXTENSIONS,
  BadgeMintingDisabledError,
  assertMintableBaseUrl,
  isProductionRuntime,
  badgeMintSpace,
  badgeTokenMetadata,
  buildBadgeMintInstructions,
  mintBadge,
  parseSecretKey,
} from "@/lib/badges/mint";
import { toMyBadgeView } from "@/lib/badges/views";
import { DEFAULT_MINT_LIMIT, LEAGUE_TOP3_REF_RE, ensureLeagueTop3Badges, mintPendingBadges, resetBadgesCronMemory } from "@/lib/cron/badges";
import { TAMGA_PATHS } from "@/components/brand/Tamga";

const OWNER = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";

beforeEach(() => {
  vi.resetAllMocks();
  resetBadgesCronMemory();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.db.pointsEvent.findMany.mockResolvedValue([]);
  mocks.db.badge.findMany.mockResolvedValue([]);
  mocks.db.badge.createMany.mockResolvedValue({ count: 0 });
  mocks.db.badge.update.mockResolvedValue({});
  mocks.db.play.findUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// designs / meta
// ---------------------------------------------------------------------------

describe("badge designs", () => {
  it("ships five keys: the four Play badges plus the League podium", () => {
    expect([...BADGE_KEYS]).toEqual(["first_position", "diamond_hands", "earnings_holder", "mirror", "league_top3"]);
    expect(isBadgeKey("mirror")).toBe(true);
    expect(isBadgeKey("nope")).toBe(false);
    expect(badgeInfo("nope")).toBeNull();
    expect(badgeMeta("nope")).toBeNull();
  });

  it.each(BADGE_KEYS)("%s has copy and a tamga-based SVG", (key) => {
    const meta = badgeMeta(key);
    expect(meta).not.toBeNull();
    expect(meta!.name.startsWith("Dulo · ")).toBe(true);
    expect(meta!.description.length).toBeGreaterThan(20);
    expect(meta!.svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(meta!.svg.endsWith("</svg>")).toBe(true);
    for (const d of TAMGA_PATHS) expect(meta!.svg).toContain(`d="${d}"`);
    expect(meta!.svg).toContain(`<title id="b-${key}-t">`);
    expect(meta!.svg).toContain(meta!.color);
    expect(meta!.svg).toContain(BADGES[key].title);
    expect(meta!.svg).not.toMatch(/NaN|undefined/);
    expect(BADGE_SVGS[key]).toBe(meta!.svg);
  });

  it("gives every badge a distinct accent and artwork, deterministically", () => {
    const accents = new Set(BADGE_KEYS.map((k) => BADGES[k].accent));
    expect(accents.size).toBe(BADGE_KEYS.length);
    const svgs = new Set(BADGE_KEYS.map((k) => BADGE_SVGS[k]));
    expect(svgs.size).toBe(BADGE_KEYS.length);
    expect(renderBadgeSvg(BADGES.mirror)).toBe(renderBadgeSvg(BADGES.mirror));
    // The mirror design reflects the mark: the tamga paths appear twice.
    expect(BADGE_SVGS.mirror.split(TAMGA_PATHS[1]).length - 1).toBe(2);
    expect(BADGE_SVGS.first_position.split(TAMGA_PATHS[1]).length - 1).toBe(1);
  });

  it("escapes the caption text", () => {
    const svg = renderBadgeSvg({ ...BADGES.mirror, title: "A & <B>", name: "N \"q\"" });
    expect(svg).toContain("A &amp; &lt;B&gt;");
    expect(svg).toContain("N &quot;q&quot;");
  });

  it("builds the off-chain metadata document with absolute image URLs", () => {
    const json = badgeMetadataJson("first_position", "https://dulo.fun/");
    expect(json).toMatchObject({
      name: "Dulo · First Position",
      symbol: "DULO",
      image: "https://dulo.fun/api/v1/badges/first_position/image.svg",
      attributes: expect.arrayContaining([{ trait_type: "Season", value: "Stocks Season" }]),
    });
    expect(badgeImagePath("mirror")).toBe("/api/v1/badges/mirror/image.svg");
    expect(badgeMetadataPath("mirror")).toBe("/api/v1/badges/mirror/metadata.json");
    expect(txExplorerUrl("abc")).toBe("https://solscan.io/tx/abc");
  });

  it("shapes a Badge row for the API with its state", () => {
    const at = new Date("2026-09-14T12:00:00Z");
    expect(toMyBadgeView({ playKey: "diamond_hands", mint: "M", txSig: "S", createdAt: at })).toMatchObject({
      title: "Diamond Hands",
      name: "Dulo · Diamond Hands",
      accent: "ice",
      imageUrl: "/api/v1/badges/diamond_hands/image.svg",
      state: "minted",
      txUrl: "https://solscan.io/tx/S",
    });
    expect(toMyBadgeView({ playKey: "diamond_hands", mint: null, txSig: null, createdAt: at }).state).toBe("pending");
    expect(toMyBadgeView({ playKey: "legacy", mint: null, txSig: null, createdAt: at }, "Legacy Play")).toMatchObject({ title: "Legacy Play", imageUrl: null, accent: null });
  });
});

// ---------------------------------------------------------------------------
// mint (pure parts + the transaction flow with a faked send)
// ---------------------------------------------------------------------------

describe("mint", () => {
  it("parses a base58 or JSON-array secret and refuses an empty one", () => {
    const kp = Keypair.generate();
    expect(parseSecretKey(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
    expect(parseSecretKey(JSON.stringify([...kp.secretKey])).publicKey.equals(kp.publicKey)).toBe(true);
    expect(() => parseSecretKey("")).toThrow(BadgeMintingDisabledError);
    expect(() => parseSecretKey("   ")).toThrow(/badge minting disabled/);
    expect(() => parseSecretKey(bs58.encode(kp.secretKey.slice(0, 32)))).toThrow(/64 bytes/);
  });

  it("builds Token-2022 metadata pointing at the app's metadata.json", () => {
    const mint = Keypair.generate().publicKey;
    const auth = Keypair.generate().publicKey;
    const md = badgeTokenMetadata("earnings_holder", mint, auth, "https://dulo.fun");
    expect(md).toMatchObject({ name: "Dulo · Earnings Holder", symbol: "DULO", uri: "https://dulo.fun/api/v1/badges/earnings_holder/metadata.json" });
    expect(md.additionalMetadata).toEqual([
      ["badge", "earnings_holder"],
      ["season", "Stocks Season"],
    ]);
    const { mintLen, metadataLen } = badgeMintSpace(md);
    expect(mintLen).toBeGreaterThan(82); // base mint + NonTransferable + MetadataPointer
    expect(metadataLen).toBeGreaterThan(md.name.length + md.uri.length);
  });

  it("composes one transaction: create, NonTransferable, MetadataPointer, mint, metadata, ATA, mintTo 1, burn authority", () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const owner = new PublicKey(OWNER);
    const md = badgeTokenMetadata("first_position", mint, payer, "https://dulo.fun");
    const ixs = buildBadgeMintInstructions({ payer, mint, owner, metadata: md, lamports: 1_000_000, mintLen: 200 });
    expect(ixs).toHaveLength(8);
    expect(ixs[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(ixs[5].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    for (const i of [1, 2, 3, 4, 6, 7]) expect(ixs[i].programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    // The mint account is created by the payer with the requested space.
    expect(ixs[0].keys[0].pubkey.equals(payer)).toBe(true);
    expect(ixs[0].keys[1].pubkey.equals(mint)).toBe(true);
    expect(BADGE_MINT_EXTENSIONS).toHaveLength(2);
  });

  it("mintBadge signs with the server wallet + mint keypair and returns mint/txSig (send faked; no SOL spent)", async () => {
    const payer = Keypair.generate();
    const mintKeypair = Keypair.generate();
    mocks.sendAndConfirmTransaction.mockResolvedValue("sig123");
    const connection = { getMinimumBalanceForRentExemption: vi.fn(async () => 2_000_000) };

    const r = await mintBadge({ ownerAddress: OWNER, badgeKey: "mirror" }, { connection: connection as never, payer, mintKeypair, baseUrl: "https://dulo.fun" });

    expect(r).toEqual({ mint: mintKeypair.publicKey.toBase58(), txSig: "sig123", tokenAccount: expect.any(String) });
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledTimes(1);
    const [, tx, signers] = mocks.sendAndConfirmTransaction.mock.calls[0];
    expect(tx.instructions).toHaveLength(8);
    expect(tx.feePayer?.equals(payer.publicKey)).toBe(true);
    expect(signers.map((s: Keypair) => s.publicKey.toBase58())).toEqual([payer.publicKey.toBase58(), mintKeypair.publicKey.toBase58()]);
  });

  it("mintBadge rejects an unknown badge key or a bad address before touching the chain", async () => {
    await expect(mintBadge({ ownerAddress: OWNER, badgeKey: "nope" })).rejects.toThrow(/Unknown badge key/);
    await expect(mintBadge({ ownerAddress: "not-an-address", badgeKey: "mirror" })).rejects.toThrow(/Invalid owner address/);
    expect(mocks.sendAndConfirmTransaction).not.toHaveBeenCalled();
  });

  it("refuses to mint (BadgeMintingDisabledError, no RPC) when the metadata origin is localhost in production", async () => {
    const payer = Keypair.generate();
    const connection = { getMinimumBalanceForRentExemption: vi.fn(async () => 2_000_000) };
    for (const baseUrl of ["http://localhost:3000", "http://127.0.0.1:3000", "not a url"]) {
      const p = mintBadge({ ownerAddress: OWNER, badgeKey: "mirror" }, { connection: connection as never, payer, baseUrl, production: true });
      await expect(p).rejects.toBeInstanceOf(BadgeMintingDisabledError);
    }
    await expect(
      mintBadge({ ownerAddress: OWNER, badgeKey: "mirror" }, { connection: connection as never, payer, baseUrl: "http://localhost:3000", production: true }),
    ).rejects.toThrow(/localhost in production/);
    expect(connection.getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
    expect(mocks.sendAndConfirmTransaction).not.toHaveBeenCalled();

    // Outside production a localhost origin is allowed (devnet/local experiments), and a real origin always is.
    mocks.sendAndConfirmTransaction.mockResolvedValue("sig-local");
    await expect(
      mintBadge({ ownerAddress: OWNER, badgeKey: "mirror" }, { connection: connection as never, payer, baseUrl: "http://localhost:3000", production: false }),
    ).resolves.toMatchObject({ txSig: "sig-local" });
    expect(() => assertMintableBaseUrl("https://dulo.fun", true)).not.toThrow();
    expect(isProductionRuntime({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ VERCEL_ENV: "preview", NODE_ENV: "development" })).toBe(false);
  });

  it("the cron step skips with the localhost reason instead of recording a failure", async () => {
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "mirror")]);
    const payer = Keypair.generate();
    const mint = vi.fn((input: { ownerAddress: string; badgeKey: string }) => mintBadge(input, { payer, baseUrl: "http://localhost:3000", production: true }));
    const r = await mintPendingBadges(new Date(), { enabled: true, mint });
    expect(r).toMatchObject({ minted: 0, failed: [], skipped: true });
    expect(r.reason).toMatch(/localhost in production/);
    expect(mocks.sendAndConfirmTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cron step
// ---------------------------------------------------------------------------

const WALLETS = [
  { address: "OldWallet1111111111111111111111111111111111", chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", isPrimary: false, createdAt: new Date("2026-01-01T00:00:00Z") },
  { address: OWNER, chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", isPrimary: true, createdAt: new Date("2026-02-01T00:00:00Z") },
];

function pendingRow(id: string, playKey: string, userId = "u1") {
  return { id, userId, playKey, user: { wallets: WALLETS } };
}

describe("ensureLeagueTop3Badges", () => {
  it("creates league_top3 rows for ranks 1-3 only, once per user, idempotently via skipDuplicates", async () => {
    mocks.db.pointsEvent.findMany.mockResolvedValue([
      { userId: "u1", ref: "league:L1:rank:1" },
      { userId: "u1", ref: "league:L2:rank:3" }, // same user, second podium
      { userId: "u2", ref: "league:L1:rank:2" },
      { userId: "u3", ref: "league:L1:rank:4" }, // not a podium
      { userId: "u4", ref: "play:first_position" }, // not a League ref (contains filter is a pre-filter only)
    ]);
    mocks.db.badge.createMany.mockResolvedValue({ count: 2 });

    expect(await ensureLeagueTop3Badges()).toBe(2);
    expect(mocks.db.pointsEvent.findMany.mock.calls[0][0].where).toEqual({ source: "league", ref: { contains: ":rank:" } });
    expect(mocks.db.badge.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", playKey: "league_top3" },
        { userId: "u2", playKey: "league_top3" },
      ],
      skipDuplicates: true,
    });

    // Second run: the same rows are offered again; the unique constraint (skipDuplicates) makes it a no-op.
    mocks.db.badge.createMany.mockResolvedValue({ count: 0 });
    expect(await ensureLeagueTop3Badges()).toBe(0);
    expect(mocks.db.badge.createMany.mock.calls[1][0]).toEqual(mocks.db.badge.createMany.mock.calls[0][0]);
    expect(LEAGUE_TOP3_REF_RE.test("league:abc:rank:10")).toBe(false);
  });

  it("does nothing when nobody has a podium", async () => {
    expect(await ensureLeagueTop3Badges()).toBe(0);
    expect(mocks.db.badge.createMany).not.toHaveBeenCalled();
  });
});

describe("mintPendingBadges", () => {
  it("skips minting without a server wallet, leaves rows pending and warns once per process", async () => {
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "first_position")]);
    const mint = vi.fn();

    const first = await mintPendingBadges(new Date(), { enabled: false, mint });
    const second = await mintPendingBadges(new Date(), { enabled: false, mint });

    expect(first).toMatchObject({ pending: 1, minted: 0, skipped: true, reason: "SERVER_WALLET_SECRET is empty", failed: [] });
    expect(second.skipped).toBe(true);
    expect(mint).not.toHaveBeenCalled();
    expect(mocks.db.badge.update).not.toHaveBeenCalled();
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("SERVER_WALLET_SECRET"))).toHaveLength(1);
    // The podium rows are still ensured even when minting is off.
    expect(mocks.db.badge.createMany).not.toHaveBeenCalled(); // nobody on a podium in this fixture
  });

  it("mints pending rows to the primary wallet, stores mint/txSig and isolates per-row failures", async () => {
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "first_position"), pendingRow("b2", "diamond_hands", "u2"), pendingRow("b3", "mirror")]);
    const mint = vi.fn(async ({ badgeKey }: { badgeKey: string }) => {
      if (badgeKey === "diamond_hands") throw new Error("blockhash expired");
      return { mint: `mint_${badgeKey}`, txSig: `sig_${badgeKey}`, tokenAccount: "ata" };
    });

    const r = await mintPendingBadges(new Date(), { enabled: true, mint, limit: 5 });

    expect(r).toMatchObject({ pending: 3, minted: 2, skipped: false });
    expect(r.failed).toEqual([{ badgeId: "b2", userId: "u2", playKey: "diamond_hands", error: "blockhash expired" }]);
    expect(mint).toHaveBeenCalledWith({ ownerAddress: OWNER, badgeKey: "first_position" });
    expect(mocks.db.badge.update).toHaveBeenCalledTimes(2);
    expect(mocks.db.badge.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { mint: "mint_first_position", txSig: "sig_first_position" } });
    expect(mocks.db.badge.update).toHaveBeenCalledWith({ where: { id: "b3" }, data: { mint: "mint_mirror", txSig: "sig_mirror" } });
    const query = mocks.db.badge.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ mint: null });
    expect(query.take).toBe(5);
  });

  it("resolves the design through Play.badgeKey when the row's playKey is not a design, and fails rows without a wallet", async () => {
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "some_partner_play"), { id: "b2", userId: "u9", playKey: "mirror", user: { wallets: [] } }]);
    mocks.db.play.findUnique.mockResolvedValue({ badgeKey: "earnings_holder" });
    const mint = vi.fn(async () => ({ mint: "m", txSig: "s", tokenAccount: "a" }));

    const r = await mintPendingBadges(new Date(), { enabled: true, mint });

    expect(mint).toHaveBeenCalledWith({ ownerAddress: OWNER, badgeKey: "earnings_holder" });
    expect(r.minted).toBe(1);
    expect(r.failed).toEqual([{ badgeId: "b2", userId: "u9", playKey: "mirror", error: "user has no Solana wallet" }]);
  });

  it("stops the batch when the mint reports minting disabled mid-run", async () => {
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "first_position"), pendingRow("b2", "mirror")]);
    const mint = vi.fn(async () => {
      throw new BadgeMintingDisabledError();
    });
    const r = await mintPendingBadges(new Date(), { enabled: true, mint });
    expect(r).toMatchObject({ skipped: true, minted: 0, failed: [] });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("takes at most DEFAULT_MINT_LIMIT (2) pending rows per tick by default (WIN-PLAN M-L)", async () => {
    expect(DEFAULT_MINT_LIMIT).toBe(2);
    mocks.db.badge.findMany.mockResolvedValue([pendingRow("b1", "first_position"), pendingRow("b2", "mirror")]);
    const mint = vi.fn(async () => ({ mint: "m", txSig: "s", tokenAccount: "a" }));
    const r = await mintPendingBadges(new Date(), { enabled: true, mint });
    expect(mocks.db.badge.findMany.mock.calls[0][0].take).toBe(2);
    expect(r).toMatchObject({ pending: 2, minted: 2 });
  });

  it("awards podium badges and returns early when nothing is pending", async () => {
    mocks.db.pointsEvent.findMany.mockResolvedValue([{ userId: "u1", ref: "league:L1:rank:1" }]);
    mocks.db.badge.createMany.mockResolvedValue({ count: 1 });
    const r = await mintPendingBadges(new Date(), { enabled: true, mint: vi.fn() });
    expect(r).toMatchObject({ leagueTop3Created: 1, pending: 0, minted: 0, skipped: false });
  });
});
