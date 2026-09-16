import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dulo is a standalone project: no public file may name the founder or an earlier project of
 * theirs. docs/private is gitignored and exempt; this file is exempt because it holds the pattern.
 */
const ROOT = path.join(__dirname, "..");
const BANNED = new RegExp(["gal" + "in", "dimi" + "trov", "dum" + "\\.fun", "fogo" + "quest", "bull" + "mania"].join("|"), "i");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "private"]);
const EXTENSIONS = /\.(ts|tsx|mts|cjs|js|json|md|css|prisma|yml|yaml|example)$|^LICENSE$/;

function publicFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) publicFiles(full, out);
    else if (EXTENSIONS.test(name) && full !== __filename && !name.endsWith(".lock")) out.push(full);
  }
  return out;
}

describe("anonymity", () => {
  it("no public file names the founder or an earlier project", () => {
    const hits = publicFiles(ROOT)
      .filter((f) => !f.endsWith("package-lock.json") && !f.endsWith("xstocks-catalogue.json"))
      .filter((f) => BANNED.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
