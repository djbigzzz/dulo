# Launch video (4:5, about 11 s)

Three live mobile shots of the app in the Live Broadcast design, then an end card:

1. **Predictions:** this week's NVDA question with its current split, and a tap on Yes (press feedback only; nothing is placed).
2. **Weekly competition (virtual cash):** the paper-trade ticket, from the twelve xStocks down to a live price with its source and age. No player names are on screen.
3. **On-chain quests:** a public holder's "Qualifies now" quest cards. No address, no amounts, no Proof sheet.
4. **End card:** the tamga and wordmark, "The entertainment layer for xStocks.", the three verbs, the `/start` link and the welcome offer.

Each shot sits under a caption band with the run-of-show track (01 Predict, 02 Compete, 03 Quests, the gold marker on the current game) and the compliance line. Output: `dulo-launch-v5-4x5.mp4`, 1080x1350, 30 fps, H.264, silent.

## When to render

The footage shows the current week's questions, so render after the weekly rollover (Friday's settlement opens next week's predictions) and post before the next Thursday 20:00 UTC lock. Before posting, `https://projectdulo.com/start` must load, because the end card links there.

## Render

`capture.mjs` films a local production build of `main` and reads every `/api/v1` GET from production (read-only: any other method is refused), so the footage is live data. Set `BASE` to film another origin directly.

```bash
npm run build && npx next start -p 3201 &          # from the repo root
mkdir -p /tmp/trailer && cp docs/brand/trailer/* /tmp/trailer && cd /tmp/trailer
npm i playwright@1 && python3 -m venv v && ./v/bin/pip install imageio-ffmpeg
node capture.mjs        # frame by frame under a paused clock; stops if there is no open prediction
node gfx.mjs            # caption bands and end card (START_URL=... to change the link)
./v/bin/python edit.py  # assembles dulo-launch-v5-4x5.mp4
```

Playwright needs a Chromium (`PLAYWRIGHT_BROWSERS_PATH` or `npx playwright install chromium`).

## Copy rules this follows

Points only, no cash value; "virtual cash" beside the competition; no betting words in designed copy; the end-card offer quotes `WELCOME_OFFER_LINE` and the tagline quotes the landing headline; COMPLIANCE_LINE on every frame; gold only for the "now" marker, the tap and the one call to action. Fonts: Instrument Serif, Archivo and IBM Plex Mono (SIL Open Font License).
