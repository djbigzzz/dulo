import { NextResponse } from "next/server";
import { badgeMetadataJson } from "@/lib/badges/designs";
import { isBadgeKey } from "@/lib/badges/keys";
import { requestOrigin } from "@/lib/server/api";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/**
 * GET /api/v1/badges/[key]/metadata.json
 * The off-chain metadata document the Token-2022 mint's `uri` points at (Metaplex-style
 * JSON: name, symbol "DULO", description, image, attributes). Public, no envelope, so
 * wallets and explorers can read it directly. 404 for an unknown key.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  if (!isBadgeKey(key)) return NextResponse.json({ error: "Unknown badge" }, { status: 404 });
  const { origin } = requestOrigin(req, env().NEXT_PUBLIC_APP_URL);
  return NextResponse.json(badgeMetadataJson(key, origin), {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
