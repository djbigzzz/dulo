import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// AppShell renders client components; only its pure footer helper is under test.
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));
vi.mock("@/components/layout/NavLinks", () => ({ NavLinks: () => null }));
vi.mock("@/components/layout/MobileTabBar", () => ({ MobileTabBar: () => null }));

import { footerLinks } from "@/components/layout/AppShell";
import { CHECK_INVALID_MESSAGE, SAMPLE_WALLETS, checkHref } from "@/components/landing/check-wallet";
import { SEASON_TOP_MIN_ROWS, seasonTopRows } from "@/components/landing/scoreboard-mode";
import { PRE_IPO_PUBLIC_WALLETS, PUBLIC_WALLETS, publicWalletLabel } from "@/lib/mirror/public-wallets";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { NEXT_WEEK_MARKETS_COPY } from "@/components/calls/calls-format";
import {
  CONNECT_CTA_TITLE,
  PREVIEW_STATUS_LABEL,
  checkErrorCopy,
  decidablePlays,
  formatMultiplier,
  formatQty,
  groupPreviewPlays,
  inPlatformSummary,
} from "@/app/check/_components/check-format";
import { NOTHING_QUALIFIES, PreviewBoard } from "@/app/check/_components/PreviewBoard";
import { STARTER_POINTS, VIRTUAL_CASH_USD } from "@/lib/games/ledger-policy";
import { previewApi, type LeaderboardResponse, type PreviewPlayStatus, type PreviewPlayView, type PreviewResponse } from "@/lib/api-client";

