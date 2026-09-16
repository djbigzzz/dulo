/**
 * Season 0 traction stats (work item C12): honest, reproducible numbers for the README, the submission form
 * and the pitch video's traction beat. Read-only; it never writes a row.
 *
 * Prints one timestamped JSON object:
 *
 *   signedInUsers           distinct users who signed in (>= 1 linked wallet)
 *   usersWithCompletedPlay  of those, users with at least one completed Play
 *   playsVerified           completed PlayProgress rows (plus the split by Play key)
 *   leaguePlayers           users with a League account that has placed >= 1 paper trade
 *   leagueTrades            paper trades those players placed
 *   callsPlaced / callers   Call positions and the distinct users who placed them
 *   xstocksUsdHeld          USD value of xStocks held by counted players, from the LATEST
 *                           snapshot of each of their wallets (never summed across snapshots)
 *
 * Who is counted: a user is counted only when ALL of these hold
 *   - not a bot: the same rule the app uses (lib/server/queries REAL_USER_WHERE: a user with
 *     any LeagueAccount.isBot). It is applied in every DB query and again in the pure helper;
 *   - signed in: owns at least one Wallet (Calls bot stakes can create a wallet-less user);
 *   - not the founder: owns none of the addresses in env FOUNDER_WALLETS (comma-separated). A user
 *     is a set of wallets, so one listed address removes that whole user.
 *
 * Usage (from the repo root)
 *   local   npm run stats                      (loads .env.local when DATABASE_URL is unset)
 *   prod    DATABASE_URL="<transaction pooler url>" FOUNDER_WALLETS="<addr>,<addr>" npm run stats
 *
 * Kept free of top-level await so it runs as .ts under tsx and stays valid if copied to .mts.
 * Like scripts/purge-bot-points.ts it opens its own Prisma client with `pgbouncer=true`.
 */

/** One User as the helper sees it: its wallet addresses and whether any of its League accounts is a bot. */
export interface TractionUserRow {
  id: string;
  walletAddresses: string[];
  isBot: boolean;
}

export interface TractionInput {
  users: TractionUserRow[];
  completedPlays: { userId: string; playKey: string }[];
  leagueAccounts: { userId: string; isBot: boolean; trades: number }[];
  callPositions: { userId: string }[];
  latestSnapshots: { userId: string; walletAddress: string; takenAt: Date; holdings: unknown }[];
  excludedWallets: ReadonlySet<string>;
}

export interface TractionStats {
  signedInUsers: number;
  usersWithCompletedPlay: number;
  playsVerified: number;
  playsVerifiedByKey: Record<string, number>;
  leaguePlayers: number;
  leagueTrades: number;
  callsPlaced: number;
  callers: number;
  xstocksUsdHeld: number;
  walletsHoldingXstocks: number;
  /** Oldest and newest of the latest-per-wallet snapshots that fed xstocksUsdHeld (ISO), null when none. */
  snapshotsAsOf: { oldest: string; newest: string } | null;
  excluded: { botUsers: number; founderUsers: number; walletlessUsers: number };
}

/** FOUNDER_WALLETS -> set of addresses. Comma or whitespace separated; Solana addresses are case-sensitive, so no case folding. */
export function parseWalletList(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Sum of `usd` across a Snapshot.holdings JSON array; ignores anything that is not a finite, non-negative number. */
export function holdingsUsd(holdings: unknown): number {
  if (!Array.isArray(holdings)) return 0;
  let total = 0;
  for (const h of holdings) {
    const usd = typeof h === "object" && h !== null ? (h as { usd?: unknown }).usd : undefined;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) total += usd;
  }
  return total;
}

/** Ids of the users that count: not a bot, at least one wallet, no wallet listed in FOUNDER_WALLETS. */
export function countedUserIds(users: readonly TractionUserRow[], excludedWallets: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const u of users) {
    if (u.isBot || u.walletAddresses.length === 0) continue;
    if (u.walletAddresses.some((a) => excludedWallets.has(a))) continue;
    ids.add(u.id);
  }
  return ids;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure aggregation over already-fetched rows. Every metric is restricted to countedUserIds. */
