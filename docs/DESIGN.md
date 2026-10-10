# Dulo design system — "Live Broadcast"

Live Broadcast, chosen by the founder 9 Oct 2026, replaces Mono (the zinc greys, white primary buttons, electric-blue accent and heavy Geist headlines are retired).

Dulo looks like a calm, well-made weekly show. One thin Monday-to-Friday **week track** runs along the top of every page (Lock Thursday, Close Friday, a gold "now" marker and one countdown), so the week itself is the race. Instrument Serif sets the headlines, the questions and the section names; Archivo, upright, in its narrow and wide cuts, sets the numbers and the labels; mono is used only for price, source, age and time. The ground is near-black and the text is cream. Colour has one job each: gold is the one primary button and "now", green and red are Yes / No and gain / loss. Dark only.

The reference mockups (landing and competition, 1440 and 390, the weekend and pre-IPO states) are the source of truth for layout; this file is the contract for building pages from the shared pieces.

## Palette (tokens in `src/app/globals.css`)

| Role | Utility | Value | Use |
|---|---|---|---|
| Ground | `bg-background` / `bg-ink` (+ `.app-backdrop` in AppShell) | `#0b0b0c`, with the mockup's film grain at 4.5% behind the content; also `THEME_COLOR` in `layout.tsx`, the manifest, the icons and `sw.js` | Never paint a page background yourself |
| Surface | `bg-card` / `bg-ink-2` | `#121214` | The week band, panels (the paper-trade panel), Season seats |
| Raised | `bg-popover` / `bg-ink-3` | `#1a1a1d` | Dialogs, sheets, menus, toasts, quiet buttons, skeletons |
| Well | `bg-ink-4` | `#232327` | Track base, logo wells, disabled fills |
| Rule | `border-rule` | cream at 8.5% | Every row, every panel edge, 1px, solid |
| Strong rule | `border-rule-2` | cream at 17% | Under a page title, quiet button edges, inputs |
| Text | `text-foreground` / `text-paper` | `#f3f0e8` cream | Body, titles, numbers |
| Muted | `text-muted-foreground` / `text-mute` | `#a3a199` (7.6:1 on ink) | Every must-read small line: trust lines, labels, hints, sources |
| Dim | `text-dim` | `#87857e` (5.3:1 on ink, 5.1:1 on cards) | Secondary only: column heads, future days, inactive tabs, bot names. Never a trust line |
| Gold | `bg-signal` (and the `default` Button) | `#ffd23c`, its ink `#161100` (13:1) | The one primary action and the "now" marker. **At most two per screen** |
| Yes / gain | `text-yes`, `bg-yes` | `#3ad08a` | Yes, positive returns, the open-market dot |
| No / loss | `text-no`, `bg-no` | `#ff5d6c` | No, negative returns, errors |
| Focus | `ring-[var(--focus)]` | `#8cc8ff` (11:1 on ink) | Keyboard focus only: solid, never an alpha, always with `ring-offset-2 ring-offset-background` (or `ring-inset` inside bars). The one hue that cannot be read as gold, Yes or No |

shadcn's semantic tokens carry the same values: `--primary` is the gold, `--secondary` is the cream solid, `--muted` and `--accent` are ink-3, `--destructive` is the No red, `--ring` is `--focus`.

**Legacy names.** `ember`, `ember-light`, `gold`, `scoreboard` and `surface-solid` are kept so pages not yet rebuilt still render in one palette. `ember` and `gold` both resolve to **cream** (the name `gold` is not the gold). New code never uses them: use `foreground` / `paper`, and `signal` for the real gold. `.border-gradient` draws a plain 1px strong rule, `.ember-glow` and `.text-gradient-*` are no-ops.

**Logos.** xStock and partner logos are greyscale (`logo-greyscale` on the `<img>`, inside a round `bg-ink-4` well with an inset `rule-2` ring), so green and red keep their only meanings.

**Badge artwork** (`src/lib/badges/`) is unchanged by Broadcast: the Mono medallions on near-black stay until a badge redesign is decided (none has been minted).

