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

/**
 * Secrets are generated ONCE and then reused. Re-running this after the values are live in Vercel
 * used to mint new ones, which silently desynced three places at a time: the deployment kept the
 * old CRON_SECRET so the tick answered 401, the Actions pinger would have been given a third
 * value, and a rotated JWT_SECRET signs out every session. Regenerating on purpose means deleting
 * the file, and the printout below says so.
 *
 * env() requires >= 32 and >= 16 characters respectively; these are comfortably past both.
 */
const previous = existsSync(TARGET) ? parse(readFileSync(TARGET, "utf8")) : {};
const jwtSecret = previous.JWT_SECRET || randomBytes(48).toString("base64");
const cronSecret = previous.CRON_SECRET || randomBytes(16).toString("hex");
const reused = Boolean(previous.JWT_SECRET && previous.CRON_SECRET);

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
console.log(reused ? "  JWT_SECRET            (kept from the existing file)" : "  JWT_SECRET            (generated, 48 random bytes)");
console.log(reused ? "  CRON_SECRET           (kept from the existing file)" : "  CRON_SECRET           (generated, 16 random bytes)");
console.log(`  NEXT_PUBLIC_APP_URL   ${appUrl}`);
console.log("  NEXT_PUBLIC_APP_NAME  Dulo");
console.log("\nOpen it, select all, paste into Vercel's Environment Variables panel.");
console.log("CRON_SECRET also goes in the repo's Actions secrets, for the tick pinger.");
console.log("JUPITER_API_KEY is worth adding by hand: free at https://portal.jup.ag");
