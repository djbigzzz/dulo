import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, type AccountInfo, type ParsedAccountData } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountType,
  ExtensionType,
  MINT_SIZE,
  MintLayout,
  SCALED_UI_AMOUNT_CONFIG_SIZE,
  ScaledUiAmountConfigLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SOLANA_MAINNET } from "@/lib/core";
import {
  SLOT_ANCHOR_MAX_AGE_MS,
  SLOT_ANCHOR_RETRY_MS,
  SLOT_ANCHOR_TTL_MS,
  SLOT_MS,
  SolanaAdapterError,
  createSolanaAdapter,
  effectiveMultiplier,
  isValidSolanaAddress,
  parseScaledUiAmountExtension,
  verifyEd25519,
  type SolanaRpc,
} from "@/lib/adapters/solana";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"; // Token-2022, 8 decimals, scaled UI
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"; // Token-2022, zero balance in fixture
const METAX = "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu"; // Token-2022, no scaled UI extension
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // SPL Token, 6 decimals

const OWNER = Keypair.generate().publicKey.toBase58();

/** Fixed clock: 2026-09-14T12:00:00Z. */
const NOW_MS = Date.UTC(2026, 8, 14, 12, 0, 0);
const NOW_SEC = Math.floor(NOW_MS / 1000);
/** Pending multiplier activates one hour after NOW. */
const ACTIVATION_SEC = NOW_SEC + 3600;

function tokenAccount(pubkey: string, mint: string, amount: string, decimals: number, programId: PublicKey) {
  return {
    pubkey: new PublicKey(pubkey),
    account: {
      executable: false,
      owner: programId,
      lamports: 2_039_280,
      data: {
        program: programId.equals(TOKEN_2022_PROGRAM_ID) ? "spl-token-2022" : "spl-token",
        space: 165,
        parsed: {
          type: "account",
          info: {
            mint,
            owner: OWNER,
            state: "initialized",
            isNative: false,
            tokenAmount: {
              amount,
              decimals,
              uiAmount: Number(amount) / 10 ** decimals,
              uiAmountString: String(Number(amount) / 10 ** decimals),
            },
          },
        },
      } satisfies ParsedAccountData,
    },
  };
}

function parsedMint(programId: PublicKey, decimals: number, extensions?: unknown[]): AccountInfo<ParsedAccountData> {
  return {
    executable: false,
    owner: programId,
    lamports: 1_461_600,
    data: {
      program: programId.equals(TOKEN_2022_PROGRAM_ID) ? "spl-token-2022" : "spl-token",
      space: 82,
      parsed: {
        type: "mint",
        info: {
          decimals,
          isInitialized: true,
          supply: "1000000000000",
          mintAuthority: null,
          freezeAuthority: null,
          ...(extensions ? { extensions } : {}),
        },
      },
    },
  };
}

const TSLAX_SCALED_UI_EXTENSION = {
  extension: "scaledUiAmountConfig",
  state: {
    authority: "Xs1111111111111111111111111111111111111111",
    multiplier: "1.25",
    newMultiplier: "1.5",
    newMultiplierEffectiveTimestamp: ACTIVATION_SEC,
  },
};

const OTHER_T22_EXTENSIONS = [
  { extension: "metadataPointer", state: { authority: null, metadataAddress: TSLAX } },
  { extension: "permanentDelegate", state: { delegate: "Xs1111111111111111111111111111111111111111" } },
  { extension: "defaultAccountState", state: { accountState: "initialized" } },
  { extension: "pausableConfig", state: { authority: null, paused: false } },
  { extension: "transferHook", state: { authority: null, programId: null } },
];

const MINT_FIXTURES: Record<string, AccountInfo<Buffer | ParsedAccountData> | null> = {
  [TSLAX]: parsedMint(TOKEN_2022_PROGRAM_ID, 8, [...OTHER_T22_EXTENSIONS, TSLAX_SCALED_UI_EXTENSION]),
  [AAPLX]: parsedMint(TOKEN_2022_PROGRAM_ID, 8, [...OTHER_T22_EXTENSIONS, TSLAX_SCALED_UI_EXTENSION]),
  [METAX]: parsedMint(TOKEN_2022_PROGRAM_ID, 8, OTHER_T22_EXTENSIONS),
  [USDC]: parsedMint(TOKEN_PROGRAM_ID, 6),
};

