/**
 * Turn Neon's copied .env block into the two variables Prisma needs.
 *
 *   npm run db:neon            (rewrites .env.production.local in place)
 *
 * Neon names them the other way round from us, which is the easy mistake to make:
 *
 *   Neon DATABASE_URL_POOLED  (host has -pooler)  -> our DATABASE_URL  (app runtime)
 *   Neon DATABASE_URL         (no -pooler)        -> our DIRECT_URL    (schema changes)
 *
 * Serverless functions open many short connections, so the runtime URL must be the pooled one,
 * and Prisma's prepared statements need `pgbouncer=true&connection_limit=1` to survive PgBouncer's
 * transaction mode. Prisma cannot run DDL through a pooler at all, so DIRECT_URL stays unpooled.
 *
 * Prints only hosts, never a password. Rewrites the file, so it is safe to re-run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.argv[2] ?? ".env.production.local");

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Host and database only: this prints to a terminal and the URL carries a password. */
function where(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const env = parse(readFileSync(FILE, "utf8"));
const candidates = Object.entries(env).filter(([, v]) => /^postgres(ql)?:\/\//.test(v));
if (candidates.length === 0) throw new Error(`${FILE} has no postgres:// URL. Paste Neon's .env block into it first.`);

const pooled = candidates.find(([, v]) => v.includes("-pooler."))?.[1];
const direct = candidates.find(([, v]) => !v.includes("-pooler."))?.[1];

if (!pooled) throw new Error("No pooled URL found (its host contains '-pooler'). Copy the full .env from Neon, which has both.");
if (!direct) throw new Error("No direct URL found (its host has no '-pooler'). Copy the full .env from Neon, which has both.");

const runtime = withParams(pooled, { pgbouncer: "true", connection_limit: "1" });

writeFileSync(
  FILE,
  [
    "# Written by scripts/neon-env.mts. Gitignored: never commit this file.",
    "# Neon's DATABASE_URL_POOLED -> DATABASE_URL (app runtime, through PgBouncer).",
    `DATABASE_URL="${runtime}"`,
    "",
    "# Neon's DATABASE_URL -> DIRECT_URL (Prisma schema changes; DDL cannot cross a pooler).",
    `DIRECT_URL="${direct}"`,
    "",
  ].join("\n"),
);

console.log(`Wrote ${FILE}`);
console.log(`  DATABASE_URL -> ${where(runtime)}  (pooled, +pgbouncer)`);
console.log(`  DIRECT_URL   -> ${where(direct)}  (direct)`);
console.log("\nNext: npm run db:setup -- --env .env.production.local");
