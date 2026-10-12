import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3201";   // a local build of main; its /api/v1 GETs are read from production
const PROD = "https://projectdulo.com";
const OUT = process.cwd() + "/shots";
const FPS = 30;
const VP = { width: 432, height: 936 };
const WIN = { x: 0, y: 0, width: 432, height: 412 };            // frames are 1296x1236 at DSF 3
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const cache = new Map();
async function prod(pq) {                                     // read-only: GETs only, cached, 3 tries
  if (cache.has(pq)) return cache.get(pq);
  let last = { status: 502, body: "{}", type: "application/json" };
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(PROD + pq, { headers: { accept: "application/json" } }); last = { status: r.status, body: await r.text(), type: r.headers.get("content-type") || "application/json" }; if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (last.status === 200) cache.set(pq, last);
  return last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);         // sine in-out: peak speed 1.57x the mean (the cubic was 3x)
const seg = (t, t0, t1, a, z) => (t <= t0 ? a : t >= t1 ? z : a + (z - a) * ease((t - t0) / (t1 - t0)));
// Headless Chromium drops backdrop-blur, so make the app chrome opaque (fixes the bleed-through).
const CHROME = "::-webkit-scrollbar{display:none}";

async function open(path, ready) {
  const ctx = await b.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: "America/New_York", locale: "en-US" });
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname !== "localhost") return route.continue();
    if (u.pathname.startsWith("/api/")) {
      if (req.method() !== "GET") return route.fulfill({ status: 403, body: "{}" });     // nothing is ever written
      const r = await prod(u.pathname + u.search);
      return route.fulfill({ status: r.status, headers: { "content-type": r.type }, body: r.body });
    }
    return route.continue();
  });
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
  const sy = Math.round(m.top + 40 - 57);                  // the NVDAx label row sits wholly under the header; the question starts the window
  const dx = m.x, dy = m.y - sy;                             // the ring centres on the word "Yes"
  if (dy > WIN.height - 24) throw new Error(`Yes sits at ${dy}px, below the ${WIN.height}px window`);
  await p.evaluate(([sy, dx, dy]) => {
    scrollTo(0, sy);
    for (const id of ["dot", "rip"]) { const d = document.createElement("div"); d.id = id;
      Object.assign(d.style, { position: "fixed", left: dx - 22 + "px", top: dy - 22 + "px", width: "44px", height: "44px", borderRadius: "50%", pointerEvents: "none", zIndex: 99999, opacity: 0 });
      document.body.appendChild(d); }
    Object.assign(document.getElementById("dot").style, { background: "rgba(244,241,234,.14)", border: "2px solid rgba(244,241,234,.9)" });
    document.getElementById("rip").style.border = "3px solid #ffd23c";
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

// 2. Compete: the paper-trade ticket (no player names on screen): the twelve xStocks, then a live price with its source and age.
{ const { ctx, p } = await open("/competition", () => [...document.querySelectorAll("h2")].some((e) => e.textContent.trim() === "Paper trade"));
  const m = await p.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.trim() === "Paper trade");
    const box = h.closest("section, aside, div");
    const price = [...document.querySelectorAll("p, span, div")].filter((e) => e.children.length === 0 && /^\$[\d,]+\.\d\d$/.test(e.textContent.trim()))
      .map((e) => e.getBoundingClientRect()).filter((r) => r.top > h.getBoundingClientRect().top)[0];
    return { head: h.getBoundingClientRect().top + scrollY, priceBottom: price ? price.bottom + scrollY : null };
  });
  if (!m.priceBottom) throw new Error("No live price under the Paper trade heading");
  const a = Math.round(m.head - 57 - 18), z = Math.round(Math.max(a, m.priceBottom + 16 - WIN.height));   // heading first, then down to the price row
  await film(p, "compete", 2.8, (t) => p.evaluate((y) => scrollTo(0, y), seg(t, 0.6, 1.9, a, z)));
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
