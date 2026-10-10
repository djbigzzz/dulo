# Colosseum Crypto World's Fair: submission checklist and outlines

Deadline: Mon 12 Oct 2026, 11:59pm PT (Tue 13 Oct, 07:59 Irish). Register at https://colosseum.com/worldsfair with **Ireland** as the country. Rules: https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf. Only work done between 14 Sep and 12 Oct is judged; prior code is allowed if disclosed.

These are outlines and questions, not paste-ready answers: judges read the form as the founder's own words, so write each field yourself.

## Checklist

- [ ] Colosseum profile registered, country Ireland, project draft created (gives the project link for Earn)
- [ ] Hedge submission filed by Wed 7 Oct, edited until the close
- [ ] Presentation video, 2 to 3 minutes
- [ ] Product demo video, 3 minutes or less, recorded from production
- [ ] Logo, public GitHub link, live URL
- [ ] Go-to-market, demand validation and distribution answers
- [ ] Prior-work disclosure
- [ ] Superteam Ireland sidetrack on Earn (after the Colosseum entry exists): https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-ie-track
- [ ] Solami sidetrack on Earn, only if the webhook is deployed and demoed: https://superteam.fun/earn/listing/build-something-live-on-solana-data
- [ ] Player numbers read from `npm run -s stats` on the day

## Presentation video outline (2 to 3 minutes)

1. **Problem (20s).** 800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026). Buying once is easy; giving holders a reason to stay is not.
2. **Product (40s).** Three games on one Season leaderboard: predictions on Friday closes, a weekly competition with virtual cash, on-chain quests verified from the player's own wallet. Points only.
3. **Why Solana (20s).** Holdings are public state; Token-2022 ScaledUiAmount keeps balances split-correct; Jupiter prices the xStock mint 24/7, so it works with markets closed.
4. **Traction (20s).** Only real numbers from the stats script. If small, say so and say what you learned.
5. **Business, as a plan (20s).** Players free; issuers and apps would sponsor competitions and pay per verified completion. Nothing billed yet.
6. **Vision (20s).** The three rungs from README: xStocks today, tokenized assets next, then any app or issuer runs games for its holders on Dulo's API.

Expect the comparison question: how is this different from Crypto Fantasy League or Quantro (both rewarded in earlier Colosseum hackathons)? Live xStock prices 24/7, points only, quests that reward holding rather than trading volume, and distribution for issuers.

## Demo video shot list (3 minutes or less)

1. `/start` signed out, then Connect, sign one message, 1,000 starter points toast (30s)
2. Make a prediction; First Prediction (+50) completes in the same request; share to X (30s)
3. `/competition`: three paper trades with virtual cash, rank against labelled house bots (40s)
4. `/quests`: in-platform and on-chain quests; open a proof (30s)
5. `/check/<address>` with no sign-in (20s)
6. A transfer into your own linked wallet, then Refresh on `/quests` and the quest completes. Only if the Solami webhook is configured (it is not in production today) does it complete within seconds on its own (30s)

## Questions to answer in your own words

**Go-to-market and distribution**
- Who are the first 100 players, and exactly where do you reach them (which communities, which posts)?
- What did the first players do, and where did they drop off?
- Which issuer or app would pay first, and what would they pay for?

**Demand validation**
- How many real players by the deadline (from `npm run -s stats`)?
- Any written reply from an issuer, app or community lead? Quote it only with permission and call it a conversation, not a partnership.

**Prior-work disclosure**
- What existed before 14 Sep 2026, 6:00am PT (14:00 Irish)? Check your local history before the squashed first public commit (17 Sep).
- What was built in the window? Public history from 17 Sep onward: deployment (21 to 22 Sep), PreStocks as a second issuer and the corporate-actions quest (22 Sep), the Solami webhook (30 Sep), `/start` and the share flow (1 Oct), plus whatever follows.
- Dulo was also entered in Stocklana (Solana Foundation, closed 25 Sep). Say so.
