# Stocklana submission: Dulo

Paste-ready copy for the submit form at https://hackathons.solana.com/hackathons/stocklana. The headings below follow the form's own steps.

- **Status:** rewritten 16 Sep 2026 for the three games (predictions first, then the virtual-cash competition, then quests), starter points and the Season points rule. Submissions close **Fri 25 Sep 2026, 16:00 ET** (20:00 UTC, 21:00 Irish), confirmed 17 Sep from the page countdown and header, and judging runs to 2 Oct.
- **No placeholders.** Everything inside a paste block is true today. Anything that depends on a thing that does not exist yet (the live URL, the videos, a minted badge, player numbers) is listed under "Add once it exists" in the Links step, outside the blocks.
- **Limits:** Short Description 280 characters, Full Description 5,000 characters, Pitch Video 3:00, Technical Video 5:00, at least one link.

Character counts are the JavaScript string length of each paste block (the text between the fences). Reproduce from the repo root:

```bash
node -e "const s=require('fs').readFileSync('docs/SUBMISSION.md','utf8');for(const m of s.matchAll(/### (Short Description|Full Description)[^\n]*\n[\s\S]*?\x60{4}\w*\n([\s\S]*?)\n\x60{4}/g))console.log(m[1]+': '+m[2].length)"
```

---

## Step 1: Project

### Project Name

Dulo

### Short Description (280 max): 266 measured

````text
The entertainment layer for xStocks. Predict Friday closes. Compete with $10,000 of virtual cash. Complete quests, in-app or verified from your Solana wallet. Three games, one Season leaderboard, and 1,000 starter points on first sign-in. Points only, no cash value.
````

## Step 2: Description

### Full Description (Markdown, 5,000 max): 3,672 measured

````markdown
**The entertainment layer for xStocks. Compete, predict and get rewarded, for points.**

Predict. Compete. Complete on-chain quests.

## The problem

800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026). Buying the first one is easy. Staying is not, and every app built on tokenized stocks has to find those holders itself.

## Three games, one Season leaderboard

Nobody hits a dead end. On first sign-in every player gets 1,000 starter points for predictions and $10,000 of virtual cash for the weekly competition, so all three games work from the first minute, with or without an xStock.

**1. Predictions.** Points-only Yes or No: will NVDA, TSLA or SPY close above the strike on Friday? Settled from the Friday close, with the source shown on the card. The side that settles right shares the whole pool, and nobody on it gets back less than they put in.

**2. Competition.** A weekly trading competition with $10,000 of virtual cash at real xStock prices. Not real money and not real trades. The top 10 with 3+ trades that week earn points. Labelled house bots keep the board busy and never earn.

**3. Quests.** Verified actions, each with a proof you can open.

- **In-platform quests** are completed with virtual cash and points, from a first prediction to paper trades in five different xStocks.
- **On-chain quests** are verified from your own Solana wallet: holding, diversifying, buying steadily, holding through earnings, matching a portfolio you chose to copy. Four of them queue a soulbound Token-2022 badge mint.
- **Partner quests** from Kamino and Jupiter Recurring are listed as coming soon. No partner has signed.

**Check any wallet** without signing in, and **copy a portfolio** with one prefilled Jupiter swap per leg, signed in your own wallet. No custody.

## How points work

Points only, no cash value, kept in an append-only ledger with a unique ref on every row. Season points = quests + weekly competition finishes + settled prediction results. The 1,000 starter points can go into predictions but never count toward rank, and points in an open prediction count only once it settles. In-platform quests are worth 850 points and on-chain quests 2,700. No quest tells anyone to buy a security: an on-chain quest describes a wallet state, and the proof shows the wallet reached it. Points cannot be bought, cashed out or sent to another player. Onboarding, not churn.

## Why Solana

Behaviour is public state: sitting through earnings is read from RPC, not claimed by a broker, and anyone can check it again. Token-2022 ScaledUiAmount keeps balances split-correct, and Jupiter Price v3 quotes the xStock mint itself, so every game works with US markets closed.

## Where it goes

Today, the entertainment layer for xStocks.

Next, the entertainment layer for tokenized assets.

Then, any app or issuer runs competitions, predictions and rewards for its own holders on Dulo's API, and a player carries one score across them.

Quests are JSON rules behind one asset interface, so a second issuer is an implementation, not a rewrite.

## The model, as a plan

Players are free. Partners would list on-chain quests and pay per verified completion, and apps and issuers would sponsor competitions. Nothing is charged today: a plan, not revenue.

## Team

Built solo. Next.js 15, TypeScript and Postgres, no Anchor program, 1,176 tests, CI on every push.

Points only, no cash value. Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions. Dulo is independent and not affiliated with xStocks (Backed Finance owns that brand). Original work, written for this hackathon.
````

## Step 3: Links

Every field takes a full `https://` URL, and the form wants at least one. **Nothing is published yet**, so today this step is empty: fill Step 1, Step 2, Step 4 and Step 5 and press **Save Draft**.

The order things become linkable:

