/**
 * Pure helpers used by useSession / ConnectButton. No React, no window, so they
 * are unit-testable in the node vitest environment.
 */

import { WELCOME_COPY, WELCOME_TITLE, type PointsSummary, type WelcomeGrant } from "@/lib/games/ledger-policy";

/** Session shape returned by /api/v1/auth/me and /verify (mirrors "@/lib/auth/session" Session). */
export type Session = {
  userId: string;
  walletId: string;
  address: string;
  chainId: string;
};

export type SessionWallet = { chainId: string; address: string; isPrimary: boolean };

export type SessionUser = {
  id: string;
  handle: string | null;
  wallets: SessionWallet[];
  /**
   * The caller's points from /auth/me: spendable balance, Season points and rank. Null when the
   * server could not read them (it never fails /me for this); absent from older servers.
   */
  points?: PointsSummary | null;
};

/**
 * Payload of POST /api/v1/auth/verify. `welcome` is set only by the request that wrote the
 * one-off starter grant; null (or absent) on every other sign-in.
 */
export type VerifyResult = { session: Session; welcome?: WelcomeGrant | null };

/** Payload of GET /api/v1/auth/nonce. */
export type NonceResponse = {
  nonce: string;
  issuedAt: string;
  domain: string;
  uri: string;
  statement?: string;
};

/**
 * Body of POST /api/v1/auth/verify. The SIWS input itself comes from
 * siwsInputFromNonce() in "@/lib/auth/siws" (shared with the server, so the text the
 * wallet signs and the text the server rebuilds are always the same).
 */
export type VerifyBody = {
  address: string;
  /** The exact text the wallet signed. */
  message: string;
  /** base58 ed25519 signature. */
  signature: string;
  /** base58 bytes reported by wallet-standard signIn(); absent in the signMessage fallback. */
  signedMessage?: string;
  /** Already signed in and `address` belongs to another account: sign in to that account instead of failing with 409. */
  switch?: boolean;
};

/** Envelope shape produced by src/lib/server/api.ts. */
export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown };

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * True when a session exists but the connected wallet is a different address. The
 * session is kept (users own N wallets); the UI offers "Add this wallet" / "Switch account".
 */
export function isWalletMismatch(session: Session | null, connected: boolean, address: string | null): boolean {
  return Boolean(session && connected && address && session.address !== address);
}

/** "So11111111111111111111111111111111111111112" -> "So11…1112" */
export function truncateAddress(address: string, head = 4, tail = 4): string {
  if (!address) return "";
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Narrow an unknown JSON body to the API envelope and return its data, or throw. */
export function unwrapEnvelope<T>(json: unknown, status = 200): T {
  if (!json || typeof json !== "object" || !("ok" in json)) {
    throw new ApiClientError(`Unexpected response (${status})`, status);
  }
  const env = json as ApiEnvelope<T>;
  if (env.ok) return env.data;
  throw new ApiClientError(env.error || `Request failed (${status})`, status, env.issues);
}

/** fetch() wrapper for /api/v1 that always sends cookies and unwraps the envelope. */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new ApiClientError(`Request failed (${res.status})`, res.status);
    throw new ApiClientError("Response was not JSON", res.status);
  }
  return unwrapEnvelope<T>(json, res.status);
}

/** True when the error looks like the user closed or rejected a wallet prompt. */
export function isUserRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const code = "code" in err ? Number((err as { code?: unknown }).code) : NaN;
  if (code === 4001) return true; // EIP-1193 style user rejection, used by several Solana wallets too
  return /reject|cancel|denied|dismiss|closed/i.test(`${name} ${message}`);
}

/** Human-readable message for a thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

// ---------------------------------------------------------------------------
// Points display (points only, no cash value)
// ---------------------------------------------------------------------------

export const NO_CASH_VALUE = "Points only, no cash value";

const pointsFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "1,250"; anything that is not a finite number reads as "0". */
function pts(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? pointsFmt.format(Math.round(n)) : "0";
}

/** "+1,000" for credits, "−100" (true minus sign) for debits, "0" for nothing. */
export function signedPoints(delta: number): string {
  if (!Number.isFinite(delta) || Math.round(delta) === 0) return "0";
  return delta > 0 ? `+${pts(delta)}` : `−${pts(Math.abs(delta))}`;
}

/** True for a verify response's welcome that really granted starter points. Read defensively. */
export function isWelcomeGrant(welcome: unknown): welcome is WelcomeGrant {
  if (typeof welcome !== "object" || welcome === null) return false;
  const n = (welcome as { starterPoints?: unknown }).starterPoints;
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** How signInOutcome() in session-state reports a sign-in ("signed_in" accepted as an alias). */
export type SignInOutcome = "linked" | "signedIn" | "signed_in";

export interface SignInToastCopy {
  title: string;
  description: string;
  action?: { label: string; href: string };
}

/**
 * The toast after a successful verify. The welcome wins over "Wallet added": it is sent only by
 * the request that wrote the one-off starter grant, so dropping it would hide the grant for good.
 */
export function signInToast(outcome: SignInOutcome, welcome?: WelcomeGrant | null): SignInToastCopy {
  if (isWelcomeGrant(welcome)) {
    return { title: WELCOME_TITLE, description: WELCOME_COPY, action: { label: "Make a prediction", href: "/predictions" } };
  }
  if (outcome === "linked") return { title: "Wallet added", description: "Quests now verify against this wallet too." };
  return { title: "Signed in", description: "The entertainment layer for xStocks." };
}

/** Rank as shown next to Season points: "Rank #12" or "Not ranked yet". */
export function rankLabel(rank: number | null | undefined): string {
  return typeof rank === "number" && Number.isFinite(rank) && rank >= 1 ? `Rank #${pts(rank)}` : "Not ranked yet";
}

/**
 * The account menu's points block, at every width:
 *   "Points balance 1,000 pts", "Season points 50 · Rank #12", "Points only, no cash value".
 * Only the compliance line when the server sent no points.
 */
export function accountPointsLines(points: PointsSummary | null | undefined): string[] {
  if (!points || typeof points !== "object") return [NO_CASH_VALUE];
  return [
    `Points balance ${pts(points.balance)} pts`,
    `Season points ${pts(points.seasonPoints)} · ${rankLabel(points.rank)}`,
    NO_CASH_VALUE,
  ];
}

/**
 * The balance hint on /profile and /predictions: "Includes 1,000 starter points" only while the
 * balance shown still covers the grant. `starterPoints` is the grant (0 or 1,000 all Season), so
 * once points go into a prediction the balance drops below it and the line would be false.
 */
export function starterPointsHint(starterPoints: number | null | undefined, balance?: number | null): string {
  if (typeof starterPoints !== "number" || !Number.isFinite(starterPoints) || starterPoints <= 0) return NO_CASH_VALUE;
  if (typeof balance === "number" && !(balance >= starterPoints)) return NO_CASH_VALUE;
  return `Includes ${pts(starterPoints)} starter points`;
}
