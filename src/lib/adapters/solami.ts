import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Solami webhooks (https://solami.dev/docs/webhooks): Solami watches the real players' linked
 * wallets for xStocks and PreStocks transfers and POSTs a signed event to /api/hooks/solami the
 * moment one lands, instead of Dulo waiting for the next 5-minute snapshot.
 *
 * A delivery is a trigger only. Nothing in its payload is scored: the route maps it to the
 * affected players and runs lib/cron/tick runForUser, which re-reads every holding through the
 * ChainAdapter and evaluates the quests exactly as the cron does. So a forged or malformed event
 * can at most cause one extra read, and it is refused before that unless its HMAC checks out.
 *
 * Server-only. The API key and the signing secret never leave the server.
 */

export const SOLAMI_DEFAULT_API_URL = "https://api.solami.dev";
export const SOLAMI_WEBHOOK_LABEL = "dulo-quests";
/** The events that can change an xStock or pre-IPO holding. */
export const SOLAMI_EVENT_TYPES = ["transfer", "swap", "mint", "burn"] as const;

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * True when `header` is an HMAC-SHA256 of the raw `body` under `secret`. Solami documents the
 * header as "an HMAC of the body with your secret" without fixing the encoding, so hex, base64
 * and a "sha256=" prefix are all accepted; comparisons are constant-time. An empty secret or
 * header is always false.
 */
export function verifySolamiSignature(body: string, header: string | null | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const mac = createHmac("sha256", secret).update(body, "utf8").digest();
  for (const raw of header.split(",")) {
    const value = raw.trim().replace(/^(sha256=|v1=)/i, "");
    if (!value) continue;
    if (/^[0-9a-f]+$/i.test(value) && safeEqual(Buffer.from(value, "hex"), mac)) return true;
    if (safeEqual(Buffer.from(value, "base64"), mac)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
/** Deliveries are small; a payload walk stops here rather than trusting an unbounded body. */
const MAX_NODES = 20_000;

export interface SolamiDelivery {
  /** Transaction signatures in the delivery (an envelope's `signature`), deduplicated. */
  signatures: string[];
  /** Every base58 string that could be an account address, deduplicated. */
  candidateAddresses: string[];
}

/**
 * Pull the transaction signatures and the candidate addresses out of a delivery (one envelope
 * or an array of them). The enriched schema is walked generically on purpose: the route only
 * needs to know which of our wallets a transaction touched, and it checks each candidate
 * against the Wallet table, so an unknown or renamed field costs nothing.
 */
export function parseSolamiDelivery(payload: unknown): SolamiDelivery {
  const signatures = new Set<string>();
  const addresses = new Set<string>();
  const stack: Array<{ value: unknown; key: string | null }> = [{ value: payload, key: null }];
  let seen = 0;
  while (stack.length > 0 && seen < MAX_NODES) {
    const { value, key } = stack.pop()!;
    seen += 1;
    if (typeof value === "string") {
      if (key === "signature" && BASE58_SIGNATURE.test(value)) signatures.add(value);
      else if (BASE58_ADDRESS.test(value)) addresses.add(value);
    } else if (Array.isArray(value)) {
      for (const v of value) stack.push({ value: v, key });
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) stack.push({ value: v, key: k });
    }
  }
  return { signatures: [...signatures], candidateAddresses: [...addresses] };
}

// ---------------------------------------------------------------------------
// Replay guard: Solami retries a failed delivery three times.
// ---------------------------------------------------------------------------

export interface SeenSignatures {
  /** True when every signature was already seen inside the window; records them either way. */
  allSeen(signatures: readonly string[], nowMs?: number): boolean;
  reset(): void;
}

export function createSeenSignatures(opts: { windowMs: number; maxEntries?: number }): SeenSignatures {
  const maxEntries = Math.max(1, opts.maxEntries ?? 5_000);
  const seen = new Map<string, number>();
  return {
    allSeen(signatures, nowMs = Date.now()) {
      if (signatures.length === 0) return false;
      let all = true;
      for (const sig of signatures) {
        const at = seen.get(sig);
        if (at === undefined || nowMs - at >= opts.windowMs) all = false;
        seen.delete(sig);
        seen.set(sig, nowMs);
      }
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next();
        if (oldest.done) break;
        seen.delete(oldest.value);
      }
      return all;
    },
    reset() {
      seen.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Health: what /api/hooks/solami GET reports (per server instance, reset on deploy).
// ---------------------------------------------------------------------------

export interface SolamiHookHealth {
  deliveries: number;
  rejected: number;
  duplicates: number;
  /** Deliveries that touched at least one real player's wallet. */
  matched: number;
  lastDeliveryAt: string | null;
  /** The last triggered re-read: how long it took and how many quests it newly completed. */
  lastRun: { at: string; users: number; tookMs: number; newlyCompleted: number } | null;
}

export function createHookHealth() {
  const state: SolamiHookHealth = { deliveries: 0, rejected: 0, duplicates: 0, matched: 0, lastDeliveryAt: null, lastRun: null };
  return {
    delivery(now: Date) {
      state.deliveries += 1;
      state.lastDeliveryAt = now.toISOString();
    },
    rejected() {
      state.rejected += 1;
    },
    duplicate() {
      state.duplicates += 1;
    },
    matched() {
      state.matched += 1;
    },
    run(run: NonNullable<SolamiHookHealth["lastRun"]>) {
      state.lastRun = run;
    },
    snapshot(): SolamiHookHealth {
      return { ...state, lastRun: state.lastRun ? { ...state.lastRun } : null };
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook management (POST /webhooks/create | /webhooks/update, key with WebhooksManage)
// ---------------------------------------------------------------------------

export interface SolamiWebhookSpec {
  label: string;
  addresses: string[];
  url: string;
  stream: boolean;
  event_types: string[];
  payload_kind: "enriched";
  auto_region: true;
  transfer_filter: { mints: string[]; native: false; tokens: true };
  tx_status: { succeeded: true; failed: false };
}

/**
 * The one webhook Dulo runs: the real players' wallets, filtered server-side to token transfers
 * of the registered issuers' mints (xStocks + PreStocks), pushed to `hookUrl`.
 */
export function buildWebhookSpec(opts: { hookUrl: string; addresses: Iterable<string>; mints: Iterable<string> }): SolamiWebhookSpec {
  return {
    label: SOLAMI_WEBHOOK_LABEL,
    addresses: [...new Set(opts.addresses)].sort(),
    url: opts.hookUrl,
    stream: false,
    event_types: [...SOLAMI_EVENT_TYPES],
    payload_kind: "enriched",
    auto_region: true,
    transfer_filter: { mints: [...new Set(opts.mints)].sort(), native: false, tokens: true },
    tx_status: { succeeded: true, failed: false },
  };
}

export interface SolamiClientOptions {
  apiKey: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

async function call<T>(opts: SolamiClientOptions, path: string, body: unknown): Promise<T> {
  const base = (opts.apiUrl || SOLAMI_DEFAULT_API_URL).replace(/\/+$/, "");
  const url = new URL(base + path);
  url.searchParams.set("api_key", opts.apiKey);
  const res = await (opts.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  // The key rides in the query: errors name the path and status, never the URL.
  if (!res.ok) throw new Error(`Solami ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface SolamiWebhook {
  id: string;
  secret?: string;
  [k: string]: unknown;
}

/** Unwraps `{ data: X }` or `X`. */
function unwrap<T>(v: unknown): T {
  return (typeof v === "object" && v !== null && "data" in v ? (v as { data: T }).data : v) as T;
}

export async function createWebhook(opts: SolamiClientOptions, spec: SolamiWebhookSpec): Promise<SolamiWebhook> {
  return unwrap<SolamiWebhook>(await call(opts, "/webhooks/create", spec));
}

export async function updateWebhook(opts: SolamiClientOptions, id: string, spec: SolamiWebhookSpec): Promise<SolamiWebhook> {
  return unwrap<SolamiWebhook>(await call(opts, "/webhooks/update", { id, ...spec }));
}
