import { z } from "zod";
import { ApiError, handler, ok } from "@/lib/server/api";
import { getPartner } from "@/lib/server/queries";
import type { PartnerResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

const Slug = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-_]*$/i, "Invalid partner slug");

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/partners/[slug] — one Partner with Campaigns, Plays and completion counts. 404 when unknown. */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { slug: raw } = await ctx.params;
  const parsed = Slug.safeParse(raw);
  if (!parsed.success) throw new ApiError("Invalid partner slug", 400, parsed.error.issues);
  const partner = await getPartner(parsed.data);
  if (!partner) throw new ApiError("Partner not found", 404);
  const data: PartnerResponse = partner;
  return ok(data);
});
