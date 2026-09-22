import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOLANA_MAINNET, type AssetId, type AssetInfo } from "@/lib/core";
import type { MintInfo } from "@/lib/adapters/solana";
import {
  CORPORATE_ACTIONS_TTL_MS,
  configureCorporateActions,
  corporateActionFor,
  issuerSourceForPartner,
  listCorporateActions,
  resetCorporateActions,
} from "@/lib/corporate-actions";

/**
 * lib/corporate-actions: the server-side view model of pending and past ScaledUiAmount changes
 * per issuer, read through the ChainAdapter in one batched mint read and cached for 10 minutes.
 * The adapter and the asset list are injected; nothing here touches an RPC or an issuer API.
 *
 * Live facts (22 Sep 2026): SPACEX 1 -> 5 effective 2026-06-10T04:30:00Z (a split), OPENAI
 * 1 -> 1.4861347 effective 2026-07-17T16:30:00Z (an adjustment). A corporate action changes the
 * number of tokens shown, not the holder's value; the view model carries no price.
 */

const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const ANDURIL_MINT = "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

const SPACEX_EFFECTIVE = 1781065800; // 2026-06-10T04:30:00Z
const OPENAI_EFFECTIVE = 1784305800; // 2026-07-17T16:30:00Z

/** 22 Sep 2026 12:00Z, in ms. */
const NOW_MS = Date.UTC(2026, 8, 22, 12, 0, 0);

function asset(mint: string, symbol: string, decimals: number): AssetInfo {
  return {
    assetId: `${SOLANA_MAINNET}/token:${mint}` as AssetId,
    chainId: SOLANA_MAINNET,
    symbol,
    underlying: symbol,
    name: symbol,
    decimals,
    sector: null,
    logoUrl: null,
    pythFeedId: null,
    multiplier: 1,
  };
}

const ASSETS = [
  { info: asset(TSLAX_MINT, "TSLAx", 8), source: "xstocks" },
  { info: asset(SPACEX_MINT, "SPACEX", 9), source: "prestocks" },
  { info: asset(OPENAI_MINT, "OPENAI", 9), source: "prestocks" },
  { info: asset(ANDURIL_MINT, "ANDURIL", 9), source: "prestocks" },
];

function t22(mint: string, multiplier: number, newMultiplier: number | null, ts: number | null): MintInfo {
  return { mint, program: "token-2022", scaledUi: { multiplier, newMultiplier, newMultiplierEffectiveTimestamp: ts } };
}

/** The live states on 22 Sep 2026: SPACEX split, OPENAI adjustment, everything else unchanged. */
const LIVE: Record<string, MintInfo> = {
  [SPACEX_MINT]: t22(SPACEX_MINT, 1, 5, SPACEX_EFFECTIVE),
  [OPENAI_MINT]: t22(OPENAI_MINT, 1, 1.4861347, OPENAI_EFFECTIVE),
  [ANDURIL_MINT]: t22(ANDURIL_MINT, 1, 1, 0),
  [TSLAX_MINT]: t22(TSLAX_MINT, 1, null, null),
};

const getMintInfos = vi.fn<(mints: Iterable<string>) => Promise<Map<string, MintInfo>>>();
const listAssets = vi.fn<() => Promise<typeof ASSETS>>();
let nowMs = NOW_MS;

function statesFrom(table: Record<string, MintInfo>) {
  return async (mints: Iterable<string>) => {
    const out = new Map<string, MintInfo>();
    for (const m of mints) out.set(m, table[m] ?? { mint: m, program: null, scaledUi: null });
    return out;
  };
}

beforeEach(() => {
  resetCorporateActions();
  nowMs = NOW_MS;
  getMintInfos.mockReset();
  listAssets.mockReset();
  getMintInfos.mockImplementation(statesFrom(LIVE));
  listAssets.mockResolvedValue(ASSETS);
  configureCorporateActions({ adapter: { getMintInfos }, listAssets, now: () => nowMs });
});

describe("corporateActionFor (pure)", () => {
  const nowSeconds = Math.floor(NOW_MS / 1000);

  it("SPACEX 1 -> 5 with a past effective time is an effective split", () => {
    expect(corporateActionFor(ASSETS[1].info, "prestocks", LIVE[SPACEX_MINT].scaledUi!, nowSeconds)).toEqual({
      assetId: ASSETS[1].info.assetId,
      symbol: "SPACEX",
      source: "prestocks",
      kind: "split",
      multiplierBefore: 1,
      multiplierAfter: 5,
      ratio: 5,
      effectiveAt: "2026-06-10T04:30:00.000Z",
      effective: true,
    });
  });

  it("OPENAI 1 -> 1.4861347 is an adjustment, not a split", () => {
    expect(corporateActionFor(ASSETS[2].info, "prestocks", LIVE[OPENAI_MINT].scaledUi!, nowSeconds)).toMatchObject({
      symbol: "OPENAI",
      kind: "adjustment",
      multiplierBefore: 1,
      multiplierAfter: 1.4861347,
      ratio: 1.4861347,
      effectiveAt: "2026-07-17T16:30:00.000Z",
      effective: true,
    });
  });

  it("a future effective time is a pending action (effective: false); a 2x with an integer ratio is a split", () => {
    const future = nowSeconds + 3600;
    const res = corporateActionFor(ASSETS[1].info, "prestocks", { multiplier: 1, newMultiplier: 2, newMultiplierEffectiveTimestamp: future }, nowSeconds);
    expect(res).toMatchObject({ kind: "split", ratio: 2, effective: false, effectiveAt: new Date(future * 1000).toISOString() });
    // A reverse split (ratio below 1) is an adjustment.
    const reverse = corporateActionFor(ASSETS[1].info, "prestocks", { multiplier: 4, newMultiplier: 2, newMultiplierEffectiveTimestamp: future }, nowSeconds);
    expect(reverse).toMatchObject({ kind: "adjustment", ratio: 0.5, effective: false });
  });

  it("is null when nothing changes: no newMultiplier, or the same value", () => {
    expect(corporateActionFor(ASSETS[0].info, "xstocks", LIVE[TSLAX_MINT].scaledUi!, nowSeconds)).toBeNull();
    expect(corporateActionFor(ASSETS[3].info, "prestocks", LIVE[ANDURIL_MINT].scaledUi!, nowSeconds)).toBeNull();
    expect(corporateActionFor(ASSETS[3].info, "prestocks", null, nowSeconds)).toBeNull();
  });
});

