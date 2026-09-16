# Project brief

We are building the entertainment layer for xStocks: a distribution network where projects list Plays (verified on-chain actions), users complete them from their real wallet activity, and everyone competes in games and predictions for points. Think Arkada/Galxe, but the first vertical is tokenized stocks (xStocks) and the entry is the Stocklana hackathon.

Status (16 Sep 2026): not deployed. No public URL, no players, no partner has signed anything, no badge has been minted, no billing. Never claim otherwise in any doc or copy.

Deadline (settled 16 Sep 2026, per the hackathon page): submissions close Fri 18 Sep 2026, 16:00 ET (20:00 UTC, 21:00 Irish), and judging runs to 2 Oct. There is no later date to plan for. README.md, docs/SUBMISSION.md and docs/HANDOFF.md all say this; keep them in step.

Long-term: multichain, multi-asset, multi-client, many partners. Hackathon: Solana only, xStocks only, web PWA only, partners seeded by hand. Build one of everything behind an interface; never build the second of anything.

Vocabulary. Play, Streak, Call, League and Mirror are internal code names only (founder decision, 15 Sep 2026, public names updated 16 Sep 2026). They stay in Prisma models, DB keys, playKey values, ledger refs, internal event names, /api/v1 paths and file and module names under src/lib. The UI and every piece of public copy use plain names instead. Dulo presents three games on one Season leaderboard (Predictions, Competition, Quests) plus one tool (Copy a portfolio):
- Play (code) -> a quest. The section and nav item are "Quests". "Plays live" -> "Quests live", "Play completed" -> "Quest complete", "complete a Play" -> "complete a quest". Two kinds: in-platform quests (completed with virtual cash and points) and on-chain quests (verified from the user's own wallet); partner quests (Kamino Collateral, Jupiter Recurring) show as "Coming soon". "Rewards" was the public noun until 16 Sep and is retired too; the positioning line's "get rewarded" stays.
- League (code) -> "Competition" in the nav, "Weekly competition (virtual cash)" as the page heading, and "the weekly competition" or "trading competition" in running copy, always with virtual cash. "Virtual" (or "paper") always sits next to it: it is not real money, not real trading and not swaps. "the League" -> "the competition", "League trades" -> "paper trades", League account -> competition account.
- Call (code) -> a prediction; the nav item is "Predictions". "Place a Call" -> "Make a prediction". Betting words are banned in the UI: stake -> "points in" or "put in points"; odds -> "current split" or "share of the pool"; payout -> "points back"; bet -> prediction. Never write "prediction market" in the UI.
- Mirror (code) -> "Copy a portfolio", a tool and not a game. "Mirror a wallet" -> "Copy a wallet's portfolio"; "Mirror match" -> "portfolio match". Its completion is the Portfolio Match quest.
- Score as a noun (code) -> points: "Season points" is the ranked number, "Points balance" the spendable one, "Starter points" the welcome grant. Campaign -> quests wherever it is user-facing.
- Keep in copy: Season / Season 0 / Stocks Season, Partners, Leaderboard, Badge, Points, and Streak as an ordinary English word.
- Quest titles: First Position, Diversified, Diamond Hands, Earnings Holder, Index Holder, Thousand Club and Sector Spread keep their names; Scout -> "First Paper Trades", Oracle -> "First Prediction", DCA Streak -> "Steady Buyer", Mirror -> "Portfolio Match", League Podium -> "Podium Finish". Added 16 Sep: Three Predictions, Paper Portfolio, Ten Paper Trades, Five-Stock Paper Portfolio, Three Game Days, Five Predictions. No other quest exists; docs/HANDOFF.md §3.1 is the catalogue.
- Nav order: Predictions · Competition · Quests · Copy a portfolio · Leaderboard. Mobile tabs: Predict · Compete · Quests · Board · Profile.
- Page routes carry the plain names: /predictions, /competition, /quests, /copy. The old paths (/plays, /rewards, /league, /paper-trading, /calls, /mirror) redirect permanently (ROUTE_RENAMES in next.config.ts). /api/v1 paths did not move.
- tests/plain-names.test.ts guards this: it fails on retired vocabulary in user-facing string files.
- Season: a scoped points period (Season 0 = Stocks Season on Solana).
- Partner / Campaign: a listed project and its set of Plays.
- Badge: soulbound Token-2022 achievement.

Points (founder decision, 16 Sep 2026; full table in docs/HANDOFF.md §3.8, contract in src/lib/games/ledger-policy.ts). Points only, no cash value. Points are an append-only PointsEvent ledger with @@unique(userId, seasonId, ref); every balance is derived, and no schema change or migration is needed for any of this. Every real user gets 1,000 starter points once per user per Season (source "starter", ref starter:<seasonId>); they can go into predictions but never score. Season points (leaderboard, rank, profile, /copy leaders, landing top 3) exclude starter and admin rows (NON_SCORING_SOURCES) and the points in open predictions, so Season points = quests + weekly competition finishes + settled prediction results. A weekly competition place pays only a real account with at least 3 trades that week (MIN_TRADES_FOR_WEEKLY_POINTS). Every user also has $10,000 of virtual cash per competition week, which is never mixed with points. House bots never get starter or quest points, never appear on the Season leaderboard (REAL_USER_WHERE) and cannot sign in (403). A quest never instructs anyone to buy a security: an on-chain quest describes the wallet state to reach, and its proof shows it was reached. Spot On, Top 10 Finish and Green Week quests are not built; never present them.

Positioning line: "The entertainment layer for xStocks. Compete, predict and get rewarded, for points." It is shipped in src/lib/config.ts as POSITIONING; quote it, never a variant.
Landing first screen (founder-approved 16 Sep 2026): the headline "The entertainment layer for xStocks." with the three verbs "Predict. Compete. Complete on-chain quests."; this week's live prediction cards as the hero visual; three game tiles (Predictions, Competition, On-chain quests), each with one live number and one button; the welcome offer line before sign-in (WELCOME_OFFER_LINE); Connect wallet first, Check a wallet second; the session chip and the compliance line. Predictions lead everywhere a game list appears.
Vision, three rungs, worded the same way in README.md and docs/SUBMISSION.md: today, the entertainment layer for xStocks; next, the entertainment layer for tokenized assets; then, any app or issuer runs competitions, predictions and rewards for its own holders on Dulo's API, and a player carries one score across them.
Business model, always written as a plan and never as revenue: players are free, and apps and issuers would sponsor competitions and pay per verified completion (partners would list on-chain quests and pay per verified completion). Nothing is billed today, there is no billing code and no project has paid.
Regulatory framing: points only, no cash value. Real-money Plays (on-chain quests) pay for holding, diversifying and buying steadily. Speculation lives in the virtual-cash competition and the points-only predictions. Say "onboarding, not churn".

Stack: Next.js 15 app router, TypeScript, Tailwind, shadcn/ui, Prisma + Postgres (Supabase), @solana/wallet-adapter (Phantom, Backpack, Solflare, MWA), Helius RPC, xStocks public API, Jupiter Price v3 + Swap v2, Pyth Hermes, Vercel Cron. No Anchor program needed.

Rules of the codebase:
- All chain reads go through lib/core ChainAdapter; all asset math through AssetSource; all prices through lib/price. No raw RPC in routes or components.
- Plays are JSON rules evaluated by lib/plays/engine.ts. Adding a Play is a DB row, not code.
- Points are an append-only PointsEvent ledger; balances are derived.
- All UI reads go through /api/v1 typed handlers; Next.js is the first client, not the only one.
- Asset IDs are CAIP-19 strings. Users own N wallets; nothing keys on a single pubkey.
- Every price shown carries source + age. The app must work with markets closed.
- Cut list is binding: no social feed, no comments, no native app, no real-money markets, no in-app swap execution, no referral, no on-chain points, no second chain, no partner self-serve dashboard, no email auth.

Deadline discipline: press Submit Project on Thu 17 Sep as a hedge (Save Draft is not a submission), then keep editing until the close at Fri 18 Sep 2026, 16:00 ET. Mirror ships as "view allocation + open Jupiter with a prefilled swap per leg" by decision (14 Sep): that is the product, not a fallback; in-app swap execution stays on the cut list.

Product name: Dulo (dulo.fun), after the House of Dulo, the founding Bulgar dynasty. Repo package name: dulo.