function repoFile(rel: string): string {
  return readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("landing — check any wallet (M-C) and the three-games hero (C9)", () => {
  it("offers the first three curated public wallets with their neutral labels, then the pre-IPO holder with its tag", () => {
    expect(SAMPLE_WALLETS).toHaveLength(4);
    expect(SAMPLE_WALLETS.slice(0, 3)).toEqual(PUBLIC_WALLETS.slice(0, 3));
    for (const w of SAMPLE_WALLETS) expect(w.label).toMatch(/^(Public holder [A-Z]|Pre-IPO holder)$/); // the pre-IPO chip has its own name
    for (const w of SAMPLE_WALLETS.slice(0, 3)) expect(w.tag).toBeUndefined();
    // Public holder D (22 Sep): a PreStocks holder, on the check chips only, tagged so the label says why.
    const preIpo = SAMPLE_WALLETS[3];
    expect(preIpo).toEqual(PRE_IPO_PUBLIC_WALLETS[0]);
    expect(preIpo).toMatchObject({ address: "55t97rzPqCLNY1KX4Ypd3BFDCvbKF15i6xzrjLJgWh95", label: "Pre-IPO holder", tag: "pre-IPO" });
    expect(publicWalletLabel(preIpo.address)).toBe("Pre-IPO holder");
    // Never on /copy: the copy tool lists PUBLIC_WALLETS only, and this wallet would show an empty xStocks plan there.
    expect(PUBLIC_WALLETS.some((w) => w.address === preIpo.address)).toBe(false);
    const box = repoFile("src/components/landing/CheckWalletBox.tsx");
    expect(box).toContain('data-slot="wallet-tag"');
    expect(box).toContain("{w.tag}");
    expect(repoFile("src/lib/mirror/views.ts")).not.toContain("PRE_IPO_PUBLIC_WALLETS");
    expect(repoFile("src/lib/mirror/public.ts")).not.toContain("PRE_IPO_PUBLIC_WALLETS");
    expect(checkHref(SAMPLE_WALLETS[0].address)).toBe(`/check/${SAMPLE_WALLETS[0].address}`);
    expect(checkHref("a/b")).toBe("/check/a%2Fb");
    expect(CHECK_INVALID_MESSAGE).toMatch(/Solana wallet address/);
  });

  it("leads the hero with the three games, keeps Connect primary and makes the secondary CTA 'Check a wallet'", () => {
    const landing = repoFile("src/app/page.tsx");
    const flat = landing.replace(/\s+/g, " ");
    expect(flat).toContain("The entertainment layer for");
    expect(landing).toContain("Predict. Compete. Complete on-chain quests.");
    // No paragraph under the verbs since 2 Oct 2026: the welcome line and the tiles say the rest.
    expect(flat).not.toContain("Dulo gives them three games");
    expect(flat).not.toContain("Yes or No on Friday&apos;s close, a weekly competition");
    expect(landing).not.toContain("Try the League");
    expect(landing).not.toContain("activity is");
    const connect = landing.indexOf("<ConnectButton");
    const check = landing.indexOf("Check a wallet");
    expect(connect).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(connect);
    expect(landing).toContain('href="#check"');
    expect(landing).toContain('id="check"');
    expect(landing).toContain("<CheckWalletBox");
  });

  it("moves keyboard focus with 'Check a wallet': the #check section takes focus, so the next Tab reaches the address field", () => {
    const landing = repoFile("src/app/page.tsx");
    // Next's hash navigation calls focus() on the target; without tabIndex the call does nothing and focus stays in the hero.
    expect(landing).toMatch(/<section\s+id="check"\s+tabIndex=\{-1\}/);
  });

  it("keeps the check field 44px tall on phones and visible without its card", () => {
    const box = repoFile("src/components/landing/CheckWalletBox.tsx");
    const input = box.slice(box.indexOf("<Input"), box.indexOf("/>", box.indexOf("<Input")));
    // Stacked below sm: a bare flex-1 (basis 0) in the column overrides h-11 and draws a 28px field.
    expect(input).toContain("h-11");
    expect(input).toContain("sm:flex-1");
    expect(input).not.toMatch(/[" ]flex-1\b/);
    // The landing strips the card, so it gives the field a stronger edge than the 6% well border.
    expect(repoFile("src/app/page.tsx")).toMatch(/<CheckWalletBox className="[^"]*\[&_input\]:border-white\/\[0\.14\]/);
  });

  it("keeps the hero's Sign in as tall as the Connect it replaces: the pair fills the caller's size, never its padding", () => {
    const src = repoFile("src/components/wallet/ConnectButton.tsx");
    const branch = src.slice(src.indexOf("if (!signedIn) {"), src.indexOf("const points = user?.points"));
    expect(branch).toContain('<div className={cn("inline-flex items-stretch gap-1", className, "p-0!")}>');
    // Both buttons drop their fixed height and stretch to the wrapper, with the size's own height as the floor.
    expect(branch).toMatch(/className=\{cn\("h-auto grow font-semibold", PAIR_MIN\[size\]\.h\)\}/);
    expect(branch).toMatch(/className=\{cn\("aspect-square h-auto w-auto shrink-0 p-0", PAIR_MIN\[size\]\.h, PAIR_MIN\[size\]\.w\)\}/);
    expect(src).toMatch(/lg: \{ h: "min-h-9", w: "min-w-9" \}/);
  });

  it("states the welcome offer before sign-in, directly above the buttons, from the points policy", () => {
    const landing = repoFile("src/app/page.tsx");
    expect(landing).toMatch(/import \{[^}]*\bWELCOME_OFFER_LINE\b[^}]*\} from "@\/lib\/games\/ledger-policy"/);
    const offer = landing.indexOf("{WELCOME_OFFER_LINE}");
    expect(offer).toBeGreaterThan(landing.indexOf("Predict. Compete. Complete on-chain quests."));
    expect(offer).toBeLessThan(landing.indexOf("<ConnectButton"));
    expect(WELCOME_OFFER_LINE).toBe("Sign in free: 1,000 starter points and $10,000 of virtual cash to play. Points only, no cash value.");
  });

  it("keeps the market session chip, the pre-IPO hook and the compliance line in the hero, as one quiet status line", () => {
    const landing = repoFile("src/app/page.tsx");
    const hero = landing.slice(landing.indexOf('aria-labelledby="hero-title"'), landing.indexOf("<GameTiles"));
    expect(hero).toContain("<MarketSessionChip");
    // The one pre-IPO hook on the landing (22 Sep) sits beside the chip, at the same quiet size.
    expect(hero).toMatch(/<MarketSessionChip [^>]*\/>[\s\S]{0,400}href="\/prestocks"[\s\S]{0,300}Pre-IPO tokens trade 24\/7/);
    // The trust row was folded away on 9 Oct 2026: one status line, not four chips.
    expect(hero).not.toContain("TRUST.map(");
    expect(hero).toContain("{COMPLIANCE_LINE}");
    // The regulatory line keeps AA contrast for 12px text: /80 is 5.3:1 on the page background, /70 only 4.3:1.
    const compliance = hero.match(/<p className="([^"]*)">\{COMPLIANCE_LINE\}<\/p>/);
    const tone = compliance?.[1].split(" ").find((c) => c.startsWith("text-muted-foreground"));
    expect(["text-muted-foreground", "text-muted-foreground/90", "text-muted-foreground/80"]).toContain(tone);
    // The pre-IPO link draws the focus ring (its outline-none removes the global outline) and is at least 24px tall.
    const preIpo = hero.match(/href="\/prestocks"\s+className="([^"]*)"/);
    expect(preIpo?.[1]).toContain("focus-visible:ring-2 focus-visible:ring-[var(--focus)]");
    expect(preIpo?.[1]).toContain("min-h-6");
    expect(landing).toMatch(/import \{[^}]*\bCOMPLIANCE_LINE\b[^}]*\} from "@\/components\/common\/compliance"/);
    // Phones read the pitch, then the status line, then the live card.
    expect(hero.indexOf("<MarketSessionChip")).toBeGreaterThan(hero.indexOf("Check a wallet"));
    expect(hero.indexOf("<MarketSessionChip")).toBeLessThan(hero.indexOf("<LivePredictions"));
    // The H1 steps down below sm so Connect sits on the first 375 px screen (Mono: 40px, then 60px from sm),
    // set heavy and tight in Geist, never the old serif italic.
    expect(landing).toMatch(/id="hero-title"\s+className="font-display text-\[2\.5rem\] [^"]*\bfont-semibold\b[^"]*\bsm:text-6xl\b/);
    expect(landing.slice(landing.indexOf('id="hero-title"'), landing.indexOf("</h1>"))).not.toContain("italic");
  });

  it("signed in, the hero's first button is the next step, never the wallet chip again", () => {
    const landing = repoFile("src/app/page.tsx");
    const hero = landing.slice(landing.indexOf('aria-labelledby="hero-title"'), landing.indexOf("<GameTiles"));
    expect(hero).toMatch(/<SessionSwitch signedIn=\{<ContinueTour \/>\} signedOut=\{<ConnectButton /);
    expect(landing).toMatch(/href="\/start"[^>]*>\s*Continue the tour/);
    // The welcome offer is for visitors who have not signed in yet. A signed-in player gets a plain line
    // that is true at a first sign-in too: the first-grant toast says "Welcome to Dulo" at that moment.
    expect(hero).toMatch(/<SessionSwitch\s+signedIn=\{[\s\S]{0,300}You&apos;re signed in\.[\s\S]{0,300}signedOut=\{[\s\S]{0,300}\{WELCOME_OFFER_LINE\}/);
    expect(landing).not.toMatch(/Welcome back/i);
    // The landing shows no personal balance (docs/HANDOFF.md 3.8, decided 16 Sep 2026).
    expect(landing).not.toMatch(/\buser\??\.points|PointsSummary|seasonPoints|formatPoints/);
    expect(repoFile("src/components/landing/SessionSwitch.tsx")).not.toMatch(/\.points|formatPoints|balance/);
  });

  it("puts this week's predictions in the hero as one featured card, and the game tiles right under it", () => {
    const landing = repoFile("src/app/page.tsx");
    const predictions = landing.indexOf("<LivePredictions");
    const tiles = landing.indexOf("<GameTiles");
    expect(predictions).toBeGreaterThan(-1);
    // The hero ranking card was cut on 9 Oct 2026: the tiles carry the competition's live figure.
    expect(landing).not.toContain("<RankCard");
    // The tiles follow the hero section and come before the Check section.
    expect(tiles).toBeGreaterThan(landing.indexOf("</section>"));
    expect(tiles).toBeLessThan(landing.indexOf('id="check"'));
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).not.toContain("PlayTeaser");
    expect(src).toContain("export function LivePredictions");
    expect(src).not.toContain("export function RankCard");
    expect(src).toContain("export function GameTiles");
    expect(src).toContain("Live right now");
    const cards = src.slice(src.indexOf("export function LivePredictions"), src.indexOf("export function GameTiles"));
    expect(cards).not.toMatch(/min-height/);
    expect(cards).toContain("See all {count} predictions");
    expect(cards).toContain("NEXT_WEEK_MARKETS_COPY");
    expect(NEXT_WEEK_MARKETS_COPY).toBe("Next week's predictions open right after Friday's settle.");
  });

  it("keeps the landing short (lower explainer sections cut 2 Oct 2026), with nothing that pays for holding", () => {
    const landing = repoFile("src/app/page.tsx");
    for (const gone of ["How it <span", "Three games, <span", "Why it works", "<PartnersRow"]) expect(landing).not.toContain(gone);
    expect(landing).not.toContain("PLAY_KINDS");
    for (const chip of ['"Hold"', '"Diversify"', '"DCA"', '"Earnings"']) expect(landing).not.toContain(chip);
    expect(landing).not.toMatch(/\b(paid|pays?|earn\w*) (points )?(for|by) (holding|buying)/i);
    // Closing CTA: Connect plus the tour; signed in, the tour plus "Make a prediction".
    const cta = landing.slice(landing.indexOf('aria-labelledby="cta"'));
    expect(cta).toContain("<ConnectButton");
    expect(cta).toMatch(/href="\/start"[^>]*>\s*Take the tour/);
    expect(cta).toMatch(/href="\/predictions"[^>]*>\s*Make a prediction/);
    // No betting words or internal odds on the landing.
    expect(landing).not.toMatch(/probability|odds today|~0%/i);
    expect(landing).not.toMatch(/prediction market|\bstake|\bodds\b|\bpayout|\bbets?\b/i);
  });
});