describe("listCorporateActions", () => {
  it("returns one entry per mint whose newMultiplier differs, in one batched mint read, filtered by source", async () => {
    const all = await listCorporateActions();
    expect(all.map((a) => [a.symbol, a.kind, a.ratio, a.effective])).toEqual([
      ["OPENAI", "adjustment", 1.4861347, true],
      ["SPACEX", "split", 5, true],
    ]);
    expect(getMintInfos).toHaveBeenCalledTimes(1);
    expect([...getMintInfos.mock.calls[0][0]].sort()).toEqual([TSLAX_MINT, SPACEX_MINT, OPENAI_MINT, ANDURIL_MINT].sort());

    expect((await listCorporateActions("prestocks")).map((a) => a.symbol)).toEqual(["OPENAI", "SPACEX"]);
    expect(await listCorporateActions("xstocks")).toEqual([]);
    expect(await listCorporateActions("nope")).toEqual([]);
    // Every mint without a change (ANDURIL, TSLAx) is absent.
    expect(all.some((a) => a.symbol === "ANDURIL" || a.symbol === "TSLAx")).toBe(false);
    // Serialisable as API JSON.
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
  });

  it("caches the list for 10 minutes and reads again after", async () => {
    await listCorporateActions();
    await listCorporateActions("prestocks");
    expect(getMintInfos).toHaveBeenCalledTimes(1);
    expect(listAssets).toHaveBeenCalledTimes(1);

    nowMs += CORPORATE_ACTIONS_TTL_MS - 1;
    await listCorporateActions();
    expect(getMintInfos).toHaveBeenCalledTimes(1);

    nowMs += 2;
    await listCorporateActions();
    expect(getMintInfos).toHaveBeenCalledTimes(2);
  });

  it("a pending action becomes effective once its time passes and the cache expires", async () => {
    const soon = Math.floor(NOW_MS / 1000) + 60;
    getMintInfos.mockImplementation(statesFrom({ ...LIVE, [SPACEX_MINT]: t22(SPACEX_MINT, 1, 5, soon) }));
    const before = await listCorporateActions("prestocks");
    expect(before.find((a) => a.symbol === "SPACEX")).toMatchObject({ effective: false, effectiveAt: new Date(soon * 1000).toISOString() });

    nowMs += CORPORATE_ACTIONS_TTL_MS + 1;
    const after = await listCorporateActions("prestocks");
    expect(after.find((a) => a.symbol === "SPACEX")).toMatchObject({ effective: true });
  });

  it("never throws: an adapter failure serves the last good list, or [] when there is none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      getMintInfos.mockRejectedValue(new Error("rpc down"));
      expect(await listCorporateActions()).toEqual([]);
      expect(await listCorporateActions("prestocks")).toEqual([]);

      // A good read, then an outage after the cache expires: the last good list is served.
      getMintInfos.mockImplementation(statesFrom(LIVE));
      nowMs += CORPORATE_ACTIONS_TTL_MS + 1;
      const good = await listCorporateActions("prestocks");
      expect(good).toHaveLength(2);

      getMintInfos.mockRejectedValue(new Error("rpc down again"));
      nowMs += CORPORATE_ACTIONS_TTL_MS + 1;
      expect(await listCorporateActions("prestocks")).toEqual(good);

      // A throwing asset list is the same story.
      listAssets.mockRejectedValue(new Error("issuer api down"));
      nowMs += CORPORATE_ACTIONS_TTL_MS + 1;
      expect(await listCorporateActions("prestocks")).toEqual(good);
    } finally {
      warn.mockRestore();
    }
  });

  it("concurrent callers share one read", async () => {
    let resolve: ((m: Map<string, MintInfo>) => void) | null = null;
    getMintInfos.mockImplementation(() => new Promise((r) => (resolve = r)));
    const a = listCorporateActions("prestocks");
    const b = listCorporateActions();
    // The mint read starts after the asset list resolves: let the microtasks run, then release it.
    await new Promise((r) => setTimeout(r, 0));
    expect(getMintInfos).toHaveBeenCalledTimes(1);
    resolve!(await statesFrom(LIVE)(Object.keys(LIVE)));
    expect((await a).map((x) => x.symbol)).toEqual(["OPENAI", "SPACEX"]);
    expect((await b).map((x) => x.symbol)).toEqual(["OPENAI", "SPACEX"]);
    expect(getMintInfos).toHaveBeenCalledTimes(1);
  });
});

describe("issuerSourceForPartner", () => {
  it("maps the two issuer Partners to their AssetSource names and nothing else", () => {
    expect(issuerSourceForPartner("prestocks")).toBe("prestocks");
    expect(issuerSourceForPartner("xstocks")).toBe("xstocks");
    expect(issuerSourceForPartner("jupiter")).toBeNull();
    expect(issuerSourceForPartner("kamino")).toBeNull();
    expect(issuerSourceForPartner("dulo")).toBeNull();
    expect(issuerSourceForPartner("")).toBeNull();
  });
});
