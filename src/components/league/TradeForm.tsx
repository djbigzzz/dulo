"use client";

import * as React from "react";
import { ChevronDown, Loader2Icon, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { errorMessage, leagueApi, type LeagueSymbolSource, type LeagueSymbolView, type LeagueTradeSide, type LeagueView } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { PriceChip } from "@/components/common/PriceChip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatUsd } from "@/components/common/format";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { LEAGUE_MIN_TRADE_USD, WEEKEND_TRADES_COPY, formatQty, isBelowMinTrade, isPreWeek } from "@/components/league/format";
import { completedPlayTitle, type LeagueTradeResult } from "@/components/league/scout";
import { symbolSource } from "@/components/league/symbol-source";

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
   * tokens only. Omitted, every symbol the endpoint lists is offered, grouped by issuer.
   */
  sources?: readonly LeagueSymbolSource[];
  /** The label over the select. Default "Symbol" when more than one issuer is listed, else the issuer's noun. */
  symbolLabel?: string;
  /**
   * Print the pre-IPO compliance line under the button while a pre-IPO token is selected (default).
   * /prestocks passes false: its page header carries the line once for the whole page.
   */
  preIpoNotice?: boolean;
  className?: string;
}

/** The select's group headings, one per issuer, in the order the groups are shown. */
export const SYMBOL_GROUP_LABEL: Readonly<Record<LeagueSymbolSource, string>> = Object.freeze({
  xstocks: "xStocks",
  prestocks: "Pre-IPO tokens",
});

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

