import { describe, expect, it } from "vitest";
import { effectiveMultiplier, parseScaledUiAmountExtension, type ScaledUiAmountState } from "@/lib/adapters/solana";
import { normaliseQty, normaliseQtyString } from "@/lib/assets/normalise";
import fixture from "./fixtures/prestocks-jupiter-2026-09-22.json";

/**
 * Token-2022 ScaledUiAmount handling for PreStocks pre-IPO tokens, proven against a recorded
 * Jupiter Price v3 response (tests/fixtures/prestocks-jupiter-2026-09-22.json, fetched once on
 * 22 Sep 2026; nothing here touches the network).
 *
 * What the fixture showed that day:
 *   - all eight mints: decimals 9, stockData.id "prestocks", no Pyth feed;
 *   - SPACEX  PreANxu...: scaledUiConfig { multiplier 1, newMultiplier 5,         effective 2026-06-10T04:30:00Z };
 *   - OPENAI  Prewe...:  scaledUiConfig { multiplier 1, newMultiplier 1.4861347, effective 2026-07-17T16:30:00Z };
 *   - the other six: no scaledUiConfig block at all (multiplier 1 applies).
 *
 * Both effective timestamps are in the past, so on any tick after them the multiplier in force is
 * the NEW one. Reading the static `multiplier` field (1) would under-count a SPACEX balance 5x and
 * an OPENAI balance 1.486x. The adapter (src/lib/adapters/solana.ts effectiveMultiplier) mirrors
 * the on-chain rule `now >= new_multiplier_effective_timestamp`; normaliseQty (src/lib/assets/
 * normalise.ts) then scales raw / 1e9 by that multiplier with string-decimal exactness.
 */

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

interface JupiterScaledUiConfig {
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveAt: string;
  circSupplyPrescaled?: number;
  totalSupplyPrescaled?: number;
  usdPricePrescaled?: number;
}

interface JupiterPriceRow {
  usdPrice: number;
  decimals: number;
  stockData?: { id: string; price: number };
  scaledUiConfig?: JupiterScaledUiConfig;
}

const MINTS = fixture.mints as Record<string, string>;
const RESPONSE = fixture.response as Record<string, JupiterPriceRow>;
const NAMES = Object.keys(MINTS).sort();
const row = (name: string): JupiterPriceRow => RESPONSE[MINTS[name]];

/** A fixed "now" after both activations: Tue 22 Sep 2026 12:00Z (unix 1790078400). */
const NOW_SEC = Math.floor(Date.parse("2026-09-22T12:00:00.000Z") / 1000);
const PRESTOCKS_DECIMALS = 9;

/** Jupiter reports the activation as ISO; the chain (and the adapter) use unix seconds. */
const toUnixSeconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** The adapter's state for a Jupiter scaledUiConfig block, in the shape getScaledUiAmountConfig yields. */
function stateOf(cfg: JupiterScaledUiConfig): ScaledUiAmountState {
  return { multiplier: cfg.multiplier, newMultiplier: cfg.newMultiplier, newMultiplierEffectiveTimestamp: toUnixSeconds(cfg.newMultiplierEffectiveAt) };
}

/** The same block as a jsonParsed mint would report it (data.parsed.info.extensions), which the adapter parses. */
function jsonParsedExtensions(cfg: JupiterScaledUiConfig): unknown[] {
  return [
    { extension: "metadataPointer", state: { authority: null, metadataAddress: null } },
    {
      extension: "scaledUiAmountConfig",
      state: {
        authority: "PreStocksAuthority111111111111111111111111111",
        multiplier: cfg.multiplier,
        newMultiplier: cfg.newMultiplier,
        newMultiplierEffectiveTimestamp: toUnixSeconds(cfg.newMultiplierEffectiveAt),
      },
    },
  ];
}