## Type

Loaded in `src/app/layout.tsx` with `next/font/google`; the CSS variables go on `<html>`.

- **Display: Instrument Serif** (`font-display`, one weight: 400). Headlines, the prediction question, section names, dialog titles, the wordmark, the footer line. Always `font-normal` (a `font-semibold` left on it renders the real 400 face: `font-synthesis-weight: none`). Tracking `-0.012em`, leading about `0.98`. Sizes from the mockup: landing headline 68px (41px on a phone), the question 70px (35px), page titles 58px (36px), section names 26–46px. No italics.
- **Sans: Archivo** (`font-sans`, the default), variable with the width axis. Labels and UI at 14–16px, weight 500–650. The cuts:
  - narrow scoreboard numerals: `figure` (Archivo at `font-stretch: 74%`, tabular, lining, `-0.02em`), with the size and leading from utilities: `figure text-[6.25rem] leading-[0.8]` (the lock clock), `figure text-[3.75rem] leading-[0.8]` (a Season rank);
  - condensed figures: `font-stretch-[85%] font-semibold tabular-nums` (returns, splits, StatStrip values);
  - wide capitals: `label-caps` (11px, 600, `font-stretch: 112%`, `0.05em`, uppercase) for the few markers that need them (LOCK, CLOSE, "In the points"). Sparingly: Broadcast has no tiny tracked labels everywhere;
  - italics only in the FINAL stamp: `stamp` (italic 800, wide, cream fill, ink text).
- **Mono: IBM Plex Mono** (`font-mono`, 400 / 500) for **price, source, age and time only**. `mono-meta` is the 13px trust line ("Jupiter · 22s ago", "Thu 8 Oct · 20:00 UTC") in the muted grey; the price itself in cream 500 (PriceChip does this). Never for addresses-as-decoration, labels or headlines.
- Numbers are tabular and lining globally.

## Shapes and surfaces

- `--radius` is 2px: controls are square or very lightly rounded (`rounded-lg` = 2px, cards `rounded-md`/`rounded-2xl` = 1.6–3.6px). Logos and live dots are the only circles.
- Panels: `bg-card` with a 1px `rule` (Card does `ring-1 ring-rule`). **No cards in cards**: inside a panel, separate with rules, not another box.
- Rows: 42px, a 1px `rule` on top, no zebra, no boxes. Dimmed rows (house bots) use `text-muted-foreground` / `opacity-70`, never a hue.
- **No four-box stat strips.** StatStrip is an inline row of label / value pairs on rules.
- Open seats and invitations ("Your slot", SignInBanner): a dashed outline `border border-dashed border-[rgb(243_240_232/0.38)]`.
- Page container: `page-wrap` (1312px of content between gutters of 16 / 24 / 40 / 64px). The shell's header, week track, main and footer all use it.

## Buttons (`src/components/ui/button.tsx`)

| Variant | Look | Use |
|---|---|---|
| `default` | Gold, dark ink, the slanted bottom-right cut (`cut-corner`, drawn on `::before` so the focus ring is never clipped) | **One per view.** It shares the screen's gold with the week track's "now" |
| `secondary` | Cream solid, ink text | A strong action that is not the primary ("Make a prediction", "Connect wallet to trade" inside a panel) |
| `outline` | `bg-ink-3`, 1px `rule-2` | Quiet: the header's Connect wallet, secondary choices |
| `ghost` | Muted text, faint fill on hover | Quieter still: retry, close, menu triggers |
| `link` | Cream text on a 1px rule | "Check a wallet →", "Leaderboard →" (add the arrow yourself, `aria-hidden`) |
| `destructive` | No-red tint | Sign out, remove |

