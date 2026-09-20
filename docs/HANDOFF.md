# Stocklana hackathon: Claude Code handoff kit

> **Status (16 Sep 2026):** this is the pre-build handoff plan, kept for transparency; where it disagrees with the code, the code and `README.md` are authoritative. Updated 16 Sep: Dulo now presents three games on one Season leaderboard (predictions, the weekly competition with virtual cash, quests), with 1,000 starter points on first sign-in and a Season points rule that leaves starter points out (§3.1, §3.8, §3.9). The §6 Pitch Video and §6b Technical Video scripts use the plain names, the new page routes and the shipped positioning line, "The entertainment layer for xStocks. Compete, predict and get rewarded, for points." Internal planning notes are kept privately.
> **Not shipped yet (16 Sep):** no live URL, no users, no partners, no minted Badge, no billing. Every shot in §6 and §6b is something the app does today, recorded from production once the first deploy is live and from a local production build until then. No script in this file may quote a number the app has not produced.
> **Plain names (updated 16 Sep):** public copy says predictions, the competition (always with "virtual cash" or "paper" next to it), quests, copy a portfolio, points, leaderboard, badges, partners. "Rewards" was the public noun for a Play from 15 to 16 Sep and is retired. Play, League, Call, Mirror, Scout and Oracle survive as internal code names only (Prisma models, `playKey` values, `/api/v1` paths), and this document uses them where it explains the code. Pages are `/predictions`, `/competition`, `/quests` and `/copy` (old paths redirect permanently), plus `/check`, `/profile`, `/partners` and `/leaderboard`.
> Copying a portfolio ships as an allocation view + one prefilled Jupiter swap per leg by decision (§3.4), not as a fallback: nothing in the app signs or sends a swap. Predictions settle from Jupiter Price v3 with the source printed on the card; no Pyth key.
> **Reuse:** no code was ported from earlier projects; every module is a fresh implementation.

This was the pre-build handoff kit (written 14 Sep before P0). Section 0 is the brief as it was handed over; the maintained brief is `CLAUDE.md` in the repo root, so do not paste §0 over it. Nothing here depends on the chat that produced it.

Deadline: **Fri 25 Sep 2026, 16:00 ET** (= 20:00 UTC = 21:00 Irish time), confirmed 17 Sep from the hackathon page countdown and header, and judging runs to 2 Oct. Submit a valid entry Thu 17 Sep as a hedge, then keep editing until the close. The demo must work at a weekend, with US markets closed, for the whole judging window.

---

## 0. CLAUDE.md (original project brief, 14 Sep: the repo's `CLAUDE.md` is the maintained copy)

Kept verbatim as a record of what was handed over. Three things in it are superseded and must not be quoted: the positioning line (the shipped one is "The entertainment layer for xStocks. Compete, predict and get rewarded, for points."), the vocabulary section (Play, League, Call and Mirror became internal code names on 15 Sep, and the public names were updated again on 16 Sep, see the banner above and §3.10), and the "submit by Fri 12:00 Irish" discipline (the hedge submission moved to Thu 17 Sep, §8). Its Fri 18 Sep deadline is superseded: the close is Fri 25 Sep 2026, 16:00 ET.

```
# Project brief

We are building a Solana-native "on-chain activity hub": a distribution network where projects list Plays (verified on-chain actions), users complete them from their real wallet activity, and everyone competes in leagues and games for points. Think Arkada/Galxe, but the first vertical is tokenized stocks (xStocks) and the entry is the Stocklana hackathon (deadline Fri 25 Sep 2026 16:00 ET).

Long-term: multichain, multi-asset, multi-client, many partners. Hackathon: Solana only, xStocks only, web PWA only, partners seeded by hand. Build one of everything behind an interface; never build the second of anything.

Vocabulary (use everywhere, UI + code + copy):
- Play: a verified on-chain action or holding pattern (NOT "quest", "task", "mission").
- Streak: consecutive Plays over days.
- Call: a points-only Yes/No prediction on a price or earnings outcome.
- League: weekly paper-trading competition with virtual cash.
- Mirror: copy another wallet's allocation (MVP: allocation view + Jupiter deep links; no in-app swap execution).
- Season: a scoped points period (Season 0 = Stocks Season on Solana).
- Partner / Campaign: a listed project and its set of Plays.
- Score: points. Badge: soulbound Token-2022 achievement.

Positioning line: "Your on-chain activity is the game. Every transaction is a play. Every play scores."
Regulatory framing: points only, no cash value. Real-money Plays reward holding, diversifying, DCA. Speculation lives in paper Leagues and points-only Calls. Say "onboarding, not churn".

Stack: Next.js 15 app router, TypeScript, Tailwind, shadcn/ui, Prisma + Postgres (Supabase), @solana/wallet-adapter (Phantom, Backpack, Solflare, MWA), Helius RPC, xStocks public API, Jupiter Price v3 + Swap v2, Pyth Hermes, Vercel Cron. No Anchor program needed.

Rules of the codebase:
- All chain reads go through lib/core ChainAdapter; all asset math through AssetSource; all prices through lib/price. No raw RPC in routes or components.
- Plays are JSON rules evaluated by lib/plays/engine.ts. Adding a Play is a DB row, not code.
- Points are an append-only PointsEvent ledger; balances are derived.
- All UI reads go through /api/v1 typed handlers; Next.js is the first client, not the only one.
- Asset IDs are CAIP-19 strings. Users own N wallets; nothing keys on a single pubkey.
- Every price shown carries source + age. The app must work with markets closed.
- Cut list is binding: no social feed, no comments, no native app, no real-money markets, no in-app swap execution (Mirror is deep-link only), no referral, no on-chain points, no second chain, no partner self-serve dashboard, no email auth.

Deadline discipline: submit by Fri 12:00 Irish, patch until 21:00. Mirror ships as "view allocation + open Jupiter with a prefilled swap per leg" by decision (14 Sep) — that is the product, not a fallback; in-app swap execution stays on the cut list.
```

---

## 1. Decisions locked

| Topic | Decision |
|---|---|
| Idea | On-chain activity hub / distribution layer. Hackathon entry = "Dulo: Stocks Season" |
| Chain / assets / client | Solana only, xStocks only, web PWA only |
| Mechanics shipped | Decided 16 Sep: three games on one Season leaderboard. (1) Calls = predictions, points-only Yes/No on Friday closes, first in the nav. (2) The paper League = the weekly competition with $10,000 of virtual cash at real xStock prices, top 10 score; it is not real trading and not swaps. (3) Plays = quests: in-platform quests anyone completes with virtual cash and points, and on-chain quests verified from the user's own wallet, with partner quests (Kamino, Jupiter Recurring) shown as coming soon. Mirror = copy a portfolio is a tool, not a fourth game (allocation view + Jupiter deep links, no in-app execution); its completion is the Portfolio Match quest. Soulbound Badges |
| Rewards | Points only, no cash value, Season 0 |
| Economy | Decided 16 Sep: every real user gets 1,000 starter points once per Season on first sign-in (never counted toward rank) and $10,000 of virtual cash per competition week, so a new player never hits a dead end. Season points = quests + weekly finishes (top 10 with 3+ trades) + settled prediction results. Full table in §3.8. No schema change and no migration |
| Audience | Crypto natives new to stocks (lead), stock traders new to crypto (roadmap) |
| Business model | Players are free, forever. Partners list Plays and pay per verified completion, or sponsor a Season. Attribution (verified completions per partner per Season) is the number sold. Points only, no cash value. **This is a plan, never revenue:** nothing is billed today, there is no billing code and no project has paid. Write it in that tense everywhere. The unit a partner would pay for is a verified on-chain quest completion |
| Mechanic word | Settled 15 Sep as "rewards", changed 16 Sep: the public word is "quests". "Plays" survives as the internal code name only (Prisma models, `playKey` values, `/api/v1` paths, file names) |
| Nav | Decided 16 Sep: Predictions · Competition · Quests · Copy a portfolio · Leaderboard. Mobile tabs: Predict · Compete · Quests · Board · Profile |
| Name | **Dulo** (dulo.fun). Named after the House of Dulo, the founding dynasty of the Bulgars. Brand mark: the Dulo tamga (the IYI symbol), used as inline SVG logo, favicon, PWA icon and as the base motif for the four Badge designs. Positioning, shipped 15 Sep in `src/lib/config.ts` (POSITIONING) and fixed copy everywhere: "The entertainment layer for xStocks. Compete, predict and get rewarded, for points." The earlier tagline ("Your on-chain activity is the game") and the earlier positioning ("On-chain activity league") are both retired. Vision, in three rungs: today, the entertainment layer for xStocks; next, the entertainment layer for tokenized assets; then, any app or issuer runs competitions, predictions and rewards for its own holders on Dulo's API, and a player carries one score across them |

Reuse (planned): code from earlier projects (quest engine, leaderboard UI, pool math, market cards). **As built: no code was ported.** The repo has no references to earlier projects, the `<path>` placeholders in §9 were never filled, and `src/lib/plays/engine.ts`, `src/lib/games/parimutuel.ts` and `src/lib/games/calls.ts` are fresh TypeScript: design lineage only. The founder confirmed this on 15 Sep, and the README disclosure sentence states it (hackathon rule: original work, OSS components allowed if disclosed).

---

## 2. Why this wins (judging map)

Judging: "could this be a real app people actually use?" That is real user need, works end to end, why Solana, execution quality. The submit form takes a GitHub link, a live demo URL, a Pitch Video (≤ 3:00) and a separate Technical Video (≤ 5:00); at least one link is required.