describe("the recorded Jupiter response", () => {
  it("was fetched once on 22 Sep 2026 and covers the eight PreStocks mints, all 9 decimals, all tagged prestocks", () => {
    expect(fixture.fetchedAt).toBe("2026-09-22T09:18:45Z");
    expect(fixture.source.startsWith("https://api.jup.ag/price/v3?ids=")).toBe(true);
    expect(NAMES).toEqual(["ANDURIL", "ANTHROPIC", "FIGUREAI", "KALSHI", "NEURALINK", "OPENAI", "POLYMARKET", "SPACEX"]);
    for (const name of NAMES) {
      const mint = MINTS[name];
      expect(mint.startsWith("Pre"), `${name} mint ${mint} starts with "Pre"`).toBe(true);
      const r = row(name);
      expect(r, `${name} is in the response`).toBeDefined();
      expect(r.decimals, `${name} decimals`).toBe(PRESTOCKS_DECIMALS);
      expect(r.stockData?.id, `${name} stockData.id`).toBe("prestocks");
      expect(r.usdPrice).toBeGreaterThan(0);
    }
    expect(Object.keys(RESPONSE)).toHaveLength(8);
  });

  it("carries a scaledUiConfig block for SPACEX and OPENAI only, each with a pending multiplier that is already effective", () => {
    const withBlock = NAMES.filter((n) => row(n).scaledUiConfig !== undefined);
    expect(withBlock).toEqual(["OPENAI", "SPACEX"]);

    const spacex = row("SPACEX").scaledUiConfig!;
    expect(spacex).toMatchObject({ multiplier: 1, newMultiplier: 5, newMultiplierEffectiveAt: "2026-06-10T04:30:00Z" });
    const openai = row("OPENAI").scaledUiConfig!;
    expect(openai).toMatchObject({ multiplier: 1, newMultiplier: 1.4861347, newMultiplierEffectiveAt: "2026-07-17T16:30:00Z" });

    for (const name of withBlock) {
      const cfg = row(name).scaledUiConfig!;
      expect(toUnixSeconds(cfg.newMultiplierEffectiveAt), `${name} activation is before NOW`).toBeLessThan(NOW_SEC);
      expect(cfg.newMultiplier, `${name} newMultiplier differs from the static field`).not.toBe(cfg.multiplier);
    }
    expect(toUnixSeconds(spacex.newMultiplierEffectiveAt)).toBe(1781065800);
    expect(toUnixSeconds(openai.newMultiplierEffectiveAt)).toBe(1784305800);
  });

  it("shows the issuer mark and the DEX price as two different numbers for every mint", () => {
    // stockData.price is the issuer SPV mark; usdPrice is the Meteora pool price. They are shown as
    // two things, never as a discount, and this pins that they are not interchangeable.
    for (const name of NAMES) {
      const r = row(name);
      expect(r.stockData?.price, `${name} mark`).toBeGreaterThan(0);
      expect(r.stockData?.price, `${name} mark differs from DEX price`).not.toBe(r.usdPrice);
    }
    expect(row("SPACEX").stockData?.price).toBeCloseTo(152.7419, 3);
    expect(row("SPACEX").usdPrice).toBeCloseTo(117.8315, 3);
  });
});

// ---------------------------------------------------------------------------
// Effective multiplier (src/lib/adapters/solana.ts)
// ---------------------------------------------------------------------------

