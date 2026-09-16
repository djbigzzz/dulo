/**
 * Exact quantity normalisation for token balances.
 *
 *   qty = raw / 10^decimals * multiplier
 *
 * All arithmetic is done in BigInt on an exact decimal expansion of the
 * multiplier, so huge raw balances are never pushed through floating-point
 * division before scaling. The final Number is produced by parsing the exact
 * decimal string, which yields the correctly rounded nearest double.
 *
 * Client-safe: no server imports.
 */

const RAW_RE = /^\d+$/;
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

/** Largest number of decimals we accept. Token-2022 allows up to 255 but nothing real uses more than ~18. */
export const MAX_DECIMALS = 36;

const ZERO = BigInt(0);
const TEN = BigInt(10);

/** 10^n as a BigInt. */
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`pow10 exponent must be a non-negative integer, got ${n}`);
  let out = BigInt(1);
  for (let i = 0; i < n; i += 1) out *= TEN;
  return out;
}

/**
 * Exact decimal parts of a finite, non-negative JS number: value = mantissa / 10^scale.
 * Uses the shortest round-trip representation (String(n)), so 1.0000001 -> { 10000001, 7 },
 * 1.5 -> { 15, 1 }, 2 -> { 2, 0 }, 1e-7 -> { 1, 7 }.
 */
export function decimalParts(x: number): { mantissa: bigint; scale: number } {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new RangeError(`multiplier must be a finite number, got ${String(x)}`);
  if (x < 0) throw new RangeError(`multiplier must be non-negative, got ${x}`);
  const m = DECIMAL_RE.exec(String(x));
  if (!m) throw new RangeError(`cannot parse number ${String(x)} as a decimal`);
  const intPart = m[1];
  const frac = m[2] ?? "";
  const exp = m[3] ? parseInt(m[3], 10) : 0;
  let digits = intPart + frac;
  let scale = frac.length - exp;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  return { mantissa: BigInt(digits), scale };
}

/** Parse a raw base-unit amount. Accepts a decimal digit string, a BigInt, or a safe non-negative integer. */
export function parseRawAmount(amountRaw: string | bigint | number): bigint {
  if (typeof amountRaw === "bigint") {
    if (amountRaw < ZERO) throw new RangeError(`raw amount must be non-negative, got ${amountRaw}`);
    return amountRaw;
  }
  if (typeof amountRaw === "number") {
    if (!Number.isSafeInteger(amountRaw) || amountRaw < 0) {
      throw new RangeError(`raw amount as a number must be a safe non-negative integer, got ${amountRaw}`);
    }
    return BigInt(amountRaw);
  }
  const s = typeof amountRaw === "string" ? amountRaw.trim() : "";
  if (!RAW_RE.test(s)) throw new RangeError(`raw amount must be a decimal digit string, got ${JSON.stringify(amountRaw)}`);
  return BigInt(s);
}

/** Render mantissa / 10^scale as a plain decimal string with no trailing zeros ("0" for zero). */
export function formatScaled(mantissa: bigint, scale: number): string {
  if (mantissa === ZERO) return "0";
  const neg = mantissa < ZERO;
  const s = (neg ? -mantissa : mantissa).toString();
  if (scale === 0) return (neg ? "-" : "") + s;
  const padded = s.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const frac = padded.slice(padded.length - scale).replace(/0+$/, "");
  return (neg ? "-" : "") + (frac ? `${intPart}.${frac}` : intPart);
}

/**
 * Exact decimal string of raw / 10^decimals * multiplier.
 *   normaliseQtyString("12345678900", 8, 1)   -> "123.456789"
 *   normaliseQtyString("12345678900", 8, 1.5) -> "185.1851835"
 */
export function normaliseQtyString(amountRaw: string | bigint | number, decimals: number, multiplier: number): string {
  const raw = parseRawAmount(amountRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer in [0, ${MAX_DECIMALS}], got ${decimals}`);
  }
  const { mantissa, scale } = decimalParts(multiplier);
  return formatScaled(raw * mantissa, decimals + scale);
}

/**
 * Human quantity = raw / 10^decimals * multiplier, as the nearest double to the exact value.
 * Throws RangeError on malformed input (non-digit raw, negative/NaN multiplier, bad decimals).
 */
export function normaliseQty(amountRaw: string | bigint | number, decimals: number, multiplier: number): number {
  return Number(normaliseQtyString(amountRaw, decimals, multiplier));
}
