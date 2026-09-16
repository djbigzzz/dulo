import { handler, ok } from "@/lib/server/api";
import { listPartners } from "@/lib/server/queries";
import type { PartnersResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/** GET /api/v1/partners — every listed Partner with its Play and completion counts. */
export const GET = handler(async () => {
  const partners = await listPartners();
  const data: PartnersResponse = { partners };
  return ok(data);
});
