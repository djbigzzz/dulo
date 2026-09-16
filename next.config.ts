import type { NextConfig } from "next";

// Self-contained on purpose: next.config.ts is compiled on its own, so no imports from src/.

/** Headers on every response. Route handlers keep their own (the badge image/metadata CORS header). */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nobody frames Dulo (clickjacking on wallet sign-in). XFO for old browsers, frame-ancestors for the rest.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const LOCAL_HOST_RE = /^(localhost|.*\.localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

/**
 * A production Vercel build must bake a public origin into og:url and Badge metadata URIs
 * (a Badge's `uri` is written on-chain and cannot be changed). Returns the reason to fail, or null.
 */
export function productionAppUrlProblem(e: Record<string, string | undefined>): string | null {
  if (e.VERCEL_ENV !== "production") return null;
  const raw = e.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "NEXT_PUBLIC_APP_URL is missing";
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return `NEXT_PUBLIC_APP_URL is not a URL: ${raw}`;
  }
  if (LOCAL_HOST_RE.test(host) || /localhost/i.test(raw)) return `NEXT_PUBLIC_APP_URL points at localhost: ${raw}`;
  return null;
}

const appUrlProblem = productionAppUrlProblem(process.env);
if (appUrlProblem) {
  throw new Error(`Refusing a production build: ${appUrlProblem}. Set it to the public origin (e.g. https://dulo.fun) in Vercel env.`);
}

/**
 * Page routes renamed to plain names on 15 Sep 2026; Rewards became Quests and Paper trading became
 * Competition on 16 Sep. Old links keep working, and every old path points straight at the current
 * page (one hop, no redirect chains). API routes did not move.
 */
export const ROUTE_RENAMES: { from: string; to: string }[] = [
  { from: "/plays", to: "/quests" },
  { from: "/rewards", to: "/quests" },
  { from: "/league", to: "/competition" },
  { from: "/paper-trading", to: "/competition" },
  { from: "/calls", to: "/predictions" },
  { from: "/mirror", to: "/copy" },
];

const nextConfig: NextConfig = {
  // The dev-mode "N" badge sits on top of the mobile tab bar and ends up in local screen recordings.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return ROUTE_RENAMES.flatMap(({ from, to }) => [
      { source: from, destination: to, permanent: true },
      { source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true },
    ]);
  },
};

export default nextConfig;
