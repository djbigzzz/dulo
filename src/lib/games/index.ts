import type { GameModule } from "@/lib/core";
import { league } from "./league";
import { calls } from "./calls";

/**
 * Registered game modules, ticked in order by the 5-minute cron
 * (src/lib/cron/tick.ts step "games": `for (const g of games) await g.tick(now)`,
 * each inside its own try/catch so one module can never block the others).
 *
 * Season 0 registrations land with their prompts:
 *   P2 adds `league` from ./league.ts (equity + rank recompute, weekly rollover).
 *   P3 adds `calls`  from ./calls.ts  (settle Markets with settleAt < now).
 *
 * A module's tick must be idempotent: the cron may run it again for the same window.
 */
export const games: GameModule[] = [league, calls];
