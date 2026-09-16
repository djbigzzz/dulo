import type { PrismaClient } from "@prisma/client";
import { BOT_HANDLES, ensureLeague, seedBots } from "../src/lib/games/league";
import type { SeedRow } from "./seed";

/**
 * League seed: make sure the current week's League exists (same week math as
 * lib/games/league currentWeek, which rolls forward to next Monday on a weekend) and
 * put the 15 bot accounts in it with 3-8 plausible trades each. Idempotent: bots that
 * already have an account in that League are reported as skipped, never re-traded, but
 * their handle and wallet address still converge on BOT_HANDLES (a renamed handle reaches
 * an existing database; the change is listed in the row detail).
 *
 * Fill prices come from lib/price at seed time (Jupiter on a weekend) and fall back to
 * a fixed table when a symbol cannot be quoted, so the seed works offline.
 */
export async function seedLeague(prisma: PrismaClient, seasonId: string): Promise<SeedRow[]> {
  const now = new Date();
  const rows: SeedRow[] = [];

  const league = await ensureLeague(seasonId, now, prisma);
  rows.push({
    entity: "League",
    key: league.id,
    action: "updated",
    detail: `ensured ${league.weekStart.toISOString().slice(0, 10)} → ${league.weekEnd.toISOString()} · ${league.status}`,
  });

  const bots = await seedBots(prisma, league.id, now);
  for (const b of bots) {
    const identity = b.identity.length > 0 ? ` · ${b.identity.join(" · ")}` : "";
    rows.push({
      entity: "Bot",
      key: b.handle,
      action: b.created ? "created" : "updated",
      detail: b.created
        ? `${b.userId} · ${b.address.slice(0, 4)}…${b.address.slice(-4)} · ${b.trades} trades · equity $${b.equityUsd.toFixed(2)}${identity}`
        : `already in this League (skipped) · ${b.trades} trades · equity $${b.equityUsd.toFixed(2)}${identity}`,
    });
  }
  const created = bots.filter((b) => b.created).length;
  const converged = bots.filter((b) => b.identity.length > 0).length;
  console.log(
    `League seed: ${created} of ${BOT_HANDLES.length} bots created in ${league.id} (${bots.length - created} already present; ${converged} identities updated)`,
  );
  return rows;
}
