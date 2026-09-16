/**
 * Local cron: hits /api/cron/tick every 5 minutes, the same call Vercel Cron makes in production.
 *
 * Use it when running Dulo on your own machine against real mainnet data (no deployment):
 * wallet snapshots, Play streaks, League equity/rollover, Calls settlement and badge minting
 * (skipped without SERVER_WALLET_SECRET) all advance on the same schedule as production.
 *
 *   npm run tick:local                     # every 5 minutes, first tick immediately
 *   npm run tick:local -- --once           # one tick, then exit
 *   npm run tick:local -- --every=60       # custom interval in seconds
 *   TICK_URL=http://localhost:3000 npm run tick:local
 *
 * Reads CRON_SECRET from .env.local (tsx --env-file). Prints one compact line per tick.
 */

const base = (process.env.TICK_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET ?? "";
const once = process.argv.includes("--once");
const everyArg = process.argv.find((a) => a.startsWith("--every="));
const everySeconds = everyArg ? Math.max(30, Number(everyArg.split("=")[1]) || 300) : 300;

if (!secret) {
  console.error("CRON_SECRET is not set. Run with: npx tsx --env-file=.env.local scripts/local-tick.mts");
  process.exit(1);
}

interface TickStep {
  name: string;
  ok: boolean;
  took: number;
}

interface TickBody {
  ok: boolean;
  error?: string;
  data?: { steps?: TickStep[]; health?: { ok?: boolean; warnings?: string[]; rpcHost?: string | null } };
}

async function tick(): Promise<void> {
  const started = Date.now();
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  try {
    const res = await fetch(`${base}/api/cron/tick`, {
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: AbortSignal.timeout(300_000),
    });
    const body = (await res.json().catch(() => null)) as TickBody | null;
    const steps = body?.data?.steps ?? [];
    const summary = steps.map((s) => `${s.name}:${s.ok ? "ok" : "FAIL"}(${s.took}ms)`).join(" ");
    const warnings = body?.data?.health?.warnings ?? [];
    const rpc = body?.data?.health?.rpcHost ? ` rpc=${body.data.health.rpcHost}` : "";
    console.log(`[${stamp}] HTTP ${res.status} in ${Date.now() - started}ms ${summary || body?.error || ""}${rpc}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  } catch (e) {
    console.log(`[${stamp}] tick failed: ${e instanceof Error ? e.message : String(e)} (is the dev server running at ${base}?)`);
  }
}

await tick();
if (!once) {
  console.log(`Next ticks every ${everySeconds}s against ${base}. Ctrl+C to stop.`);
  setInterval(() => void tick(), everySeconds * 1000);
}
