import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The "Best Use of PreStocks" track excludes projects that integrate any non-PreStocks pre-IPO
 * token. Tessera's T-Tokens (T-OpenAI, T-Kalshi, T-SpaceX) are exactly that, so a single one of
 * those mints anywhere in the repo forfeits the track — silently, since nothing else would fail.
 *
 * Accidental inclusion is easy rather than far-fetched: Jupiter Price v3 serves all three in the
 * identical shape src/lib/prices/jupiter.ts already parses, tagged stockData.id "tessera" beside
 * PreStocks' "prestocks". A copy-paste during a registry refactor is all it would take.
 *
 * Naming the tracks in prose is not integrating, so docs may discuss Tessera; only the mints are
 * banned. This file holds the addresses, so it exempts itself and builds them from fragments.
 */
const ROOT = path.join(__dirname, "..");

/** T-OpenAI, T-Kalshi, T-SpaceX on Solana mainnet, verified against Jupiter on 17 Sep 2026. */
const T_TOKEN_MINTS = [
  "oPAiAikWTaFj9RYo" + "RFD35ccfwhnMcB3ThgBZRHSkjTZ",
  "TKLSidmLVt3cqGaa" + "odG8tyRzoANfQwoh67AccjmubeZ",
  "TSPXcLV76s6V2zDi" + "ZQ18kBfcbnjaE2ZzNT3ga2Pd99v",
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "private", "coverage"]);
const EXTENSIONS = /\.(ts|tsx|mts|cjs|js|json|md|css|prisma|yml|yaml|example|sql)$/;

function trackedFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) trackedFiles(full, out);
    else if (EXTENSIONS.test(name) && full !== __filename) out.push(full);
  }
  return out;
}

describe("PreStocks track eligibility", () => {
  it("no file integrates a Tessera T-Token mint", () => {
    const files = trackedFiles(ROOT).filter((f) => !f.endsWith("package-lock.json"));
    const hits = files
      .map((f) => ({ file: path.relative(ROOT, f), text: readFileSync(f, "utf8") }))
      .filter(({ text }) => T_TOKEN_MINTS.some((mint) => text.includes(mint)))
      .map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it("scans a real tree, so an empty result means clean rather than nothing read", () => {
    const files = trackedFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(path.join("src", "lib", "prices", "jupiter.ts")))).toBe(true);
  });
});
