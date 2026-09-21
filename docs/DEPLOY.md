# Deploy the demo

Everything in this file is free and takes about twenty minutes. At the end there is a public URL
that a judge can open, connect a wallet to and play. The README's Deploy section describes the
paid, long-term setup (Vercel Pro + Supabase); this is the shortest path to a working demo.

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
origin, and it is baked into badge metadata at mint time. You will not know the Vercel URL until
the first deploy, so set it to the project's expected `https://<project>.vercel.app`, and if the
first build fails on it, correct the value and redeploy.

**`JUPITER_API_KEY` is the one key worth the two minutes.** Keyless Jupiter throttles to about half
a request per second and starts returning 429s under normal click-through, which shows up as prices
going stale in the middle of a demo. `HELIUS_API_KEY` is optional — without it, chain reads fall
back to the public `api.mainnet-beta.solana.com`, which works but rate-limits wallet snapshots. The
wallet check page reads about a dozen accounts per address, so add Helius if a judge is likely to
paste several wallets. `PYTH_API_KEY` and `SERVER_WALLET_SECRET` stay empty: predictions settle
from Jupiter with the source shown on every card, and badges read "Minting soon" until a funded
server wallet exists.

## 4. Fill the database

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

One tick every five minutes runs the games, snapshots wallets, evaluates quests and mints badges.
Vercel's Hobby plan only allows daily crons, so the repo ships a GitHub Actions pinger that does the
same job for free. It stays inert until you switch it on, in **Settings → Secrets and variables →
Actions**:

- Variables: `TICK_PINGER_ENABLED` = `true`, and `APP_URL` = `https://<project>.vercel.app` (no trailing slash)
- Secrets: `CRON_SECRET` = the same value you set in Vercel

Then run it once by hand: **Actions → Cron tick (Hobby fallback) → Run workflow**. A green run means
the whole backend works end to end. GitHub schedules can run five to thirty minutes late under load,
which is fine for snapshots and quest evaluation.

`vercel.json` also schedules one daily run at 20:10 UTC, which is five minutes after the Friday
settle: if the pinger is ever off, the week still settles. On Vercel Pro you can raise that schedule
to `*/5 * * * *` and skip the pinger entirely.

## 6. Check it

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/cron/tick" | jq '.data.health'
```

Send the secret in the header, never in a query string — the route refuses a query-string secret in
production because it would land in request logs.

Then open the site and walk the judge path:

1. The landing shows three live prediction cards with real prices, and three game tiles with real
   numbers rather than dashes. If the cards are stuck on skeletons, the database is empty — step 4
   did not run against this database.
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
