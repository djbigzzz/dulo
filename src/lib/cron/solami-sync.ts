/**
 * Keep the one Solami webhook (lib/adapters/solami) watching exactly the real players' linked
 * wallets, filtered to the registered issuers' mints. Called after a sign-in links a wallet and
 * by `npm run solami:webhook`. Bots are never watched (REAL_USER_WHERE). Server-only.
 */
import {
  buildWebhookSpec,
  createWebhook,
  updateWebhook,
  type SolamiClientOptions,
  type SolamiWebhook,
} from "@/lib/adapters/solami";
import { unionMintSet } from "@/lib/assets/registry";
import { SOLANA_MAINNET } from "@/lib/core";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { REAL_USER_WHERE } from "@/lib/server/queries";

export const SOLAMI_HOOK_PATH = "/api/hooks/solami";

export interface SolamiSyncResult {
  skipped: boolean;
  reason: string | null;
  created: boolean;
  webhookId: string | null;
  addresses: number;
  mints: number;
  /** Only on create: Solami shows the signing secret once. Never logged by this module. */
  secret?: string;
}

export function solamiConfigured(e = env()): boolean {
  return Boolean(e.SOLAMI_API_KEY);
}

export async function realUserWalletAddresses(): Promise<string[]> {
  const rows = await db.wallet.findMany({
    where: { chainId: SOLANA_MAINNET, user: REAL_USER_WHERE },
    select: { address: true },
  });
  return rows.map((r) => r.address);
}

/**
 * Update the webhook's address list, or create the webhook when `createIfMissing` and no
 * SOLAMI_WEBHOOK_ID is set (the script does this once; a sign-in never creates one).
 */
export async function syncSolamiWebhook(opts: { fetchImpl?: typeof fetch; createIfMissing?: boolean } = {}): Promise<SolamiSyncResult> {
  const e = env();
  const empty = { created: false, webhookId: e.SOLAMI_WEBHOOK_ID || null, addresses: 0, mints: 0 };
  if (!solamiConfigured(e)) return { ...empty, skipped: true, reason: "SOLAMI_API_KEY is empty" };
  if (!e.SOLAMI_WEBHOOK_ID && !opts.createIfMissing) return { ...empty, skipped: true, reason: "SOLAMI_WEBHOOK_ID is empty" };

  const [addresses, mints] = await Promise.all([realUserWalletAddresses(), unionMintSet()]);
  if (addresses.length === 0) return { ...empty, skipped: true, reason: "no real player wallet yet" };

  const hookUrl = new URL(SOLAMI_HOOK_PATH, e.NEXT_PUBLIC_APP_URL).toString();
  const spec = buildWebhookSpec({ hookUrl, addresses, mints });
  const client: SolamiClientOptions = { apiKey: e.SOLAMI_API_KEY, apiUrl: e.SOLAMI_API_URL, fetchImpl: opts.fetchImpl };

  let hook: SolamiWebhook;
  let created = false;
  if (e.SOLAMI_WEBHOOK_ID) {
    hook = await updateWebhook(client, e.SOLAMI_WEBHOOK_ID, spec);
  } else {
    hook = await createWebhook(client, spec);
    created = true;
  }
  return {
    skipped: false,
    reason: null,
    created,
    webhookId: hook.id ?? e.SOLAMI_WEBHOOK_ID ?? null,
    addresses: spec.addresses.length,
    mints: spec.transfer_filter.mints.length,
    ...(created && typeof hook.secret === "string" ? { secret: hook.secret } : {}),
  };
}