describe("SeasonTop — the landing top 3 once three real players exist", () => {
  const board = (n: number): LeaderboardResponse => ({
    season: null,
    limit: 3,
    rows: Array.from({ length: n }, (_, i) => ({ rank: i + 1, userId: `u${i}`, handle: null, address: null, points: 300 - i * 50 })),
  });

  it("shows nothing until the board has three rows, then the first three", () => {
    expect(SEASON_TOP_MIN_ROWS).toBe(3);
    expect(seasonTopRows(null)).toBeNull();
    expect(seasonTopRows(undefined)).toBeNull();
    expect(seasonTopRows(board(0))).toBeNull();
    expect(seasonTopRows(board(2))).toBeNull();
    expect(seasonTopRows(board(3))?.map((r) => r.userId)).toEqual(["u0", "u1", "u2"]);
    expect(seasonTopRows(board(5))).toHaveLength(3);
  });

  it("sits in the closing section, below the fold, never in the hero", () => {
    const landing = repoFile("src/app/page.tsx");
    const cta = landing.slice(landing.indexOf('aria-labelledby="cta"'));
    expect(cta).toContain("<SeasonTop ");
    expect(landing.indexOf("<SeasonTop")).toBeGreaterThan(landing.indexOf('aria-labelledby="cta"'));
  });
});