1. **GitHub**, the moment the org is registered and the repo is flipped public. This is the gate for the hedge submission on Thu 17 Sep: one working link is enough to press Submit Project.
2. **Demo URL**, after the first production deploy.
3. **Pitch Video** and **Technical Video**, after they are recorded.

### Add once it exists

| Field | What goes in, and when |
|---|---|
| GitHub | `https://github.com/djbigzzz/dulo` — public, pushed 21 Sep 2026. |
| Demo URL | The production origin. The Vercel `https://<project>.vercel.app` URL until dulo.fun resolves. |
| Pitch Video | Unlisted YouTube, 3:00 or shorter. Script: `docs/HANDOFF.md` section 6. |
| Technical Video | Unlisted YouTube, 5:00 or shorter. Script: `docs/HANDOFF.md` section 6b. |

Also waiting on the same facts, outside the form: the README's live link, video links and screenshots, the X and GitHub handles in Step 4, and any mainnet transaction link (no badge has been minted yet, so no proof link is claimed anywhere).

## Step 4: Team

**Solo.**

Built solo.

Add the X and GitHub handles to this step once those accounts are registered.

## Step 5: Bounty Tracks

**Tick nothing on the first submission. Add a track only once its build is live on production and the claim is true.**
The form stays editable until the close, so a tick costs nothing to add later and a tick that is ahead of the code is a promise, not an entry.

Planned, in order:

- [ ] **Best Use of PreStocks** ($10,000; 1st $5k, 2nd $3k, 3rd $2k). PreStocks needs no token launch, its API needs no key, and Jupiter already quotes all eight mints in the same shape the xStocks code parses. The work is an AssetSource registry plus database rows, which is the main-track execution upgrade anyway: it is what makes `Play.assetSource` load-bearing instead of decorative. Tick it only once a PreStocks quest is live and has actually been completed by a funded mainnet wallet, with its proof drawer showing the wallet state that satisfied it.
- [ ] **Best use of Pyth market data** (non-cash: 3 months of Pyth Pro, roughly $7,500 at list price). The track asks how central Pyth is to the product. Predictions already settle on a named Pyth feed; what makes Pyth central rather than decorative is preferring the 24/7 `Crypto.<SYMBOL>X/USD` xStock feeds over `Equity.US.<TICKER>/USD`, which also keeps live sourced prices on screen while US equities are shut. Gated on a working API key: Hermes now returns 401 without one. Do not tick this while the integration is documented and dormant.

Not entered, and the reasons are worth one sentence in the full description rather than silence:

- **Tessera** ($6,000) is excluded by the PreStocks track itself, which says projects integrating any non-PreStocks pre-IPO tokens are ineligible for it. T-Tokens are exactly that, so this is $10,000 XOR $6,000, not both. Explaining the choice is not integrating.
- **Meteora DBC** and **Clawpump** ($5,000 each) both require launching a token. Dulo is points only, with no cash value, and on-chain points are on its cut list, so entering either would contradict the entry being judged on the main track. PreStocks swaps do route through Meteora pools, which is a fact about the integration rather than a bounty entry.

Verify on the form itself: the PreStocks exclusion clause, and whether a cap on the number of ticks exists at all (it is not stated on the hackathon page).

---

## Judge path

This is the same path as the README's quick path. The demo URL and the Pitch Video should both follow it.

1. **Connect** a wallet from the landing, which opens on this week's live predictions and the three game tiles, and sign one message. There is no transaction.
2. **Welcome.** The toast says: 1,000 starter points for predictions and $10,000 of virtual cash for this week's competition. Starter points don't count toward rank. Points only, no cash value.
3. **Predict** on `/predictions`. The dialog defaults to 100 points, and First Prediction (+50) completes in the same request.
4. **Compete** on `/competition`. Three paper trades in three different xStocks complete First Paper Trades (+50) and Paper Portfolio (+75).
5. **Quests** on `/quests`: in-platform quests with their next steps, on-chain quests verified from the wallet with a proof, and partner quests marked coming soon.

A judge with no xStocks can do all of this except the on-chain quests, and can still see those at work on `/check/<address>` without signing in.

## What the economy is, in one table

| | |
|---|---|
| Games | Predictions, the weekly competition (virtual cash), quests. Copy a portfolio is a tool. |
| Starter points | 1,000 on first sign-in, once per player per Season. Points only, no cash value, never counted toward rank. |
| Virtual cash | $10,000 per competition week. It is not money and not points. |
| Season points | Quests + weekly finishes (top 10 with 3+ trades) + settled prediction results. |
| Predictions | 10 to 5,000 points per placement, 100 by default. The side that settles right shares the whole pool; a void market or an empty side refunds. |
| Weekly finishes | 1,000 / 700 / 500 / 300 / 200, then 100 for places 6 to 10, paid only to real accounts with 3+ trades that week. |
| Quests | In-platform quests (850 points) and on-chain quests verified from the wallet (2,700 points), 50 to 500 each. Kamino and Jupiter Recurring partner quests are coming soon. |
| Partners | The plan is that partners pay per verified completion. Nothing is billed and no partner has signed. |
| Not built | Spot On-style settlement quests are not built, and neither are Top 10 Finish or Green Week quests. |

