import { z } from "zod";
import { ApiError, fail, handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { PublicWalletReadError } from "@/lib/mirror/public";
import { getMirrorView, publicReadApiError, publicReadIpGate } from "@/lib/mirror/views";
import { clientIp } from "@/lib/server/rate-limit";
import type { MirrorResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Wallet = z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address");

type Ctx = { params: Promise<{ wallet: string }> };

/**
 * GET /api/v1/mirror/[wallet]
 * The wallet's allocation (a Dulo wallet's latest Snapshot or League paper positions, or
 * for any other Solana address a live public read: cached 10 minutes, nothing stored, never
 * scored), 7d/30d value change, one PriceQuote per leg and a `stale` flag.
 *   400 invalid address · 404 a Dulo wallet with nothing to mirror
 *   429 more than 10 uncached public lookups a minute from this IP (IPv6: its /64), with Retry-After
 *   503 the public read failed or the instance-wide lookup budget is spent (try again shortly)
 * The per-IP decision is taken before the shared budget is spent, so one client cannot lock
 * "Copy any wallet's portfolio" for everyone. Public; `signedIn` tells the page whether "verify" will work.
 */
export const GET = handler<Ctx>(async (req, ctx) => {
  const { wallet: raw } = await ctx.params;
  const parsed = Wallet.safeParse(raw);
  if (!parsed.success) throw new ApiError("Invalid wallet address", 400, parsed.error.issues);
  const session = await getSession().catch(() => null);
  let data: MirrorResponse | null;
  try {
    data = await getMirrorView(parsed.data, session?.userId ?? null, new Date(), { beforeUncachedRead: publicReadIpGate(clientIp(req)) });
  } catch (e) {
    if (e instanceof PublicWalletReadError && e.kind === "limited") {
      const res = fail(e.message, 429);
      res.headers.set("cache-control", "no-store");
      if (e.retryAfterSeconds !== undefined) res.headers.set("retry-after", String(e.retryAfterSeconds));
      return res;
    }
    throw publicReadApiError(e) ?? e;
  }
  if (!data) throw new ApiError("Nothing to copy: this address is not a valid Solana wallet, or it has no snapshots or competition positions (virtual cash)", 404);
  return ok(data, { headers: { "cache-control": "no-store" } });
});
