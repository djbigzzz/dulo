# Dulo design system — "Obsidian & Khan's Gold"

The look should read as a premium product (Linear / Stripe / Vercel tier) with a heritage signature: the House of Dulo tamga in gold, warm obsidian surfaces, one ember action colour. Dark only.

## Palette (tokens in `src/app/globals.css`)

| Role | Token / class | Value | Use |
|---|---|---|---|
| Page | `bg-background` + `.app-backdrop` (AppShell) | `#0a0908` with ember/gold aurora, fading grid, grain | Never paint a page background yourself |
| Text | `text-foreground` | `#f4f1ea` warm white | Body and titles |
| Secondary text | `text-muted-foreground` | `#a9a299` warm grey | Labels, hints |
| Surface | `bg-card` | translucent warm charcoal; auto sheen + inner highlight | Every card/panel |
| Solid surface | `bg-surface-solid` / `bg-popover` | `#141210` / `#15130f` | Sticky bars, sheets, dialogs, anything over scrolling content |
| Hairline | `border-white/[0.07]` (cards), `border-white/[0.05]` (rows) | | Never `border-border` on new surfaces |
| Action | `bg-primary` via `<Button>` default | ember gradient + halo | ONE primary action per view |
| Ember text | `.text-gradient-ember` | `#ff9452 → #ff6a2a → #e2471a` | Headline accent word, the one headline number |
| Heritage | `text-gold`, `.text-gradient-gold`, `border-gold/20`, `bg-gold/[0.06]` | `#d8b46a` | Eyebrows, rank #1 / podium, badges, Season chips, "Listed" status |
| Positive / negative | `text-emerald-400` / `text-rose-400` | | Returns, Yes/No, complete/failed only |

Silver and bronze for ranks 2 and 3: `text-zinc-300` with `bg-zinc-300/10 border-zinc-300/20`, and `text-[#d49a6a]` with `bg-[#d49a6a]/10 border-[#d49a6a]/25`.

## Type

- **Display serif** `font-display` (Instrument Serif, weight 400, italic available): page titles (PageHeader does this), landing hero headline and section titles, big empty-state headlines. Sizes: hero `text-5xl sm:text-7xl leading-[0.98]`; section `text-3xl sm:text-4xl`. Put one accent phrase in `italic` and/or `.text-gradient-ember`. Never use the serif below `text-2xl`, for numbers, or for UI controls.
- **Sans** (Geist): everything else. Card titles `text-base font-semibold tracking-tight`; body `text-sm`/`text-base leading-relaxed`.
- **Numbers**: tabular numerals are global. Big numbers `text-2xl–4xl font-semibold tracking-tight`. Use `font-mono` only for addresses, codes and tickers, never for prose labels.
- **Labels / eyebrows**: `text-xs font-medium tracking-[0.14em] uppercase text-muted-foreground` (or `text-gold` for section eyebrows). No text below `text-xs`.

## Surfaces and depth

- Cards: `rounded-2xl border border-white/[0.07] bg-card` (sheen and shadow come automatically). Inner padding `p-5 sm:p-6` for feature cards, `p-4` for dense ones.
- Interactive cards: add `transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.04]`.
- Hero / featured panel: `rounded-3xl bg-card ember-glow border-gradient` (use `ember-glow`, never `bg-ember-glow`, inside cn(): tailwind-merge drops `bg-card` otherwise) (gradient hairline from gold to ember).
- Inset wells (inputs, chips inside cards, pool bars): `rounded-xl bg-black/25 border border-white/[0.06] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]`.
- Dividers: `h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`.
- Icon tiles: `size-10 rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]`, icon `text-gold` (or ember for the primary item).
- Radius scale: controls `rounded-lg/xl`, cards `rounded-2xl`, hero `rounded-3xl`, chips/pills `rounded-full`.

## Components (already themed — use, don't restyle)

`Button` (default = ember gradient; `outline` = glass; `ghost`), `Badge variant="outline"` (glass pill), `Table` (uppercase muted headers, hairline rows), `Card`, `PageHeader` (serif title, gold eyebrow, collapsible details), `StatStrip` (tones: `ember` gradient, `gold` gradient, `positive`, `negative`), `SignInBanner` (gradient hairline), `Tamga tone="gradient"`.

## Motion

Subtle only: `transition-all duration-300`; entrances `animate-in fade-in-0 slide-in-from-bottom-2 duration-500` on page sections (tw-animate-css is installed); no bouncing, no parallax. Respect `motion-reduce:` for anything that moves.

## Rules

1. One ember primary action per screen. Everything else is `outline` or `ghost`.
2. Gold means heritage and rank, never an action.
3. No flat `bg-ember/10` blocks, no `border-border`, no `rounded-md` cards, no `text-[10px]`.
4. Generous spacing: sections `gap-8 sm:gap-12`, page sections separated by `mt-12 sm:mt-16` on the landing.
5. Every price keeps its source and age (PriceChip). Points only, no cash value.
6. Must look right at 375px with no horizontal scroll.
