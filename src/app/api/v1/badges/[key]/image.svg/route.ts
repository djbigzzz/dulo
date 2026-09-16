import { BADGE_SVGS } from "@/lib/badges/designs";
import { isBadgeKey } from "@/lib/badges/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/**
 * GET /api/v1/badges/[key]/image.svg
 * The badge artwork (512x512 inline SVG built from the Dulo tamga). Public, cacheable;
 * the same bytes back the profile grid and the on-chain metadata image. 404 for an unknown key.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  if (!isBadgeKey(key)) return new Response("Unknown badge", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(BADGE_SVGS[key], {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
