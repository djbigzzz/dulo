import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AppShell renders client components; only its pure footer helper is under test.
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));
vi.mock("@/components/layout/NavLinks", () => ({ NavLinks: () => null }));
vi.mock("@/components/layout/MobileTabBar", () => ({ MobileTabBar: () => null }));

import { footerLinks } from "@/components/layout/AppShell";
import { CHECK_INVALID_MESSAGE, SAMPLE_WALLETS, checkHref } from "@/components/landing/check-wallet";
import { PRACTICE_LEAGUE_TITLE, SEASON_TOP_MIN_ROWS, seasonTopRows } from "@/components/landing/scoreboard-mode";
import { PUBLIC_WALLETS } from "@/lib/mirror/public-wallets";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { NEXT_WEEK_MARKETS_COPY } from "@/components/calls/calls-format";
import {
  CONNECT_CTA_TITLE,
  PREVIEW_STATUS_LABEL,
  checkErrorCopy,
  decidablePlays,
  formatMultiplier,
  formatQty,
} from "@/app/check/_components/check-format";
import { previewApi, type LeaderboardResponse, type PreviewPlayStatus, type PreviewPlayView } from "@/lib/api-client";

function repoFile(rel: string): string {
  return readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("landing — check any wallet (M-C) and the three-games hero (C9)", () => {
  it("offers the first three curated public wallets with their neutral labels", () => {
    expect(SAMPLE_WALLETS).toHaveLength(3);
    expect(SAMPLE_WALLETS).toEqual(PUBLIC_WALLETS.slice(0, 3));
    for (const w of SAMPLE_WALLETS) expect(w.label).toMatch(/^Public holder [A-Z]$/);
    expect(checkHref(SAMPLE_WALLETS[0].address)).toBe(`/check/${SAMPLE_WALLETS[0].address}`);
    expect(checkHref("a/b")).toBe("/check/a%2Fb");
    expect(CHECK_INVALID_MESSAGE).toMatch(/Solana wallet address/);
  });

  it("leads the hero with the three games, keeps Connect primary and makes the secondary CTA 'Check a wallet'", () => {
    const landing = repoFile("src/app/page.tsx");
    const flat = landing.replace(/\s+/g, " ");
    expect(flat).toContain("The entertainment layer for");
    expect(landing).toContain("Predict. Compete. Complete on-chain quests.");
    expect(flat).toContain(
      "800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026). Dulo gives them three games on one Season leaderboard: Yes or No on Friday&apos;s close, a weekly competition with virtual cash at real xStock prices, and quests you complete in Dulo or on-chain.",
    );
    expect(landing).not.toContain("Try the League");
    expect(landing).not.toContain("activity is");
    const connect = landing.indexOf("<ConnectButton");
    const check = landing.indexOf("Check a wallet");
    expect(connect).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(connect);
    expect(landing).toContain('href="#check"');
    expect(landing).toContain('id="check"');
    expect(landing).toContain("<CheckWalletBox");
    // Pinned by tests/copy.test.ts: the Predictions tile still says where settlement comes from.
    expect(landing).toContain("settled from the Friday close, source shown on the card");
  });

  it("states the welcome offer before sign-in, directly above the buttons, from the points policy", () => {
    const landing = repoFile("src/app/page.tsx");
    expect(landing).toMatch(/import \{[^}]*\bWELCOME_OFFER_LINE\b[^}]*\} from "@\/lib\/games\/ledger-policy"/);
    const offer = landing.indexOf("{WELCOME_OFFER_LINE}");
    expect(offer).toBeGreaterThan(landing.indexOf("Predict. Compete. Complete on-chain quests."));
    expect(offer).toBeLessThan(landing.indexOf("<ConnectButton"));
    expect(WELCOME_OFFER_LINE).toBe("Sign in free: 1,000 starter points and $10,000 of virtual cash to play. Points only, no cash value.");
  });

  it("keeps the market session chip, the trust row and the compliance line in the hero", () => {
    const landing = repoFile("src/app/page.tsx");
    const hero = landing.slice(landing.indexOf('aria-labelledby="hero-title"'), landing.indexOf("<GameTiles"));
    expect(hero).toContain("<MarketSessionChip />");
    expect(hero).toContain("TRUST.map(");
    expect(hero).toContain("{COMPLIANCE_LINE}");
    expect(landing).toMatch(/import \{[^}]*\bCOMPLIANCE_LINE\b[^}]*\} from "@\/components\/common\/compliance"/);
    // Phones read the pitch, then session and trust, then the live cards.
    expect(hero.indexOf("<MarketSessionChip")).toBeGreaterThan(hero.indexOf("Check a wallet"));
    expect(hero.indexOf("<MarketSessionChip")).toBeLessThan(hero.indexOf("<LivePredictions"));
    // The H1 steps down below sm so Connect sits on the first 375 px screen; the sourced stat is never hidden.
    expect(landing).toMatch(/id="hero-title"\s+className="font-display text-4xl /);
    expect(hero).not.toMatch(/hidden[^"]*">\s*800,000\+/);
  });

  it("puts the live prediction cards first in the hero, then the ranking, and the game tiles right under it", () => {
    const landing = repoFile("src/app/page.tsx");
    const predictions = landing.indexOf("<LivePredictions");
    const rank = landing.indexOf("<RankCard");
    const tiles = landing.indexOf("<GameTiles");
    expect(predictions).toBeGreaterThan(-1);
    expect(rank).toBeGreaterThan(predictions);
    // The tiles follow the hero section and come before the Check section.
    expect(tiles).toBeGreaterThan(landing.indexOf("</section>"));
    expect(tiles).toBeLessThan(landing.indexOf('id="check"'));
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).not.toContain("PlayTeaser");
    expect(src).toContain("export function LivePredictions");
    expect(src).toContain("export function RankCard");
    expect(src).toContain("export function GameTiles");
    expect(src).toContain("Live right now");
    // Predictions show at every width: no viewport-height gate on them any more.
    expect(src).not.toContain("min-height:740px");
    const cards = src.slice(src.indexOf("export function LivePredictions"), src.indexOf("export function RankCard"));
    expect(cards).not.toMatch(/min-height/);
    expect(cards).toContain("See all {count} predictions");
    expect(cards).toContain("NEXT_WEEK_MARKETS_COPY");
    expect(NEXT_WEEK_MARKETS_COPY).toBe("Next week's predictions open right after Friday's settle.");
  });

  it("reframes the lower sections as three games on one Season leaderboard, with nothing that pays for holding", () => {
    const landing = repoFile("src/app/page.tsx");
    expect(landing).toMatch(/Three games, <span className="italic">one Season leaderboard<\/span>/);
    expect(landing).not.toContain("PLAY_KINDS");
    for (const chip of ['"Hold"', '"Diversify"', '"DCA"', '"Earnings"']) expect(landing).not.toContain(chip);
    expect(landing).not.toMatch(/\b(paid|pays?|earn\w*) (points )?(for|by) (holding|buying)/i);
    expect(landing).toContain("A fresh week every Monday with virtual cash at real xStock prices. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points.");
    expect(landing).toContain("In-platform quests with points and virtual cash, and on-chain quests verified from your wallet.");
    expect(landing).toContain("See a leader's allocation and open the same legs in Jupiter from your own wallet.");
    // Closing CTA: Connect plus "Make a prediction".
    const cta = landing.slice(landing.indexOf('aria-labelledby="cta"'));
    expect(cta).toContain("<ConnectButton");
    expect(cta).toMatch(/href="\/predictions"[^>]*>\s*Make a prediction/);
    // No betting words or internal odds on the landing.
    expect(landing).not.toMatch(/probability|odds today|~0%/i);
    expect(landing).not.toMatch(/prediction market|\bstake|\bodds\b|\bpayout|\bbets?\b/i);
  });
});

