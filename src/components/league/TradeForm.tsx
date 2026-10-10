"use client";

import * as React from "react";
import { Loader2Icon, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { errorMessage, leagueApi, type LeagueSymbolSource, type LeagueSymbolView, type LeagueTradeSide, type LeagueView } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { priceSourceLabel, type PriceChipQuote } from "@/components/common/PriceChip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { ageSeconds, formatAge, formatUsd } from "@/components/common/format";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { LEAGUE_MIN_TRADE_USD, WEEKEND_TRADES_COPY, formatQty, formatUsdWhole, isBelowMinTrade, isPreWeek } from "@/components/league/format";
import { completedPlayTitle, type LeagueTradeResult } from "@/components/league/scout";
import { symbolSource } from "@/components/league/symbol-source";
import { SymbolLogo } from "@/components/league/SymbolLogo";
import { preIpoToken } from "@/components/prestocks/tokens";

export interface TradeFormProps {
  league: LeagueView | null;
  signedIn: boolean;
  /** Server clock (ISO) from the overview, to tell a weekend trade that counts toward next week. */
  serverNow?: string | null;
  /** Bumped by the page after every refetch so held quantities and cash stay in step. */
  refreshKey?: string;
  /** Called after a fill was accepted (the page refetches the overview and Scout progress). */
  onPlaced?: (result: LeagueTradeResult) => void;
  /**
   * Issuers to list (22 Sep): the /prestocks page passes ["prestocks"] so its form offers pre-IPO
   * tokens only. Omitted, every symbol the endpoint lists is offered, one tab per issuer.
   */
  sources?: readonly LeagueSymbolSource[];
  /** The picker's name. Default "Symbol" when more than one issuer is listed, else the issuer's noun. */
  symbolLabel?: string;
  /**
   * Print the pre-IPO compliance line while a pre-IPO token is selected (default).
   * /prestocks passes false: its page carries the line once for the whole page.
   */
  preIpoNotice?: boolean;
  /**
   * /start tour: a chip beside Max that fills in the quantity for this many dollars of virtual
   * cash on the buy side, capped at the cash left; omitted, nothing renders.
   */
  quickBuyUsd?: number;
  /**
   * The signed-out Connect. "default" is the gold primary. "secondary" is the cream solid, for a page
   * where another control carries the view's one gold action (the competition's "Your slot" row).
   */
  connectVariant?: "default" | "secondary";
  className?: string;
}

/** The issuer names, one per group, in the order the groups are shown (the tabs read the short form). */
export const SYMBOL_GROUP_LABEL: Readonly<Record<LeagueSymbolSource, string>> = Object.freeze({
  xstocks: "xStocks",
  prestocks: "Pre-IPO tokens",
});

const GROUP_TAB: Readonly<Record<LeagueSymbolSource, string>> = Object.freeze({ xstocks: "xStocks", prestocks: "Pre-IPO" });

const GROUP_ORDER: readonly LeagueSymbolSource[] = ["xstocks", "prestocks"];

/**
 * The listed symbols split by issuer, in GROUP_ORDER, empty groups dropped. Exported for tests:
 * the competition form shows an xStocks group and a Pre-IPO tokens group, the /prestocks form one group.
 */
export function groupSymbols(list: readonly LeagueSymbolView[]): { source: LeagueSymbolSource; label: string; symbols: LeagueSymbolView[] }[] {
  return GROUP_ORDER.map((source) => ({ source, label: SYMBOL_GROUP_LABEL[source], symbols: list.filter((s) => symbolSource(s) === source) })).filter(
    (g) => g.symbols.length > 0,
  );
}

const QTY_DECIMALS = 6;

function floorQty(n: number): number {
  return Math.floor(n * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
}

/** The /start tour's quick amount: `usd` of virtual cash at the buy fill, capped at the cash left. */
export function quickBuyQty(usd: number, cash: number | null, fill: number): number {
  return floorQty(Math.min(usd, cash ?? usd) / fill);
}

function parseQty(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A pre-IPO token's short name for its tile ("SpaceX" from "SpaceX PreStocks"). A token the client
 * list does not know yet (the issuer listed OURA after the static list) reads as a title-cased
 * symbol ("Oura"), so it sits among names and not as a ticker in capitals.
 */
function preIpoShortName(symbol: string): string {
  const known = preIpoToken(symbol)?.name.replace(/\s*PreStocks$/, "");
  if (known) return known;
  return symbol ? symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase() : symbol;
}

/** Pre-IPO tiles in rows of 4, or of 3 when that fills every row and 4 would not (9 tokens: 3 x 3, no orphan). */
function preIpoGridCols(count: number): string {
  return count % 3 === 0 && count % 4 !== 0 ? "grid-cols-3" : "grid-cols-4";
}

/** Keyboard focus on a tile: the solid focus hue outside the tile (the cream ring marks the pick). */
const TILE_FOCUS = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset";

/** Ruled tags beside the age ("stale", "closed"), as PriceChip draws them. */
const TAG = "self-center rounded-sm border border-rule-2 px-1 py-px font-sans text-[0.6875rem] leading-none font-semibold text-foreground";

/**
 * The paper-trade slip (the Broadcast mockup's panel): issuer tabs when two issuers are listed, a
 * picker of logo tiles (names for pre-IPO tokens), the selected quote as a big number with its
 * source and age, a Buy / Sell toggle, the quantity well with Max (and the tour's quick amount),
 * the cost at the quote +/- spread and the virtual cash left. Submits to POST /league/trade and
 * toasts any quest the trade completed ("Quest complete: First Paper Trades · +50 pts"). Every id
 * comes from useId, so two forms on one page never clash.
 */
export function TradeForm({
  league,
  signedIn,
  serverNow = null,
  refreshKey = "",
  onPlaced,
  sources,
  symbolLabel,
  preIpoNotice = true,
  quickBuyUsd,
  connectVariant = "default",
  className,
}: TradeFormProps) {
  const symbols = useApiQuery((signal) => leagueApi.symbols({ signal }), `${refreshKey}:${signedIn ? "in" : "out"}`, { refetchOnFocus: false });
  const sourceKey = sources ? sources.join(",") : "";
  const list = React.useMemo(() => {
    const all = symbols.data?.symbols ?? [];
    if (!sourceKey) return all;
    const allowed = new Set(sourceKey.split(","));
    return all.filter((s) => allowed.has(symbolSource(s)));
  }, [symbols.data, sourceKey]);
  const groups = React.useMemo(() => groupSymbols(list), [list]);
  const label = symbolLabel ?? (groups.length === 1 ? (groups[0].source === "prestocks" ? "Pre-IPO token" : "xStock") : "Symbol");

  const uid = React.useId();
  const pickerName = `${uid}-symbol`;
  const qtyId = `${uid}-qty`;
  const qtyHintId = `${uid}-qty-hint`;

  const [chosen, setSymbol] = React.useState<string>("");
  const [side, setSide] = React.useState<LeagueTradeSide>("buy");
  const [qtyText, setQtyText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  // The last pick in each issuer's tab, so switching tabs and back keeps it.
  const lastPick = React.useRef<Partial<Record<LeagueSymbolSource, string>>>({});

  // The first listed symbol until the player picks one; the pick survives refetches while it stays listed.
  const symbol = list.some((s) => s.symbol === chosen) ? chosen : (list[0]?.symbol ?? "");

  const selected: LeagueSymbolView | null = list.find((s) => s.symbol === symbol) ?? null;
  const selectedPreIpo = selected !== null && symbolSource(selected) === "prestocks";
  const activeGroup = groups.find((g) => (selected ? g.source === symbolSource(selected) : false)) ?? groups[0] ?? null;
  const spread = symbols.data?.spread ?? 0.001;
  const spreadLabel = `${(spread * 100).toFixed(1)}%`;
  const cash = symbols.data?.cashUsd ?? null;
  const open = league?.open ?? false;
  const weekend = league !== null && open && isPreWeek(league, serverNow);
  const price = selected?.quote.price ?? null;
  const fill = price !== null ? (side === "buy" ? price * (1 + spread) : price * (1 - spread)) : null;
  const qty = parseQty(qtyText);
  const cost = qty !== null && fill !== null ? qty * fill : null;
  const held = selected?.held ?? 0;

  const overCash = side === "buy" && cost !== null && cash !== null && cost > cash + 1e-6;
  const overHeld = side === "sell" && qty !== null && qty > held + 1e-9;
  const belowMin = !overHeld && isBelowMinTrade({ side, qty, cost, held });
  const canSubmit = signedIn && open && !submitting && selected !== null && fill !== null && qty !== null && !overCash && !overHeld && !belowMin;

  // What the virtual cash would be after this trade. Without an account yet it starts from the week's $10,000.
  const cashBase = cash ?? 10_000;
  const cashAfter = cost === null ? cashBase : side === "buy" ? cashBase - cost : cashBase + cost;

  const pick = (s: LeagueSymbolView) => {
    lastPick.current[symbolSource(s)] = s.symbol;
    setSymbol(s.symbol);
  };

  const pickGroup = (source: LeagueSymbolSource) => {
    const g = groups.find((x) => x.source === source);
    if (!g) return;
    const keep = lastPick.current[source];
    setSymbol(keep && g.symbols.some((s) => s.symbol === keep) ? keep : g.symbols[0].symbol);
  };

  const setMax = () => {
    if (fill === null) return;
    if (side === "buy") {
      const budget = cash ?? 10_000;
      setQtyText(String(floorQty(budget / fill)));
    } else {
      setQtyText(String(floorQty(held)));
    }
  };

  const setQuickBuy = () => {
    if (fill === null || !quickBuyUsd) return;
    setQtyText(String(quickBuyQty(quickBuyUsd, cash, fill)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selected || qty === null) return;
    setSubmitting(true);
    try {
      const r: LeagueTradeResult = await leagueApi.trade({ symbol: selected.symbol, side, qty });
      toast.success(`Paper trade filled: ${side === "buy" ? "bought" : "sold"} ${formatQty(r.trade.qty)} ${r.trade.symbol} at ${formatUsd(r.fill)}`, {
        description: `Cash ${formatUsd(r.account.cashUsd)} · Equity ${formatUsd(r.account.equityUsd)}${r.account.rank ? ` · Rank #${r.account.rank}` : ""}`,
      });
      for (const play of r.completedPlays ?? []) {
        toast.success(completedPlayTitle(play), { description: "Verified from your paper trades. Points only, no cash value." });
      }
      setQtyText("");
      symbols.refetch();
      onPlaced?.(r);
    } catch (err) {
      toast.error("Paper trade refused", { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (symbols.loading) return <TradeFormSkeleton className={className} />;

  const invalid = overCash || overHeld || belowMin;

  return (
    <form onSubmit={submit} className={cn("flex flex-col", className)} aria-label="Place a paper trade">
      {/* Two issuers: one tab each, so a pre-IPO token is never mistaken for an xStock. */}
      {groups.length > 1 ? (
        <div role="group" aria-label="Issuer" className="mb-3.5 flex gap-[22px] border-b border-rule">
          {groups.map((g) => {
            const active = activeGroup?.source === g.source;
            return (
              <button
                key={g.source}
                type="button"
                aria-pressed={active}
                onClick={() => pickGroup(g.source)}
                className={cn(
                  "relative -mb-px pb-2.5 text-[0.9375rem] leading-none font-semibold transition-colors motion-reduce:transition-none",
                  FOCUS,
                  active ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground" : "text-dim hover:text-foreground",
                )}
              >
                {GROUP_TAB[g.source]}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* A pre-IPO token on screen carries the pre-IPO line; the standard line sits in the footer of every page. */}
      {preIpoNotice && selectedPreIpo ? (
        <p data-slot="pre-ipo-compliance" className="mb-3.5 bg-background px-3 py-2.5 text-[0.78125rem] leading-[1.45] text-pretty text-muted-foreground ring-1 ring-rule ring-inset">
          {PRE_IPO_COMPLIANCE_LINE}
        </p>
      ) : null}

      <fieldset className="min-w-0" disabled={list.length === 0}>
        <legend className="sr-only">{label}</legend>
        {list.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No symbols available</p>
        ) : activeGroup?.source === "prestocks" ? (
          <div className={cn("grid gap-1", preIpoGridCols(activeGroup.symbols.length))}>
            {activeGroup.symbols.map((s) => (
              <SymbolTile key={s.assetId} s={s} name={pickerName} checked={s.symbol === symbol} onPick={pick} preIpo />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {(activeGroup?.symbols ?? []).map((s) => (
              <SymbolTile key={s.assetId} s={s} name={pickerName} checked={s.symbol === symbol} onPick={pick} />
            ))}
          </div>
        )}
      </fieldset>

      {selected ? <SelectedQuote s={selected} preIpo={selectedPreIpo} /> : null}

      <div className="mt-4 grid h-11 grid-cols-2 ring-1 ring-rule-2 ring-inset" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((value) => {
          const active = side === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setSide(value)}
              className={cn(
                "text-[0.9375rem] font-semibold transition-colors motion-reduce:transition-none",
                FOCUS,
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {value === "buy" ? "Buy" : "Sell"}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "mt-2.5 flex h-14 items-center justify-between gap-3 bg-background pr-2.5 pl-3.5 ring-1 ring-inset transition-shadow focus-within:ring-2 focus-within:ring-[var(--focus)] motion-reduce:transition-none",
          // The field's edge: the input token (3.7:1 on ink), not the decorative strong rule.
          invalid ? "ring-no" : "ring-input",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={qtyId} className="text-xs leading-none font-medium text-dim">
            Quantity
          </label>
          <input
            id={qtyId}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.5"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={qtyHintId}
            className="w-full min-w-0 [appearance:textfield] bg-transparent text-[1.375rem] leading-none font-medium text-foreground tabular-nums outline-none placeholder:text-dim [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {quickBuyUsd && side === "buy" ? (
            <button
              type="button"
              onClick={setQuickBuy}
              disabled={fill === null}
              aria-label={`Set the quantity to ${formatUsdWhole(quickBuyUsd)} of virtual cash`}
              className={cn(
                "inline-flex h-7 items-center px-2 text-[0.8125rem] font-semibold text-foreground tabular-nums ring-1 ring-rule-2 ring-inset transition-colors hover:bg-white/[0.05] disabled:opacity-50 motion-reduce:transition-none",
                FOCUS,
              )}
            >
              {formatUsdWhole(quickBuyUsd)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={setMax}
            disabled={fill === null}
            className={cn("inline-flex h-7 items-center px-1.5 text-sm font-semibold text-muted-foreground tabular-nums transition-colors hover:text-foreground disabled:opacity-50 motion-reduce:transition-none", FOCUS)}
          >
            {side === "buy" ? "Max" : `Max (${formatQty(held)})`}
          </button>
        </div>
      </div>
      <p id={qtyHintId} className="mt-2 text-[0.8125rem] leading-snug text-muted-foreground">
        Fills at the live quote {side === "buy" ? "+" : "−"} {spreadLabel} spread. Minimum trade {formatUsd(LEAGUE_MIN_TRADE_USD)}.
      </p>

      <dl className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
        <div className="flex items-baseline justify-between gap-3">
          <dt>Fill price</dt>
          <dd className="font-medium text-foreground tabular-nums">{fill !== null ? formatUsd(fill) : "No price"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>{side === "buy" ? `Cost, incl. ${spreadLabel} spread` : `Proceeds, after ${spreadLabel} spread`}</dt>
          <dd className="font-semibold text-foreground tabular-nums">{cost !== null ? formatUsd(cost) : "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>{side === "buy" ? "Virtual cash left" : "Virtual cash after"}</dt>
          <dd className="font-semibold text-foreground tabular-nums">{cashAfter >= 0 && !overCash ? formatUsd(cashAfter) : "—"}</dd>
        </div>
      </dl>
      {overCash ? <p className="mt-2 text-[0.8125rem] text-no">Exceeds your cash{cash !== null ? ` (${formatUsd(cash)})` : ""}.</p> : null}
      {overHeld ? <p className="mt-2 text-[0.8125rem] text-no">You hold {formatQty(held)} {selected?.symbol ?? ""}.</p> : null}
      {belowMin ? <p className="mt-2 text-[0.8125rem] text-no">Minimum paper trade is {formatUsd(LEAGUE_MIN_TRADE_USD)}.</p> : null}
      {selected && price === null ? <p className="mt-2 text-[0.8125rem] text-no">No price source can quote {selected.symbol} right now.</p> : null}

      {/*
        Sticky footer: inside a bottom sheet (a scroll container) the CTA stays above the fold and the
        iOS home indicator however tall the form gets. The solid bg-popover only applies inside a
        sheet; in a panel the footer is static and transparent.
      */}
      <div
        data-slot="trade-form-footer"
        className="mt-4 flex flex-col gap-2 pb-[env(safe-area-inset-bottom,0px)] in-data-[slot=sheet-content]:sticky in-data-[slot=sheet-content]:bottom-0 in-data-[slot=sheet-content]:bg-popover in-data-[slot=sheet-content]:pt-3"
      >
        {!signedIn ? (
          // The cream solid when the standings' Your slot row carries the screen's gold.
          <ConnectButton size="lg" variant={connectVariant} fullLabel className="h-12 w-full text-base" />
        ) : !open ? (
          <Button type="button" variant="outline" size="lg" disabled className="h-12 w-full">
            <Lock data-icon="inline-start" aria-hidden />
            Next week&apos;s competition opens shortly
          </Button>
        ) : (
          <Button type="submit" size="lg" disabled={!canSubmit} className="h-12 w-full text-base">
            {submitting ? <Loader2Icon className="animate-spin motion-reduce:animate-none" data-icon="inline-start" aria-hidden /> : null}
            {submitting ? "Placing" : `${side === "buy" ? "Paper buy" : "Paper sell"}${selected ? ` ${selected.symbol}` : ""}`}
          </Button>
        )}
        {weekend ? <p className="text-center text-[0.8125rem] text-muted-foreground">{WEEKEND_TRADES_COPY}.</p> : null}
        {symbols.error ? <p className="text-[0.8125rem] text-no">{symbols.error}</p> : null}
      </div>
    </form>
  );
}

/** One picker tile: a native radio (arrow keys move the pick) behind a logo and the symbol, or a name for a pre-IPO token. */
function SymbolTile({ s, name, checked, onPick, preIpo = false }: { s: LeagueSymbolView; name: string; checked: boolean; onPick: (s: LeagueSymbolView) => void; preIpo?: boolean }) {
  return (
    <label
      className={cn(
        "relative grid min-w-0 cursor-pointer text-muted-foreground transition-colors select-none hover:text-foreground has-[:checked]:text-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground has-[:checked]:ring-inset motion-reduce:transition-none",
        TILE_FOCUS,
        preIpo
          ? "place-items-center px-0.5 py-2.5 text-[0.78125rem] leading-none font-semibold font-stretch-[92%] ring-1 ring-rule ring-inset"
          : "justify-items-center gap-1.5 px-0.5 pt-2 pb-[7px] text-[0.71875rem] leading-none font-semibold font-stretch-[92%]",
      )}
    >
      <input type="radio" name={name} value={s.symbol} checked={checked} onChange={() => onPick(s)} className="sr-only" />
      {preIpo ? null : <SymbolLogo symbol={s.symbol} size={34} />}
      <span className="max-w-full truncate">{preIpo ? preIpoShortName(s.symbol) : s.symbol}</span>
      {s.held > 0 ? (
        <>
          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground" aria-hidden />
          <span className="sr-only">, you hold {formatQty(s.held)}</span>
        </>
      ) : null}
    </label>
  );
}

/** The selected symbol: its logo and name, the quote as a big number, and the quote's source and age beside it. */
function SelectedQuote({ s, preIpo }: { s: LeagueSymbolView; preIpo: boolean }) {
  const name = preIpo ? preIpoShortName(s.symbol) : s.symbol;
  const price = s.quote.price;
  const hasPrice = price !== null && price !== undefined && Number.isFinite(price);
  return (
    <div data-slot="trade-quote" className="mt-4 border-t border-rule pt-4">
      <div className="flex items-center gap-3.5">
        {/* Keyed by symbol: a fresh <img> per pick, so the last logo never lingers while the next one loads. */}
        <SymbolLogo key={s.symbol} symbol={s.symbol} preIpo={preIpo} name={name} size={40} />
        <p className="min-w-0 text-sm leading-tight text-muted-foreground">
          <span className="block truncate text-[0.9375rem] font-semibold text-foreground">{name}</span>
          {preIpo ? "pre-IPO token" : "xStock"}
          {s.held > 0 ? ` · you hold ${formatQty(s.held)}` : ""}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className={cn(
            "leading-[0.85] font-normal tracking-[-0.02em] tabular-nums font-stretch-[78%]",
            hasPrice ? "text-[2.875rem] text-foreground lg:text-[3.125rem]" : "text-[2rem] text-muted-foreground",
          )}
        >
          {hasPrice ? formatUsd(price) : "No price"}
        </span>
        <QuoteMeta quote={s.quote} symbol={s.symbol} session={!preIpo} />
      </div>
    </div>
  );
}

/**
 * The big quote's source and age ("Jupiter · 18s ago"), in mono, with PriceChip's ruled stale /
 * closed tags. Its own clock, so the age keeps moving while the payload stays the same.
 */
function QuoteMeta({ quote, symbol, session, tickMs = 15_000 }: { quote: PriceChipQuote; symbol: string; session: boolean; tickMs?: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!tickMs) return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  const age = ageSeconds(quote.publishedAt ?? null, now) ?? quote.ageSeconds ?? null;
  const hasPrice = quote.price !== null && quote.price !== undefined && Number.isFinite(quote.price);
  const stale = quote.stale === true || (!hasPrice && quote.source === "none");
  const closed = session && quote.marketOpen === false && hasPrice;
  return (
    <span
      data-slot="quote-meta"
      className="mono-meta inline-flex items-baseline gap-x-1.5"
      title={
        hasPrice
          ? `${symbol} ${formatUsd(quote.price)} from ${priceSourceLabel(quote.source)}, ${formatAge(age)}${closed ? " (US market closed)" : ""}`
          : "No price available"
      }
    >
      <span>{priceSourceLabel(quote.source)}</span>
      <span aria-hidden>·</span>
      <span>{formatAge(age)}</span>
      {stale ? <span className={TAG}>stale</span> : null}
      {closed ? <span className={TAG}>closed</span> : null}
    </span>
  );
}

export function TradeFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col", className)} aria-hidden>
      <div className="grid grid-cols-6 gap-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="grid justify-items-center gap-1.5 pt-2 pb-[7px]">
            <Skeleton className="size-[34px] rounded-full" />
            <Skeleton className="h-2.5 w-9" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3.5 border-t border-rule pt-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
      <Skeleton className="mt-3 h-10 w-40" />
      <Skeleton className="mt-4 h-11 w-full" />
      <Skeleton className="mt-2.5 h-14 w-full" />
      <Skeleton className="mt-3 h-16 w-full" />
      <Skeleton className="mt-4 h-12 w-full" />
    </div>
  );
}

export default TradeForm;