| Criterion | Answer |
|---|---|
| Real need | 800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026). Getting someone to buy once is the easy part; giving them a reason to keep holding, diversify and add over time is the hard part, and every app building on tokenized stocks has to find those holders on its own. Dulo gives holders a reason to hold and gives apps a way to reach them: on-chain quests verified from real wallet activity, and a partner layer where any app lists a quest. Someone who holds nothing yet still gets a full game from minute one: starter points for predictions and virtual cash for the competition. |
| End to end | Reads Solana mainnet (not deployed yet, so everything runs from the repo). First sign-in writes 1,000 starter points; a prediction and a paper trade each complete an in-platform quest in the same request. On-chain quests verify against real xStocks balances via Helius. A judge with an empty wallet can paste any address at `/check/<address>` and watch the same engine verify it as a dry run with no writes. Copying a portfolio opens one prefilled Jupiter swap per leg (`https://jup.ag/swap?sell=<USDC>&buy=<xStock>&inAmount=<usdc>`) signed in your own wallet; land within 20% of the allocation and the next snapshot verifies it. Competition prices and prediction settlement come from Jupiter Price v3 with source and age on every chip and card (no Pyth key; Pyth-first only if one is ever added). |
| Why Solana | Holdings are public and composable: "hold NVDAx through earnings" is verifiable from RPC and "copy this wallet" is one prefilled Jupiter swap per leg, with no broker API. Token-2022 ScaledUiAmount multipliers give multiplier-correct holdings (splits and dividends normalised), including the pending `newMultiplier`. No broker API needed: anyone can re-check it from RPC. |
| Execution | A polished PWA reading Solana mainnet (no deployment yet), 1,164 tests across 54 files on 16 Sep 2026 and CI on every push, an append-only ledger with one Season points rule shared by every board, bots seed the competition board and the prediction pools (labelled on the competition board, never paid, never on the Season board, unable to sign in), works on a weekend with US markets closed, a pitch video and a technical walkthrough. Read the test count off `npx vitest run` on the day; never quote a remembered one. |
| Business model | A plan, not revenue: nothing is billed today, there is no billing code and no project has paid. Players are free, forever; partners would list on-chain quests and pay per verified completion, and apps and issuers would sponsor competitions. Points only, no cash value: onboarding, not churn. |
| Next to xPoints | Complementary, never a jab: an issuer's own points reward activity in its own venues, while Dulo scores verified behaviour across apps and issuers and routes holders to the apps that list a quest. README, form and video only, not the landing. |
| Issuer scope | Season 0 reads xStocks. Every asset read goes through `AssetSource`, so another issuer is another implementation behind the same interface, not a rewrite. |

**Claim rules for every public surface** (README, form, videos, landing, X):
- No exclusivity claims about the field (Dulo is one of several consumer entries), and never disparage other apps' retention.
- Never quote a hackathon registration or submission count.
- The holder stat is "800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)". Say addresses, never people or users.
- No unsourced position-size statistics (the earlier "median position" and "share over $100" figures are dropped).
- Traction numbers come only from `npm run -s stats` (`scripts/traction-stats.ts`, bots and `FOUNDER_WALLETS` excluded) run the same day.
- Starter points are always "points only, no cash value" and never presented as a prize; virtual cash is never called money.
- Only quests in §3.1 exist. Three ideas from the 16 Sep draft are not built and may not be presented anywhere: Spot On, Top 10 Finish and Green Week.

Demo partners: xStocks (issuer), Jupiter (Recurring quest, coming soon), Kamino (SPYx collateral quest, coming soon). Other Stocklana apps are listed only with their consent (read-only, their logo and link, one coming-soon quest); there are no placeholder listings.

---

## 3. Product scope

### 3.1 Plays, shown as quests (Season 0 catalogue, JSON rules)

