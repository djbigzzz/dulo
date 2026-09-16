import { z } from "zod";

/**
 * Server-only environment. Import from route handlers, cron, and lib/server code only.
 * Anything prefixed NEXT_PUBLIC_ is readable by the client and lives in lib/config.ts.
 */

/** Shortest CRON_SECRET the schema accepts; a one-character secret is guessable from a pinger's logs. */
export const CRON_SECRET_MIN_LENGTH = 16;
/** The .env.example placeholder starts with this; a production deploy that kept it is refused. */
export const CRON_SECRET_PLACEHOLDER_PREFIX = "change-me";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when `secret` is still the copied .env.example placeholder (any case). */
export function isPlaceholderCronSecret(secret: string): boolean {
  return secret.trim().toLowerCase().startsWith(CRON_SECRET_PLACEHOLDER_PREFIX);
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Prisma CLI only (schema `directUrl`): Supabase direct connection, or the same value as DATABASE_URL on local Postgres. */
  DIRECT_URL: z.string().optional(),
  HELIUS_API_KEY: z.string().default(""),
  JUPITER_API_KEY: z.string().default(""),
  /** HS256 session key, at least 32 characters (`openssl rand -base64 48`). Enforced again in lib/auth/token.ts. */
  JWT_SECRET: z.string().min(32),
  /**
   * Bearer token for /api/cron/* (Vercel Cron, the Actions pinger). At least 16 characters (`openssl rand -hex 16`).
   * In production the .env.example placeholder ("change-me…") is refused: it is public in the repo.
   */
  CRON_SECRET: z
    .string()
    .min(CRON_SECRET_MIN_LENGTH)
    .refine((v) => !(isProduction() && isPlaceholderCronSecret(v)), {
      message: `CRON_SECRET still holds the "${CRON_SECRET_PLACEHOLDER_PREFIX}" placeholder; set a random value in production`,
    }),
  SERVER_WALLET_SECRET: z.string().default(""),
  PYTH_HERMES_URL: z.string().default("https://hermes.pyth.network"),
  PYTH_API_KEY: z.string().default(""),
  XSTOCKS_API_URL: z.string().default("https://api.xstocks.fi/api/v2/public"),
  NEXT_PUBLIC_RPC: z.string().default("https://api.mainnet-beta.solana.com"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export const HELIUS_RPC_HOST = "mainnet.helius-rpc.com";

function rpcUrlFor(e: Pick<ServerEnv, "HELIUS_API_KEY" | "NEXT_PUBLIC_RPC">): string {
  return e.HELIUS_API_KEY ? `https://${HELIUS_RPC_HOST}/?api-key=${e.HELIUS_API_KEY}` : e.NEXT_PUBLIC_RPC;
}

/** Helius RPC URL (falls back to NEXT_PUBLIC_RPC when no key is set). Carries the key: never log or return it. */
export function rpcUrl(): string {
  return rpcUrlFor(env());
}

/**
 * The host of the RPC the server reads the chain through, safe to print: the URL's host only,
 * never its path, query (Helius puts the key there) or credentials. "invalid" when unparseable.
 */
export function rpcHost(e: Pick<ServerEnv, "HELIUS_API_KEY" | "NEXT_PUBLIC_RPC"> = env()): string {
  try {
    return new URL(rpcUrlFor(e)).host || "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Deploy-configuration warnings for the tick health summary (15 Sep review M-I).
 * Only production warns: locally a keyless public RPC and keyless Jupiter are expected.
 * Messages name hosts and variables, never a secret value.
 */
export function configWarnings(
  e: Pick<ServerEnv, "HELIUS_API_KEY" | "JUPITER_API_KEY" | "NEXT_PUBLIC_RPC"> = env(),
  production: boolean = isProduction(),
): string[] {
  if (!production) return [];
  const out: string[] = [];
  if (!e.HELIUS_API_KEY) {
    out.push(`HELIUS_API_KEY is empty: chain reads fall back to ${rpcHost(e)}, which rate-limits wallet snapshots`);
  }
  if (!e.JUPITER_API_KEY) {
    out.push("JUPITER_API_KEY is empty: keyless Jupiter Price is throttled and serves stale or missing prices under load");
  }
  return out;
}
