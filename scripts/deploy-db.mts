/**
 * One command to make a fresh production database ready to demo:
 *
 *   npm run db:setup -- --env .env.production.local
 *
 * It pushes the Prisma schema and runs the seed, both against the URLs in that file rather
 * than .env.local, so there is no shell quoting to get wrong and no way to seed the local
 * database by accident. Both steps are idempotent, so re-running is safe.
 *
 * The file needs DATABASE_URL, and DIRECT_URL when the host pools connections (Supabase,
 * Neon): Prisma's CLI cannot run DDL over a transaction pooler. With no DIRECT_URL the
 * pushed URL is DATABASE_URL, which is right for a plain unpooled Postgres.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_ENV_FILE = ".env.production.local";

function parseEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`cannot read ${file}. Create it with DATABASE_URL (and DIRECT_URL if the host pools connections).`);
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** Host and database only: a connection string carries a password, and this prints to a terminal. */
function safeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * npx is a shell script on POSIX and npx.cmd on Windows, so this runs through a shell. The
 * command is passed as one string rather than as args: every part is a literal below, and
 * arg arrays with `shell: true` are escaped by no one (Node's DEP0190).
 */
function run(label: string, command: string, env: NodeJS.ProcessEnv): void {
  console.log(`\n--- ${label} ---`);
  const res = spawnSync(command, { stdio: "inherit", env, shell: true });
  if (res.status !== 0) throw new Error(`${label} failed with exit code ${res.status ?? "null"}`);
}

const argv = process.argv.slice(2);
const at = argv.indexOf("--env");
const envFile = path.resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : DEFAULT_ENV_FILE);

const parsed = parseEnvFile(envFile);
const databaseUrl = parsed.DATABASE_URL;
if (!databaseUrl) throw new Error(`${envFile} has no DATABASE_URL`);
const directUrl = parsed.DIRECT_URL || databaseUrl;

console.log(`env file   ${envFile}`);
console.log(`runtime    ${safeTarget(databaseUrl)}`);
console.log(`migrations ${safeTarget(directUrl)}${parsed.DIRECT_URL ? "" : "  (no DIRECT_URL set; using DATABASE_URL)"}`);

const env: NodeJS.ProcessEnv = { ...process.env, ...parsed, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl };

run("prisma db push", "npx prisma db push --skip-generate", env);
run("seed", "npx tsx prisma/seed.ts", env);

console.log("\nDatabase ready. Open the deployment and the landing page should show live prediction cards.");