// Token account pubkeys (any valid base58 32-byte keys will do).
const ACC = {
  usdcA: Keypair.generate().publicKey.toBase58(),
  usdcB: Keypair.generate().publicKey.toBase58(),
  bonkZero: Keypair.generate().publicKey.toBase58(),
  tslaA: Keypair.generate().publicKey.toBase58(),
  tslaB: Keypair.generate().publicKey.toBase58(),
  aaplZero: Keypair.generate().publicKey.toBase58(),
  meta: Keypair.generate().publicKey.toBase58(),
};
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const SPL_ACCOUNTS = [
  tokenAccount(ACC.usdcA, USDC, "1000000", 6, TOKEN_PROGRAM_ID),
  tokenAccount(ACC.usdcB, USDC, "250000", 6, TOKEN_PROGRAM_ID),
  tokenAccount(ACC.bonkZero, BONK, "0", 5, TOKEN_PROGRAM_ID),
];
const T22_ACCOUNTS = [
  tokenAccount(ACC.tslaA, TSLAX, "50000000", 8, TOKEN_2022_PROGRAM_ID),
  tokenAccount(ACC.tslaB, TSLAX, "75000000", 8, TOKEN_2022_PROGRAM_ID),
  tokenAccount(ACC.aaplZero, AAPLX, "0", 8, TOKEN_2022_PROGRAM_ID),
  tokenAccount(ACC.meta, METAX, "12345678", 8, TOKEN_2022_PROGRAM_ID),
];

type FakeRpc = SolanaRpc & {
  getParsedTokenAccountsByOwner: ReturnType<typeof vi.fn>;
  getMultipleParsedAccounts: ReturnType<typeof vi.fn>;
  getBlockTime: ReturnType<typeof vi.fn>;
  getSlot: ReturnType<typeof vi.fn>;
};

/** Slots the fake ledger knows a block time for (unix seconds). Anything else -> null. */
const SLOT_A = 372_795_734;
const SLOT_B = 372_795_800;
const SLOT_MISSING = 372_000_000;
const BLOCK_TIMES: Record<number, number> = {
  [SLOT_A]: NOW_SEC - 90,
  [SLOT_B]: NOW_SEC - 60,
};
/** What the fake node reports as the current slot (getSlot). */
const CURRENT_SLOT = 372_800_000;

function fakeRpc(overrides: Partial<Record<string, AccountInfo<Buffer | ParsedAccountData> | null>> = {}): FakeRpc {
  const mints = { ...MINT_FIXTURES, ...overrides };
  const getParsedTokenAccountsByOwner = vi.fn(async (_owner: PublicKey, filter: { programId?: PublicKey }) => {
    const programId = filter.programId!;
    const value = programId.equals(TOKEN_2022_PROGRAM_ID) ? T22_ACCOUNTS : SPL_ACCOUNTS;
    return { context: { slot: 1 }, value };
  });
  const getMultipleParsedAccounts = vi.fn(async (keys: PublicKey[]) => ({
    context: { slot: 1 },
    value: keys.map((k) => mints[k.toBase58()] ?? null),
  }));
  const getBlockTime = vi.fn(async (slot: number) => BLOCK_TIMES[slot] ?? null);
  const getSlot = vi.fn(async () => CURRENT_SLOT);
  return { getParsedTokenAccountsByOwner, getMultipleParsedAccounts, getBlockTime, getSlot } as unknown as FakeRpc;
}

