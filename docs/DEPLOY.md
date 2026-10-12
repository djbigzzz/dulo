# Deploy the demo

Everything in this file is free and takes about twenty minutes. At the end there is a public URL
that a judge can open, connect a wallet to and play. The README's Deploy section covers the full
setup and what a paid plan would change; this is the shortest path to a working demo, and it is
how production runs (Vercel Hobby + Neon).

There is no smart contract to deploy, no migration to write and no build step that touches the
database. The only thing the app needs that a laptop does not provide is one Postgres database.

**Submissions close Fri 25 Sep 2026, 16:00 ET.** Press **Submit Project** as soon as a URL exists
(Save Draft is not a submission), then keep editing.

---

## 1. Push the repo

```bash
git status --ignored --short | grep "docs/private"
```

That must print `!! docs/private/` — it is the only directory holding private notes, and it has to
stay out of a public repo. The repo is `github.com/djbigzzz/dulo`, pushed public on 21 Sep 2026.
To recreate it elsewhere, make an empty public repo with no README, .gitignore or licence, then:

```bash
git remote add origin https://github.com/djbigzzz/dulo.git
git push -u origin main
```

## 2. Create the database

Any Postgres works. [Neon](https://neon.tech) free tier is the fastest: new project, region
**AWS US East (N. Virginia)** so it sits next to Vercel's default `iad1`. From the dashboard copy
both connection strings — the **pooled** one and the **direct / unpooled** one. Prisma needs both:
it cannot run schema changes over a connection pooler.

Vercel's own Storage tab can create the same Neon database from inside the project, which sets
`DATABASE_URL` for you. Take the direct URL from the Neon dashboard afterwards either way.

## 3. Deploy on Vercel

Import the repo at [vercel.com/new](https://vercel.com/new). Framework detection is correct and no
build settings need changing. Before the first deploy, add these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooled Postgres URL |
| `DIRECT_URL` | the direct / unpooled Postgres URL |
| `JWT_SECRET` | 32+ random characters |
| `CRON_SECRET` | 16+ random characters |
| `NEXT_PUBLIC_APP_URL` | `https://<project>.vercel.app` |
| `JUPITER_API_KEY` | free at [portal.jup.ag](https://portal.jup.ag) — see below |

Generate the two secrets yourself and paste them straight into Vercel:

```bash
openssl rand -base64 48
```

```bash
openssl rand -hex 16
```

`NEXT_PUBLIC_APP_URL` must not be a localhost address: a production build fails without a real
origin, and it is baked into badge metadata at mint time. **The URL is not what you expect**: a
project named `dulo` did not get `dulo.vercel.app` (taken), it got `https://dulo-iota.vercel.app`.
Read the real production domain off the project's Domains tab after the first deploy, then correct
the variable and redeploy.

**Set the two `NEXT_PUBLIC_*` variables as type Config, not Secret.** Vercel's paste box defaults
every variable to Secret. A public-prefixed Secret is flagged "needs attention", its edit form will
not save, and a Secret can never be changed to Config -- the only way out is delete and re-create.
The database URLs and the two secrets are correctly Secret.

**`JUPITER_API_KEY` is the one key worth the two minutes.** Keyless Jupiter throttles to about half
a request per second and starts returning 429s under normal click-through, which shows up as prices
going stale in the middle of a demo. `HELIUS_API_KEY` is optional — without it, chain reads fall
back to the public `api.mainnet-beta.solana.com`, which works but rate-limits wallet snapshots. The
wallet check page reads about a dozen accounts per address, so add Helius if a judge is likely to
paste several wallets. `PYTH_API_KEY` and `SERVER_WALLET_SECRET` stay empty: predictions settle
from Jupiter with the source shown on every card, and badges read "Minting soon" until a funded
server wallet exists.

## 4. Fill the database

Run `npm run db:neon` on the block Neon gives you (it maps their names onto Prisma's and adds the
pooler parameters), then `npm run env:vercel -- <url>` writes `vercel.env.txt` for the Vercel paste.
That file is disposable: the deployment is the source of truth for secrets. Never paste the whole
file back into Vercel later -- `JWT_SECRET` was rotated once before the script learned to reuse
values, so the deployed one is not the one on disk, and re-pasting would sign out every session.

Create `.env.production.local` in the repo (it is gitignored) with the same two database URLs:

```
DATABASE_URL="<pooled URL>"
DIRECT_URL="<direct URL>"
```

Then, from the repo:

```bash
npm run db:setup -- --env .env.production.local
```

That pushes the schema and runs the seed against that database and nothing else. It is idempotent,
so it is safe to run again. It creates Season 0, four partners, 19 quests, the 15 house bots with
plausible trades, this week's competition and the three weekly prediction markets with their strikes
taken from live prices. It does not create users — the first real account is the first wallet that
signs in.

Expect a line like `48 rows (19 created, 29 updated)` at the end.

## 5. Keep the clock running

One tick runs the games, snapshots wallets, evaluates quests and mints badges.
Vercel's Hobby plan only allows daily crons, so the repo ships a GitHub Actions pinger that does the
same job for free. It stays inert until you switch it on, in **Settings → Secrets and variables →
Actions**:

- Variables: `TICK_PINGER_ENABLED` = `true`, and `APP_URL` = `https://<project>.vercel.app` (no trailing slash)
- Secrets: `CRON_SECRET` = the same value you set in Vercel

Then run it once by hand: **Actions → Cron tick (Hobby fallback) → Run workflow**. A green run means
the whole backend works end to end. The pinger asks for a tick every five minutes, but GitHub runs
scheduled workflows late or skips them under load: in production the median gap between runs has
been about 4.75 hours. Sign-in and Refresh on `/quests` read a player's wallets at once, and the
prediction and competition boards run an overdue settlement or rollover when they are read.

`vercel.json` also schedules one daily run at 21:10 UTC, after the Friday settle in both summer and
winter time: if the pinger is ever off, the week still settles. On Vercel Pro you can raise that schedule
to `*/5 * * * *` and skip the pinger entirely.

## 6. Check it

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/cron/tick" | jq '.data.health'
```

Send the secret in the header, never in a query string — the route refuses a query-string secret in
production because it would land in request logs.

Then open the site and walk the judge path:

1. The landing shows this week's featured prediction with its price (source and age) and the other
   two as rows, and three game tiles with real numbers rather than dashes (9 Oct 2026: calm
   redesign). If the card is stuck on a skeleton, the database is empty — step 4 did not run
   against this database.
2. **Check a wallet** → **Public holder A**. This is the strongest page in the app and needs no
   sign-in: it reads a real mainnet wallet, applies the Token-2022 multipliers and shows which
   on-chain quests that wallet already meets, with every price carrying its source and age.
3. **Connect wallet** and sign one message. There is no transaction. The welcome toast gives 1,000
   starter points and $10,000 of virtual cash.
4. Make a prediction, place a paper trade, open a quest's proof drawer.

Do all of this in an incognito window with Phantom, on desktop and on a phone, before recording
anything.

## 7. Correct the docs that say it is not deployed

The repo currently states, in several places, that nothing is deployed. Those lines are true today
and false the moment step 3 finishes, and a judge reads the README. Update exactly these:

- `README.md:9` — the bold "Not deployed yet" line. Replace with the live URL.
- `README.md:82` — "nothing is deployed, so every count reads zero" inside the judging table.
- `README.md:347` — the traction section, "The app is not deployed".
- `README.md:457` — the limitations list, "Not deployed."
- `CLAUDE.md:5` — the Status line.
- `docs/HANDOFF.md:81`, `:410`, `:473` — the end-to-end row, the video shoot note and the checklist.

Keep the rest of the honesty intact: after a deploy there is still no partner signed, no billing and
no minted badge until a funded server wallet exists, and the player count is whatever it actually
is. Replacing "not deployed" with a live URL is the only claim that changes.

## 8. Then submit

`docs/SUBMISSION.md` holds the paste-ready form copy. Press **Submit Project** with the main track
as soon as the URL is live. The form stays editable until the close.

---

## If something is wrong

**Landing cards never load.** The database has no markets. Re-run step 4 and confirm the env file
points at the deployed database, not the local one — the script prints the host it is about to
write to.

**Prices show as stale or missing.** Keyless Jupiter is being throttled; set `JUPITER_API_KEY`.

**A prediction sits locked and unsettled past its Friday.** No tick has run. Check step 5, and run
the workflow by hand.

**Wallet snapshots fail or time out.** The public RPC is rate-limiting. Set `HELIUS_API_KEY`.

**The build fails on `NEXT_PUBLIC_APP_URL`.** It is still a localhost value. Set the real origin.

**Sign-in fails with an internal error.** The app cannot reach Postgres. Check `DATABASE_URL` in
Vercel, and that the database is awake — Neon's free tier suspends an idle database and the first
request after that pays the wake-up.

## Local development: the tick and the checks

Run one cron tick, the same request the scheduler sends (in production, the GitHub Actions pinger, whose median gap has been about 4.75 hours, and Vercel's daily cron; see [Full setup reference](#full-setup-reference)). `?steps=` picks a subset of `games,snapshot,evaluate,badges`. The evaluate step also gives starter points to any real player who signed in before they existed:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/tick"
curl -s -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/tick?steps=snapshot,evaluate"
```

Checks:

```bash
npx vitest run      # 1,558 tests across 75 files on 10 Oct 2026; no database needed
npx next typegen    # once on a fresh clone: next-env.d.ts and .next/types are gitignored, and tsc needs the route types
npm run typecheck
npm run lint
npm run build       # stop the dev server first (they share .next)
```

## Environment variables

Server-only variables are parsed by `src/lib/server/env.ts`. `NEXT_PUBLIC_*` variables are bundled into the client, so never put a secret in one. The template is `.env.example`.

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres, pooled for the app runtime. Production runs on Neon: its pooled URL (the `-pooler` host) with `pgbouncer=true&connection_limit=1`, which `npm run db:neon` adds. On Supabase, use the transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1&connect_timeout=5`. Locally, a plain URL. |
| `DIRECT_URL` | Prisma CLI | Used by `prisma db push` / `migrate` only, because schema changes cannot run through a pooler. On Neon this is the direct (unpooled) URL; on Supabase the session pooler (port 5432); locally it is the same value as `DATABASE_URL`. |
| `JWT_SECRET` | yes | HS256 session key, 32+ characters (`openssl rand -base64 48`). |
| `CRON_SECRET` | yes | 16+ characters (`openssl rand -hex 16`), accepted only as `Authorization: Bearer` in production. The `.env.example` placeholder is refused in production. |
| `HELIUS_API_KEY` | production | Helius RPC for every chain read. When empty, reads fall back to `NEXT_PUBLIC_RPC`, and the production tick health lists a warning. |
| `JUPITER_API_KEY` | production | Jupiter Price v3 key (free at portal.jup.ag). Keyless Jupiter is throttled and serves stale or missing prices under load. |
| `SERVER_WALLET_SECRET` | for badges | Base58 or JSON-array secret key of the badge-minting wallet. When empty, badges stay "Minting soon". |
| `PYTH_API_KEY` | no | Unset in Season 0. Without it, Jupiter prices the competition and settles the predictions, with the source shown. |
| `PYTH_HERMES_URL` | no | Default `https://hermes.pyth.network`. |
| `XSTOCKS_API_URL` | no | Default `https://api.xstocks.fi/api/v2/public`. |
| `NEXT_PUBLIC_APP_URL` | production | The public origin. A production Vercel build fails without a non-localhost value. It is baked into badge metadata URIs at mint time. |
| `NEXT_PUBLIC_RPC` | no | Public fallback RPC when `HELIUS_API_KEY` is empty (default `https://api.mainnet-beta.solana.com`). Never put a key here. |
| `NEXT_PUBLIC_APP_NAME` | no | Default `Dulo`. |
| `NEXT_PUBLIC_GITHUB_URL`, `NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_VIDEO_URL` | no | Footer links, rendered only when set. Read at build time. |
| `NEXT_PUBLIC_PARTNER_CONTACT` | no | A `mailto:` or https URL for the `/partners` "Talk to us" button. Hidden when unset. |
| `SOLAMI_API_KEY` | no | Solami standard key with WebhooksManage. Enables the webhook that re-reads a player's wallets within seconds of a transfer. Unset in production, so the webhook is off; empty = sign-in, Refresh and the scheduled tick alone. |
| `SOLAMI_API_URL` | no | Default `https://api.solami.dev`. |
| `SOLAMI_WEBHOOK_ID`, `SOLAMI_WEBHOOK_SECRET` | with a Solami key | Printed once by `npm run solami:webhook`. Without the secret, `/api/hooks/solami` refuses every delivery. |
| `FOUNDER_WALLETS` | script only | Comma-separated founder wallets that `npm run stats` excludes. |

## Full setup reference

Steps 1 to 8 above are the short version. Production runs that way today (Vercel Hobby, Neon Postgres in us-east-1). What follows is the full setup, and what a paid plan would change.

1. **Scheduling.** `vercel.json` pins functions to `iad1` and schedules `/api/cron/tick` once a day at 21:10 UTC, chosen to fall after the Friday settle in both summer and winter time, because Hobby refuses any cron that runs more than once a day; Hobby may fire it any time in that hour. `.github/workflows/tick.yml` asks GitHub Actions for a tick every 5 minutes once `TICK_PINGER_ENABLED` is set, but GitHub runs scheduled workflows late or skips them under load: in production the median gap between pinger runs has been about 4.75 hours, so the scheduled tick runs hours apart, not minutes. Both send `CRON_SECRET` as the Bearer header, and the tick route allows up to 300 seconds. Reads cover the gaps: sign-in and Refresh re-read one player's wallets and evaluate their quests at once (`runForUser`), and the prediction and competition boards run an overdue settlement or weekly rollover when they are read (`src/lib/cron/catch-up.ts`). On Pro, raise the `vercel.json` schedule to `*/5 * * * *` for a real 5-minute tick, and the pinger becomes redundant.
2. **Postgres in us-east-1**, next to `iad1`. Production uses Neon; any Postgres works.
   - **Neon (production):** `DATABASE_URL` is the pooled URL (its host contains `-pooler`) with `pgbouncer=true&connection_limit=1`, and `DIRECT_URL` is the direct, unpooled one. Paste Neon's `.env` block into `.env.production.local` and `npm run db:neon` maps it onto those two names.
   - **Supabase:** `DATABASE_URL` is the transaction pooler: `postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&connect_timeout=5`, and `DIRECT_URL` is the session pooler on port 5432 of the same host, not `db.<ref>.supabase.co`.
3. **Keys and URLs.** Set `HELIUS_API_KEY`, `JUPITER_API_KEY`, `JWT_SECRET` and `CRON_SECRET`. Set `NEXT_PUBLIC_APP_URL` to the public origin before the first badge mint: `https://projectdulo.com` in production since 7 Oct 2026, or `https://<project>.vercel.app` until a custom domain resolves.
4. **Schema and seed.** With the production variables loaded in your shell, run `npx prisma db push` then `npx prisma db seed` (or `npm run db:setup -- --env .env.production.local`, which does both against that file's database only). The seed is idempotent.
5. **Check the tick.**
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/cron/tick" | jq '.data.health'
   ```
   It should show `ok: true`, `rpcHost` = the Helius host and `warnings: []`.
6. **Badges.** Create a wallet and fund it with SOL for rent and fees (about 0.006 SOL per badge). Set `SERVER_WALLET_SECRET` and redeploy. Each tick mints up to 2 pending badges, and `?steps=badges` runs that step alone.
7. **Catalogue.** If xStocks has listed new assets, run `npm run catalogue:build` before a deploy and commit `src/lib/assets/xstocks-catalogue.json`. That bundled catalogue is served while the live fetch runs, and if it fails.

## Usage stats

Read any number off `npm run -s stats` on the day, never from memory. Reproduce against a live database:

```bash
FOUNDER_WALLETS="<addr1>,<addr2>" DATABASE_URL="<transaction pooler url>" npm run -s stats
```

It prints one timestamped JSON object (`signedInUsers`, `usersWithCompletedPlay`, `playsVerified`, `leaguePlayers`, `leagueTrades`, `callsPlaced`, `xstocksUsdHeld`, ...). It is read-only and never writes a row.