describe("effectiveMultiplier on the recorded blocks", () => {
  it("SPACEX: 5, not the static 1, on 22 Sep 2026 (activation 10 Jun 2026 04:30Z)", () => {
    const state = stateOf(row("SPACEX").scaledUiConfig!);
    expect(effectiveMultiplier(state, NOW_SEC), "SPACEX effective multiplier is newMultiplier 5").toBe(5);
    expect(effectiveMultiplier(state, NOW_SEC), "SPACEX must not read the static multiplier 1").not.toBe(state.multiplier);
  });

  it("OPENAI: 1.4861347, not the static 1, on 22 Sep 2026 (activation 17 Jul 2026 16:30Z)", () => {
    const state = stateOf(row("OPENAI").scaledUiConfig!);
    expect(effectiveMultiplier(state, NOW_SEC), "OPENAI effective multiplier is newMultiplier 1.4861347").toBe(1.4861347);
    expect(effectiveMultiplier(state, NOW_SEC), "OPENAI must not read the static multiplier 1").not.toBe(1);
  });

  it("switches exactly at the activation second (before: static; at and after: new)", () => {
    for (const name of ["SPACEX", "OPENAI"]) {
      const cfg = row(name).scaledUiConfig!;
      const state = stateOf(cfg);
      const ts = toUnixSeconds(cfg.newMultiplierEffectiveAt);
      expect(effectiveMultiplier(state, ts - 1), `${name} one second before activation`).toBe(cfg.multiplier);
      expect(effectiveMultiplier(state, ts), `${name} at the activation second`).toBe(cfg.newMultiplier);
      expect(effectiveMultiplier(state, ts + 1), `${name} one second after activation`).toBe(cfg.newMultiplier);
      expect(effectiveMultiplier(state, NOW_SEC), `${name} now`).toBe(cfg.newMultiplier);
    }
  });

  it("the same answer when the block arrives as a jsonParsed mint extension, the way the RPC reports it", () => {
    for (const name of ["SPACEX", "OPENAI"]) {
      const cfg = row(name).scaledUiConfig!;
      const parsed = parseScaledUiAmountExtension(jsonParsedExtensions(cfg));
      expect(parsed, `${name} extension parses`).toEqual(stateOf(cfg));
      expect(effectiveMultiplier(parsed!, NOW_SEC), `${name} via parseScaledUiAmountExtension`).toBe(cfg.newMultiplier);
    }
  });

  it("the six mints without a block have no extension state, so the adapter falls back to multiplier 1", () => {
    // getTokenBalances: `row.multiplier = multipliers.get(row.mint) ?? 1`; a mint without the
    // extension yields null from the parser and therefore 1.
    const plain = NAMES.filter((n) => row(n).scaledUiConfig === undefined);
    expect(plain).toEqual(["ANDURIL", "ANTHROPIC", "FIGUREAI", "KALSHI", "NEURALINK", "POLYMARKET"]);
    expect(parseScaledUiAmountExtension([{ extension: "metadataPointer", state: {} }])).toBeNull();
    expect(parseScaledUiAmountExtension([])).toBeNull();
    for (const name of plain) expect(normaliseQty("1000000000", PRESTOCKS_DECIMALS, 1), `${name} 1e9 base units = 1 token`).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Quantity normalisation (src/lib/assets/normalise.ts)
// ---------------------------------------------------------------------------

describe("normaliseQty with the effective multiplier", () => {
  const spacexMultiplier = effectiveMultiplier(stateOf(row("SPACEX").scaledUiConfig!), NOW_SEC);
  const openaiMultiplier = effectiveMultiplier(stateOf(row("OPENAI").scaledUiConfig!), NOW_SEC);

  it("SPACEX: raw / 1e9 * 5, exact as a decimal string", () => {
    expect(spacexMultiplier).toBe(5);
    expect(normaliseQtyString("1000000000", 9, spacexMultiplier), "1 pre-scaled unit is 5 tokens").toBe("5");
    expect(normaliseQty("1000000000", 9, spacexMultiplier)).toBe(5);
    expect(normaliseQtyString("123456789", 9, spacexMultiplier), "0.123456789 * 5").toBe("0.617283945");
    expect(normaliseQty("123456789", 9, spacexMultiplier)).toBe(0.617283945);
    // The whole recorded pre-scaled supply (8742.506666474 tokens in base units) scales to 43,712.53333237.
    expect(normaliseQtyString("8742506666474", 9, spacexMultiplier)).toBe("43712.53333237");
    expect(normaliseQty("8742506666474", 9, spacexMultiplier)).toBe(43712.53333237);
    // With the static field the same balance would read 5x too small.
    expect(normaliseQty("1000000000", 9, row("SPACEX").scaledUiConfig!.multiplier)).toBe(1);
  });

  it("OPENAI: raw / 1e9 * 1.4861347, exact to the last digit", () => {
    expect(openaiMultiplier).toBe(1.4861347);
    expect(normaliseQtyString("1000000000", 9, openaiMultiplier), "1 pre-scaled unit is 1.4861347 tokens").toBe("1.4861347");
    expect(normaliseQty("1000000000", 9, openaiMultiplier)).toBe(1.4861347);
    expect(normaliseQtyString("123456789", 9, openaiMultiplier)).toBe("0.1834734180834783");
    // The recorded pre-scaled supply (1901.858204773) scales to 2826.4174725928609231: 16 fractional
    // digits, kept exactly by the BigInt path and only rounded once, at the final Number().
    expect(normaliseQtyString("1901858204773", 9, openaiMultiplier)).toBe("2826.4174725928609231");
    expect(normaliseQty("1901858204773", 9, openaiMultiplier)).toBe(Number("2826.4174725928609231"));
    expect(normaliseQty("1000000000", 9, row("OPENAI").scaledUiConfig!.multiplier)).toBe(1);
  });

  it("a scaled quantity times the DEX price equals the pre-scaled quantity times Jupiter's pre-scaled price", () => {
    // usdPricePrescaled / newMultiplier == usdPrice, so qty (post-multiplier) x usdPrice is the right
    // USD value and nothing is counted twice: SPACEX 589.157539176846 / 5 = 117.8315078353692,
    // OPENAI 1708.9029534530687 / 1.4861347 = 1149.8977538530448.
    for (const name of ["SPACEX", "OPENAI"]) {
      const r = row(name);
      const cfg = r.scaledUiConfig!;
      const multiplier = effectiveMultiplier(stateOf(cfg), NOW_SEC);
      expect(cfg.usdPricePrescaled! / multiplier, `${name} pre-scaled price / multiplier = DEX price`).toBeCloseTo(r.usdPrice, 9);
      const qty = normaliseQty("1000000000", 9, multiplier);
      expect(qty * r.usdPrice, `${name} 1 pre-scaled unit is worth usdPricePrescaled`).toBeCloseTo(cfg.usdPricePrescaled!, 6);
    }
    expect(row("SPACEX").scaledUiConfig!.usdPricePrescaled).toBeCloseTo(589.157539176846, 9);
    expect(row("OPENAI").scaledUiConfig!.usdPricePrescaled).toBeCloseTo(1708.9029534530687, 9);
  });
});