---

## Pre-submit checklist

### Timing

Submissions close **Fri 25 Sep 2026, 16:00 ET** (20:00 UTC, 21:00 Irish), confirmed 17 Sep from the page countdown and header. Judging runs to 2 Oct, so the live demo has to keep working through two weekends with US markets closed.

- [ ] **Thu 17 Sep: press Submit Project** with whatever links exist, as a hedge. Save Draft is not a submission.
- [ ] The entry shows as **submitted**, not as a draft.
- [ ] Keep editing after that with **Save edit**. Final edit by 12:00 Irish on Fri 25 Sep; **Fri 25 Sep 2026, 16:00 ET** is the hard stop.
- [ ] Nothing is edited after the close, and nothing is expected to change during judging to 2 Oct.

### Account

- [ ] Registered on hackathons.solana.com with a Solana wallet linked. Use the prize wallet, not the badge minting wallet.

### Repository

- [ ] Before the repo goes public: dulo.fun, the `dulofun` GitHub org and `@dulofun` on X are registered.
- [ ] `git status --ignored` shows `!! docs/private/`, and `git ls-files docs/private` prints nothing. No tracked file cites a path inside it.
- [ ] Secret grep over tracked files is clean: `git grep -nIE "(-----BEGIN|api[_-]?key[\"' ]*[:=]|api-key=|postgres(ql)?://[^ ]*:[^ @]*@)" -- ':!*.example' ':!docs/*'` returns only variable names, never a value.
- [ ] No keypair, `.env` or wallet file is tracked.
- [ ] CI is green on the default branch. `npx vitest run` printed **1,176** on 21 Sep; re-read it on the day and make the Full Description and the README say the same number.
- [ ] The repo is public, MIT, with the README's disclosure section intact.

### Badge names (gate: do this before a badge can ever mint)

A badge's on-chain name and metadata URI are written at mint time into a supply-1 mint whose authority is burned. They cannot be renamed afterwards, so the renamed catalogue has to be in the database first.

- [ ] The production database is seeded from the current catalogue (`npx prisma db seed`): 19 quest rows, with the two partner rows inactive. The rows carry **Steady Buyer**, **Portfolio Match**, **First Paper Trades** and **First Prediction**, not the old titles.
- [ ] `NEXT_PUBLIC_APP_URL` is the final public origin before the first mint, not a preview URL.
- [ ] `/api/v1/badges/mirror/metadata.json` returns the name `Dulo · Portfolio Match`, and `/api/v1/badges/league_top3/metadata.json` returns `Dulo · Podium Finish`.
- [ ] Only then set `SERVER_WALLET_SECRET` and let the badges step of the cron run.

### Live app

- [ ] Deployed, and the demo URL loads in an incognito window with Phantom on desktop and on a phone.
- [ ] The production tick returns `.data.health.ok: true`, the Helius RPC host, and no warnings.
- [ ] Old links still work: `/plays` and `/rewards` go to `/quests`, `/league` and `/paper-trading` go to `/competition`, `/calls` goes to `/predictions`, and `/mirror` goes to `/copy`.
- [ ] Checking a wallet without signing in works on the deployed app, not only locally.
- [ ] A fresh wallet's first sign-in shows the welcome toast and a points balance of 1,000. Signing in again grants nothing more.
- [ ] A fresh wallet can make a prediction and a paper trade without holding anything. The leaderboard shows it only once it has Season points.
- [ ] House bots are labelled on the competition board, absent from the Season leaderboard, and cannot sign in.

### Content

- [ ] **Character counter re-run** with the command at the top of this file after any edit to a paste block: Short Description 280 or under, Full Description 5,000 or under.
- [ ] No paste block claims anything that does not exist yet: no live URL, no video, no minted badge, no player count, no paying project, no partner who has signed up.
- [ ] Public copy uses the plain names: quests, the competition (always with "virtual cash" or "paper" beside it), predictions, copy a portfolio, points, leaderboard, badges, partners.
- [ ] Starter points are always described as points only, no cash value, and never counted toward rank. Virtual cash is never called money.
- [ ] The business model is written as a plan: partners would pay per verified completion, and nothing is billed.
- [ ] No paste block, README line or video beat presents a quest that is not built. Spot On-style settlement quests, Top 10 Finish and Green Week are not built.
- [ ] The holder stat reads exactly "800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)".
- [ ] The test number in the Full Description matches what `npx vitest run` prints that day.
- [ ] No exclusivity claims, and no hackathon registration or submission counts.
- [ ] The compliance lines are present: points only, no cash value; not investment advice with the restricted-jurisdiction line; the independence note; the original-work disclosure.

### Form

- [ ] Bounty Tracks: none ticked.
- [ ] Team: solo.
- [ ] Both paste blocks pasted whole, with their Markdown intact.
