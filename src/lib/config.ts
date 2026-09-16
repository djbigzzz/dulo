/** Client-safe config. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Dulo";

export const LOCAL_APP_URL = "http://localhost:3000";

export interface AppUrlEnv {
  NEXT_PUBLIC_APP_URL?: string;
  /** Vercel system env: the production domain without a scheme ("dulo.fun" or "dulo.vercel.app"). */
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

/**
 * The public app origin, no trailing slash. NEXT_PUBLIC_APP_URL wins; otherwise
 * https://${VERCEL_PROJECT_PRODUCTION_URL} when Vercel provides it; otherwise localhost.
 * Pure so lib/badges/mint and tests resolve it the same way.
 */
export function resolveAppUrl(e: AppUrlEnv): string {
  const explicit = e.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = e.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (vercel) return `https://${vercel}`;
  return LOCAL_APP_URL;
}

/** True for localhost / 127.0.0.1 / [::1] / 0.0.0.0 origins, or anything that is not a URL. */
export function isLocalAppUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
}

// Literal process.env reads so Next can inline them; VERCEL_PROJECT_PRODUCTION_URL is server-only
// (the client sees the NEXT_PUBLIC_ twin when Vercel exposes system env vars).
export const APP_URL = resolveAppUrl({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
});
export const RPC_URL = process.env.NEXT_PUBLIC_RPC ?? "https://api.mainnet-beta.solana.com";
export const POSITIONING = "The entertainment layer for xStocks. Compete, predict and get rewarded, for points.";
export const SEASON_NAME = "Stocks Season";