Updated 16 Sep: 19 rows. The `key` column is the DB key (`playKey`) and never changes; the title is what the app shows, from `src/lib/plays/catalogue.ts`. "Kind" is how `/quests` groups a row: in-platform (house partner, virtual cash and points), on-chain (xStocks partner, verified from the user's wallet) or partner coming soon (seeded with `isActive=false`, never evaluated).

| Key | Title | Kind | Rule | Points | Badge |
|---|---|---|---|---|---|
| oracle | First Prediction | in-platform | `internal_event` event call_placed count 1 | 50 | |
| scout | First Paper Trades | in-platform | `internal_event` event league_trade count 3 | 50 | |
| three_predictions | Three Predictions | in-platform | `internal_event` event call_placed count 3 distinctBy ref (one per question) | 75 | |
| paper_portfolio | Paper Portfolio | in-platform | `internal_event` event league_trade count 3 distinctBy symbol | 75 | |
| ten_paper_trades | Ten Paper Trades | in-platform | `internal_event` event league_trade count 10 (any week) | 150 | |
| paper_portfolio_five | Five-Stock Paper Portfolio | in-platform | `internal_event` event league_trade count 5 distinctBy symbol | 150 | |
| game_days | Three Game Days | in-platform | `internal_event` event game_action count 3 distinctBy day (UTC) | 150 | |
| five_predictions | Five Predictions | in-platform | `internal_event` event call_placed count 5 distinctBy ref | 150 | |
| first_position | First Position | on-chain | `hold_any` minUsd 5 | 100 | yes |
| index_holder | Index Holder | on-chain | `hold_any` minUsd 5, assetSymbols SPYx QQQx VOOx VTIx | 150 | |
| diversified | Diversified | on-chain | `diversified` minAssets 3 minSectors 2 | 250 | |
| diamond_hands | Diamond Hands | on-chain | `hold_consecutive` days 7 | 300 | yes |
| dca_streak | Steady Buyer | on-chain | `net_increase_days` count 3 window 14 | 300 | |
| thousand_club | Thousand Club | on-chain | `hold_any` minUsd 1000 (largest single position) | 300 | |
| earnings_holder | Earnings Holder | on-chain | `hold_through_date` calendarKey earnings | 400 | yes |
| sector_spread | Sector Spread | on-chain | `diversified` minAssets 5 minSectors 4 | 400 | |
| mirror | Portfolio Match | on-chain | `mirror_match` tolerance 0.2 | 500 | yes |
| kamino_collateral | Kamino Collateral | partner, coming soon (isActive=false) | `hold_any` minUsd 1, partnerAssetIds [] | 300 | |
| jupiter_dca | Jupiter Recurring | partner, coming soon (isActive=false) | `hold_any` minUsd 1, partnerAssetIds [] | 200 | |

Notes:
- **Totals.** The 8 live in-platform quests are worth 850 points, the 9 live on-chain quests 2,700, and the 2 coming-soon partner quests 500. One ladder covers every quest: tier 1 (first minute) 50 to 100, tier 2 150 to 250, tier 3 300 to 500. Weekly competition finishes (100 to 1,000) sit above any single quest.
- **distinctBy** is an optional `internal_event` field (`src/lib/plays/rules.ts`): `ref` counts one event per question (both sides of one question count once, top-ups add nothing), `symbol` one per upper-cased xStock symbol, `day` one per UTC calendar day.
- **game_action** is a derived, read-only event built in `loadInternalEvents` from rows it already loads: one per LeagueTrade (ref `trade:<id>`) and one per prediction Position (ref `prediction:<marketId>:<side>`, ts = createdAt), so a top-up does not make a new day.
- **Inline completion.** Every in-platform quest listens to `call_placed`, `league_trade` or `game_action`, so `calls/place` and `league/trade` evaluate it in the same request, and the toast "Quest complete: <title> · +N pts" shows only when that request wrote the points.
- **Descriptions are wallet states.** An on-chain quest says what the wallet holds ("Your connected wallet holds any xStock worth $5 or more"), never an instruction to buy. The First Position card no longer links a Jupiter swap. The Portfolio Match card's action stays "Copy a portfolio" (the tool), and the Jupiter partner blurb keeps the deep-link sentence.
- **Coming soon.** The two partner rows are seeded with `comingSoon` and `isActive=false` and are never evaluated; an empty `partnerAssetIds` means never satisfied. Each needs a partner adapter once its listing goes live, which is out of scope. No partner has signed.
- **Badges.** First Position, Diamond Hands, Earnings Holder and Portfolio Match mint a badge. The badge a top-three finish in the weekly competition mints is titled **Podium Finish**.
- **Not built.** Spot On, Top 10 Finish and Green Week were cut from the 16 Sep draft and are not built.

Rule engine types: hold_any, hold_consecutive, net_increase_days, hold_through_date, diversified, mirror_match, internal_event. Pure functions over normalised Holding[] history (and internal events). Tests per rule type with fixture snapshots.

### 3.2 League (the weekly competition, virtual cash)
Weekly, Mon 00:00 UTC to Fri 20:00 UTC. Virtual $10,000 per user per week (`VIRTUAL_CASH_USD === STARTING_CASH_USD`, tested). Trade any xStock at lib/price with 0.1% virtual spread, $10 minimum. Equity recomputed on the 5-minute tick, plus on read when the last recompute is more than 60s old (recomputeIfStale). Top 10 get 1000/700/500/300/200/100×5 points. Seed 15 bot accounts with 3–8 plausible trades.

Decided 15 Sep (C6, reversible): trading stays open on weekends. The week still settles Fri 20:00 UTC; between then and Mon 00:00 UTC trades land in the next week's League (`currentWeek(now)` already points there), so the only zero-capital path to points never closes during judging.

Decided 16 Sep:
- The page is "Weekly competition (virtual cash)" at `/competition`. It shows virtual cash and never the points balance.
- The LeagueAccount is created by the first paper trade, never at sign-in, so an idle $10,000.00 account cannot outrank bots that paid the spread.
- Ranks are overall and include the labelled house bots. Only real accounts with at least `MIN_TRADES_FOR_WEEKLY_POINTS` (3) trades that week are paid; a place held by a bot or by an account with fewer trades pays nobody. The page's rules say so, and the prize stat hint reads "Top 10 with 3+ trades earn points".
- Bot sessions get a 403 from `league/trade`.

### 3.3 Calls (points-only parimutuel, shown as predictions)
Template "Will {TICKER} close above ${STRIKE} on {DATE}?" Yes/No pools in points, locked until settle. Settle from Pyth `Equity.US.{TICKER}/USD` first publish after 16:00 ET, fallback Jupiter Price v3 for the xStock mint at 20:05 UTC; record source. Seed 3 markets (NVDA, TSLA, SPY, strike = Monday open, settle Friday). Planned: port pool math from an earlier project. As built, `src/lib/games/parimutuel.ts` is a fresh implementation and nothing was ported. As built, settlement: no Pyth key (decided 14 Sep; a key would not change it, because Hermes publishes only during the NY session and `settleAt` is close + 5 min), so Jupiter Price v3 settles and the source is printed on every card.

Decided 16 Sep:
- Entries close at the Friday close (5 minutes before `settleAt`). Points in per placement: 10 to 5,000 (`MIN_CALL_POINTS` / `MAX_CALL_POINTS`); the dialog shows "Balance N pts" and defaults to 100 (10 when the balance is between 10 and 99), never to the whole balance.
- `calls/place` answers 403 for a bot session, then awaits `ensureStarterPoints(session.userId, now)` before `placeCall`, so a player whose grant was missed can still predict. `placeCall` itself is unchanged.
- Under the preview the dialog prints "If it doesn't settle your way, the points you put in count against your Season points." (`PREDICTION_LOSS_COPY`).
- A player below 10 points sees "Not enough points: you have X, this prediction needs Y. Earn more in the weekly competition (virtual cash) or from quests." The panel links only to `/competition` and `/quests`, never to a holding.

### 3.4 Mirror, shown as "Copy a portfolio" (deep links, no in-app execution). DECIDED 14 Sep 2026
MVP is points-only: no user money moves through the app. Any leaderboard wallet: allocation %, 7d/30d P&L from snapshots. "Mirror with $X USDC" shows the target allocation and one "Open in Jupiter" deep link per leg (input mint USDC, output mint, amount prefilled). The user swaps in Jupiter; the next snapshot verifies the mirror_match Play. In-app swap execution is on the cut list for the hackathon; there is no feature flag, and nothing in the code signs or sends a swap. Stale-price chip still shown on the Mirror page. Blink only if ahead on Thursday.

Decided 16 Sep: copy a portfolio is a tool, not a game. The tool never mentions points or quests; its only line about verification is "the next snapshot checks whether your wallet matches". The +500 appears only on the Portfolio Match quest card, which describes the wallet state.

As built (P4, `src/lib/mirror/`, `src/app/copy/` since the 15 Sep route rename, `/api/v1/mirror/**` unchanged):
- **Target** (`getMirrorTarget` in `src/lib/server/queries.ts`): any Solana wallet the app knows. With at least one Snapshot the allocation is the latest row's usd-weighted legs (dust under $1 dropped) and the 7d / 30d figures are the change in total position value versus the snapshot closest to 7d / 30d ago (NOT cash-flow adjusted: a deposit reads as profit; labelled "value change" with the comparison time). Wallets with no snapshots but a LeagueAccount (the 15 bots, paper-only users) get a **paper allocation**: their most recent League positions valued at lib/price (avgPrice when nothing quotes), no history, chip says "Paper allocation". Neither -> 404. Rank chips show the Season points rank and the League rank when either exists.
- **API**: `GET /api/v1/mirror` (index: top leaderboard wallets that have snapshot history + League leaders), `GET /api/v1/mirror/[wallet]` (`{ target, quotes, stale, usdcMint, tolerance, signedIn }`; one PriceQuote per leg, `stale` when any leg's quote is stale or missing), `POST /api/v1/mirror/record { targetWallet, budgetUsd }` (session + same-origin).
- **Plan** (`src/lib/mirror/allocation.ts`, pure, computed in the browser): usdc = weight x budget rounded to cents, legs under $1 dropped and listed. One deep link per leg: `https://jup.ag/swap?sell=<USDC mint>&buy=<xStock mint>&inAmount=<usdc>` (amount dropped when it formats to 0). Fixed 15 Sep (C1): the legacy `/swap/<in>-<out>?amount=` path redirects to buy=SOL with no amount. The amount is still printed next to each link. Copy everywhere says deep links / "you swap in Jupiter"; nothing in the app signs or sends a swap.
- **Verification**: the "I've done my swaps" button (`MirrorPlanCard`) stores the target as the caller's Mirror INTENT on their `mirror` PlayProgress row (`proof.intent = { targetWallet, target: {assetId: weight}, symbols, budgetUsd, recordedAt, source }`, status in_progress; a completed row keeps its status). No PointsEvent, no points. `buildEvalContext` reads it through `src/lib/mirror/events.ts` as the `mirror_executed` InternalEvent (ts = recordedAt) the mirror_match rule consumes, and `cron/evaluate` carries `proof.intent` across proof refreshes (`carryIntent`) so the intent survives until a later snapshot lands inside the tolerance. The record route schedules `runForUser` with `after()`, so a mirror done before pressing the button completes in seconds; otherwise the next 5-minute tick. The §4.2 note about PointsEvent source "mirror" is superseded by this.
- Leaderboard rows carry a "Copy" link. The page is `/copy` (the old `/mirror` path redirects permanently, `ROUTE_RENAMES` in `next.config.ts`) and it lists competition leaders (paper allocation) and scored wallets (on-chain).

### 3.5 Badges
Token-2022 mint per achievement, NonTransferable + MetadataPointer, minted by server wallet (fund 0.3 SOL, about 0.006 SOL per Badge). Four inline SVGs. Store txSig.

As built (P4, `src/lib/badges/`, `src/lib/cron/badges.ts`, `/api/v1/badges/**`):
- **Designs** (`designs.ts`, deterministic 512x512 SVG strings built from the tamga paths in `src/components/brand/Tamga.tsx`): first_position (ember), diamond_hands (ice), earnings_holder (gold), mirror (violet, the mark reflected), plus a fifth `league_top3` (laurel), titled **Podium Finish**, for a top-three finish in the weekly competition. Copy and keys live in `keys.ts` (client-safe). `GET /api/v1/badges/[key]/image.svg` serves the artwork, `GET /api/v1/badges/[key]/metadata.json` the Metaplex-style document (name "Dulo · <Badge>", symbol DULO, image = the SVG route, attributes Season / Badge / Accent / Soulbound). Both are public, no envelope, with image URLs derived from the request origin. `GET /api/v1/badges/me` (session) returns the caller's rows joined with the copy and `state` "minted" | "pending".
- **Mint** (`mint.ts`, `mintBadge({ ownerAddress, badgeKey })`): ONE transaction signed by the server wallet (`SERVER_WALLET_SECRET`, base58 or solana-keygen JSON array) and a fresh mint keypair: createAccount (space = `getMintLen([NonTransferable, MetadataPointer])`, rent for that plus the packed TokenMetadata TLV), InitializeNonTransferableMint, InitializeMetadataPointer (metadata on the mint), InitializeMint (decimals 0, no freeze authority), spl-token-metadata Initialize (uri = `<APP_URL>/api/v1/badges/<key>/metadata.json`, additionalMetadata badge/season), idempotent Token-2022 ATA for the owner, MintTo 1, SetAuthority(MintTokens -> null). Returns `{ mint, txSig, tokenAccount }`. This is the one `Connection` outside the ChainAdapter (a write, documented in the file). An empty secret throws `BadgeMintingDisabledError`.
- **Cron** (`mintPendingBadges`, tick step "badges", runs LAST, after games, because confirmed chain writes are the slowest step and the podium rows it creates come from PointsEvents the games step just wrote): (1) every user holding a `league:<id>:rank:1|2|3` PointsEvent gets a `league_top3` Badge row (createMany skipDuplicates, so the League module is untouched and re-runs are no-ops); (2) up to `DEFAULT_MINT_LIMIT` (2) rows with `mint` null are minted to the user's display wallet and updated with `{ mint, txSig }`, per-row try/catch; (3) with no server wallet the step logs once and leaves rows pending: the profile shows "Minting soon". `?steps=badges` runs it alone.
- **Profile**: badge tiles from the SVG route with "Minted · view tx" (Solscan) or "Minting soon"; unearned Play badges are shown dimmed as "Locked".
- Not verified end to end: no mainnet mint was attempted (the local `SERVER_WALLET_SECRET` is empty and the wallet is unfunded). The instruction set is unit-tested against a faked send; the first real run should be `?steps=badges` with one pending row and ~0.01 SOL of rent + fees per badge. `@solana/spl-token-metadata` is imported directly and pinned in package.json (`^0.1.6`). Set `NEXT_PUBLIC_APP_URL` to the resolving production URL before the first mint: the metadata URI is baked into each mint.

### 3.6 Partners (seeded, no dashboard)
Partner page: logo, blurb, links, its Plays, completions count. Campaign page is a co-branded landing both sides can link to. Attribution: completions per partner per season shown on an /admin JSON route (as built: per-Play completion counts on `/partners` and `/partners/[slug]`, real users only; no /admin route). A partner card reads "Quests live" only when it has a verifiable quest, otherwise "Coming soon".

### 3.7 Cut list (binding)
Social feed, comments, native app, real-money markets, referral, on-chain points, Ondo/Backpack tokens, second chain, partner self-serve, email auth.

### 3.8 Economy (points, decided 16 Sep)

Points only, no cash value. Every row below is a `PointsEvent` in the append-only ledger, guarded by `@@unique([userId, seasonId, ref])`. The client-safe contract is `src/lib/games/ledger-policy.ts`: `STARTER_POINTS` (1000), `STARTER_SOURCE`, `NON_SCORING_SOURCES` (`["starter", "admin"]`), `VIRTUAL_CASH_USD` (10000), `MIN_TRADES_FOR_WEEKLY_POINTS` (3) and the welcome and hint sentences. No Prisma schema change and no migration: `source` is a free string and the unique key makes every grant idempotent.

| Action | Points | Ledger row | Limit |
|---|---|---|---|
| Starter points: a one-time welcome grant on first sign-in in a Season | +1,000 | source `starter`, ref `starter:<seasonId>` (`starterRef`) | Once per user per Season: `createMany` with `skipDuplicates`, granted = (count === 1). Real users only (`isBotUserId`, `REAL_USER_WHERE` and an isBot LeagueAccount are all checked). Only while a Season window is active (startsAt <= now <= endsAt), never into an ended Season. Per user, not per wallet. Can go into predictions, never counts toward Season points or rank. |
| Quest completed (in-platform or on-chain; partner quests once live) | +50 to +500 (`Play.points`, §3.1) | source `play`, ref `play:<playKey>` | Once per user per quest per Season. `awardPoints` treats P2002 as already paid. Bots are refused at the top of `evaluateUser`. The inline routes toast only when `newlyCompleted && awarded`. |
| Weekly competition finish, ranks 1 to 10 by virtual portfolio value | +1,000 / +700 / +500 / +300 / +200, then +100 each for ranks 6 to 10 (`RANK_POINTS`, unchanged) | source `league`, ref `league:<leagueId>:rank:<n>` (format unchanged: `LEAGUE_TOP3_REF_RE` in the badges step parses it for Podium Finish) | Once per week per place. Ranks are overall and include house bots; only real accounts with at least `MIN_TRADES_FOR_WEEKLY_POINTS` (3) trades that week are paid. Written only by the tick that wins the rollover claim (below). |
| Put points into a prediction (Yes or No), including top-ups | -10 to -5,000 per placement; the dialog defaults to 100 | source `call`, ref `call:<marketId>:stake:<userId>:<side>`, then `:2`, `:3` for top-ups | The only debit in the codebase. `placeCall` runs one transaction: `SELECT ... FOR UPDATE` on the User, the balance check, then the debit, so a balance never goes below 0. Entries close at the Friday close. Bot sessions get a 403. Starter points are ensured first. |
| Prediction settles your way (points back) | + your pro-rata share of the whole pool, largest-remainder rounded, no house cut, never less than you put in | source `call`, ref `call:<marketId>:payout:<userId>` | Once per user per market, written only by `finaliseMarket` inside its claim transaction (`updateMany` where outcome IS NULL). Settlement code unchanged. |
| Prediction settles against you | 0 new rows | none | The points you put in already left the balance; from settlement on they also count against Season points. The dialog says so before confirming. |
| Refund: a void market (no price 24h after settleAt) or an empty side | + exactly the points put in on that side | source `call`, ref `call:<marketId>:refund:<userId>:<side>` | Once per user per side per market, in the same claim transaction. Points in and refund net to 0 in both balance and Season points. |
| House bot funding for seeded prediction pools | each bot's planned points in (500 to 650 per market across the bots) | source `admin`, ref `admin:seed:<marketId>:<botUserId>` | Bots only; each bot nets to 0 until it wins. Admin rows never score (`NON_SCORING_SOURCES`) and bots never reach the board (`REAL_USER_WHERE`). Real users never receive admin rows (`scripts/check-ledger.ts` asserts it). |
| Paper trade in the weekly competition | 0 (no ledger row) | LeagueTrade row only; feeds the `league_trade` and `game_action` quest events | $10,000 of virtual cash per account per week. The account is created by the first trade, never at sign-in. $10 minimum, 0.1% spread. Bot sessions get a 403. |
| Copy a portfolio (a tool) | 0 directly; Portfolio Match pays +500 once the wallet state is verified | none for copying; a verified match completes `play:mirror` | The tool never mentions points or quests. |
| Buy points, cash out, or transfer points between users | not possible | no code path | The only way points move between players is a shared prediction pool. |

**Two numbers, one ledger.**
- **Points balance** (spendable) = the sum of every `PointsEvent.delta` for (user, current Season). Unchanged: `spendablePoints` in `calls.ts` and `placeCall` are not touched.
- **Season points** (board, rank, profile, `/copy` leaders, landing top 3) = the same sum minus (a) rows whose source is in `NON_SCORING_SOURCES` and (b) rows whose ref starts with `call:<marketId>:stake:` for every market in that Season with outcome IS NULL. Once a market settles, its stake rows count again together with the points-back or refund rows.
- So **Season points = quest points + weekly competition finishes + the net result of settled predictions.** A lost prediction counts against you, a void one nets to 0, and an open one does not count yet.
- **Identity** (unit-tested in `summariseLedger`): balance = Season points + starter points + admin points - points in open predictions. Admin is 0 for every real user.
- **Implementation** (`src/lib/server/queries.ts`, no interactive RepeatableRead transaction): the pure `seasonScoreWhere(seasonId, openMarketIds)` returns `{ seasonId, source: { notIn: NON_SCORING_SOURCES }, NOT: openMarketIds.map(id => ({ ref: { startsWith: openStakePrefix(id) } })) }`, with `NOT` omitted for an empty list. Open market ids come from one plain `market.findMany({ where: { seasonId, outcome: null } })` run just before the sums; the only cost is a one-request display skew while a weekly settlement commits. The same fragment, with `user: REAL_USER_WHERE`, feeds `getLeaderboard` (having sum > 0, order by sum desc then userId asc, at most 500), `rankAmongRealUsers`, `seasonRankOf` (and through it the `/copy` Season leaders), `getUserProfile` and `getPointsSummary`, so the profile rank, the board, the landing top 3 and the `/copy` leaders always agree. `pointsAllTime` applies the same source exclusion across Seasons and leaves out every open market.
- **Why.** The board must rank play, not sign-ups: counting the grant would tie every new user at 1,000 and fill the landing top 3 and the `/copy` leaders with empty wallets. Leaving open stakes out fixes minute one: a new player who predicts shows +50 (First Prediction) at once instead of -50 until Friday.
- **Display.** A user with 0 or fewer Season points is not on the board and reads "Not ranked yet"; their Season points are still shown honestly, negative after losses. The UI calls the ranked number "Season points" and the spendable one "Points balance", and never uses "score" as a noun.

**Where starter points are written** (whichever happens first; each call is wrapped so a failed grant never fails the request; never inside another interactive transaction):
1. `POST /api/v1/auth/verify`, in this order: `resolveWallet` (a new account first passes the per-IP new-account limiter, 20 per hour keyed on `clientIp(req)`, else 429 "Too many new accounts from this network. Try again later."); the bot refusal (below); `ensureStarterPoints` synchronously, not in `after()`; then the response `ok({ session, welcome })`, where `welcome` is `{ starterPoints: 1000, virtualCashUsd: 10000 }` only when this request inserted the row. `after(runForUser)` is unchanged.
2. `POST /api/v1/calls/place`: after the bot 403, `await ensureStarterPoints(session.userId, now)` before `placeCall`. Under READ COMMITTED, `placeCall`'s User lock then reads the committed grant.
3. The cron evaluate step: `evaluateAllUsers` calls `backfillStarterPoints(season.id, realUserIds, now)` once per tick, after loading `REAL_USER_WHERE` users and before the no-plays early return, in try/catch, and reports `starterGranted`. It returns 0 unless the Season window is active and filters `isBotUserId`.

Never from a GET handler, `after()`, `createUserWithWallet` alone, or a `/points/starter` route (cut). `ensureStarterPoints(userId, now, client)` in `src/lib/games/starter.ts` runs: `isBotUserId` -> reason `bot`; `user.findFirst({ id, ...REAL_USER_WHERE })` null -> `not_found` (also catches an isBot LeagueAccount); the active Season (same window as `findCurrentSeasonId`, no fallback to an ended Season) null -> `no_season`; `createMany({ skipDuplicates })`; granted = (count === 1). Two concurrent sign-ins, a sign-in racing a prediction, or a backfill can never write two rows, and only the request that inserted the row sees granted=true. Users granted by the backfill or by `calls/place` get no welcome toast; they see the balance in the account menu, the xl header chip and the `/predictions` hint. In a later Season every returning user gets a fresh grant through the same paths, because the ref carries the seasonId.

**Bot refusals** (house bots never get starter or quest points and cannot play as a user):
- `auth/verify` answers 403 "House bot wallets cannot sign in" when `isBotUserId` or a LeagueAccount with `isBot` matches, before `createSessionCookie`, including `switch=true`.
- `calls/place` and `league/trade` answer 403 for a bot session.
- `ensureStarterPoints` (prefix + `REAL_USER_WHERE`) and `backfillStarterPoints` (`REAL_USER_WHERE` + prefix) never write a bot row; `evaluateUser` returns early for a bot.
- `tests/starter.test.ts` asserts no row is ever created for a `bot-league-*` id or an isBot-account user.
- `scripts/check-ledger.ts` (read-only, local database only: `npx tsx --env-file=.env.local scripts/check-ledger.ts`) fails if any bot holds starter, play or league rows, any real user holds an admin row, a balance is below 0, or a pool, points-back or refund total disagrees with its positions. `scripts/purge-bot-points.ts` also deletes bot starter rows.

**The rollover claim.** Weekly awards are written only by the tick that wins `tx.league.updateMany({ where: { id, status: "open" } })` with count === 1, so overlapping ticks cannot pay twice; a tick that loses the claim writes nothing.

**The 3-trade minimum.** `MIN_TRADES_FOR_WEEKLY_POINTS` (3) is checked per account per week at rollover. Places stay overall ranks (bots included), and a place held by a bot or by an account with fewer than 3 trades pays nobody; nothing shifts down.

**Surfaces** (for reference): `GET /api/v1/auth/me` returns `user.points` as a `PointsSummary` `{ seasonId, balance, seasonPoints, starterPoints, inPredictions, rank }` or null (any failure returns null, never fails `/me`). The account menu shows "Points balance", "Season points · Rank #n" or "Not ranked yet", and "Points only, no cash value" at every width; the xl header chip shows the balance; the mobile Profile tab shows the tiles. `/profile` adds a "Points history" list (up to 20 rows: "Starter points", "Quest: <title>", "Points into a prediction (<TICKER>)", "Points back from a prediction (<TICKER>)", "Prediction refund (<TICKER>)", "Competition finish #n"); admin rows never appear for real users. The landing shows no personal balance, only the offer line before sign-in. Virtual cash and points are never mixed in one number.

### 3.9 Known limitations (16 Sep)

Recorded, not fixed today. Each has a planned fix; none is presented as done.

1. **Late entries.** Predictions stay open until the Friday close, so a late entry can take points from the house-bot pools at little risk. This is the largest repeatable Season points source, about 1,070 a week. Planned fix: close entries earlier and open next week's questions at that lock.
2. **Sybil starter-point funnelling.** Throwaway accounts can put their starter points on the side about to lose, which moves those points to a main account as Season points. The only brake is the new-account limiter in `auth/verify`: in memory, per instance, 20 per hour per network. Planned fix: an account-age or wallet-age signal. Scoring must never depend on holding xStocks.
3. **Bot keys.** House bot keys are derivable from their public handles. Sign-in is refused for bot wallets, so a derived key cannot act as a bot. Planned fix: HMAC-derived keys plus a reseed.
4. **Season scoping.** PlayProgress and internal events are not Season-scoped, so a completed quest stays complete. A later Season needs new quest keys.
5. **One-tick lag.** `evaluateUser` can briefly show a completed quest as in progress for one tick.
6. **Copy intent.** The copy intent on the `mirror` PlayProgress row can be overwritten by a stale read.
7. **Final competition ranks** depend on the first tick after the Friday close.
8. **Settlement read order.** `finaliseMarket` reads positions before its claim.
9. **No admin void tool.** A market can only void through the 24-hour no-price rule; there is no manual void.

### 3.10 Vocabulary (in step with `CLAUDE.md`)

- Code names stay in code: Play, League, Call, Mirror, `playKey` values, Prisma model names, `/api/v1` paths, `src/lib` module names, ledger refs (`play:`, `league:`, `call:`) and internal event names (`call_placed`, `league_trade`, `mirror_executed`, `game_action`).
- Public names: Play -> quest (in-platform quest, on-chain quest, "Quests live", "Quest complete"); League -> the competition, "Weekly competition (virtual cash)", paper trades, competition account; Call -> prediction ("Make a prediction"); Mirror -> "Copy a portfolio" (a tool) and "Portfolio Match" (the quest); score as a noun -> points ("Season points", "Points balance"); starter grant -> "Starter points".
- Banned in the UI: stake, odds, payout, bet, "prediction market", and "rewards" as a noun (the positioning line's "get rewarded" stays byte-exact). `tests/plain-names.test.ts` enforces this.
- "Virtual" or "paper" always sits next to the competition. Quests describe a wallet state and never instruct a purchase. Say "onboarding, not churn".

---

## 4. Architecture

```
Next.js 15 app router (PWA)   Tailwind, shadcn, wallet-adapter (Phantom/Backpack/Solflare/MWA)
  /api/v1/*      typed handlers (zod), the only thing the UI calls
  /api/cron/*    CRON_SECRET-protected, Vercel Cron every 5 min
lib/core         ChainAdapter, AssetSource, PriceSource, GameModule interfaces, CAIP-19 helpers
lib/adapters/solana.ts    Helius getTokenAccountsByOwner (Token-2022 + SPL), SIWS verify
lib/assets/xstocks.ts     https://api.xstocks.fi/api/v2/public/assets (Solana deployments, sector, multiplier), 1h cache
lib/prices/pyth.ts        https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=
lib/prices/jupiter.ts     https://api.jup.ag/price/v3?ids=  (x-api-key)
lib/price.ts              getPrice(assetId) -> {price, source, publishedAt, stale, marketOpen}; Pyth if open and <60s old else Jupiter; stale if >6h; 30s cache; US session calendar 2026 incl. holidays
lib/plays/engine.ts       rule evaluators
lib/games/league.ts, lib/games/calls.ts   GameModule implementations
lib/games/ledger-policy.ts, lib/games/starter.ts   points policy (client-safe) and the starter grant (server), added 16 Sep
lib/badges/               Token-2022 soulbound mint (mint.ts, keys.ts, designs.ts)
Postgres via Prisma (Supabase)
```

Auth: SIWS nonce → signature → httpOnly JWT. Since 16 Sep, verify also refuses bot wallets and writes starter points (§3.8).

### 4.1 Prisma models
```
User          id, handle?, createdAt
Wallet        id, userId, chainId, address, isPrimary
Identity      id, userId, provider (x|telegram|email), externalId      // reserved, unused now
Season        id, name, chainScope JSON, startsAt, endsAt
Partner       id, slug, name, logoUrl, blurb, links JSON, chainIds JSON
Campaign      id, partnerId, seasonId, title, startsAt, endsAt
Play          id, key, campaignId, assetSource, title, desc, points, badgeKey?, rule JSON
PlayProgress  userId, playKey, status, completedAt, proof JSON
PointsEvent   id, userId, seasonId, source (play|league|call|admin), ref, delta, ts
Snapshot      id, walletId, takenAt, holdings JSON [{assetId, symbol, raw, multiplier, qty, price, priceSource, usd}]
League        id, seasonId, weekStart, weekEnd, status
LeagueAccount leagueId, userId, cashUsd, positions JSON, equityUsd, rank
LeagueTrade   id, leagueAccountId, symbol, side, qty, price, ts
Market        id, seasonId, ticker, strike, settleAt, settledPrice?, outcome?, yesPool, noPool, source?
Position      marketId, userId, side, points
Badge         id, userId, playKey, mint, txSig
```

As built, 16 Sep: `PointsEvent.source` also takes `starter` (§3.8). It is a free string, so this needed no schema change and no migration; `prisma/schema.prisma` is untouched.

### 4.2 Cron (every 5 min)
1. Snapshot every wallet: Token-2022 accounts filtered to xStocks mint set, multiplier from mint (API fallback), price via lib/price.
2. Evaluate every active Play for every user → PlayProgress, PointsEvent, badge queue.
3. Recompute League equity and ranks.
4. Settle Markets with settleAt < now.

As built (P1, `src/lib/cron/`): `/api/cron/tick` (GET or POST, Bearer header, `?steps=games,snapshot,evaluate,badges`) runs `runTick` = games → snapshot → evaluate → badges (games first since 14 Sep: the Friday settle and rollover are clock-driven and must never wait behind a rate-limited RPC; badges last because confirmed chain writes are the slowest step). Each step is timed and isolated (`{ name, ok, took, detail }`; a failing step is reported, never a 500), and the response carries a `health` summary (`ok`, `took`, `catalogueOrigin`, `slotAnchorAgeMs`, snapshot / evaluate / badges counts) for pingers. Steps 3–4 above are the League and Calls GameModules registered in `src/lib/games/index.ts`. Notes where behaviour differs from the outline:
- Snapshot rows are written with the tick's `now`, one per wallet per tick, an empty wallet included (so "sold everything" is visible). Evaluation merges every wallet of a user per 5-minute bucket (latest row per wallet in the bucket wins) over the last 45 days.
- Completion is sticky: a completed PlayProgress never returns to `in_progress`, keeps its first `completedAt`, and its proof is only refreshed by another complete evaluation (an unmet re-evaluation leaves the completion-time evidence in place). In-progress proofs refresh every tick, with the engine's progress under `proof.progress`.
- PointsEvent (`play:<key>`) and Badge rows are inserted before PlayProgress and guarded by their unique constraints (P2002 = already awarded), so a crash anywhere is repaired by the next run. Badge rows are queued with `mint`/`txSig` null; P4 mints them.
- `mirror_executed` events: superseded by §3.4 (the intent lives on the `mirror` PlayProgress proof; no PointsEvent source "mirror").
- Since 16 Sep the evaluate step first backfills starter points for real users in the active Season (`backfillStarterPoints`, §3.8) and reports `starterGranted`; bots are refused at the top of `evaluateUser`.
- Fast path: `runForUser(userId)` = snapshot that user's wallets + evaluate, capped at ~8s, never throws. `/api/v1/auth/verify` schedules it with `after()` on every successful sign-in, `POST /api/v1/plays/refresh` (session, same-origin, 1/min per user, 429 otherwise) runs it on demand behind the Refresh button on the Quests page (`/quests`), and that page re-fetches once ~3s after a sign-in transition so "First Position" is already complete on first look.

### 4.3 Env
`HELIUS_API_KEY, JUPITER_API_KEY, DATABASE_URL, DIRECT_URL, JWT_SECRET, CRON_SECRET, SERVER_WALLET_SECRET, NEXT_PUBLIC_RPC, NEXT_PUBLIC_APP_URL` (template: `.env.example`)

Production (Vercel Pro, default region iad1):
- `DATABASE_URL`: create the Supabase project in **us-east-1** (next to iad1). Use the transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1&connect_timeout=5`, e.g. `postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&connect_timeout=5`.
- `DIRECT_URL`: read by the Prisma CLI only (schema `directUrl`). Supabase: the session pooler (port 5432, same host), not `db.<ref>.supabase.co` (IPv6-only on Free). Local Postgres: same value as `DATABASE_URL`.
- `JUPITER_API_KEY`: **required** (free at https://portal.jup.ag). Keyless Jupiter is throttled to about 0.5 requests per second and returns 429 in normal click-through, which surfaces as "No price".
- `HELIUS_API_KEY`: set it in production (free tier is enough); without it the adapter falls back to `NEXT_PUBLIC_RPC`, the slow, rate-limited public RPC.
- `NEXT_PUBLIC_APP_URL`: `https://<project>.vercel.app` until dulo.fun actually resolves; then `https://dulo.fun` and redeploy. Set it before the first Badge mint, because the metadata URI is baked into each mint. Otherwise it is only the fallback SIWS domain/uri: the nonce and verify routes derive them from the request (`x-forwarded-proto`, `x-forwarded-host` / `host`) so previews and custom domains sign for themselves.
- `JWT_SECRET`: at least 32 characters (`openssl rand -base64 48`). `CRON_SECRET`: at least 16 characters (`openssl rand -hex 16`), sent only as `Authorization: Bearer`; the `.env.example` placeholder is refused in production.
- `SERVER_WALLET_SECRET`: the badge wallet (base58 or JSON array), funded with 0.3 SOL. Empty means Badges stay "Minting soon". The keypair file must live outside the repo (never in the working tree); only its secret goes in Vercel env. `.gitignore` also blocks `badge-wallet.json`, `*keypair*.json`, `*-wallet.json`, `id.json`, `/keys/` and `*.key` as a backstop.

Plus `PYTH_API_KEY`, optional and **not set for the hackathon** (decided 14 Sep: Jupiter settles, source shown; since 26 Aug 2026 Hermes price updates return 401 without `Authorization: Bearer <key>`, sign-up at https://pythdata.app/signup), optional `PYTH_HERMES_URL` (default https://hermes.pyth.network, docs example uses https://pyth.dourolabs.app/hermes), optional `XSTOCKS_API_URL`.

### 4.4 Known mainnet mints (verify against API before use)
TSLAx XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB · AAPLx XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp · METAx Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu. All xStocks mints start with `Xs`. Devnet has no xStocks and Jupiter is mainnet-only: everything runs on mainnet with small amounts.

---

## 5. Day-by-day (Irish time)

Status 14 Sep (evening): P0–P4 shipped on Monday, ahead of this plan. The live Tue–Fri plan and checklists are internal planning notes kept privately; the ticks below record what is actually done.

**Mon 14**
- [x] Name decision (P-1): Dulo.
- [x] P0 scaffold: SIWS, ChainAdapter / AssetSource / PriceSource, Prisma models, seed, tests.
- [x] P1 (snapshots, rule engine, Plays UI) and P2 (League), pulled forward from Tue.
- [x] P3 (Calls) and P4 (Mirror as deep links + soulbound Badges), pulled forward from Wed.
- [ ] Repo on GitHub, Vercel, Supabase, Helius key. Founder, moved to Tue (G1).
- [ ] Buy $5 of one xStock on the demo wallet. Founder, moved to Tue (G3).

**Tue 15**
- [x] Bot hygiene (T1), League/Calls continuity (T2), deploy config + LICENSE + `.env.example` (T3), earnings calendar (T5). Claude, in parallel.
- [x] Copy drift (T4): Mirror deep-link wording, Calls settlement wording, this file's banner and §6 shot list.
- [ ] G1 first deploy, G2 prod bring-up + tick, G3 xStocks on the demo wallet, G4 DM 2 or 3 Stocklana builders. Founder.

**Wed 16**: register on the hackathon site with a linked wallet; record the Technical Video in the evening per §6b (Founder). Placeholder partners, landing + nav, mobile tables, badge mint limit (Claude, W1 to W4). Badge wallet + first mainnet mint (G5), one real Portfolio Match completion, which is one Jupiter swap done outside the app and then "verify" (G6), two paper trades (G7) (Founder). README, `docs/SUBMISSION.md` and this file rewritten for the plain names (Claude, done 16 Sep). Three games on one Season leaderboard, the Quests and Competition renames, starter points, the Season points rule, the 19-quest catalogue and these docs (Claude, 16 Sep). (`@solana/spl-token-metadata` is already pinned, G8 done.)
**Thu 17**: press **Submit Project** as the hedge, with whatever links exist (Save Draft is not a submission); the gate is the repo being public, since the form wants at least one link. Screenshots (Claude, H3). Record the Pitch Video 14:00 to 17:00 per §6 (Founder). No Blink.
**Fri 18**: final checks (F1, Claude). Fresh-wallet dry run, then "Save edit" on the Thursday submission by 12:00 Irish, X post tagging @solana and @xStocksFi, Colosseum interest (Founder, G12 to G14). The close moved to Fri 25 Sep 2026, 16:00 ET: keep editing until then, and nothing changes during judging to 2 Oct.

---

## 6. Pitch Video script (≤ 3:00, rewritten 20 Sep 2026 for the shoot)

The form's Pitch Video is "sell your project", and judges open it first. **Target 2:55.** The voice-over below is **374 words**, which is 2:40 at 140 words a minute and 2:53 at a slow 130 — so it fits at a natural pace with room to breathe. The 16 Sep version ran 451 words, about 3:07, and could only be delivered rushed. Do not add sentences back without cutting others.

**This script needs no xStocks in your own wallet.** The on-chain verification beat runs on a curated public holder, which is both zero-setup and a stronger demonstration: a stranger's wallet, read live. The signed-in beats run on starter points and virtual cash, which every new wallet gets. If you do hold xStocks by the shoot, see the upgrade note in §6.3.

Record at 1280x800 in an incognito window with Phantom. Desktop only — the phone insert from the earlier version is cut; it costs more than it returns in a three-minute film. Unlisted YouTube; link it in the README and the form.

Rules for this shoot:

- **Plain names on camera, predictions first.** Predictions, the competition (virtual cash), quests, copy a portfolio, points, leaderboard, badges, partners, in that order whenever the games are listed. Never say Play, League, Call, Mirror, Scout, Oracle or rewards (as a noun) out loud: those are code names or retired words, and the app no longer shows them. Never say stake, odds, payout, bet or "prediction market". The beat labels in §6.2 are pinned by `tests/copy.test.ts`.
- **The positioning line is fixed copy:** "The entertainment layer for xStocks. Compete, predict and get rewarded, for points." (`src/lib/config.ts`). The Ask beat closes on it, word for word; never invent a variant. The hook uses the landing's own words instead: the headline "The entertainment layer for xStocks." and the three verbs "Predict. Compete. Complete on-chain quests."
- **Say "Points only, no cash value." once, out loud.** Whenever starter points are on screen, they are points only, never a prize, and never ranked. The competition is always "virtual cash", never money, and a paper trade is never called a buy of a real stock.
- **Never fake a shot.** When a precondition fails, take the plan-B beat in §6.3. Rehearse once on the recording target before the real take, and decide the plan-B beats then.
- **Never claim a number the app has not produced.** There are no users, no partners, no minted badge and no billing, so this script carries no traction number at all. If one is ever added it comes from `npm run -s stats` run the same day, bots and the founder's own wallets excluded.
- **Only shipped quests.** Show quests from §3.1 only; nothing that is not built appears on screen or in the voice-over.
- **`APP` is where you record.** Production, once `docs/DEPLOY.md` has been followed (`https://<project>.vercel.app`, then `https://dulo.fun` when it resolves). Record on the deployed URL if at all possible: the main track is judged partly on a working end-to-end demo, and a visible live URL is the cheapest proof of one. Only if the deploy is not up, fall back to a local production build (§6.3).
- `HOLDER` = one of the curated "Try a real holder" addresses (never the founder's own wallet). `DEMO` = the wallet you sign in with on camera; it needs no xStocks. `TARGET` = any copy target that is not `DEMO`.

Budget (2:55 total): hook 0:12 · problem 0:13 · founder 0:08 · check a wallet 0:24 · proof 0:20 · sign in and quests 0:25 · predict and compete 0:26 · where it goes 0:28 · ask 0:19. The verified core (check a wallet, its proof, signing in) is the longest block at 1:09, 39% of the film.

### 6.1 Preconditions (check an hour before the shoot, in this order)

| # | Must be true where you record | How to check |
|---|---|---|
| P1 | The tick is healthy and has run recently | `curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/cron/tick" \| jq '.data.health'` shows `"ok": true` with no failed step |
| P2 | The landing's first screen shows the headline, the three verbs, the welcome offer line, three live prediction cards with prices, and three game tiles each showing a number rather than a dash | `$APP/` in the incognito window, signed out. A dash or a stuck skeleton means the database is empty: re-run `npm run db:setup` |
| P3 | `HOLDER` still holds at least 3 xStocks, the page loads in under 3 seconds, and it reads several on-chain quests as verified | `$APP/check/<HOLDER>` once off camera; the answer is cached for 5 minutes, so the take is fast |
| P4 | The proof sheet shows the holding, the quantity after the multiplier, the dollar value, the price source and the snapshot time, and the address chip in the page header opens the wallet on Solscan | open a verified on-chain quest on that check page, then Proof. There is no Solscan **token** link inside the sheet; the explorer link is the address chip |
| P5 | `DEMO` has never signed in this Season, so its first sign-in shows the welcome toast (1,000 starter points, $10,000 virtual cash) | sign-in history on the target. Once you burn this wallet you cannot re-shoot the toast with it; keep a second fresh wallet in reserve |
| P6 | Three predictions are open (NVDA, TSLA, SPY) for this Friday and lock later than your shoot | `$APP/predictions`; each card reads Open, not Locked |
| P7 | The competition week is open and the bots are visible and labelled "house bot" | `$APP/competition` |
| P8 | `TARGET` has at least 2 legs and no stale-price banner, and every "Open in Jupiter" button opens the right xStock with the USDC amount filled in | `$APP/copy/<TARGET>`; open every leg once, off camera |
| P9 | Every partner card reads "Quests live" or "Coming soon", with no placeholder. Note what the per-quest completion counts actually read; if they are all zero, describe the mechanism and never a result | `$APP/partners` |

### 6.2 Shot list

| t | Beat | Shot | URL | Voice |
|---|---|---|---|---|
| 0:00 | Hook | Landing first screen, signed out, cursor still: the headline "The entertainment layer for xStocks.", the three verbs "Predict. Compete. Complete on-chain quests.", this week's live prediction cards beside them, and the three game tiles underneath | `$APP/` | "Dulo is the entertainment layer for xStocks. Predict, compete, complete on-chain quests: three games, one Season leaderboard, on an engine that can score any tokenized asset." |
| 0:12 | Problem | Hold on the hero paragraph, then a slow scroll past the game tiles. Lower third: "800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)" | `$APP/` | "More than 800,000 Solana addresses hold a tokenized stock. Getting someone to buy once is easy. Giving them a reason to hold, diversify and come back is not." |
| 0:25 | Founder | The quests board, cursor still | `$APP/quests` | "Dulo is built solo, and it works because on Solana what you hold is public, so it can be scored." |
| 0:33 | Check a wallet | The "Check any wallet" box, click the "Public holder A" chip, then the check page: the stat strip (value, on-chain quests verified, would score), the holdings list with quantities, the multiplier note and the price chip showing source and age | `$APP/check` → `$APP/check/<HOLDER>` | "No account needed. Paste any Solana address. Dulo reads that wallet's xStocks straight from Token-2022 balances, applies the split and dividend multiplier, prices every position with its source and age, and shows the on-chain quests it already meets. Nothing is stored. Nothing is scored." |
| 0:57 | Proof | Proof button on a verified on-chain quest, then the proof sheet rows. Pause on the holding, the quantity, the dollar value, the price source and the snapshot time. Click the address chip in the header, land on Solscan, come back | `$APP/check/<HOLDER>` → `https://solscan.io/account/<HOLDER>` | "Every on-chain quest carries its evidence: the exact holding, the quantity after the multiplier, the value, the price source, and the moment the engine read it. You don't take that on trust. Open the wallet on Solscan and check it yourself." |
| 1:17 | Sign in and quests | `DEMO`: Connect → Phantom → sign the message → the welcome toast. Then the quests board, In-platform filter first (First Prediction and First Paper Trades waiting, with their next steps), then the On-chain filter (the holding quests with their hints, the two partner quests marked "Coming soon") | `$APP/` → `$APP/quests` | "Sign one message. No transaction. Every new player gets 1,000 starter points and ten thousand dollars of virtual cash, so nobody hits a dead end, and starter points never count toward rank. Quests pay for holding, diversifying and buying steadily, never for trading volume. Points only, no cash value." |
| 1:42 | Predict · Compete | Predictions: Yes on NVDA with the default 100 points, the pool bar moves, "Quest complete: First Prediction". Cut to the competition: one paper trade, the price chip showing source and age. Cut to the copy page and open one "Open in Jupiter" leg | `$APP/predictions` → `$APP/competition` → `$APP/copy/<TARGET>` | "Then play. Predictions: Yes or No on Friday's close, for points, settled from the close with the source on the card. The weekly competition gives you ten thousand in virtual cash at live prices, and the top ten with three trades earn points. Copying a portfolio opens one prefilled Jupiter swap per leg, signed in your own wallet." |
| 2:08 | Where it goes | Partner grid, then the xStocks partner page with its on-chain quests and per-quest completion counts, then the "List your project" card | `$APP/partners` → `$APP/partners/xstocks` | "Every quest is a row of JSON, not code, so listing one is a database row, and a partner page counts every verified completion it drives. That is the direction: apps and issuers run competitions and quests for their own holders on Dulo's API, and a player carries one score across them. Partners would pay per verified completion. Nobody is billed today." |
| 2:36 | Ask | Back to the landing first screen, then the closing card. End card text: the positioning line · the live URL · `github.com/<owner>/<repo>` · "Points only, no cash value." · "Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions." · "Dulo is independent and not affiliated with xStocks (Backed Finance owns that brand)." | `$APP/` | "Dulo takes no custody, signs no swap for you, runs no real-money market and puts no points on chain. Hold a tokenized stock? Paste your wallet. Just want to play? Sign in. Dulo. The entertainment layer for xStocks. Compete, predict and get rewarded, for points." |

### 6.3 Plan B (decide at the rehearsal; never fake a shot)

- **The deploy is not up by the shoot:** record from a local production build (`npm run build && npm start`, with the dev server stopped first, plus `npm run tick:local` in a second terminal). Keep the URL bar out of frame or let it read localhost. Do not say "live" of anything that is not, and leave the live URL off the end card until one resolves. Prefer spending twenty minutes on `docs/DEPLOY.md` instead: a visible production URL is worth more than the time it costs.
- **Upgrade, if `DEMO` holds xStocks by the shoot:** after the welcome toast, switch the quests board to the On-chain filter and show First Position and Diversified verifying against your own wallet. Say "and against my own wallet, these verify in seconds" — nine words, so cut "so nobody hits a dead end" from the same beat to pay for it. Do not attempt this unless the quests already read complete before you record.
- **P3 fails (the check page is slow, or the holder sold):** try the next curated address. If none works, cut the 0:33 beat to ten seconds on the landing's check box and give the seconds to Proof, read slowly.
- **P4 fails (no price source in the proof sheet):** do not click through to Solscan. Say "the exact holding, the quantity after the multiplier, and the value the engine used", and stop there.
- **P5 fails (no fresh wallet, or no toast):** sign in off camera and open the beat already connected. Show the account menu instead (Points balance, Season points, "Points only, no cash value") and say "every new player starts with 1,000 starter points", never "you just got". The toast only appears on a wallet's first sign-in in a Season.
- **P6 fails (predictions are locked):** show a settled market and its resolution instead, and change the voice to "settled from Friday's close, with the source on the card". Never place a prediction on a locked market on camera.
- **P7 fails (no bots in the week):** cut the competition shot and give its seconds to predictions.
- **Sign-in does not refresh the board:** reload once on camera; it is honest and takes a second. Do not cut to a signed-in board and imply it happened instantly.

### 6.4 Shoot day, in order

1. **Deploy first** if it is not already up: `docs/DEPLOY.md`, about twenty minutes.
2. **Run the preconditions in §6.1** and write down which plan-B beats you are taking. Do this before you open a recorder.
3. **Rehearse once, end to end, out loud, with a stopwatch.** Not to camera. If it runs past 2:55, cut a sentence rather than speaking faster.
4. **Set up:** incognito window at 1280x800, Phantom installed and locked to `DEMO`, notifications off, a second monitor for this script so it is never on camera, and every URL in the shot list opened once beforehand so nothing loads cold.
5. **Record the screen and the voice together** if you can deliver it; otherwise record the screen silently against the beat timings and lay the voice over afterwards. A clean voice track matters more than one take.
6. **Watch it once before uploading.** Check the three things that sink a pitch video: a number on screen that contradicts the voice, a URL bar showing localhost while you say "live", and any retired word (Play, League, Call, Mirror, rewards, stake, odds, payout, bet).
7. **Upload unlisted to YouTube**, title "Dulo — the entertainment layer for xStocks", and put the URL in the form, in `README.md` and in `NEXT_PUBLIC_VIDEO_URL`.
8. **Submit.** `docs/SUBMISSION.md` has the paste-ready copy. Press **Submit Project** — Save Draft is not a submission — with the main track and no bounty ticks, then keep editing until the close on Fri 25 Sep 2026, 16:00 ET.

## 6b. Technical Video script (≤ 5:00)

The form's Technical Video is a walkthrough of the code. **Target 4:55.** Rewritten 16 Sep: plain names on screen (predictions, the competition with virtual cash, quests, copy a portfolio), code names in the code, the starter grant and the Season points rule in the ledger beat, and the one honest limit named out loud.

Record Wed 16 Sep evening from the editor (VS Code, 16 pt, minimap off), a terminal, and a browser on the recording target (§6). Unlisted YouTube; link it in the README and the form. Code names survive in the code, so `Call`, `League`, `Play` and `Mirror` will be on screen: say once, early, that the user-facing names are predictions, the competition, quests and copy a portfolio, and then read the code as it is. The page routes on screen are the new ones (`/predictions`, `/competition`, `/quests`, `/copy`); the `/api/v1` paths keep their code names.

Before pressing record:

- Hide secrets: add `.env*`, `badge-wallet.json` and any keypair file to VS Code `files.exclude`. Export `CRON_SECRET` and `APP` off camera and never echo them.
- CI is green on the default branch (`.github/workflows/ci.yml`).
- A tick ran in the last 5 minutes with `health.ok: true` (`npm run tick:local -- --once` locally).
- One completed on-chain quest with a proof exists on `$APP/quests`, or use `$APP/check/<HOLDER>` for the 1:35 cut.
- Run `npx vitest run` once beforehand so it finishes on camera in about 20 seconds. **Quote the number it prints that day, never a remembered one.**
- No Badge has been minted on mainnet as of 16 Sep. Unless one exists by the shoot, take the plan-B beat at 4:25 rather than a Solscan transaction.

| t | Beat | Screen | Voice (key points) |
|---|---|---|---|
| 0:00 | What it is | Two seconds of the landing first screen (the live prediction cards and the three game tiles), then the README top, then the `src/lib` tree | "Dulo is a Next.js 15 app reading Solana mainnet: predictions, a virtual-cash competition and quests, on one Season leaderboard. There is no Anchor program: every read is public chain state, and the only transaction this codebase sends is a soulbound badge mint. The screens say predictions, the competition, quests and copy a portfolio; the code still says Call, League, Play and Mirror, and only the code does." |
| 0:25 | The four interfaces | `src/lib/core/types.ts`: `ChainAdapter`, `AssetSource`, `PriceSource`, `GameModule`; then `src/lib/core/caip.ts` | "Everything sits behind four interfaces. Chain reads go through ChainAdapter, asset maths through AssetSource, prices through lib/price, and the two games that run on a clock are GameModules. Asset ids are CAIP-19 strings, so an asset carries its chain in its id, and a user owns many wallets: nothing keys on one pubkey. This is what makes the second asset class an implementation rather than a rewrite, and Season 0 ships exactly one of each." |
| 1:05 | Token-2022 multipliers | `src/lib/adapters/solana.ts`: `getTokenBalances` over both token programs (`getParsedTokenAccountsByOwner`), the batched `getMultipleParsedAccounts` mint read, `parseScaledUiAmountExtension`, `effectiveMultiplier`; then `normaliseQtyString` in `src/lib/assets/normalise.ts`; then `tests/solana-adapter.test.ts` | "xStocks are Token-2022 mints with the ScaledUiAmount extension: a split or a dividend changes a multiplier on the mint, not your raw balance. The adapter batches the mint reads, switches to the pending newMultiplier once its activation time has passed, and normalises the quantity with string decimal maths, so a holding reads the way a statement would." |
| 1:35 | A quest is a data row | `src/lib/plays/catalogue.ts`, the Diversified rule `{ "type": "diversified", "minAssets": 3, "minSectors": 2 }` and one in-platform rule with `distinctBy` → `src/lib/plays/rules.ts` `PLAY_RULE_TYPES` (seven types, zod-validated) → `src/lib/plays/engine.ts` `evaluatePlay` → `evalDiversified`; then the browser, Proof on a completed on-chain quest | "A quest is data. That rule is stored as JSON on a row and validated by a zod schema with seven rule types. In-platform quests use the same engine, counting paper trades and predictions instead of snapshots. The engine is pure functions over history: complete or not, plus the proof. This is the same JSON the player opens in the proof sheet, so adding a quest is a database row, not code." |
| 2:10 | Scoping a quest to its issuer | `prisma/schema.prisma` `Play.assetSource` → the terminal: `git grep -n assetSource -- src prisma` → `src/lib/plays/engine.ts` `scopeOf` and `inScope` → `tests/engine.test.ts` the "assetSource scope" block, run live | "A quest is fenced to the issuer it was written for. Every Play row carries an assetSource, every holding carries the source that resolved it, and the engine applies both: the issuer fence, and then the rule's own asset list, which narrows it rather than replacing it, because two issuers can ship the same symbol. Without that fence, adding a second issuer's mints would silently change what five existing quests mean — a foreign bag completing First Position, inflating Diversified, and breaking Portfolio Match by becoming a leg nobody chose. So it landed on its own, as a behavioural no-op, proved by the tests that already existed, before a single new mint existed. [If the registry has not shipped: 'What is still true is that snapshot and price import the xStocks source directly — an AssetSource registry keyed by Play.assetSource is what replaces that last import.']" |
| 2:50 | The five-minute tick | `vercel.json` (`*/5`) → `src/lib/cron/tick.ts` `TICK_STEPS` → terminal: `curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/cron/tick" \| jq '.data.health'` | "Every five minutes one tick runs games, snapshot, evaluate, badges, in that order. Games go first because the Friday settlement and the weekly rollover are clock-driven and must never wait on a rate-limited RPC; badges go last because a confirmed chain write is the slowest step. Every step is timed and isolated, and this health block is what a pinger or a human reads." |
| 3:25 | Append-only ledger | `prisma/schema.prisma` `PointsEvent` with `@@unique([userId, seasonId, ref])` → `src/lib/games/ledger-policy.ts` (`STARTER_POINTS`, `NON_SCORING_SOURCES`, `starterRef`) → `src/lib/games/starter.ts` `ensureStarterPoints` (`createMany` with `skipDuplicates`, granted only when count is 1) → `src/lib/cron/evaluate.ts` (PointsEvent written before PlayProgress, a P2002 means already awarded) → `src/lib/games/calls.ts` with its negative `delta` → `REAL_USER_WHERE` and `seasonScoreWhere` in `src/lib/server/queries.ts` | "Points are an append-only ledger and a balance is a sum. Every row carries a unique ref, like play colon first underscore position, or starter colon the Season id, so a retry, a crash or two sign-ins at once can never pay twice. Points put into a prediction are just a negative event. Season points are the same sum without starter rows, house seed rows and open predictions, and one query fragment feeds every board. Bots trade in the competition and seed the prediction pools so neither board is empty; they are filtered out in the database, never score and cannot sign in." |
| 4:00 | Copying a portfolio is links, not execution | `src/lib/mirror/allocation.ts` `jupiterSwapUrl` and `src/lib/mirror/events.ts` (the recorded intent the rule consumes) → terminal: `git grep -n sendAndConfirmTransaction -- src` (one file, `src/lib/badges/mint.ts`) | "Copying a portfolio builds an allocation plan and one Jupiter link per leg: sell USDC, buy the xStock, amount prefilled. You sign it in Jupiter, in your own wallet, and pressing verify records an intent that the next snapshot is compared against. The only transaction this codebase ever sends is the badge mint, and that grep is the proof." |
| 4:25 | Badges, tests, CI | `src/lib/badges/mint.ts` instruction list, then the terminal: `npx vitest run` summary line, then `.github/workflows/ci.yml` and the green Actions run | "Badges are Token-2022 mints with NonTransferable and MetadataPointer: one transaction, zero decimals, a supply of one, mint authority removed in the same transaction, and no custom program. [Read the number the terminal prints] tests cover every rule type, the adapter, the ledger, the starter grant and both games, and CI runs lint, typecheck, tests and a production build on every push. MIT licensed. Points only, no cash value." |

**Plan B:**

- **No mainnet Badge yet (true as of 16 Sep):** at 4:25 show `tests/badges.test.ts` asserting the instruction set against a faked send, say "the first mainnet mint is queued", and skip the explorer. Once a mint exists, open `https://solscan.io/tx/<txSig>` and the token page showing the Non-Transferable and Metadata Pointer extensions.
- **`health.ok` is false on the day:** show the failing step and say what it means. Re-run once only if it was an RPC rate limit.
- **No proof on `DEMO`:** use `$APP/check/<HOLDER>`. If neither works, show the fixture snapshots in `tests/engine.test.ts`.
- **CI not green:** run `npm run lint && npm run typecheck && npx vitest run` locally on camera instead of the Actions page.
- **Running low at 3:50:** cut the copy-a-portfolio beat to the single grep line. Never cut the 2:10 limit beat: naming it is the point.

---

## 7. Risks
Weekend demo with frozen prices → Jupiter fallback + source/age chip. Jupiter rejects a Token-2022 hook mint → test 3 mints Wed morning, restrict Mirror to tested. Multiplier confusion → single normaliseQty, unit tested vs xStocks `/multiplier`. Empty boards → bots trade in the paper League and seed the Call pools (never scored, never on the Season board); real wallets come from recruiting and check-any-wallet. New players with nothing to play with → 1,000 starter points and $10,000 of virtual cash on first sign-in (§3.8). Points abuse → the known limits in §3.9, each with a planned fix. Keyless Jupiter 429s → `JUPITER_API_KEY` required. Pyth Hermes key → decided 14 Sep: no key; Jupiter Price v3 settles and the source is printed on every card (a key would not change settlement, because Hermes publishes only during the NY session and `settleAt` is close + 5 min). Scope → cut list. Optics → points only, say it.

---

## 8. Submission checklist

- **Registered** on https://hackathons.solana.com/hackathons/stocklana with a **linked Solana wallet** (the prize wallet, not the badge server wallet). The submit form is gated on both.
- **Register + submit early (Thu 17 Sep), edit until the close.** Press "Submit Project" (Save Draft is not a submission) as soon as the repo is public; one working link is enough, and a demo URL can follow. Edits are allowed until close, so every later change is a "Save edit", never a first submission.
- **Public repo:** MIT; README with one-liner, screenshots, architecture mermaid, how points work, why Solana and run + seed instructions. The disclosure says no code was ported from earlier projects. `docs/private/` is gitignored; run `git status --ignored` and a secret grep before flipping public.
- **Live URL:** nothing is deployed as of 16 Sep. Once it is, `https://<project>.vercel.app` until dulo.fun resolves, and it must work in incognito with Phantom on desktop and phone. A fresh wallet must see the welcome toast and a points balance of 1,000.
- **Videos:** Pitch Video ≤ 3:00 (§6) and Technical Video ≤ 5:00 (§6b), both unlisted YouTube, both linked in the README and the form.
- **Form fields:** Short Description ≤ 280 characters; Full Description Markdown ≤ 5,000; team Solo; bounty tracks none on the first submission, then PreStocks and Pyth added one at a time as each becomes true on production (`docs/SUBMISSION.md` Step 5 has the wording and the conditions). Tessera is excluded by the PreStocks track's own clause against non-PreStocks pre-IPO tokens; Meteora DBC and Clawpump both require launching a token, which contradicts points only.
- **Honest numbers:** every number is sourced or comes from `npm run -s stats` the same day. No entrant counts, no "only" claims.
- **Timing:** submissions close Fri 25 Sep 2026, 16:00 ET (20:00 UTC, 21:00 Irish), confirmed 17 Sep, and judging runs to 2 Oct. Hard stop at the close, with the final edit by 12:00 Irish. The same plan is in `docs/SUBMISSION.md`.
- **After submitting:** X post with the pitch video attached natively; register for Colosseum World's Fair.

---

## 9. Claude Code prompts (run in order, one session each)

Historical: these were the pre-build prompts. P0–P4 shipped 14 Sep. The `<path>` port steps in P0 and P3 were never executed (no code was ported), and P4 as written specified Jupiter Swap v2 execution, which was cut in favour of deep links (§3.4). The prompt text below has been corrected to what shipped, with the original noted in brackets. The page paths in these prompts (`/plays`, `/league`, `/calls`, `/mirror`) are the pre-rename ones: the shipped routes are `/quests`, `/competition`, `/predictions` and `/copy`, and the old paths (plus the 15 Sep names `/rewards` and `/paper-trading`) redirect permanently. The betting words in these prompts (odds, Call) were retired on 15 Sep.

**P-1: name**
```
Read docs/HANDOFF.md section 1. Help me pick the product name. Candidates already known available: transact.fun, transaction.fun, transactions.fun. Unverified: plays.fun, overtime.fun, arcade.fun, playbook.fun, gameday.fun, moves.fun, onchainplays.fun, degenplays.fun. For each: check availability via `whois` or `dig NS` if network allows, check GitHub org/X handle collisions via web search if available, and score on: works as a multichain umbrella brand, pairs with the mechanic word "Plays", says "on-chain activity" to a normie, hype-ability on X, risk of collision with existing crypto projects. Recommend one, give a one-line tagline and a 3-word positioning. Then replace {{NAME}} across docs/ and package.json.
```

**P0: scaffold**
```
Read CLAUDE.md and docs/HANDOFF.md. Scaffold the Next.js 15 app-router project per section 4: TypeScript, Tailwind, shadcn/ui, Prisma with the models in 4.1, wallet-adapter (Phantom, Backpack, Solflare, MWA), PWA manifest, SIWS auth (/api/v1/auth/nonce, /api/v1/auth/verify → httpOnly JWT). Create lib/core interfaces (ChainAdapter, AssetSource, PriceSource, GameModule) and CAIP-19 helpers; implement lib/adapters/solana.ts, lib/assets/xstocks.ts, lib/prices/pyth.ts, lib/prices/jupiter.ts, lib/price.ts exactly as specified, with the 2026 US session calendar. Seed script: Season 0 "Stocks Season", Partners (xStocks, Jupiter, Kamino, two placeholder Stocklana apps), Campaigns, Plays from 3.1 as JSON rules. Unit tests for marketOpen, normaliseQty, CAIP-19 parse. [Original: port layout and leaderboard components from an earlier project at <path>, renaming every "quest" to "play". NOT done; the layout and leaderboard were written fresh.]
```

**P1: snapshots + Plays**
```
Add /api/cron/snapshot (CRON_SECRET). Per wallet: Helius getTokenAccountsByOwner for Token-2022, filter to xStocks mint set, multiplier from mint ScaledUiAmount extension (API fallback), qty and usd via lib/price, store Snapshot. Implement lib/plays/engine.ts with rule types hold_any, hold_consecutive, net_increase_days, hold_through_date, diversified, mirror_match, internal_event as pure functions (rule, holdingsHistory, events) => {complete, proof}; tests with fixture snapshots per type. Cron step 2 evaluates active Plays, writes PlayProgress and PointsEvent. Build /plays (card grid grouped by Partner/Campaign, progress, proof drawer), /partners/[slug] (co-branded campaign page), /leaderboard (season points). /api/v1 handlers with zod for all reads.
```

**P2: League**
```
Implement lib/games/league.ts as a GameModule per 3.2 and models League/LeagueAccount/LeagueTrade. POST /api/v1/league/trade using lib/price with 0.1% spread; equity and rank recompute in cron; weekly rollover awarding PointsEvents to top 10. Seed 15 bot accounts with plausible trades. /league page: mobile bottom-sheet trade form, positions, leaderboard with rank deltas, price source/age chip. internal_event emits league_trade for the scout Play.
```

**P3: Calls**
```
Implement lib/games/calls.ts (points-denominated parimutuel) as a GameModule. [Original: port the pool math from an earlier project at <path>. NOT done; src/lib/games/parimutuel.ts was written fresh.] Models Market/Position. Create/place/settle endpoints; settle via lib/price with Pyth first, Jupiter fallback, record source. Seed 3 markets per 3.3. /calls page with market cards, live pool split, place Call, my positions. Emit call_placed for the oracle Play.
```

**P4: Mirror + Badges**
```
Build /mirror/[wallet] per 3.4: allocation from latest Snapshot, 7d/30d P&L from history, "Mirror with $X USDC" showing the target allocation and one prefilled Jupiter deep link per leg (USDC → xStock mint, amount prefilled) that the user opens and signs in Jupiter from their own wallet, with no in-app execution (decided 14 Sep, §3.4), stale-price chip on the page. mirror_match rule checks the next snapshot vs target ±20%. [Original prompt specified executing sequential Jupiter Swap v2 orders (GET /order → sign → POST /execute) with slippage and deviation checks. That is on the cut list and was not built.] lib/badges.ts mints a Token-2022 NonTransferable mint with MetadataPointer from SERVER_WALLET_SECRET on completion of badge Plays and League Top 3; four inline SVG designs; store txSig; show badges on profile.
```

**P5: Partners, landing, polish, README**
```
Landing: hero with the positioning line, three blocks (Plays, League, Calls), partner logo row, live stats (users, plays completed, league equity), "why Solana" section, "list your project" CTA (mailto). /admin/attribution JSON route: completions per partner per season. Empty states, skeletons, toasts, Android Chrome pass at 390px. README with architecture mermaid, how Plays verify, reused-code disclosure, env and seed instructions. If time: actions.json + POST /api/actions/mirror Blink, register at dial.to.
```

---

## 10. Reference links
Hackathon https://hackathons.solana.com/hackathons/stocklana · xStocks API https://docs.xstocks.fi/apis/openapi/assets · multipliers https://docs.xstocks.fi/developers/multipliers · xStocks extension set https://solana.com/news/case-study-xstocks · Jupiter Swap v2 https://developers.jup.ag/docs/swap/index.md · Jupiter Price v3 https://developers.jup.ag/docs/price/index.md · Jupiter key https://developers.jup.ag/portal · Pyth Solana + market hours https://docs.pyth.network/price-feeds/core/market-hours · Kamino xStocks market https://xstocks.fi/us/news/how-kamino-turned-xstocks-into-a-lending-market · MWA https://docs.solanamobile.com/developers/mobile-wallet-adapter · Blinks https://solana.com/docs/tools/actions
