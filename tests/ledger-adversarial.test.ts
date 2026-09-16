import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_HINT, STARTER_POINTS, summariseLedger } from "@/lib/games/ledger-policy";
import { NO_CASH_VALUE, starterPointsHint } from "@/hooks/session-helpers";

/**
 * Adversarial ledger review (17 Sep 2026), pure part. Each failing case here is a real bug with
 * its fix in the review report; the passing cases pin what the review confirmed.
 *
 * Bug: "Includes 1,000 starter points" is decided on the GRANT (PointsSummary.starterPoints is 0
 * or 1,000 for the whole Season), never on what the balance still holds. After any prediction
 * the balance is below 1,000 (points in open predictions leave it), so the /predictions stat and
 * the /profile tile print a balance of, say, 900 or 0 next to "Includes 1,000 starter points".
 */

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

/** The fixed helper takes the balance as a second argument; the cast keeps tsc green before and after the fix. */
const hint = starterPointsHint as unknown as (starterPoints: number | null | undefined, balance?: number | null) => string;

describe("adversarial ledger review — starter points hint", () => {
  it("the ledger state a first prediction produces: balance below the grant, grant still 1,000", () => {
    const rows = [
      { source: "starter", ref: "starter:season-0", delta: STARTER_POINTS },
      { source: "call", ref: "call:m1:stake:u1:yes", delta: -100 },
    ];
    const s = summariseLedger(rows, new Set(["m1"]));
    expect(s.starterPoints).toBe(1000);
    expect(s.balance).toBe(900);
  });

  it("never says the balance includes 1,000 starter points when the balance is below 1,000", () => {
    expect(hint(STARTER_POINTS, 900)).not.toBe(STARTER_HINT);
    expect(hint(STARTER_POINTS, 0)).toBe(NO_CASH_VALUE);
    expect(hint(STARTER_POINTS, 999)).toBe(NO_CASH_VALUE);
  });

  it("still says it while the balance covers the grant", () => {
    expect(hint(STARTER_POINTS, STARTER_POINTS)).toBe(STARTER_HINT);
    expect(hint(STARTER_POINTS, 1_550)).toBe(STARTER_HINT);
    expect(hint(0, 1_550)).toBe(NO_CASH_VALUE);
  });

  it("/predictions decides the balance hint from the balance it shows, not from the grant alone", () => {
    const src = read("src/app/predictions/page.tsx");
    expect(src).not.toContain("starterPoints > 0 ? STARTER_HINT");
    expect(src).toMatch(/starterPointsHint\(\s*starterPoints\s*,\s*me\.spendablePoints\s*\)/);
  });

  it("/profile passes the balance it shows into the hint", () => {
    const src = read("src/app/profile/page.tsx");
    expect(src).toMatch(/starterPointsHint\(\s*profile\.starterPoints\s*,\s*balance\s*\)/);
  });
});
