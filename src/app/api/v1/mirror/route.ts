import { handler, ok } from "@/lib/server/api";
import { getMirrorIndex } from "@/lib/mirror/views";
import type { MirrorIndexResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/mirror
 * Mirrorable wallets: top Season leaderboard rows with snapshot history, model portfolios
 * (League accounts, bots included, paper; concentrated ones last) and the curated public
 * wallets on Solana (not Dulo players, never scored; valued from the 10-minute live-read cache
 * when the read lands within ~2.5 s). Each links to /mirror/[wallet].
 */
export const GET = handler(async () => {
  const data: MirrorIndexResponse = await getMirrorIndex();
  return ok(data, { headers: { "cache-control": "no-store" } });
});
