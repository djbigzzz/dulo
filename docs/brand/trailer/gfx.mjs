import { chromium } from "playwright";
import fs from "node:fs";
const DIR = process.cwd();
const FPS = 30;
const END = 3.5;                                                    // end card seconds; edit.py reads the same value
const URL_TEXT = process.env.START_URL || "projectdulo.com/start";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
await p.goto(`file://${DIR}/gfx.html`);
await p.evaluate(async () => { await document.fonts.load('112px "Instrument Serif"'); await document.fonts.load("600 50px Geist"); await document.fonts.load("38px Geist"); await document.fonts.ready; });
await p.evaluate((u) => { document.getElementById("url").textContent = u; }, URL_TEXT);
const show = (id) => p.evaluate((id) => { document.querySelectorAll(".s").forEach((s) => s.classList.remove("on")); document.getElementById(id).classList.add("on"); }, id);
fs.rmSync(`${DIR}/gfx/end`, { recursive: true, force: true });           // a shorter end card must not keep old frames
fs.mkdirSync(`${DIR}/gfx/end`, { recursive: true });
// End card: lockup and headline complete at frame 0; URL and offer rise in; slow scale; one glow pulse.
await show("end");
await p.evaluate((END) => {
  const o = { fill: "both", easing: "cubic-bezier(.2,.8,.2,1)" };
  [["url", 0], ["sub", 120], ["sub2", 240]].forEach(([c, d]) => {
    const el = c === "url" ? document.getElementById("url") : document.querySelector("." + c);
    el.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { ...o, duration: 350, delay: d });
  });
  document.querySelector(".wrap").animate([{ transform: "scale(1)" }, { transform: "scale(1.02)" }], { duration: END * 1000, fill: "both" });
  document.getElementById("url").animate([{ boxShadow: "0 0 0 rgba(255,106,42,0)" }, { boxShadow: "0 0 48px rgba(255,106,42,.45)" }, { boxShadow: "0 0 0 rgba(255,106,42,0)" }], { duration: 800, delay: 1400, fill: "both" });
}, END);
for (let i = 0; i < END * FPS; i++) {
  await p.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), (i / FPS) * 1000);
  await p.screenshot({ path: `${DIR}/gfx/end/${String(i).padStart(4, "0")}.jpg`, type: "jpeg", quality: 95 });
}
// Caption bands (transparent below the band).
await p.evaluate(() => { document.body.className = "clear"; });
const bands = {
  predict: ["Game 1 of 3 · Predictions", "Yes or No on Friday’s close, for points."],
  compete: ["Game 2 of 3 · Weekly competition", "Beat 15 house bots with $10,000 of virtual cash."],   // D6; capture.mjs asserts the 15
  check: ["Game 3 of 3 · On-chain quests", "Points for holding, verified from your wallet."],
};
for (const [id, [k, t]] of Object.entries(bands)) {
  await show("frame");
  await p.evaluate(([k, t]) => { document.getElementById("fk").textContent = k; document.getElementById("ft").textContent = t; }, [k, t]);
  await p.screenshot({ path: `${DIR}/gfx/frame-${id}.png`, omitBackground: true });
}
await b.close();
