import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "https://dulo-iota.vercel.app";
const OUT = process.cwd() + "/shots";
const FPS = 30;
const VP = { width: 432, height: 936 };
const WIN = { x: 0, y: 0, width: 432, height: 412 };            // frames are 1296x1236 at DSF 3
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);         // sine in-out: peak speed 1.57x the mean (the cubic was 3x)
const seg = (t, t0, t1, a, z) => (t <= t0 ? a : t >= t1 ? z : a + (z - a) * ease((t - t0) / (t1 - t0)));
// Headless Chromium drops backdrop-blur, so make the app chrome opaque (fixes the bleed-through).
const CHROME = "header.sticky{background:#0a0908!important;backdrop-filter:none!important}nav.fixed.bottom-0{background:#0a0908!important;backdrop-filter:none!important}::-webkit-scrollbar{display:none}";

async function open(path, ready) {
  const ctx = await b.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: "America/New_York", locale: "en-US" });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  for (let i = 0; i < 20; i++) { await p.clock.runFor(100); await sleep(100); }
  for (let i = 0; ready && i < 60; i++) { if (await p.evaluate(ready)) break; await p.clock.runFor(250); await sleep(250); }
  await p.addStyleTag({ content: CHROME });
  const now = await p.evaluate(() => Date.now());
  await p.clock.pauseAt(now + 1000);
  return { ctx, p };
}
async function film(p, name, seconds, frame) {
  const dir = `${OUT}/${name}`;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    await frame(i / FPS);
    await p.clock.runFor(1000 / FPS);                                    // countdowns tick at video speed
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92, clip: WIN, animations: "disabled" });
  }
}

// Record in edit order so on-screen clocks only count down.
// 1. Predict: first open card, touch dot and tap on its Yes button.
{ const { ctx, p } = await open("/predictions", () => !!document.querySelector('[data-market-id][data-status="open"] button'));
  const m = await p.evaluate(() => {
    const card = document.querySelector('[data-market-id][data-status="open"]');
    if (!card) return null;
    const yes = [...card.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Yes"));
    const word = [...yes.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === "Yes") ?? yes;
    const c = card.getBoundingClientRect(), w = word.getBoundingClientRect();
    return { top: c.top + scrollY, x: w.left + w.width / 2, y: w.top + scrollY + w.height / 2 };
  });
  if (!m) throw new Error("No open prediction. Capture after the Friday tick opens next week's questions.");
  const sy = Math.round(m.top + 10);                        // today 736
  const dx = m.x, dy = m.y - sy;                             // the ring centres on the word "Yes", today about (63, 349)
  await p.evaluate(([sy, dx, dy]) => {
    scrollTo(0, sy);
    for (const id of ["dot", "rip"]) { const d = document.createElement("div"); d.id = id;
      Object.assign(d.style, { position: "fixed", left: dx - 22 + "px", top: dy - 22 + "px", width: "44px", height: "44px", borderRadius: "50%", pointerEvents: "none", zIndex: 99999, opacity: 0 });
      document.body.appendChild(d); }
    Object.assign(document.getElementById("dot").style, { background: "rgba(244,241,234,.14)", border: "2px solid rgba(244,241,234,.9)" });
    document.getElementById("rip").style.border = "3px solid #ff6a2a";
  }, [sy, dx, dy]);
  await film(p, "predict", 2.2, (t) => p.evaluate((t) => {        // the push in edit.py moves every frame; the tap lands at 0.7 s
    const card = document.querySelector('[data-market-id][data-status="open"]');
    const yes = [...card.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Yes"));
    const dot = document.getElementById("dot"), rip = document.getElementById("rip");
    dot.style.opacity = t < 0.45 ? 0 : t < 0.6 ? (t - 0.45) / 0.15 : t < 1.2 ? 1 : t < 1.4 ? (1.4 - t) / 0.2 : 0;
    const s = t < 0.7 ? 1 : t < 0.82 ? 1 - 0.04 * (t - 0.7) / 0.12 : t < 1.0 ? 0.96 + 0.04 * (t - 0.82) / 0.18 : 1;
    yes.style.transform = `scale(${s})`;                      // press feedback only; never fake a placed prediction
    const k = (t - 0.75) / 0.6;
    rip.style.opacity = k < 0 || k > 1 ? 0 : 0.9 * (1 - k);
    rip.style.transform = `scale(${1 + 2.2 * Math.max(0, k)})`;
  }, t));
  await ctx.close(); }

// 2. Compete: stats grid with the live countdown, then the board.
{ const { ctx, p } = await open("/competition", () => [...document.querySelectorAll("dt")].some((e) => /closes in/i.test(e.textContent)) && [...document.querySelectorAll("h2")].some((e) => e.textContent.trim() === "Leaderboard"));
  const m = await p.evaluate(() => {
    const dt = [...document.querySelectorAll("dt")].find((e) => /closes in/i.test(e.textContent));
    const lb = [...document.querySelectorAll("h2")].find((e) => e.textContent.trim() === "Leaderboard");
    const bots = [...dt.closest("dl").querySelectorAll("*")].map((e) => e.textContent.trim().match(/^(\d+) of them house bots$/)).find(Boolean);
    return { grid: dt.closest("dl").getBoundingClientRect().top + scrollY, lb: lb.getBoundingClientRect().top + scrollY, bots: bots ? Number(bots[1]) : null };
  });
  if (m.bots !== 15) throw new Error(`Band 2 says "Beat 15 house bots" but the page shows ${m.bots}. Update bands.compete in gfx.mjs.`);
  const a = m.grid - 66, z = m.lb - 73;                      // today 218 and 719
  await film(p, "compete", 2.8, (t) => p.evaluate((y) => scrollTo(0, y), seg(t, 0.4, 1.9, a, z)));
  await ctx.close(); }

// 3. Check: on-chain quests this public wallet already meets. No address, no amounts, no Proof sheet.
{ const { ctx, p } = await open("/check/ARdaJWDopB4J8ukZe7q3s6yZmJjoTF3PhoeeYYVQ9sWh", () => document.querySelectorAll('section[data-preview-group="check-qualifies"] article').length >= 3);
  const m = await p.evaluate(() => ({
    head: document.getElementById("check-qualifies").getBoundingClientRect().top + scrollY,
    cards: [...document.querySelectorAll('section[data-preview-group="check-qualifies"] article')].map((e) => {
      const r = e.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height, title: e.querySelector("h3")?.textContent.trim() };
    }),
  }));
  if (m.cards[0]?.title !== "First Position" || m.cards[1]?.title !== "Diversified") throw new Error(`Qualifying cards are ${m.cards.map((c) => c.title)}; the shot must rest on Diversified`);
  // End with Diversified whole and the next card (Thousand Club today) just below the window, so the $1,000 threshold is never the rest frame.
  const next = m.cards[2] ? m.cards[2].top : m.cards[1].top + m.cards[1].h + 16;
  const y0 = m.head - 68, y1 = Math.round(next - WIN.height - 2);          // today 1766 and 1965
  await film(p, "check", 2.6, (t) => p.evaluate((y) => scrollTo(0, y), seg(t, 0.5, 1.5, y0, y1)));
  await ctx.close(); }
await b.close();
