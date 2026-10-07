/**
 * Create or update Dulo's Solami webhook (lib/cron/solami-sync): the real players' linked
 * wallets, filtered to xStocks + PreStocks token transfers, pushed to
 * <NEXT_PUBLIC_APP_URL>/api/hooks/solami.
 *
 *   npm run solami:webhook          # with the production variables loaded in the shell
 *
 * Needs DATABASE_URL, SOLAMI_API_KEY (a standard key with WebhooksManage) and
 * NEXT_PUBLIC_APP_URL. Without SOLAMI_WEBHOOK_ID it creates the webhook and prints its id and
 * signing secret once: set them as SOLAMI_WEBHOOK_ID and SOLAMI_WEBHOOK_SECRET and redeploy.
 * With SOLAMI_WEBHOOK_ID it only updates the address list (sign-ins do the same on their own).
 */
import { syncSolamiWebhook } from "@/lib/cron/solami-sync";
import { db } from "@/lib/server/db";

async function main() {
  const result = await syncSolamiWebhook({ createIfMissing: true });
  if (result.skipped) {
    console.error(`Skipped: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${result.created ? "Created" : "Updated"} webhook ${result.webhookId}: ${result.addresses} wallets, ${result.mints} mints`);
  if (result.created) {
    console.log("\nSet these in the deployment, then redeploy (the secret is shown once):");
    console.log(`  SOLAMI_WEBHOOK_ID=${result.webhookId}`);
    console.log(`  SOLAMI_WEBHOOK_SECRET=${result.secret ?? "<not returned: copy it from the Solami dashboard>"}`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
