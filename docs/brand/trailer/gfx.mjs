import { chromium } from "playwright";
import fs from "node:fs";
const DIR = process.cwd();
const FPS = 30;
const END = 3.6;                                                    // end card seconds; edit.py reads the same value
const URL_TEXT = process.env.START_URL || "projectdulo.com/start";
// WELCOME_OFFER_LINE, src/lib/games/ledger-policy.ts, quoted verbatim.
const OFFER = "Sign in free: 1,000 starter points and $10,000 of virtual cash to play. Points only, no cash value.";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
await p.goto(`file://${DIR}/gfx.html`);
await p.evaluate(async () => { for (const f of ['76px "Instrument Serif"', '600 40px Archivo', '700 54px Archivo', '26px "IBM Plex Mono"']) await document.fonts.load(f); await document.fonts.ready; });
await p.evaluate(([u, o]) => { document.getElementById("url").textContent = u; document.getElementById("offer").textContent = o; track(document.getElementById("trk-end"), 3, 888); }, [URL_TEXT, OFFER]);
const show = (id) => p.evaluate((id) => { document.querySelectorAll(".s").forEach((s) => s.classList.remove("on")); document.getElementById(id).classList.add("on"); }, id);
fs.rmSync(`${DIR}/gfx/end`, { recursive: true, force: true });
fs.mkdirSync(`${DIR}/gfx/end`, { recursive: true });
// End card: lockup complete at frame 0; the line, the action and the offer rise in; a slow scale.
await show("end");
await p.evaluate((END) => {
  const o = { fill: "both", easing: "cubic-bezier(.2,.8,.2,1)" };
  [[".tag", 0], [".verbs", 120], ["#url", 260], ["#offer", 400]].forEach(([sel, d]) =>
    document.querySelector(sel).animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { ...o, duration: 380, delay: d }));
  document.querySelector(".wrap").animate([{ transform: "scale(1)" }, { transform: "scale(1.015)" }], { duration: END * 1000, fill: "both" });
}, END);
for (let i = 0; i < END * FPS; i++) {
  await p.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), (i / FPS) * 1000);
  await p.screenshot({ path: `${DIR}/gfx/end/${String(i).padStart(4, "0")}.jpg`, type: "jpeg", quality: 95 });
}
// Caption bands (transparent below the band).
await p.evaluate(() => { document.body.className = "clear"; });
const bands = {
  predict: [0, "Yes or No on Friday’s close, for points."],
  compete: [1, "$10,000 of virtual cash, every week."],
  check: [2, "Quests verified from your own wallet."],
};
for (const [id, [i, t]] of Object.entries(bands)) {
  await show("frame");
  await p.evaluate(([i, t]) => { track(document.getElementById("trk"), i, 952); document.getElementById("ft").textContent = t; }, [i, t]);
  await p.screenshot({ path: `${DIR}/gfx/frame-${id}.png`, omitBackground: true });
}
await b.close();