function parseQty(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Inset well shared by the select, the side track, the quantity input and the summary (DESIGN.md). */
const WELL = "rounded-xl border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";

const selectClass = cn(
  WELL,
  "h-11 w-full min-w-0 appearance-none pr-9 pl-3 text-sm font-semibold outline-none transition-colors hover:border-white/[0.1] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground",
);

const LABEL = "text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase";

/**
 * Symbol select (fixed list + held symbols), Buy/Sell toggle, quantity, estimated cost at the
 * quote +/- spread and the price chip (source / age / stale). Submits to POST /league/trade and
 * toasts any Play the trade completed ("Quest complete: First Paper Trades · +50 pts"). The page can render two of these
 * (desktop panel + mobile sheet), so every id comes from useId.
 */
export function TradeForm({ league, signedIn, serverNow = null, refreshKey = "", onPlaced, sources, symbolLabel, preIpoNotice = true, className }: TradeFormProps) {
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
  const symbolId = `${uid}-symbol`;
  const qtyId = `${uid}-qty`;
  const qtyHintId = `${uid}-qty-hint`;

  const [chosen, setSymbol] = React.useState<string>("");
  const [side, setSide] = React.useState<LeagueTradeSide>("buy");
  const [qtyText, setQtyText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // The first listed symbol until the player picks one; the pick survives refetches while it stays listed.
  const symbol = list.some((s) => s.symbol === chosen) ? chosen : (list[0]?.symbol ?? "");

  const selected: LeagueSymbolView | null = list.find((s) => s.symbol === symbol) ?? null;
  const selectedPreIpo = selected !== null && symbolSource(selected) === "prestocks";
  const spread = symbols.data?.spread ?? 0.001;
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

  const setMax = () => {
    if (fill === null) return;
    if (side === "buy") {
      const budget = cash ?? 10_000;
      setQtyText(String(floorQty(budget / fill)));
    } else {
      setQtyText(String(floorQty(held)));
    }
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

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-4", className)} aria-label="Place a paper trade">
      <div className="flex flex-col gap-2">
        <label htmlFor={symbolId} className={LABEL}>
          {label}
        </label>
        <div className="relative">
          <select id={symbolId} className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={list.length === 0}>
            {list.length === 0 ? <option value="">No symbols available</option> : null}
            {/* One issuer: a flat list. Two: an optgroup per issuer, so a pre-IPO token is never mistaken for an xStock. */}
            {groups.length === 1
              ? groups[0].symbols.map((s) => <SymbolOption key={s.assetId} s={s} />)
              : groups.map((g) => (
                  <optgroup key={g.source} label={g.label}>
                    {g.symbols.map((s) => (
                      <SymbolOption key={s.assetId} s={s} />
                    ))}
                  </optgroup>
                ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
        {selected ? <PriceChip quote={selected.quote} className="self-start" session={!selectedPreIpo} /> : null}
      </div>

      <div className={cn(WELL, "grid grid-cols-2 gap-1 p-1")} role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((value) => {
          const active = side === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setSide(value)}
              className={cn(
                "h-9 rounded-[10px] border text-sm font-semibold transition-all duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? value === "buy"
                    ? "border-emerald-400/25 bg-emerald-400/[0.14] text-emerald-300 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_4px_14px_-6px_rgb(52_211_153/0.45)]"
                    : "border-rose-400/25 bg-rose-400/[0.14] text-rose-300 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_4px_14px_-6px_rgb(251_113_133/0.45)]"
                  : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {value === "buy" ? "Buy" : "Sell"}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={qtyId} className={LABEL}>
            Quantity
          </label>
          <button type="button" onClick={setMax} disabled={fill === null} className="inline-flex h-6 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs font-medium text-muted-foreground tabular-nums transition-colors hover:border-white/15 hover:text-foreground disabled:opacity-50">
            {side === "buy" ? `Max${cash !== null ? ` (${formatUsd(cash)})` : ""}` : `Max (${formatQty(held)})`}
          </button>
        </div>
        <Input
          id={qtyId}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          placeholder="0.5"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value)}
          aria-invalid={overCash || overHeld || belowMin ? true : undefined}
          aria-describedby={qtyHintId}
          className={cn(WELL, "h-11 px-3 text-base font-semibold tabular-nums md:text-base dark:bg-black/25")}
        />
        <p id={qtyHintId} className="text-xs text-muted-foreground">
          Fills at the live quote {side === "buy" ? "+" : "−"} {(spread * 100).toFixed(1)}% spread. Minimum trade {formatUsd(LEAGUE_MIN_TRADE_USD)}.
        </p>
      </div>

      <div className={cn(WELL, "flex flex-col px-3.5 text-sm")}>
        <div className="flex items-center justify-between gap-2 py-2.5 text-muted-foreground">
          <span>Fill price</span>
          <span className="font-medium text-foreground/85 tabular-nums">{fill !== null ? formatUsd(fill) : "No price"}</span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] py-3">
          <span className="font-medium">{side === "buy" ? "Est. cost" : "Est. proceeds"}</span>
          <span className="text-lg font-semibold tracking-tight tabular-nums">{cost !== null ? formatUsd(cost) : "—"}</span>
        </div>
        {overCash ? <p className="-mt-1 pb-2.5 text-xs text-rose-400">Exceeds your cash{cash !== null ? ` (${formatUsd(cash)})` : ""}.</p> : null}
        {overHeld ? <p className="-mt-1 pb-2.5 text-xs text-rose-400">You hold {formatQty(held)} {selected?.symbol ?? ""}.</p> : null}
        {belowMin ? <p className="-mt-1 pb-2.5 text-xs text-rose-400">Minimum paper trade is {formatUsd(LEAGUE_MIN_TRADE_USD)}.</p> : null}
        {selected && price === null ? <p className="-mt-1 pb-2.5 text-xs text-rose-400">No price source can quote {selected.symbol} right now.</p> : null}
      </div>

      {/*
        Sticky footer: inside the mobile bottom sheet (a scroll container) the CTA stays above the
        fold and the iOS home indicator however tall the form gets. The solid bg-popover only
        applies inside the sheet; in the desktop panel the footer is static and transparent.
      */}
      <div data-slot="trade-form-footer" className="flex flex-col gap-2 pt-1 pb-[env(safe-area-inset-bottom,0px)] in-data-[slot=sheet-content]:sticky in-data-[slot=sheet-content]:bottom-0 in-data-[slot=sheet-content]:bg-popover in-data-[slot=sheet-content]:pt-3">
        {!signedIn ? (
          <ConnectButton size="lg" className="h-11 w-full rounded-xl" />
        ) : !open ? (
          <Button type="button" variant="outline" size="lg" disabled className="h-11 w-full rounded-xl">
            <Lock data-icon="inline-start" aria-hidden />
            Next week&apos;s competition opens shortly
          </Button>
        ) : (
          <Button type="submit" size="lg" disabled={!canSubmit} className="h-11 w-full rounded-xl text-base font-semibold">
            {submitting ? <Loader2Icon className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {submitting ? "Placing" : `${side === "buy" ? "Paper buy" : "Paper sell"}${selected ? ` ${selected.symbol}` : ""}`}
          </Button>
        )}
        {weekend ? <p className="text-center text-xs text-muted-foreground">{WEEKEND_TRADES_COPY}.</p> : null}
        {symbols.error ? <p className="text-xs text-rose-400">{symbols.error}</p> : null}
        {/* A pre-IPO token on screen carries the pre-IPO line; the standard line sits in the footer of every page. */}
        {preIpoNotice && selectedPreIpo ? (
          <p data-slot="pre-ipo-compliance" className="text-xs leading-relaxed text-pretty text-muted-foreground">
            {PRE_IPO_COMPLIANCE_LINE}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SymbolOption({ s }: { s: LeagueSymbolView }) {
  return (
    <option value={s.symbol}>
      {s.symbol}
      {s.held > 0 ? ` · held ${formatQty(s.held)}` : ""}
    </option>
  );
}

export function TradeFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4", className)} aria-hidden>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-6 w-40 rounded-full" />
      </div>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  );
}

export default TradeForm;