Sizes: `xs` 24px, `sm` 32px, `default` 36px, `lg` 40px, `xl` 54px (the hero's Connect wallet; cut 11px), `icon*`. Each size sets `--cut`. A page that counts its primary actions looks for `before:bg-primary` + `text-primary-foreground`.

## Shell (`src/components/layout/`)

- **Header** (`AppShell`): opaque ink, 56px (64px from lg), sticky, a 1px rule under it. The cream tamga and the serif "Dulo"; the desktop nav (Archivo 15px muted, the active section cream with a 2px cream rule on the header's edge) in the fixed order Predictions · Competition · Quests · Pre-IPO · Copy a portfolio · Leaderboard; then "Stocks Season 0", the market-session chip (680–767px only) and a quiet `outline` Connect wallet.
- **Week track** (`WeekTrack`) directly under the header on every page.
- **Footer**: the tamga, POSITIONING in the serif (verbatim; it breaks after its first sentence from md), "Points only, no cash value. Named after the House of Dulo…", COMPLIANCE_LINE, the links.
- **Mobile tab bar** (under lg): five text tabs, Predict · Compete · Quests · Board · Profile, opaque ink, a 1px strong rule on top, the active tab cream under a 2px cream bar. No icons. The shell's bottom padding keeps every page clear of it.

## Week track (`WeekTrack.tsx`, model in `week-track.ts`)

- Monday to Friday over 88% of the width, the weekend as a dashed tail. Ticks at each midnight; past days in the muted grey, future days dim.
- Cream pins for the predictions **LOCK** (the earliest `locksAt` of the markets settling this week) and the competition **CLOSE** (the League's `weekEnd`), labelled from lg (`label-caps`, times in mono from xl). The positions come from the data, never from a fixed hour (a winter lock lands at Thu 21:00 UTC).
- The elapsed bar (cream at 42%) and the gold **now** marker (a 3px bar under a diamond).
- One countdown on the right (mono 21px, 18px on a phone), the clock the page does not already show large (`readoutFocusFor`): the landing, /predictions and /start count to Friday's close; /competition counts to the lock; every other page to whichever is next. Format: `6:01:45`, `30:01:45` up to two days, then `4d 20:01:45`.
- **Weekend** (from Friday's close): the week on the track is the one that just closed, "Final · week N", a FINAL stamp left of the Close pin, and "Next week starts Mon 00:00 UTC" (the API's League is already next week's; the model moves it back a week).
- **Phone** (under lg): 50px, no left block, no pin labels, single-letter days, "Lock in" / "Close in".
- **Loading / error**: the first frame draws the ticks and day labels in the final 50 / 60px box with placeholder bars where the text goes, so nothing moves when the data lands; a failed read leaves the ticks and says "This week's times unavailable".
- **Reduced motion**: no marker transitions, no pulse, and the clock drops its seconds and ticks once a minute (`30h 01m`).
- Day labels step aside for the now marker (`dayLabelPlace`): a weekday label rides just after it for the first 40% of its day, and "Sat–Sun" rides beside it all weekend (after it in the tail's first half, before it in the second), so the diamond never covers a label.
- Accessible name: "Week of 5 Oct: predictions lock Thursday 20:00 UTC; the virtual-cash competition closes Friday 20:00 UTC."

**Data.** `WeekDataProvider` (in AppShell) owns the page's one read of `GET /api/v1/league` and one of `GET /api/v1/calls` (session-keyed, held for the session check, refetched on focus, retried twice on a 5xx). Pages read them with `useLeagueQuery(key)` / `useCallsQuery(key)` (`src/components/layout/WeekData.tsx`), never with their own `leagueApi.overview()` / `api.calls()`, so each endpoint is still one request per page. Outside the provider (a standalone render in a test) the hooks read on their own under `key`.

## Shared components (already themed: use, don't restyle)

- `PageHeader` — serif title (+ muted `suffix`), one sentence `description` (`<b>` words in cream), `actions` on the right (a page clock, a button), a strong rule under the row, then `stats` and the folding `details` ("How it works", on rules).
- `StatStrip` — `stats: { label, value, hint?, tone? }[]`: label / value pairs on rules; `tone` `positive` / `negative` = green / red, everything else cream.
- `PriceChip` — `quote`, `symbol?`, `session?`, `tickMs?`: the mono trust line "TSLAx $372.08 · Jupiter · 18s ago", ruled "stale" / "closed" tags. Every price on screen goes through it.
- `MarketSessionChip` — the status line "● US market open · closes in 6h 01m" (green dot open, dim closed).
- `SignInBanner` — `title`, `hint?`, `connectVariant`: the dashed "Your slot" row with Connect.
- `ConnectButton` — `variant` (`default` gold / `secondary` cream, where another control carries the screen's gold / `outline`), `size` (up to `xl`, the hero's 54px), `fullLabel` (keep "Connect wallet" on a phone, where the header says "Connect"): Connect wallet, Sign in, the account menu.
- `SectionHeading` / `SECTION_TITLE` — the serif section name (28px, 32px from sm) with an optional `hint`, `action` and `note`. Page titles and a game's hero sizes keep their own classes.
- `XStockLogo` — `symbol`, `ticker?`: the round greyscale xStock logo well, sized by `className`. `PartnerLogo` draws partner and pre-IPO logos in the same well.
- `IssuerPill` ("xStocks" / "PreStocks"), `AddressChip`, `PointsChip`, `SeasonBadge` — square ruled tags (a 1px rule, 2px radius, muted Archivo), never pills, never gold.
- `useReducedMotion` (`src/hooks/useReducedMotion.ts`) — the one reduced-motion hook every clock and marker reads.
- `EmptyState` / `ErrorState` — a ruled panel, a round ink-3 icon well, a serif title.
- `Card`, `Badge` (`default` = cream stamp, `outline` = 1px cream rule, as the mockup's "Player" tag), `Table` (42px rows on rules, plain dim column heads), `Dialog` / `Sheet` (ink-3 on a strong rule, serif titles), `Input` (an ink well on a strong rule, 40px), `Tabs`, `Skeleton` (ink-3, still under reduced motion), `Progress` (a cream fill on ink-4), toasts (sonner: ink-3, strong rule, green / red icons only for success / error).
- `Tamga` / `Dulo` — the cream tamga (`tone="gradient"` strokes `#f3f0e8` inline); the wordmark sets "Dulo" in the serif. Never gold.

## Standalone pages and brand assets

`global-error.tsx`, `/offline`, the `sw.js` fallback and the social card carry the values inline (no stylesheet or web font can be relied on): ink `#0b0b0c`, cream `#f3f0e8`, muted `#a3a199`, the cream tamga, a serif title at 400 ("Times New Roman" fallback), and the gold retry with its cut drawn by the background (a clip-path would clip the focus outline). The icons (`public/favicon.svg`, `public/icons/*`) are the cream tamga on ink; the PNGs are rendered from the SVGs beside them, opaque (no alpha). Re-render them when an SVG changes, and bump `CACHE_VERSION` in `public/sw.js` (now `dulo-v4`). The social card (`src/app/opengraph-image.tsx`, copied to `docs/brand/og.png`) sets "Dulo" and the line in Instrument Serif and the small lines in Archivo.

## Motion

Calm: `transition-colors`, the now marker easing along the track. No pulses except skeletons, no parallax, no glow. Every transition and animation carries its `motion-reduce:` override.

## Rules

1. One gold primary action per view; gold appears at most twice on a screen (that button and "now").
2. Green and red mean Yes / No and gain / loss, and nothing else; logos are greyscale.
3. Serif for headlines, questions and section names; Archivo for numbers and labels; mono only for price, source, age and time.
4. No four-box stat strips, no tiny tracked labels everywhere, no cards in cards, no gradients, no glow, no italics outside the FINAL stamp.
5. House bots are always labelled and dimmed; every competition mention carries "virtual cash"; points only, no cash value; COMPLIANCE_LINE (and PRE_IPO_COMPLIANCE_LINE beside it wherever a pre-IPO token is on screen).
6. Every price keeps its source and age (PriceChip). The app works with markets closed.
7. Must look right at 390px with a 16px gutter and no horizontal scroll; the mobile tab bar keeps five tabs.
