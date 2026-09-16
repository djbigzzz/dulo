/**
 * Regenerate the bundled xStocks catalogue: src/lib/assets/xstocks-catalogue.json.
 *
 * lib/assets/xstocks serves that file at cold start (the stale-while-revalidate seed) and
 * whenever the public API cannot be reached, so a cold-start fetch failure never snapshots a
 * wallet against a short list and silently drops holdings (15 Sep review,
 * "Catalogue fallback"). Run it before a deploy when xStocks has listed new assets.
 *
 * What it does
 *   1. Fetches every page of GET {XSTOCKS_API_URL}/assets through the app's own fetchAllNodes
 *      (4 pages in flight; any failed page before the end aborts the run).
 *   2. Maps nodes with the app's own mapping (Solana deployments only, deduplicated by mint),
 *      keeping symbol, underlying, name and mint (the logo only when it is non-standard).
 *   3. Refuses to write when the result looks wrong: no assets, a verified XSTOCKS_FALLBACK
 *      mint missing or re-pointed, or fewer than half the assets of the file it would replace.
 *      `--force` overrides the last two checks.
 *   4. Writes entries sorted by symbol (stable diffs) via a temp file + rename, and prints what
 *      was added and removed.
 *
 * Usage
 *   npm run catalogue:build                  write the file
 *   npm run catalogue:build -- --dry-run     fetch, validate and report; write nothing
 *   npm run catalogue:build -- --force       write despite the shortlist / shrink checks
 *
 * Needs network only (no database, no env file). XSTOCKS_API_URL overrides the API base.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  XSTOCKS_DEFAULT_API_URL,
  XSTOCKS_FALLBACK,
  bundleEntriesFromNodes,
  configureXstocks,
  fetchAllNodes,
  type FetchLike,
  type XStocksCatalogueBundle,
  type XStocksFallbackEntry,
} from "@/lib/assets/xstocks";

const OUT_FILE = path.resolve(process.cwd(), "src/lib/assets/xstocks-catalogue.json");
const GENERATOR = "scripts/build-xstocks-catalogue.ts";
const TIMEOUT_MS = 30_000;
const MIN_KEEP_RATIO = 0.5;

function readExisting(): XStocksCatalogueBundle | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(OUT_FILE, "utf8")) as XStocksCatalogueBundle;
    return Array.isArray(parsed?.assets) ? parsed : null;
  } catch {
    return null;
  }
}

function bySymbol(a: XStocksFallbackEntry, b: XStocksFallbackEntry): number {
  const x = a.symbol.toUpperCase();
  const y = b.symbol.toUpperCase();
  return x < y ? -1 : x > y ? 1 : a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0;
}

/** One entry per line: readable, diffable, and still plain JSON. */
function serialise(bundle: XStocksCatalogueBundle): string {
  const lines = bundle.assets.map((e) => `    ${JSON.stringify(e)}`);
  return `{\n  "_meta": ${JSON.stringify(bundle._meta, null, 2).replace(/\n/g, "\n  ")},\n  "assets": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

/** Problems that should stop a write. */
function validateCatalogue(entries: readonly XStocksFallbackEntry[], existing: XStocksCatalogueBundle | null): { fatal: string[]; guarded: string[] } {
  const fatal: string[] = [];
  const guarded: string[] = [];
  if (entries.length === 0) fatal.push("the API returned no Solana assets");
  const byMint = new Map(entries.map((e) => [e.mint, e]));
  for (const v of XSTOCKS_FALLBACK) {
    const got = byMint.get(v.mint);
    if (!got) guarded.push(`verified ${v.symbol} mint ${v.mint} is missing`);
    else if (got.symbol !== v.symbol) guarded.push(`verified mint ${v.mint} is now ${got.symbol}, expected ${v.symbol}`);
  }
  const before = existing?.assets.length ?? 0;
  if (before > 0 && entries.length < before * MIN_KEEP_RATIO) {
    guarded.push(`only ${entries.length} assets against ${before} in the current file (truncated response?)`);
  }
  return { fatal, guarded };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const force = args.has("--force");
  const baseUrl = (process.env.XSTOCKS_API_URL || XSTOCKS_DEFAULT_API_URL).replace(/\/+$/, "");

  let terminalPage = Number.POSITIVE_INFINITY;
  const countingFetch: FetchLike = async (url, init) => {
    const res = await fetch(url, init);
    if (res.ok) {
      try {
        const body = (await res.clone().json()) as { page?: { hasNextPage?: boolean } };
        const page = Number(new URL(url).searchParams.get("page"));
        if (body?.page?.hasNextPage === false && Number.isInteger(page)) terminalPage = Math.min(terminalPage, page);
      } catch {
        // fetchAllNodes reports the malformed body itself
      }
    }
    return res;
  };
  configureXstocks({ baseUrl, fetch: countingFetch, timeoutMs: TIMEOUT_MS });

  const started = Date.now();
  console.log(`[catalogue] fetching ${baseUrl}/assets ...`);
  const nodes = await fetchAllNodes();
  const entries = bundleEntriesFromNodes(nodes).sort(bySymbol);
  const pages = Number.isFinite(terminalPage) ? terminalPage + 1 : 0;
  console.log(`[catalogue] ${nodes.length} nodes over ${pages} pages -> ${entries.length} Solana assets in ${Date.now() - started}ms`);

  const existing = readExisting();
  const { fatal, guarded } = validateCatalogue(entries, existing);
  for (const f of fatal) console.error(`[catalogue] refusing to write: ${f}`);
  for (const g of guarded) console.error(`[catalogue] ${force ? "warning (--force)" : "refusing to write"}: ${g}`);

  const beforeMints = new Set((existing?.assets ?? []).map((e) => e.mint));
  const afterMints = new Set(entries.map((e) => e.mint));
  const added = entries.filter((e) => !beforeMints.has(e.mint)).map((e) => e.symbol);
  const removed = (existing?.assets ?? []).filter((e) => !afterMints.has(e.mint)).map((e) => e.symbol);
  const preview = (xs: string[]) => (xs.length > 20 ? `${xs.slice(0, 20).join(", ")} … (+${xs.length - 20})` : xs.join(", "));
  console.log(`[catalogue] added ${added.length}${added.length ? `: ${preview(added)}` : ""}`);
  console.log(`[catalogue] removed ${removed.length}${removed.length ? `: ${preview(removed)}` : ""}`);

  const duplicateSymbols = entries.length - new Set(entries.map((e) => e.symbol.toUpperCase())).size;
  if (duplicateSymbols > 0) console.warn(`[catalogue] ${duplicateSymbols} symbol(s) appear on more than one mint; symbol lookups keep the first`);

  if (fatal.length > 0 || (guarded.length > 0 && !force)) {
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log("[catalogue] --dry-run: nothing written");
    return;
  }

  const bundle: XStocksCatalogueBundle = {
    _meta: {
      source: `${baseUrl}/assets`,
      generatedAt: new Date().toISOString(),
      generator: GENERATOR,
      pages,
      nodes: nodes.length,
      solanaAssets: entries.length,
    },
    assets: entries,
  };
  const tmp = `${OUT_FILE}.tmp`;
  writeFileSync(tmp, serialise(bundle), "utf8");
  renameSync(tmp, OUT_FILE);
  console.log(`[catalogue] wrote ${entries.length} assets to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((e: unknown) => {
  console.error(`[catalogue] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
