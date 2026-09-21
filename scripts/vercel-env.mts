/**
 * Write a ready-to-paste environment block for Vercel.
 *
 *   npm run env:vercel -- https://my-project.vercel.app
 *
 * Vercel's "Environment Variables" panel accepts a pasted .env, so the whole set goes in at once
 * instead of six separate fields. This reads the database URLs already mapped into
 * .env.production.local, generates JWT_SECRET and CRON_SECRET locally with crypto.randomBytes,
 * and writes vercel.env.txt for you to open, select all and paste.
 *
 * Nothing is printed except variable names: the file holds the only copy, it is gitignored, and
 * pasting it into Vercel is a step only you should take.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOURCE = path.resolve(".env.production.local");
const TARGET = path.resolve("vercel.env.txt");

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

const appUrl = process.argv[2];
if (!appUrl) throw new Error("Pass the Vercel URL: npm run env:vercel -- https://<project>.vercel.app");
if (!/^https:\/\/[^/\s]+$/.test(appUrl)) {
  throw new Error(`"${appUrl}" must be an https origin with no trailing slash or path, e.g. https://dulo.vercel.app`);
}
if (!existsSync(SOURCE)) throw new Error(`${SOURCE} not found. Run: npm run db:neon`);

const env = parse(readFileSync(SOURCE, "utf8"));
const databaseUrl = env.DATABASE_URL;
const directUrl = env.DIRECT_URL;
if (!databaseUrl || !directUrl) throw new Error(`${SOURCE} needs DATABASE_URL and DIRECT_URL. Run: npm run db:neon`);
if (!databaseUrl.includes("-pooler.")) {
  throw new Error("DATABASE_URL is not the pooled host. Run npm run db:neon, which sorts the two URLs out.");
}

// env() requires >= 32 and >= 16 characters respectively; these are comfortably past both.
const jwtSecret = randomBytes(48).toString("base64");
const cronSecret = randomBytes(16).toString("hex");

const block = [
  `DATABASE_URL="${databaseUrl}"`,
  `DIRECT_URL="${directUrl}"`,
  `JWT_SECRET="${jwtSecret}"`,
  `CRON_SECRET="${cronSecret}"`,
  `NEXT_PUBLIC_APP_URL="${appUrl}"`,
  `NEXT_PUBLIC_APP_NAME="Dulo"`,
  "",
].join("\n");

writeFileSync(TARGET, block);

console.log(`Wrote ${TARGET}`);
console.log("  DATABASE_URL          (pooled Neon)");
console.log("  DIRECT_URL            (direct Neon)");
console.log("  JWT_SECRET            (generated, 48 random bytes)");
console.log("  CRON_SECRET           (generated, 16 random bytes)");
console.log(`  NEXT_PUBLIC_APP_URL   ${appUrl}`);
console.log("  NEXT_PUBLIC_APP_NAME  Dulo");
console.log("\nOpen it, select all, paste into Vercel's Environment Variables panel.");
console.log("CRON_SECRET also goes in the repo's Actions secrets, for the tick pinger.");
console.log("JUPITER_API_KEY is worth adding by hand: free at https://portal.jup.ag");
