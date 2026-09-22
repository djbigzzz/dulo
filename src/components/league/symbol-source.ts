import type { LeagueSymbolSource, LeagueSymbolView } from "@/lib/api-client";

/**
 * The issuer a competition symbol belongs to, as the UI reads it. GET /league/symbols tags
 * every entry with `source` since 22 Sep; an older payload without the tag is an xStock, the
 * Season 0 default. Client-safe, no React.
 */
export function symbolSource(s: Pick<LeagueSymbolView, "source">): LeagueSymbolSource {
  return s.source === "prestocks" ? "prestocks" : "xstocks";
}

/** True for a pre-IPO token entry from the symbols endpoint. */
export function isPreIpoSymbol(s: Pick<LeagueSymbolView, "source">): boolean {
  return symbolSource(s) === "prestocks";
}
