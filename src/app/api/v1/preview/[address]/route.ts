import { fail, handler, ok } from "@/lib/server/api";
import {
  PREVIEW_CACHE_CONTROL,
  PreviewAddress,
  clientIp,
  getPreview,
  previewGlobalLimiter,
  previewIpLimiter,
} from "@/app/api/v1/preview/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ address: string }> };

function noStore<R extends Response>(res: R, retryAfterSeconds?: number): R {
  res.headers.set("cache-control", "no-store");
  if (retryAfterSeconds !== undefined) res.headers.set("retry-after", String(retryAfterSeconds));
  return res;
}

/**
 * GET /api/v1/preview/[address]
 * Check any wallet: its xStocks read live from Solana, priced with source and age, and every
 * active Play run through the engine on that one read. Nothing is stored and nothing is scored.
 *   400 invalid address · 429 more than 10 checks a minute from this IP
 *   503 the chain / price read failed, or the instance-wide check budget is spent
 * A fully priced answer is CDN-cacheable for 5 minutes (s-maxage=300); one with an unpriced
 * holding is no-store, so a price outage never tells a holder they don't qualify for 5 minutes. Public.
 */
export const GET = handler<Ctx>(async (req, ctx) => {
  const { address: raw } = await ctx.params;
  const parsed = PreviewAddress.safeParse(raw);
  if (!parsed.success) return noStore(fail("Invalid Solana address", 400, parsed.error.issues));

  const perIp = previewIpLimiter.take(clientIp(req));
  if (!perIp.ok) return noStore(fail("Too many wallet checks from this connection. Try again in a minute.", 429), perIp.retryAfterSeconds);
  const overall = previewGlobalLimiter.take("all");
  if (!overall.ok) return noStore(fail("Too many wallet checks right now. Try again in a minute.", 503), overall.retryAfterSeconds);

  try {
    const data = await getPreview(parsed.data);
    // A holding without a price reads as "not yet" for price-gated Plays: never let the CDN keep that answer.
    const unpriced = data.holdings.some((h) => h.quote.price === null);
    return ok(data, { headers: { "cache-control": unpriced ? "no-store" : PREVIEW_CACHE_CONTROL } });
  } catch (e) {
    console.warn(`[api/preview] check of ${parsed.data} failed: ${e instanceof Error ? e.message : String(e)}`);
    return noStore(fail("Couldn't read this wallet from Solana right now. Try again shortly.", 503));
  }
});
