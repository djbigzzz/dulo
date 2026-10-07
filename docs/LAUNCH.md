# Launch kit (Colosseum Crypto World's Fair, 1 to 12 Oct 2026)

Everything here is written to the CLAUDE.md copy rules: points only, no cash value; "virtual cash" beside every mention of the competition; no betting words; never "prediction market"; xStocks are tokenized stocks, never "real stocks"; pre-IPO tokens are never shares or stock; nothing claims players, partners or revenue Dulo does not have. Replace `<LINK>` with the public origin (`https://projectdulo.com` since 7 Oct 2026) and `<X>` with the project's X handle.

The share link for every post is `<LINK>/start`: one screen, one prediction, sign in on the button, then a prefilled "Post your pick on X".

## 1. Accounts (founder, about 1 hour)

1. **Email.** A new free mailbox for the project (Gmail or Proton). Use it for X, the domain registrar, Colosseum, Superteam Earn and Solami. Never put it in a tracked file (`tests/anonymity.test.ts` scans them).
2. **X account.** Handle ideas: `@dulofun`, `@playdulo`, `@dulo_xyz`. Use the bio and pinned post below.
3. **Domain.** Optional. Ideas: `dulo.fun` (not registered on 1 Oct), `dulo.gg`, `playdulo.com`. Buy it, then follow section 5.

## 2. X profile

**Name:** Dulo

**Bio (160 max):**
> The entertainment layer for xStocks. Predict Friday closes, compete with virtual cash, complete on-chain quests. Points only, no cash value. Built on Solana.

**Link:** `<LINK>/start`

**Pinned post:**
> Dulo is live on Solana mainnet.
>
> Every week: will NVDA, TSLA and SPY close above the line on Friday? Pick Yes or No for points. Free, 1,000 starter points on sign-in, no transaction.
>
> Plus a weekly trading competition with $10,000 of virtual cash and on-chain quests verified from your own wallet.
>
> Make your first pick: `<LINK>/start`

## 3. Posting calendar (10 days)

Post from `<X>`; reply from the founder's own account. Each Friday post goes up before the 20:00 UTC lock.

| Day | Post |
|---|---|
| Thu 1 Oct | Pinned post (above). |
| Fri 2 Oct | "This week's three: NVDA above $X? TSLA above $Y? SPY above $Z? Locks at Friday's close. Pick in 30 seconds, points only: `<LINK>/start`" (fill strikes from the live cards). |
| Sat 3 Oct | Results thread: which way each one settled, the Friday close and its source, and that next week's questions are open. |
| Sun 4 Oct | "Wall Street is closed. Solana isn't. Dulo's weekly competition runs 24/7 on live xStock prices with $10,000 of virtual cash. No real money, no swaps. `<LINK>/competition`" |
| Mon 5 Oct | Build in public: one screenshot of a quest proof ("Diversified: 3 xStocks across 2 sectors, checked from Token-2022 balances, proof attached"). Never tell anyone to buy. |
| Tue 6 Oct | Builder angle for hackathon peers: "Builders vs bots: can you beat 15 labelled house bots in this week's virtual-cash competition? `<LINK>/competition`" |
| Wed 7 Oct | How it works thread (5 posts): predictions, competition, quests, points only, why Solana (holdings are public state; ScaledUiAmount handles splits). |
| Thu 8 Oct | "Pre-IPO tokens are in the weekly competition too, with the same virtual cash, 24/7. Paper trades only." Include the pre-IPO compliance line in the image or a reply. |
| Fri 9 Oct | This week's three questions (as Fri 2 Oct). |
| Sat 10 Oct | Results thread plus the competition's top 3 (handles only if those players agreed). |
| Sun 11 Oct | "We're submitting Dulo to Colosseum's Crypto World's Fair. Here's what we built in four weeks." Link the repo and the demo video. |

Every post that names xStocks carries, in the post or a reply: "Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions."

## 4. Outreach messages (founder sends)

**Superteam Ireland** (POC on Earn: t.me/diarmuid_ie)
> Hi, I'm building Dulo for Crypto World's Fair from Ireland: free weekly predictions on xStock closes plus a virtual-cash trading competition, points only, live on Solana mainnet. Would you be up for sharing it with the Irish community, or letting me run a short "Irish builders" week on it? Link: `<LINK>/start`

**xStocks / Backed, PreStocks** (via their X or Telegram)
> Hi, I built Dulo, a points-only games layer for tokenized stocks on Solana. On-chain quests reward your holders for holding and diversifying, verified from their own Token-2022 balances, never for trading volume. Would you be open to a 15-minute call about featuring your assets, or listing a quest? Live: `<LINK>`

**Community admins** (xStocks, Solana, Irish crypto Telegram and Discord groups; ask before posting)
> Hi, mind if I share a free game for this group? Weekly Yes/No predictions on xStock closes, points only, no money involved, sign in with a wallet message. Happy to skip it if it's off-topic.

**Hackathon peers** (Colosseum Discord, Superteam chats)
> Shipping for World's Fair too? Take a break and try to beat the house bots in Dulo's weekly virtual-cash competition. Feedback welcome, especially on the first 30 seconds: `<LINK>/start`

## 5. Domain setup (after you buy one)

1. Vercel, project `dulo` (team mystartup-team) > Settings > Domains > Add `<domain>` and `www.<domain>`.
2. At the registrar, add the DNS records Vercel shows (usually an `A` record to `76.76.21.21` for the apex and a `CNAME` for `www` to `cname.vercel-dns.com`). Wait until Vercel marks both valid.
3. Vercel > Settings > Environment Variables: set `NEXT_PUBLIC_APP_URL=https://<domain>` for Production, then redeploy. This also moves the SIWS domain, badge metadata URIs and the Solami webhook URL.
4. If the Solami webhook exists, run `npm run solami:webhook` once more so it points at the new URL.
5. Done 7 Oct 2026 for projectdulo.com: CLAUDE.md, README.md, docs/SUBMISSION.md and docs/HANDOFF.md name it as the public origin, with the tests that pin that wording.

## 6. What counts as traction

Read numbers only from `npm run -s stats` on the day (it excludes bots and `FOUNDER_WALLETS`). Report players as players, testers as testers, and a partner reply as a conversation, never as a partnership.
