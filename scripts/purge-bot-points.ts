/**
 * One-off bot hygiene purge (docs/REVIEW-2026-09-14.md H2).
 *
 * Until the H2 fix, the cron snapshotted bot wallets and evaluated bot users, so every
 * seeded League bot completed Scout from its own seeded trades (50 pts each) and the 15
 * bots sat tied at #1 on the Season leaderboard. This script removes what that produced
 * and nothing else:
 *
 *   PointsEvent   source "play" (ref play:<key>) for bot users — the Scout awards
 *   PointsEvent   source "starter" (ref starter:<seasonId>) for bot users — house bots never
 *                 get starter points (16 Sep 2026 points policy); every write path refuses
 *                 them, so this only clears a row written before those guards existed
 *   PlayProgress  every row for bot users (Scout complete + in_progress rows for the rest)
 *   Badge         UNMINTED rows for bot users; a minted row (mint != null) is reported and kept
 *   Snapshot      every row for bot wallets (always empty: bot keypairs are unfunded)
 *
 * Left alone on purpose: LeagueAccount / LeagueTrade (the bots' paper positions ARE the
 * League), League podium PointsEvents (rollover never awards bots), Call positions and any
 * source "admin" stakes a later seed may give bots (M10).
 *
 * A bot is a User with any LeagueAccount.isBot = true or a bot-league-* id — the same two
 * markers the app uses (lib/server/queries REAL_USER_WHERE).
 *
 * Idempotent: a second run finds nothing and prints zeros. Safe to run while the app is
 * up (the cron no longer writes any of these rows for bots).
 *
 * Usage
 *   local    npx tsx --env-file=.env.local scripts/purge-bot-points.ts [--dry-run]
 *   prod     DATABASE_URL="<transaction pooler url>" npx tsx scripts/purge-bot-points.ts
 *            (prod is seeded fresh after H2 ships, so this is a safety net there, not a
 *            required step; run it with --dry-run first and expect zeros).
 *
 * The script opens its own Prisma client with `pgbouncer=true` appended to DATABASE_URL:
 * a second client next to the dev server needs it on the local Prisma Postgres, and it is
 * the right mode for the Supabase transaction pooler.
 */
import { PrismaClient } from "@prisma/client";
import { BOT_USER_ID_PREFIX } from "../src/lib/games/bots";

const DRY_RUN = process.argv.includes("--dry-run");

/** DATABASE_URL with `pgbouncer=true` (added once; kept if already present). */
export function withPgBouncer(url: string): string {
  if (/[?&]pgbouncer=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pgbouncer=true`;
}

interface PurgeCounts {
  bots: number;
  botWallets: number;
  playPoints: number;
  starterPoints: number;
  playProgress: number;
  badges: number;
  mintedBadgesKept: number;
  snapshots: number;
}

export async function purgeBotPoints(prisma: PrismaClient, dryRun: boolean): Promise<PurgeCounts> {
  const botUsers = await prisma.user.findMany({
    where: { OR: [{ leagueAccounts: { some: { isBot: true } } }, { id: { startsWith: BOT_USER_ID_PREFIX } }] },
    select: { id: true },
  });
  const botIds = botUsers.map((u) => u.id);
  const counts: PurgeCounts = { bots: botIds.length, botWallets: 0, playPoints: 0, starterPoints: 0, playProgress: 0, badges: 0, mintedBadgesKept: 0, snapshots: 0 };
  if (botIds.length === 0) return counts;

  const botUser = { userId: { in: botIds } };
  const botWallet = { wallet: { userId: { in: botIds } } };

  const [wallets, playPoints, starterPoints, playProgress, badges, mintedBadges, snapshots] = await Promise.all([
    prisma.wallet.count({ where: botUser }),
    prisma.pointsEvent.count({ where: { ...botUser, source: "play" } }),
    prisma.pointsEvent.count({ where: { ...botUser, source: "starter" } }),
    prisma.playProgress.count({ where: botUser }),
    prisma.badge.count({ where: { ...botUser, mint: null } }),
    prisma.badge.count({ where: { ...botUser, mint: { not: null } } }),
    prisma.snapshot.count({ where: botWallet }),
  ]);
  counts.botWallets = wallets;
  counts.mintedBadgesKept = mintedBadges;

  if (dryRun) {
    return { ...counts, playPoints, starterPoints, playProgress, badges, snapshots };
  }

  const [pe, st, pp, bd, sn] = await prisma.$transaction([
    prisma.pointsEvent.deleteMany({ where: { ...botUser, source: "play" } }),
    prisma.pointsEvent.deleteMany({ where: { ...botUser, source: "starter" } }),
    prisma.playProgress.deleteMany({ where: botUser }),
    prisma.badge.deleteMany({ where: { ...botUser, mint: null } }),
    prisma.snapshot.deleteMany({ where: botWallet }),
  ]);
  return { ...counts, playPoints: pe.count, starterPoints: st.count, playProgress: pp.count, badges: bd.count, snapshots: sn.count };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (local: npx tsx --env-file=.env.local scripts/purge-bot-points.ts)");
  const prisma = new PrismaClient({ datasources: { db: { url: withPgBouncer(url) } }, log: ["warn", "error"] });
  try {
    const c = await purgeBotPoints(prisma, DRY_RUN);
    const verb = DRY_RUN ? "would delete" : "deleted";
    console.log(`purge-bot-points${DRY_RUN ? " (dry run)" : ""}: ${c.bots} bot users, ${c.botWallets} bot wallets`);
    console.log(`  PointsEvent (source play)  ${verb} ${c.playPoints}`);
    console.log(`  PointsEvent (starter)      ${verb} ${c.starterPoints}`);
    console.log(`  PlayProgress               ${verb} ${c.playProgress}`);
    console.log(`  Badge (unminted)           ${verb} ${c.badges}${c.mintedBadgesKept > 0 ? ` · ${c.mintedBadgesKept} minted row(s) kept — inspect by hand` : ""}`);
    console.log(`  Snapshot (bot wallets)     ${verb} ${c.snapshots}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly, so the helpers can be imported by tests.
const isDirectRun = /[\\/]purge-bot-points\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) {
  main().catch((e) => {
    console.error("purge-bot-points failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