function makeAdapter(rpc: SolanaRpc, extra: Parameters<typeof createSolanaAdapter>[1] = {}) {
  return createSolanaAdapter("https://rpc.example.invalid", {
    rpc,
    now: () => NOW_MS,
    sleep: async () => {},
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// getTokenBalances
// ---------------------------------------------------------------------------

describe("getTokenBalances", () => {
  let rpc: FakeRpc;
  beforeEach(() => {
    rpc = fakeRpc();
  });

  it("queries both token programs, merges duplicate mints, drops zero balances and resolves multipliers", async () => {
    const adapter = makeAdapter(rpc);
    const rows = await adapter.getTokenBalances(OWNER);

    expect(rpc.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    const programsQueried = rpc.getParsedTokenAccountsByOwner.mock.calls.map((c) => (c[1] as { programId: PublicKey }).programId.toBase58());
    expect(programsQueried).toEqual(expect.arrayContaining([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]));
    expect(rpc.getParsedTokenAccountsByOwner.mock.calls[0][2]).toBe("confirmed");

    // One row per mint; zero balances (BONK, AAPLx) are gone.
    expect(rows.map((r) => r.mint)).toEqual([USDC, METAX, TSLAX].sort());
    for (const r of rows) expect(r.chainId).toBe(SOLANA_MAINNET);

    const usdc = rows.find((r) => r.mint === USDC)!;
    expect(usdc.program).toBe("spl-token");
    expect(usdc.amountRaw).toBe("1250000");
    expect(usdc.decimals).toBe(6);
    expect(usdc.account).toBe(ACC.usdcA); // largest account represents the merged row
    expect(usdc.multiplier).toBeNull(); // SPL mints carry no ScaledUiAmount

    const tsla = rows.find((r) => r.mint === TSLAX)!;
    expect(tsla.program).toBe("token-2022");
    expect(tsla.amountRaw).toBe("125000000");
    expect(tsla.decimals).toBe(8);
    expect(tsla.account).toBe(ACC.tslaB);
    expect(tsla.multiplier).toBe(1.25); // pending 1.5 not yet effective

    const meta = rows.find((r) => r.mint === METAX)!;
    expect(meta.program).toBe("token-2022");
    expect(meta.multiplier).toBe(1); // Token-2022 without the extension

    // Multipliers were fetched once, only for Token-2022 mints with a balance.
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);
    const asked = (rpc.getMultipleParsedAccounts.mock.calls[0][0] as PublicKey[]).map((k) => k.toBase58());
    expect(asked.sort()).toEqual([METAX, TSLAX].sort());
  });

  it("filters to the given mint set", async () => {
    const adapter = makeAdapter(rpc);
    const rows = await adapter.getTokenBalances(OWNER, new Set([TSLAX, BONK]));
    expect(rows).toHaveLength(1);
    expect(rows[0].mint).toBe(TSLAX);
    expect(rows[0].amountRaw).toBe("125000000");
    expect(rows[0].multiplier).toBe(1.25);
    const asked = (rpc.getMultipleParsedAccounts.mock.calls[0][0] as PublicKey[]).map((k) => k.toBase58());
    expect(asked).toEqual([TSLAX]);
  });

  it("returns [] for an empty mint set without touching the RPC", async () => {
    const adapter = makeAdapter(rpc);
    expect(await adapter.getTokenBalances(OWNER, new Set())).toEqual([]);
    expect(rpc.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it("returns [] when the owner holds nothing", async () => {
    rpc.getParsedTokenAccountsByOwner.mockResolvedValue({ context: { slot: 1 }, value: [] });
    const adapter = makeAdapter(rpc);
    expect(await adapter.getTokenBalances(OWNER)).toEqual([]);
    expect(rpc.getMultipleParsedAccounts).not.toHaveBeenCalled();
  });

  it("rejects an invalid owner address before any RPC call", async () => {
    const adapter = makeAdapter(rpc);
    await expect(adapter.getTokenBalances("not-a-pubkey")).rejects.toMatchObject({
      name: "SolanaAdapterError",
      kind: "invalid_input",
    });
    expect(rpc.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it("skips accounts the RPC could not jsonParse instead of failing the whole read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.getParsedTokenAccountsByOwner.mockImplementation(async (_o: PublicKey, filter: { programId: PublicKey }) => {
      if (filter.programId.equals(TOKEN_2022_PROGRAM_ID)) {
        return {
          context: { slot: 1 },
          value: [
            { pubkey: new PublicKey(ACC.tslaA), account: { ...T22_ACCOUNTS[0].account, data: Buffer.alloc(165) } },
            T22_ACCOUNTS[3],
          ],
        };
      }
      return { context: { slot: 1 }, value: [] };
    });
    const adapter = makeAdapter(rpc);
    const rows = await adapter.getTokenBalances(OWNER);
    expect(rows.map((r) => r.mint)).toEqual([METAX]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Multipliers
// ---------------------------------------------------------------------------

describe("getMintMultiplier", () => {
  it("reads scaledUiAmountConfig from Token-2022 mints and returns null for SPL / missing mints", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.25);
    expect(await adapter.getMintMultiplier(METAX)).toBe(1);
    expect(await adapter.getMintMultiplier(USDC)).toBeNull();
    expect(await adapter.getMintMultiplier(Keypair.generate().publicKey.toBase58())).toBeNull(); // no account
    expect(await adapter.getMintMultiplier("garbage")).toBeNull();
    expect(await adapter.getMintMultiplier("")).toBeNull();
  });

  it("switches to newMultiplier once its effective timestamp has passed, using the cached config", async () => {
    const rpc = fakeRpc();
    let nowMs = NOW_MS;
    const adapter = makeAdapter(rpc, { now: () => nowMs, multiplierTtlMs: 2 * 60 * 60 * 1000 });

    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.25);
    nowMs = ACTIVATION_SEC * 1000; // exactly at activation -> effective
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.5);
    nowMs = ACTIVATION_SEC * 1000 + 60_000;
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.5);
    // Only one RPC round-trip: the config is cached and the effective value computed per read.
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);
  });

  it("caches per mint for 10 minutes and refetches afterwards", async () => {
    const rpc = fakeRpc();
    let nowMs = NOW_MS;
    const adapter = makeAdapter(rpc, { now: () => nowMs });

    await adapter.getMintMultiplier(TSLAX);
    await adapter.getMintMultiplier(TSLAX);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);

    nowMs = NOW_MS + 10 * 60 * 1000 - 1;
    await adapter.getMintMultiplier(TSLAX);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);

    nowMs = NOW_MS + 10 * 60 * 1000 + 1;
    await adapter.getMintMultiplier(TSLAX);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(2);

    adapter.clearMultiplierCache();
    await adapter.getMintMultiplier(TSLAX);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(3);
  });

  it("batches uncached mints in chunks of 100 and dedupes", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);
    const many = Array.from({ length: 230 }, () => Keypair.generate().publicKey.toBase58());
    const result = await adapter.getMintMultipliers([...many, TSLAX, ...many.slice(0, 5), TSLAX]);

    expect(result.size).toBe(231);
    expect(result.get(TSLAX)).toBe(1.25);
    for (const m of many) expect(result.get(m)).toBeNull();
    const sizes = rpc.getMultipleParsedAccounts.mock.calls.map((c) => (c[0] as PublicKey[]).length);
    expect(sizes).toEqual([100, 100, 31]);
    expect(rpc.getMultipleParsedAccounts.mock.calls[0][1]).toEqual({ commitment: "confirmed" });

    // Second call: everything is cached, no RPC.
    await adapter.getMintMultipliers([TSLAX, many[0]]);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(3);
  });

  it("falls back to decoding raw Token-2022 mint bytes when the RPC does not jsonParse", async () => {
    const base = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: PublicKey.default,
        supply: BigInt(0),
        decimals: 8,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      base,
    );
    const tlvHeader = Buffer.alloc(4);
    tlvHeader.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 0);
    tlvHeader.writeUInt16LE(SCALED_UI_AMOUNT_CONFIG_SIZE, 2);
    const body = Buffer.alloc(SCALED_UI_AMOUNT_CONFIG_SIZE);
    ScaledUiAmountConfigLayout.encode(
      {
        authority: PublicKey.default,
        multiplier: 1.25,
        newMultiplierEffectiveTimestamp: BigInt(ACTIVATION_SEC),
        newMultiplier: 1.5,
      },
      body,
    );
    const data = Buffer.concat([base, Buffer.alloc(ACCOUNT_SIZE - MINT_SIZE), Buffer.from([AccountType.Mint]), tlvHeader, body]);
    const raw: AccountInfo<Buffer> = { executable: false, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, data };

    const rpc = fakeRpc({ [TSLAX]: raw });
    let nowMs = NOW_MS;
    const adapter = makeAdapter(rpc, { now: () => nowMs });
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.25);
    nowMs = ACTIVATION_SEC * 1000;
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.5);
  });

  it("assumes 1 (with a warning) when the extension is present but unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = parsedMint(TOKEN_2022_PROGRAM_ID, 8, [{ extension: "scaledUiAmountConfig", state: { multiplier: "abc" } }]);
    const adapter = makeAdapter(fakeRpc({ [TSLAX]: broken }));
    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Block times
// ---------------------------------------------------------------------------

describe("getBlockTime", () => {
  it("returns the block's production time as a Date and caches it for good", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);

    const first = await adapter.getBlockTime(SLOT_A);
    expect(first).toBeInstanceOf(Date);
    expect(first!.getTime()).toBe((NOW_SEC - 90) * 1000);
    expect(rpc.getBlockTime).toHaveBeenCalledWith(SLOT_A);

    // Same slot again, much later: block times never change, so no second RPC call.
    const second = await adapter.getBlockTime(SLOT_A);
    expect(second).toEqual(first);
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(1);

    // A different slot is its own lookup.
    expect((await adapter.getBlockTime(SLOT_B))!.getTime()).toBe((NOW_SEC - 60) * 1000);
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(2);

    adapter.clearBlockTimeCache();
    await adapter.getBlockTime(SLOT_A);
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(3);
  });

  it("returns null (uncached) when the RPC has no time for the slot", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);
    expect(await adapter.getBlockTime(SLOT_MISSING)).toBeNull();
    expect(await adapter.getBlockTime(SLOT_MISSING)).toBeNull();
    // "Not available" may be transient (node lag), so it is asked again rather than pinned.
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid slots without an RPC call", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);
    expect(await adapter.getBlockTime(-1)).toBeNull();
    expect(await adapter.getBlockTime(1.5)).toBeNull();
    expect(await adapter.getBlockTime(Number.NaN)).toBeNull();
    expect(await adapter.getBlockTime("372795734" as unknown as number)).toBeNull();
    expect(rpc.getBlockTime).not.toHaveBeenCalled();
  });

  it("never throws: a persistent RPC failure is retried, warned about and becomes null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    rpc.getBlockTime.mockRejectedValue(new Error("502 Bad Gateway"));
    const adapter = makeAdapter(rpc);
    expect(await adapter.getBlockTime(SLOT_A)).toBeNull();
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(3); // default attempts
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(`getBlockTime(${SLOT_A})`);
    warn.mockRestore();
  });

  it("does not retry a skipped-slot error and recovers after a transient failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    const skipped = Object.assign(new Error("Slot 372795734 was skipped, or missing in long-term storage"), { code: -32009 });
    rpc.getBlockTime.mockRejectedValueOnce(skipped);
    const adapter = makeAdapter(rpc);
    expect(await adapter.getBlockTime(SLOT_A)).toBeNull();
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(1);

    // Failure was not cached: the next call goes to the RPC and succeeds.
    expect((await adapter.getBlockTime(SLOT_A))!.getTime()).toBe((NOW_SEC - 90) * 1000);
    expect(rpc.getBlockTime).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("times out a hung getBlockTime call and returns null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    rpc.getBlockTime.mockImplementation(() => new Promise(() => {}));
    const adapter = makeAdapter(rpc, { timeoutMs: 20, attempts: 1 });
    expect(await adapter.getBlockTime(SLOT_A)).toBeNull();
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Estimated slot times (one getSlot anchor, arithmetic per slot)
// ---------------------------------------------------------------------------

describe("estimateSlotTime", () => {
  it("estimates from one getSlot anchor: anchor time minus SLOT_MS per slot behind it", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);

    expect(adapter.slotAnchor()).toBeNull();
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toEqual(new Date(NOW_MS));
    expect(await adapter.estimateSlotTime(CURRENT_SLOT - 10)).toEqual(new Date(NOW_MS - 10 * SLOT_MS));
    expect(await adapter.estimateSlotTime(CURRENT_SLOT - 150)).toEqual(new Date(NOW_MS - 60_000));
    expect(await adapter.estimateSlotTime(SLOT_A)).toEqual(new Date(NOW_MS - (CURRENT_SLOT - SLOT_A) * SLOT_MS));

    // Arithmetic only: one getSlot for four different slots, nothing cached per slot, no getBlockTime.
    expect(SLOT_MS).toBe(400);
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);
    expect(rpc.getSlot).toHaveBeenCalledWith("confirmed");
    expect(rpc.getBlockTime).not.toHaveBeenCalled();
    expect(adapter.slotAnchor()).toEqual({ slot: CURRENT_SLOT, at: NOW_MS });
  });

  it("shares one in-flight getSlot between concurrent callers and reuses the anchor for 60 s", async () => {
    let nowMs = NOW_MS;
    const rpc = fakeRpc();
    let release: ((slot: number) => void) | undefined;
    rpc.getSlot.mockImplementationOnce(() => new Promise<number>((resolve) => (release = resolve)));
    const adapter = makeAdapter(rpc, { now: () => nowMs });

    // Twelve callers (one per distinct Jupiter slot) arrive while the first getSlot is still pending.
    const pending = Promise.all(Array.from({ length: 12 }, (_, i) => adapter.estimateSlotTime(CURRENT_SLOT - i)));
    while (!release) await Promise.resolve();
    release(CURRENT_SLOT);
    const times = await pending;
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);
    times.forEach((t, i) => expect(t).toEqual(new Date(NOW_MS - i * SLOT_MS)));

    // Inside the TTL the anchor is reused as-is.
    nowMs = NOW_MS + SLOT_ANCHOR_TTL_MS - 1;
    expect(await adapter.estimateSlotTime(CURRENT_SLOT - 5)).toEqual(new Date(NOW_MS - 5 * SLOT_MS));
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);

    // At the TTL it is refreshed with ONE new getSlot and estimates re-anchor on the new observation.
    nowMs = NOW_MS + SLOT_ANCHOR_TTL_MS;
    rpc.getSlot.mockResolvedValueOnce(CURRENT_SLOT + 150);
    expect(await adapter.estimateSlotTime(CURRENT_SLOT + 150)).toEqual(new Date(nowMs));
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toEqual(new Date(nowMs - 150 * SLOT_MS));
    expect(rpc.getSlot).toHaveBeenCalledTimes(2);
    expect(adapter.slotAnchor()).toEqual({ slot: CURRENT_SLOT + 150, at: nowMs });

    adapter.clearSlotAnchor();
    expect(adapter.slotAnchor()).toBeNull();
    await adapter.estimateSlotTime(CURRENT_SLOT);
    expect(rpc.getSlot).toHaveBeenCalledTimes(3);
  });

  it("never returns a time in the future: slots beyond the anchor extrapolate but clamp to now", async () => {
    let nowMs = NOW_MS;
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc, { now: () => nowMs });
    await adapter.estimateSlotTime(CURRENT_SLOT); // anchor at NOW_MS

    nowMs = NOW_MS + 10_000;
    // 10 slots past the anchor = 4 s after it: inside the elapsed 10 s, so plain arithmetic.
    expect(await adapter.estimateSlotTime(CURRENT_SLOT + 10)).toEqual(new Date(NOW_MS + 4_000));
    // 100 slots past the anchor would be 40 s after it, but only 10 s have passed: clamp to now.
    expect(await adapter.estimateSlotTime(CURRENT_SLOT + 100)).toEqual(new Date(NOW_MS + 10_000));
    expect(await adapter.estimateSlotTime(CURRENT_SLOT + 1_000_000)).toEqual(new Date(NOW_MS + 10_000));
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);
  });

  it("returns null after ONE failed getSlot (no retries, no backoff) and cools off before asking again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let nowMs = NOW_MS;
    const delays: number[] = [];
    const rpc = fakeRpc();
    rpc.getSlot.mockRejectedValue(new Error("429 Too Many Requests"));
    const adapter = makeAdapter(rpc, {
      now: () => nowMs,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toBeNull();
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]); // no exponential backoff on the anchor path
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("getSlot failed");
    expect(adapter.slotAnchor()).toBeNull();

    // Inside the cool-off the RPC is left alone and the answer stays null.
    nowMs = NOW_MS + SLOT_ANCHOR_RETRY_MS - 1;
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toBeNull();
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);

    // After the cool-off it is asked again and recovers.
    nowMs = NOW_MS + SLOT_ANCHOR_RETRY_MS;
    rpc.getSlot.mockResolvedValue(CURRENT_SLOT);
    expect(await adapter.estimateSlotTime(CURRENT_SLOT - 1)).toEqual(new Date(nowMs - SLOT_MS));
    expect(rpc.getSlot).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("keeps estimating from a recent anchor while getSlot is failing, then gives up once it is too old", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let nowMs = NOW_MS;
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc, { now: () => nowMs });
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toEqual(new Date(NOW_MS));

    rpc.getSlot.mockRejectedValue(new Error("502 Bad Gateway"));
    // Past the TTL: a refresh is attempted and fails, but the 90 s-old anchor is still trustworthy.
    nowMs = NOW_MS + 90_000;
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toEqual(new Date(NOW_MS));
    expect(rpc.getSlot).toHaveBeenCalledTimes(2);
    // Too old to trust the drift: null rather than a guess.
    nowMs = NOW_MS + SLOT_ANCHOR_MAX_AGE_MS;
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toBeNull();
    expect(rpc.getSlot).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("gives up on a hung getSlot after the anchor timeout, ignoring the adapter-wide retry count", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    rpc.getSlot.mockImplementation(() => new Promise(() => {}));
    const adapter = makeAdapter(rpc, { slotAnchorTimeoutMs: 20, attempts: 5, timeoutMs: 60_000 });
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toBeNull();
    expect(rpc.getSlot).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("rejects invalid slots without touching the anchor or the RPC", async () => {
    const rpc = fakeRpc();
    const adapter = makeAdapter(rpc);
    expect(await adapter.estimateSlotTime(-1)).toBeNull();
    expect(await adapter.estimateSlotTime(1.5)).toBeNull();
    expect(await adapter.estimateSlotTime(Number.NaN)).toBeNull();
    expect(await adapter.estimateSlotTime("372795734" as unknown as number)).toBeNull();
    expect(rpc.getSlot).not.toHaveBeenCalled();
  });

  it("treats a junk getSlot answer as a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    rpc.getSlot.mockResolvedValue(Number.NaN);
    const adapter = makeAdapter(rpc);
    expect(await adapter.estimateSlotTime(CURRENT_SLOT)).toBeNull();
    expect(adapter.slotAnchor()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("pure helpers", () => {
  it("effectiveMultiplier follows the on-chain rule", () => {
    const s = { multiplier: 2, newMultiplier: 3, newMultiplierEffectiveTimestamp: 1000 };
    expect(effectiveMultiplier(s, 999)).toBe(2);
    expect(effectiveMultiplier(s, 1000)).toBe(3);
    expect(effectiveMultiplier({ ...s, newMultiplier: null }, 5000)).toBe(2);
    expect(effectiveMultiplier({ ...s, newMultiplierEffectiveTimestamp: null }, 5000)).toBe(2);
  });

  it("parseScaledUiAmountExtension accepts strings and numbers and rejects junk", () => {
    expect(parseScaledUiAmountExtension([TSLAX_SCALED_UI_EXTENSION])).toEqual({
      multiplier: 1.25,
      newMultiplier: 1.5,
      newMultiplierEffectiveTimestamp: ACTIVATION_SEC,
    });
    expect(
      parseScaledUiAmountExtension([{ extension: "scaledUiAmountConfig", state: { multiplier: 1.1, newMultiplier: 1.1, newMultiplierEffectiveTimestamp: 0 } }]),
    ).toEqual({ multiplier: 1.1, newMultiplier: 1.1, newMultiplierEffectiveTimestamp: 0 });
    expect(parseScaledUiAmountExtension(OTHER_T22_EXTENSIONS)).toBeNull();
    expect(parseScaledUiAmountExtension(undefined)).toBeNull();
    expect(parseScaledUiAmountExtension([{ extension: "scaledUiAmountConfig", state: { multiplier: "-1" } }])).toBeNull();
    expect(parseScaledUiAmountExtension([{ extension: "scaledUiAmountConfig", state: { multiplier: "0" } }])).toBeNull();
    expect(parseScaledUiAmountExtension([{ extension: "scaledUiAmountConfig" }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

describe("retries and timeouts", () => {
  it("retries RPC failures with exponential backoff and succeeds", async () => {
    const rpc = fakeRpc();
    const good = rpc.getMultipleParsedAccounts.getMockImplementation()!;
    rpc.getMultipleParsedAccounts
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockImplementationOnce(good);
    const delays: number[] = [];
    const adapter = makeAdapter(rpc, {
      retryBaseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.25);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[0]).toBeLessThan(200);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(delays[1]).toBeLessThan(300);
  });

  it("caps a single backoff sleep at maxRetryDelayMs however large the base or attempt count", async () => {
    const rpc = fakeRpc();
    const good = rpc.getMultipleParsedAccounts.getMockImplementation()!;
    rpc.getMultipleParsedAccounts
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockImplementationOnce(good);
    const delays: number[] = [];
    const adapter = makeAdapter(rpc, {
      attempts: 4,
      retryBaseDelayMs: 5_000,
      maxRetryDelayMs: 150,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(await adapter.getMintMultiplier(TSLAX)).toBe(1.25);
    expect(delays).toEqual([150, 150, 150]); // uncapped this would be 5 s, 10 s, 20 s (+ jitter)
  });

  it("wraps a persistent RPC failure in SolanaAdapterError with context and cause", async () => {
    const rpc = fakeRpc();
    const boom = new Error("ECONNRESET");
    rpc.getParsedTokenAccountsByOwner.mockRejectedValue(boom);
    const adapter = makeAdapter(rpc);

    const err = await adapter.getTokenBalances(OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(SolanaAdapterError);
    expect(err.kind).toBe("rpc");
    expect(err.message).toContain("getParsedTokenAccountsByOwner");
    expect(err.message).toContain(OWNER);
    expect(err.message).toContain("after 3 attempts");
    expect(err.message).toContain("ECONNRESET");
    expect(err.cause).toBe(boom);
    // 3 attempts x 2 programs
    expect(rpc.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(6);
  });

  it("does not retry JSON-RPC invalid-params errors", async () => {
    const rpc = fakeRpc();
    const invalid = Object.assign(new Error("Invalid param: could not find account"), { code: -32602 });
    rpc.getMultipleParsedAccounts.mockRejectedValue(invalid);
    const adapter = makeAdapter(rpc);
    await expect(adapter.getMintMultiplier(TSLAX)).rejects.toBeInstanceOf(SolanaAdapterError);
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);
  });

  it("times out a hung RPC call", async () => {
    const rpc = fakeRpc();
    rpc.getMultipleParsedAccounts.mockImplementation(() => new Promise(() => {}));
    const adapter = makeAdapter(rpc, { timeoutMs: 20, attempts: 2 });
    const err = await adapter.getMintMultiplier(TSLAX).catch((e) => e);
    expect(err).toBeInstanceOf(SolanaAdapterError);
    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("timed out after 20ms");
    expect(rpc.getMultipleParsedAccounts).toHaveBeenCalledTimes(2);
  });

  it("does not build a Connection until the first chain read", async () => {
    // A bogus url must not throw at construction time; it fails on use with a clear error.
    const adapter = createSolanaAdapter("");
    await expect(adapter.getMintMultiplier(TSLAX)).rejects.toMatchObject({ kind: "invalid_input" });
    expect(adapter.isValidAddress(TSLAX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signatures and addresses
// ---------------------------------------------------------------------------

describe("verifyEd25519", () => {
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  const message = new TextEncoder().encode("dulo.fun wants you to sign in with your Solana account:\n" + address);
  const signature = nacl.sign.detached(message, kp.secretKey);

  it("accepts a signature from the matching keypair", () => {
    expect(verifyEd25519(address, message, signature)).toBe(true);
    expect(signature).toHaveLength(64);
  });

  it("rejects a tampered message, a wrong signer and a bad signature", () => {
    const tampered = new Uint8Array(message);
    tampered[0] ^= 1;
    expect(verifyEd25519(address, tampered, signature)).toBe(false);
    expect(verifyEd25519(Keypair.generate().publicKey.toBase58(), message, signature)).toBe(false);
    const badSig = new Uint8Array(signature);
    badSig[10] ^= 0xff;
    expect(verifyEd25519(address, message, badSig)).toBe(false);
    expect(verifyEd25519(address, message, signature.slice(0, 63))).toBe(false);
  });

  it("never throws on malformed input", () => {
    expect(verifyEd25519("not base58 0OIl", message, signature)).toBe(false);
    expect(verifyEd25519("", message, signature)).toBe(false);
    expect(verifyEd25519(bs58.encode(Buffer.alloc(31)), message, signature)).toBe(false);
  });

  it("is exposed on the adapter as verifySignature", () => {
    const adapter = makeAdapter(fakeRpc());
    expect(adapter.verifySignature(address, message, signature)).toBe(true);
  });
});

describe("isValidAddress", () => {
  const adapter = makeAdapter(fakeRpc());

  it("accepts on-curve keys and PDAs", () => {
    expect(adapter.isValidAddress(TSLAX)).toBe(true);
    expect(adapter.isValidAddress(Keypair.generate().publicKey.toBase58())).toBe(true);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("dulo")], TOKEN_PROGRAM_ID);
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    expect(adapter.isValidAddress(pda.toBase58())).toBe(true);
    expect(isValidSolanaAddress("11111111111111111111111111111111")).toBe(true);
  });

  it("rejects malformed strings", () => {
    expect(adapter.isValidAddress("")).toBe(false);
    expect(adapter.isValidAddress("0x0000000000000000000000000000000000000000")).toBe(false);
    expect(adapter.isValidAddress("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzo")).toBe(false);
    expect(adapter.isValidAddress(TSLAX + "B")).toBe(false);
  });

  it("reports the Solana mainnet chain id", () => {
    expect(adapter.chainId).toBe(SOLANA_MAINNET);
  });
});