describe("mobile layout at 375 px — the /competition Trade button", () => {

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

  it("hides the Trade button while the sign-in banner is in view, so it never covers the banner's Connect", () => {
    const page = repoFile("src/app/competition/page.tsx");
    expect(page).toMatch(/import \{ useInView \} from "@\/hooks\/useInView"/);
    expect(page).toContain("const bannerInView = useInView(bannerRef, !session);");
    expect(page).toContain("const hideFab = !session && bannerInView;");
    expect(page).toMatch(/<div ref=\{bannerRef\} data-slot="league-sign-in"[^>]*>\s*<SignInBanner/);
    const fab = page.slice(page.indexOf('data-slot="league-trade-fab"'), page.indexOf("<Sheet open="));
    expect(fab).toContain('hideFab && "pointer-events-none invisible opacity-0"');
    // Fails open: no observer (server, old browser) means the button shows.
    const hook = repoFile("src/hooks/useInView.ts");
    expect(hook).toContain('typeof IntersectionObserver === "undefined"');
  });

  it("clears the tab bar at the shell level: the whole shell ends above it under lg, on every page", () => {
    const shell = repoFile("src/components/layout/AppShell.tsx");
    const wrapper = shell.match(/<div className="relative isolate flex min-h-dvh flex-col ([^"]+)">/);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1].split(" ")).toEqual(expect.arrayContaining(["pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]", "lg:pb-0"]));
    // The footer no longer carries its own clearance (it sits inside the padded shell).
    expect(shell).toMatch(/<footer className="[^"]*">/);
    expect(shell.match(/<footer className="([^"]+)">/)![1]).not.toContain("safe-area-inset-bottom");
    // The tab bar itself: 4rem tall plus the home-indicator inset, fixed, under lg only.
    const bar = repoFile("src/components/layout/MobileTabBar.tsx");
    expect(bar).toContain("fixed inset-x-0 bottom-0");
    expect(bar).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(bar).toContain("lg:hidden");
    expect(bar).toContain("grid h-16");
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

  const preview = (plays: PreviewPlayView[]): PreviewResponse => ({
    now: "2026-09-22T12:00:00.000Z",
    address: "preview",
    chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    readAt: "2026-09-22T11:59:30.000Z",
    label: null,
    totalUsd: 0,
    holdings: [],
    plays,
    qualifying: plays.filter((p) => p.status === "qualifies").length,
    qualifyingPoints: 0,
  });
  const board = (plays: PreviewPlayView[]) =>
    renderToStaticMarkup(createElement(PreviewBoard, { data: preview(plays), onProof: () => undefined })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  const groupOf = (html: string, id: string) => {
    const start = html.indexOf(`data-preview-group="${id}"`);
    return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
  };

  it("groups the board as a verdict: qualifies, needs daily snapshots, not yet, then the in-platform quests collapsed", () => {
    const plays = [
      play("first_position", "qualifies"),
      play("steady_buyer", "needs_history"),
      play("diversified", "not_yet"),
      play("first_prediction", "needs_activity"),
      play("first_paper_trades", "needs_activity"),
      play("diamond_hands", "needs_history"),
    ];
    const groups = groupPreviewPlays(plays);
    expect(groups.qualifies.map((p) => p.key)).toEqual(["first_position"]);
    expect(groups.needsHistory.map((p) => p.key)).toEqual(["steady_buyer", "diamond_hands"]);
    expect(groups.notYet.map((p) => p.key)).toEqual(["diversified"]);
    expect(groups.inPlatform.map((p) => p.key)).toEqual(["first_prediction", "first_paper_trades"]);
    expect(groupPreviewPlays([])).toEqual({ qualifies: [], needsHistory: [], notYet: [], inPlatform: [] });

    const html = board(plays);
    const qualifies = html.indexOf('data-preview-group="check-qualifies"');
    const history = html.indexOf('data-preview-group="check-needs-history"');
    const notYet = html.indexOf('data-preview-group="check-not-yet"');
    const collapsed = html.indexOf('data-slot="check-in-platform"');
    expect(qualifies).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(qualifies);
    expect(notYet).toBeGreaterThan(history);
    expect(collapsed).toBeGreaterThan(notYet);
    // Each on-chain card sits in its own group; every in-platform card sits behind the one <details>.
    expect(groupOf(html, "check-qualifies")).toContain("first_position");
    expect(groupOf(html, "check-qualifies")).not.toContain("diversified");
    expect(groupOf(html, "check-needs-history")).toContain("diamond_hands");
    expect(groupOf(html, "check-not-yet")).toContain("diversified");
    // Every card carries its own rule <details>, so the disclosure runs to the last closing tag.
    const details = html.slice(collapsed, html.lastIndexOf("</details>"));
    expect(details).toContain("<summary");
    expect(details).toContain("first_prediction");
    expect(details).toContain("first_paper_trades");
    expect(details).not.toContain("first_position");
    // The disclosure line says what those quests need and what a new account starts with.
    expect(details).toContain(inPlatformSummary(2));
    expect(inPlatformSummary(2)).toBe("2 in-platform quests need a signed-in account: 1,000 starter points and $10,000 of virtual cash to start");
    expect(inPlatformSummary(1)).toBe("1 in-platform quest needs a signed-in account: 1,000 starter points and $10,000 of virtual cash to start");
    expect(STARTER_POINTS).toBe(1000);
    expect(VIRTUAL_CASH_USD).toBe(10_000);
    // The group headings reuse the status labels, so the pill on a card and the heading above it agree.
    expect(html).toContain(`>${PREVIEW_STATUS_LABEL.qualifies}<`);
    expect(html).toContain(`>${PREVIEW_STATUS_LABEL.needs_history}<`);
    expect(html).toContain(`>${PREVIEW_STATUS_LABEL.not_yet}<`);
    // No pre-IPO quest or token here: no compliance pair on the board.
    expect(html).not.toContain('data-slot="pre-ipo-compliance"');
  });

  it("says so when nothing qualifies, and drops the empty groups and the disclosure", () => {
    const html = board([play("diversified", "not_yet")]);
    expect(html).toContain(NOTHING_QUALIFIES);
    expect(html).toContain('data-preview-group="check-qualifies"');
    expect(html).not.toContain('data-preview-group="check-needs-history"');
    expect(html).toContain('data-preview-group="check-not-yet"');
    expect(html).not.toContain('data-slot="check-in-platform"');
    const full = board([play("first_position", "qualifies")]);
    expect(full).not.toContain(NOTHING_QUALIFIES);
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