describe("ScoreboardPreview — Season top 3 once three real players exist", () => {
  const board = (n: number): LeaderboardResponse => ({
    season: null,
    limit: 3,
    rows: Array.from({ length: n }, (_, i) => ({ rank: i + 1, userId: `u${i}`, handle: null, address: null, points: 300 - i * 50 })),
  });

  it("shows the virtual competition until the board has three rows", () => {
    expect(SEASON_TOP_MIN_ROWS).toBe(3);
    expect(seasonTopRows(null)).toBeNull();
    expect(seasonTopRows(undefined)).toBeNull();
    expect(seasonTopRows(board(0))).toBeNull();
    expect(seasonTopRows(board(2))).toBeNull();
    expect(seasonTopRows(board(3))?.map((r) => r.userId)).toEqual(["u0", "u1", "u2"]);
    expect(seasonTopRows(board(5))).toHaveLength(3);
    expect(PRACTICE_LEAGUE_TITLE).toBe("Virtual competition: house bots until players join");
  });
});

describe("mobile layout at 375 px — landing competition preview and the /competition Trade button", () => {
  it("shortens the virtual competition title on phones and moves the rest to a muted sub-line", () => {
    const [short, rest] = PRACTICE_LEAGUE_TITLE.split(": ");
    expect(short).toBe("Virtual competition");
    expect(rest).toBe("house bots until players join");
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).toContain('PRACTICE_LEAGUE_TITLE.split(": ")');
    expect(src).toContain("shortLabel={PRACTICE_SHORT}");
    expect(src).toContain("subLabel={PRACTICE_SUB}");
    // Full title from sm up, short title and sub-line below sm.
    expect(src).toContain('<span className="sm:hidden">{shortLabel}</span>');
    expect(src).toContain('<span className="hidden sm:inline">{label}</span>');
    expect(src).toMatch(/text-muted-foreground sm:hidden">\{subLabel\}/);
  });

  it("drops the bot pill text on phones but keeps a labelled icon", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).toContain('const BOT_LABEL = "House bot, never earns points"');
    expect(src).toContain("aria-label={BOT_LABEL}");
    expect(src).toContain("title={BOT_LABEL}");
    expect(src).toContain('<span className="hidden sm:inline">house bot</span>');
    // The competition page's BotMarker uses the same words.
    expect(repoFile("src/components/league/LeagueLeaderboard.tsx")).toContain('aria-label="House bot, never earns points"');
  });

  it("makes the competition Trade button sticky above the tab bar so it rests clear of the last row and the footer", () => {
    const page = repoFile("src/app/competition/page.tsx");
    const fab = page.match(/<div data-slot="league-trade-fab" className="([^"]+)"/);
    expect(fab).not.toBeNull();
    const cls = fab![1].split(" ");
    expect(cls).toEqual(expect.arrayContaining(["sticky", "bottom-[calc(5rem+env(safe-area-inset-bottom,0px))]", "self-end", "lg:hidden"]));
    // The tab bar shows up to lg now, so the button keeps clearing it at md too.
    expect(cls).not.toContain("md:bottom-6");
    expect(cls).not.toContain("fixed");
    // In flow after the grid (so its resting slot is under the last section), before the sheet.
    expect(page.indexOf('data-slot="league-trade-fab"')).toBeGreaterThan(page.indexOf("</aside>"));
    expect(page.indexOf('data-slot="league-trade-fab"')).toBeLessThan(page.indexOf("<Sheet open="));
    // The old fixed-button clearance padding is gone.
    expect(page).not.toContain("pb-24");
  });
});