export function aggregateTraction(input: TractionInput): TractionStats {
  const counted = countedUserIds(input.users, input.excludedWallets);
  const isCounted = (userId: string) => counted.has(userId);

  let botUsers = 0;
  let founderUsers = 0;
  let walletlessUsers = 0;
  for (const u of input.users) {
    if (u.isBot) botUsers += 1;
    else if (u.walletAddresses.length === 0) walletlessUsers += 1;
    else if (u.walletAddresses.some((a) => input.excludedWallets.has(a))) founderUsers += 1;
  }

  // A (user, playKey) pair is one verified Play even if a caller hands in duplicates.
  const playPairs = new Set<string>();
  const playsVerifiedByKey: Record<string, number> = {};
  const playUsers = new Set<string>();
  for (const p of input.completedPlays) {
    if (!isCounted(p.userId)) continue;
    const pair = `${p.userId}|${p.playKey}`;
    if (playPairs.has(pair)) continue;
    playPairs.add(pair);
    playUsers.add(p.userId);
    playsVerifiedByKey[p.playKey] = (playsVerifiedByKey[p.playKey] ?? 0) + 1;
  }

  const leaguePlayers = new Set<string>();
  let leagueTrades = 0;
  for (const a of input.leagueAccounts) {
    if (a.isBot || !isCounted(a.userId) || a.trades <= 0) continue;
    leaguePlayers.add(a.userId);
    leagueTrades += a.trades;
  }

  const callers = new Set<string>();
  let callsPlaced = 0;
  for (const c of input.callPositions) {
    if (!isCounted(c.userId)) continue;
    callsPlaced += 1;
    callers.add(c.userId);
  }

  // Latest snapshot per wallet only: if a caller passes more than one row for a wallet, keep the newest.
  const latest = new Map<string, TractionInput["latestSnapshots"][number]>();
  for (const s of input.latestSnapshots) {
    if (!isCounted(s.userId) || input.excludedWallets.has(s.walletAddress)) continue;
    const prev = latest.get(s.walletAddress);
    if (!prev || s.takenAt.getTime() > prev.takenAt.getTime()) latest.set(s.walletAddress, s);
  }
  let usd = 0;
  let walletsHoldingXstocks = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  for (const s of latest.values()) {
    const v = holdingsUsd(s.holdings);
    usd += v;
    if (v > 0) walletsHoldingXstocks += 1;
    if (!oldest || s.takenAt < oldest) oldest = s.takenAt;
    if (!newest || s.takenAt > newest) newest = s.takenAt;
  }

  const sortedByKey = Object.fromEntries(Object.entries(playsVerifiedByKey).sort(([a], [b]) => a.localeCompare(b)));

  return {
    signedInUsers: counted.size,
    usersWithCompletedPlay: playUsers.size,
    playsVerified: playPairs.size,
    playsVerifiedByKey: sortedByKey,
    leaguePlayers: leaguePlayers.size,
    leagueTrades,
    callsPlaced,
    callers: callers.size,
    xstocksUsdHeld: round2(usd),
    walletsHoldingXstocks,
    snapshotsAsOf: oldest && newest ? { oldest: oldest.toISOString(), newest: newest.toISOString() } : null,
    excluded: { botUsers, founderUsers, walletlessUsers },
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local: fall through to the explicit error below.
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (local: keep it in .env.local; prod: DATABASE_URL="<pooler url>" npm run stats)');

  // Dynamic imports keep the pure helpers above importable by vitest without Prisma or the app's db client.
  const [{ PrismaClient }, { REAL_USER_WHERE }, { withPgBouncer }] = await Promise.all([
    import("@prisma/client"),
    import("@/lib/server/queries"),
    import("./purge-bot-points"),
  ]);
  const prisma = new PrismaClient({ datasources: { db: { url: withPgBouncer(url) } }, log: ["warn", "error"] });
  const excludedWallets = parseWalletList(process.env.FOUNDER_WALLETS);

  try {
    const generatedAt = new Date();
    // Sequential on purpose: one connection, gentle on a pooler or a flaky local Postgres.
    const userRows = await prisma.user.findMany({
      select: { id: true, wallets: { select: { id: true, address: true } }, leagueAccounts: { select: { isBot: true } } },
    });
    const users: TractionUserRow[] = userRows.map((u) => ({
      id: u.id,
      walletAddresses: u.wallets.map((w) => w.address),
      isBot: u.leagueAccounts.some((a) => a.isBot),
    }));
    const completedPlays = await prisma.playProgress.findMany({
      where: { status: "complete", user: REAL_USER_WHERE },
      select: { userId: true, playKey: true },
    });
    const accountRows = await prisma.leagueAccount.findMany({
      where: { isBot: false, user: REAL_USER_WHERE },
      select: { userId: true, isBot: true, _count: { select: { trades: true } } },
    });
    const callPositions = await prisma.position.findMany({ where: { user: REAL_USER_WHERE }, select: { userId: true } });

    const counted = countedUserIds(users, excludedWallets);
    const latestSnapshots: TractionInput["latestSnapshots"] = [];
    for (const u of userRows) {
      if (!counted.has(u.id)) continue;
      for (const w of u.wallets) {
        const snap = await prisma.snapshot.findFirst({
          where: { walletId: w.id },
          orderBy: { takenAt: "desc" },
          select: { takenAt: true, holdings: true },
        });
        if (snap) latestSnapshots.push({ userId: u.id, walletAddress: w.address, takenAt: snap.takenAt, holdings: snap.holdings });
      }
    }

    const stats = aggregateTraction({
      users,
      completedPlays,
      leagueAccounts: accountRows.map((a) => ({ userId: a.userId, isBot: a.isBot, trades: a._count.trades })),
      callPositions,
      latestSnapshots,
      excludedWallets,
    });
    const out = {
      generatedAt: generatedAt.toISOString(),
      founderWalletsListed: excludedWallets.size,
      ...stats,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (tsx scripts/traction-stats.ts or a .mts copy), so tests can import the helpers.
if (/[\\/]traction-stats\.m?ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error("traction-stats failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
