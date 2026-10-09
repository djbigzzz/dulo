# Dulo design system — "Mono"

Mono, chosen by the founder 9 Oct 2026, replaces Obsidian & Khan's Gold (the warm obsidian ground, gold tamga, ember action colour and Instrument Serif headlines are retired).

Product-grade restraint (Linear / Vercel tier): true neutral greys on near-black `#09090b`, white primary buttons with black text, one electric-blue accent for live data and focus, heavy tight Geist headlines, flat surfaces with thin 1px hairlines. No gradients, no aurora, no grain, no glow; a faint grid at the top of the page is the only texture. Dark only.

## Palette (tokens in `src/app/globals.css`)

The token names `ember` and `gold` are kept from the previous theme so every component reads the new values: `ember` is the accent, `gold` is a bright neutral. Neither is orange or gold any more.

| Role | Token / class | Value | Use |
|---|---|---|---|
| Page | `bg-background` + `.app-backdrop` (AppShell) | `#09090b` with a faint grid that fades out under the header; also `THEME_COLOR` in `layout.tsx`, the manifest colours and the icon ground | Never paint a page background yourself |
| Text | `text-foreground` | `#fafafa` | Body and titles |
| Secondary text | `text-muted-foreground` | `#a1a1aa` (7.8:1) | Labels, hints, eyebrows, the second half of a two-tone headline |
| Surface | `bg-card` | `#0f0f11`, flat, quiet drop shadow | Every card/panel |
| Solid surface | `bg-surface-solid` / `bg-popover` | `#0f0f11` / `#111113` | Sticky bars, sheets, dialogs |
| Hairline | `border-white/[0.08]` | | Cards, rows, dividers (solid, never a fade) |
| Action | `bg-primary` via `<Button>` default | `#fafafa` fill, `#09090b` text | ONE primary action per view |
| Accent | `bg-ember`, `text-ember-light` | `#3b82f6` fills, `#60a5fa` text (7.8:1) | Live dots, the one headline number in a StatStrip, "You" rows and chips, quest progress, the current tour step, focus rings, the tamga |
| Bright neutral | `text-gold`, `bg-gold/[0.06]`, `border-gold/20` | `#e4e4e7` | Icons in tiles, neutral pills ("Primary", "pre-IPO"), rank 1 |
| Positive / negative | `text-emerald-300/400` / `text-rose-300/400` | | Returns, Yes/No, complete/failed only |
| Warning | `amber-300` | | Stale prices only |

Ranks 1 / 2 / 3 are three steps of grey: white (`border-white/40 bg-white/[0.12]`), `zinc-300`, `zinc-400`. The label (1st / 2nd / 3rd) and the podium height carry the order, not a metal colour.

Badge artwork (`src/lib/badges/`) follows Mono too (9 Oct 2026, before any badge was minted): flat near-black medallions, no glow, one tone each, neutral metals plus the one accent: First Position blue `#60a5fa`, Diamond Hands cold steel `#cbd5e1`, Earnings Holder pewter `#a1a1aa`, Portfolio Match chrome `#e4e4e7`, Podium Finish platinum `#fafafa`. The motif ids (`ember`, `ice`, `gold`, `violet`, `laurel`) are kept as stable keys in the API and the metadata "Accent" trait; they name the motif, not the colour.

Brand assets follow the same palette: the tamga is solid `#3b82f6` on `#09090b` in `public/favicon.svg`, `public/icons/*.svg` and the PNG app icons rendered from them (opaque, full-bleed), and in the social card (`src/app/opengraph-image.tsx`, copied to `docs/brand/og.png`).

## Type

- **Display** `font-display` = Geist (the same variable family as the UI), always `font-semibold` with negative tracking: hero `text-[2.5rem] sm:text-6xl lg:text-[4rem] tracking-[-0.045em] leading-[1.02]`; page titles (PageHeader) `text-[2rem] sm:text-4xl md:text-5xl tracking-[-0.04em]`; section titles `text-2xl sm:text-3xl tracking-[-0.035em]`. No serif, no italics. For emphasis, set the secondary half in `text-muted-foreground` (two-tone), never a colour.
- **Sans** (Geist): everything else. Card titles `text-base font-semibold tracking-tight`; body `text-sm`/`text-base leading-relaxed`.
- **Numbers**: tabular numerals are global. Big live figures `font-medium tracking-[-0.05em]`; stat values `font-semibold tracking-[-0.04em]`. `font-mono` only for addresses, codes and tickers.
- **Labels / eyebrows**: `text-xs font-medium tracking-[0.08em–0.14em] uppercase text-muted-foreground` (section eyebrows too; never the accent). No text below `text-xs`, and no body text under `text-muted-foreground/80` (5.2:1).
- **Standalone pages** (`global-error.tsx`, the `/offline` fallbacks, the social card): no stylesheet or web font can be relied on, so they carry the same values inline: `#09090b` ground, `#fafafa` text, `#a1a1aa` secondary, the `#3b82f6` tamga, a system-sans (or Geist) title at weight 600 with negative tracking.

## Surfaces and depth

- Cards: `rounded-2xl border border-white/[0.08] bg-card`. Inner padding `p-5 sm:p-6` for feature cards, `p-4` for dense ones.
- Interactive cards: `transition-colors hover:border-white/[0.14] hover:bg-white/[0.03]`. No lift.
- Hero / featured panel: `rounded-2xl` (the landing card) or `rounded-3xl` (page heroes) with `bg-card border-gradient`. `.border-gradient` now draws a plain 1px hairline, and `ember-glow` is a no-op kept for compatibility; if you keep it, keep it outside cn() (tailwind-merge reads it as a background and drops `bg-card`), and never use `bg-ember-glow`.
- Inset wells (inputs, chips inside cards, pool bars): `rounded-lg bg-black/25 border border-white/[0.06]`.
- Dividers: `h-px bg-white/[0.08]`.
- Icon tiles: `size-10 rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]`, icon `text-gold` (the bright neutral), or the accent only when the tile is live.
- Radius: `--radius` is `0.5rem`. Controls `rounded-lg`, cards `rounded-2xl` (about 14px), chips/pills `rounded-full`.

## Components (already themed — use, don't restyle)

`Button` (default = solid white, black text; disabled = grey well; `outline` = transparent with a 1px hairline; `ghost`), `Badge variant="outline"`, `Table`, `Card`, `PageHeader` (heavy sans title, muted eyebrow, collapsible details), `StatStrip` (tones: `ember` = accent number, `gold` = white, `positive`, `negative`), `SignInBanner` (flat card), `Tamga tone="gradient"` (name kept: solid accent stroke).

## Motion

Subtle only: `transition-colors duration-200`; entrances `animate-in fade-in-0 slide-in-from-bottom-2 duration-500`. No bouncing, no parallax, no glow pulses beyond the one live dot. Respect `motion-reduce:`.

## Rules

1. One white primary action per screen (the `<Button>` default). Everything else is `outline` or `ghost`.
2. One accent, and it means live or focused. Never decorate with it.
3. No gradients (fills, text, borders or dividers), no glows, no aurora or grain, no serif, no italics, no `rounded-md` cards, no `text-[10px]`.
4. Generous spacing: sections `gap-8 sm:gap-12`, landing sections `mt-20 sm:mt-28`.
5. Every price keeps its source and age (PriceChip). Points only, no cash value.
6. Must look right at 375px with no horizontal scroll.
