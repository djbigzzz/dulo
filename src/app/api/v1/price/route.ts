/**
 * GET /api/v1/price?symbols=TSLAx,AAPLx
 * GET /api/v1/price?ids=<caip19>,<caip19>
 *
 * -> ok({ quotes: PriceQuote[], unknown: string[] })
 *
 * At most 50 assets per request. `unknown` lists symbols the catalogue does not know;
 * unknown CAIP-19 ids come back as quotes with source "none" so callers can key on them.
 */
import { z } from "zod";
import type { AssetId, PriceQuote } from "@/lib/core";
import { isAssetId } from "@/lib/core";
import { getPrices, getPricesBySymbols } from "@/lib/price";
import { ApiError, handler, ok, parseQuery } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const MAX_ASSETS = 50;

/** Accepts `?x=a,b` and repeated `?x=a&x=b`; yields a trimmed, de-duplicated list. */
const listParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const raw = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const items = raw.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    return [...new Set(items)];
  });

const Query = z.object({ symbols: listParam, ids: listParam });

export const GET = handler(async (req) => {
  const q = parseQuery(req, Query);
  const symbols = q.symbols;
  const ids = q.ids;

  if (symbols.length === 0 && ids.length === 0) {
    throw new ApiError("Provide ?symbols=TSLAx,AAPLx or ?ids=<caip19>", 400);
  }
  if (symbols.length + ids.length > MAX_ASSETS) {
    throw new ApiError(`At most ${MAX_ASSETS} assets per request`, 400);
  }
  const badIds = ids.filter((id) => !isAssetId(id));
  if (badIds.length > 0) {
    throw new ApiError("Invalid CAIP-19 asset id(s)", 400, badIds);
  }

  const [bySymbol, byId] = await Promise.all([
    symbols.length ? getPricesBySymbols(symbols) : Promise.resolve({ quotes: [] as PriceQuote[], unknown: [] as string[] }),
    ids.length ? getPrices(ids as AssetId[]) : Promise.resolve(new Map<AssetId, PriceQuote>()),
  ]);

  const quotes: PriceQuote[] = [];
  const seen = new Set<AssetId>();
  for (const quote of [...bySymbol.quotes, ...byId.values()]) {
    if (seen.has(quote.assetId)) continue;
    seen.add(quote.assetId);
    quotes.push(quote);
  }

  return ok({ quotes, unknown: bySymbol.unknown }, { headers: { "cache-control": "no-store" } });
});
