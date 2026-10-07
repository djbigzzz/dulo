# Launch trailer (4:5, about 11 s)

Three live mobile shots of the production app (a prediction card with a tap on Yes, the weekly competition (virtual cash) board, the "Qualifies now" on-chain quests of a public holder), each under a caption band with the compliance line, then an end card. Output: `dulo-trailer-v4-4x5.mp4`, 1080x1350, 30 fps, H.264, silent.

## When to render

Footage shows the current week's questions and countdown, so render after the weekly rollover (the Friday tick at 21:10 UTC opens next week's predictions) and post before the next Friday lock. Before posting, `curl -s -o /dev/null -w '%{http_code}' https://projectdulo.com/start` must print 200, because the end card links there.

## Render

```bash
mkdir -p /tmp/trailer && cp docs/brand/trailer/* /tmp/trailer && cd /tmp/trailer
npm i playwright@1 && python3 -m venv v && ./v/bin/pip install imageio-ffmpeg
node capture.mjs        # live site, frame by frame under a paused clock; stops if there is no open prediction
node gfx.mjs            # caption bands and end card (START_URL=... to change the link)
./v/bin/python edit.py  # assembles dulo-trailer-v4-4x5.mp4
```

Playwright needs a Chromium (`PLAYWRIGHT_BROWSERS_PATH` or `npx playwright install chromium`).

## Copy rules this follows

Points only, no cash value; "virtual cash" beside the competition; no betting words in designed copy; the end-card offer quotes `WELCOME_OFFER_LINE` and the subline quotes the landing headline verbatim; COMPLIANCE_LINE on every frame. The public holder is framed only on its quest cards: no address, no amounts, no Proof sheet. Fonts: Geist and Instrument Serif (SIL Open Font License).