describe("AppShell footer links", () => {
  it("renders GitHub, X and the demo video only when their https URL is set", () => {
    expect(footerLinks({})).toEqual([]);
    expect(footerLinks({ github: "", x: undefined, video: null })).toEqual([]);
    expect(
      footerLinks({ github: "https://github.com/dulofun/dulo", x: " https://x.com/dulofun ", video: "https://youtu.be/abc" }),
    ).toEqual([
      { href: "https://github.com/dulofun/dulo", label: "GitHub" },
      { href: "https://x.com/dulofun", label: "X" },
      { href: "https://youtu.be/abc", label: "Watch the demo" },
    ]);
    expect(footerLinks({ github: "javascript:alert(1)", x: "http://x.com/dulofun", video: "https://" })).toEqual([]);
    expect(footerLinks({ video: "https://youtu.be/abc" })).toEqual([{ href: "https://youtu.be/abc", label: "Watch the demo" }]);
  });

  it("reads the NEXT_PUBLIC_* names literally and names no one in the footer", () => {
    const shell = repoFile("src/components/layout/AppShell.tsx");
    for (const name of ["NEXT_PUBLIC_GITHUB_URL", "NEXT_PUBLIC_X_URL", "NEXT_PUBLIC_VIDEO_URL"]) expect(shell).toContain(`process.env.${name}`);
    expect(shell).not.toMatch(/founder of|dum\.fun/i);
  });
});

describe("/check/[address] formatting", () => {
  const play = (key: string, status: PreviewPlayStatus): PreviewPlayView => ({
    key,
    title: key,
    desc: "",
    assetSource: "xstocks",
    points: 100,
    badgeKey: null,
    rule: { type: "hold_any", minUsd: 5 },
    status,
    note: "",
    proof: {},
    progress: null,
  });

  it("labels every status and counts only the rewards one read can decide", () => {
    expect(Object.keys(PREVIEW_STATUS_LABEL).sort()).toEqual(["needs_activity", "needs_history", "not_yet", "qualifies"]);
    expect(PREVIEW_STATUS_LABEL.needs_history).toBe("Needs daily snapshots");
    expect(CONNECT_CTA_TITLE).toBe("Connect this wallet to start scoring");
    expect(
      decidablePlays({ plays: [play("a", "qualifies"), play("b", "not_yet"), play("c", "needs_history"), play("d", "needs_activity")] }),
    ).toBe(2);
  });

  it("formats multiplier-correct quantities and hides a multiplier of 1", () => {
    expect(formatQty(3)).toBe("3");
    expect(formatQty(0.123456789)).toBe("0.123457");
    expect(formatQty(12.345678)).toBe("12.3457");
    expect(formatQty(1234.5678)).toBe("1,234.57");
    expect(formatQty(Number.NaN)).toBe("0");
    expect(formatMultiplier(1)).toBeNull();
    expect(formatMultiplier(1.0213)).toBe("×1.0213");
  });

  it("renders the proof sheet through the shared labelled ProofList, never raw evidence keys", () => {
    const card = repoFile("src/app/check/_components/PreviewPlayCard.tsx");
    expect(card).toContain('import { ProofList } from "@/components/plays/ProofDrawer"');
    expect(card).toContain("<ProofList entries={entries} />");
    expect(card).not.toContain("{e.key}");
  });

  it("maps failed checks to copy by status", () => {
    expect(checkErrorCopy(400, "Invalid Solana address").title).toBe("That isn't a Solana address.");
    expect(checkErrorCopy(429, "Too many").description).toBe("Too many");
    expect(checkErrorCopy(503, null).title).toBe("Couldn't read this wallet right now");
    expect(checkErrorCopy(null, null).title).toBe("Couldn't check this wallet");
  });
});

describe("previewApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded preview path", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { address: "abc" } }), { status: 200 });
    });
    await expect(previewApi.wallet("abc/def")).resolves.toEqual({ address: "abc" });
    expect(urls).toEqual(["/api/v1/preview/abc%2Fdef"]);
  });
});
