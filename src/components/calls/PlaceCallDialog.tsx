"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { api, errorMessage, type CallMarketView, type CallPositionView, type CallSide, type PlaceCallResponse } from "@/lib/api-client";
import { MAX_CALL_POINTS, MIN_CALL_POINTS } from "@/lib/games/calls-limits";
import { odds as computeOdds, potentialPayout } from "@/lib/games/parimutuel";
import { PREDICTION_LOSS_COPY } from "@/lib/games/ledger-policy";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PriceChip } from "@/components/common/PriceChip";
import { formatPoints, formatUsd } from "@/components/common/format";
import { PoolBar } from "@/components/calls/PoolBar";
import { XStockLogo } from "@/components/common/XStockLogo";
import {
  EARN_FIRST_POINTS_COPY,
  QUICK_STAKES,
  STAKE_LEAVES_SCORE_COPY,
  backPerPoint,
  completedPlayToast,
  defaultPredictionPoints,
  formatSettleDay,
  gapLabel,
  needsPointsForCall,
  newlyCompletedOf,
  sideForKey,
  sideLabel,
  stakeError,
  trackPosition,
  utcStamp,
} from "@/components/calls/calls-format";

export interface PlaceCallDialogProps {
  market: CallMarketView | null;
  /** The viewer's existing points on this market. */
  positions: CallPositionView[];
  spendablePoints: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the server response after a successful placement. */
  onPlaced: (result: PlaceCallResponse) => void;
  /** Side preselected when the dialog opens (the segment button that was pressed). */
  initialSide?: CallSide;
}

/** True below the `sm` breakpoint (640px). SSR-safe: false until mounted. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** Each side in its own colour, on a rule; the chosen one filled with its tint. */
const SIDE: Record<CallSide, { on: string; word: string; hint: string }> = {
  yes: { on: "border-yes bg-[rgb(58_208_138/0.13)]", word: "text-yes", hint: "closes above" },
  no: { on: "border-no bg-[rgb(255_93_108/0.13)]", word: "text-no", hint: "closes below" },
};

const ROW_LINK =
  "group/row flex min-h-14 items-center gap-3 border-b border-rule text-[0.9375rem] outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none";

/**
 * Prediction form: Yes/No radio group (roving tabindex, arrow keys), points with quick chips, and
 * the points back for those points at the current split, shown before confirming, with the
 * points balance and the loss line. It opens on 100 points (10 when the balance is 10 to 99), never
 * the whole balance. Below the 10-point minimum it shows the way to more points instead (First
 * Paper Trades in the competition, or a quest). A Dialog on desktop, a bottom Sheet on phones. A
 * placement re-reads the session so the header balance moves.
 */
export function PlaceCallDialog({ market, positions, spendablePoints, open, onOpenChange, onPlaced, initialSide }: PlaceCallDialogProps) {
  const isMobile = useIsMobile();
  const { refresh: refreshSession } = useSession();
  const [side, setSide] = React.useState<CallSide>("yes");
  const [raw, setRaw] = React.useState("100");
  const [submitting, setSubmitting] = React.useState(false);
  const pointsId = React.useId();
  const hintId = React.useId();
  const backId = React.useId();
  const radios = React.useRef<Record<CallSide, HTMLButtonElement | null>>({ yes: null, no: null });

  // Reset the form only when a market is opened (or the preselected side changes). Positions and
  // the balance are read through a ref: the page polls and ticks every second, and re-running
  // the reset on every new array would wipe the amount while the user is typing.
  const latest = React.useRef({ positions, spendablePoints });
  React.useEffect(() => {
    latest.current = { positions, spendablePoints };
  });
  React.useEffect(() => {
    if (!open) return;
    const { positions: held, spendablePoints: spendable } = latest.current;
    setSide(initialSide ?? (held.length === 1 ? held[0].side : "yes"));
    // 100 by default, the minimum when the balance is below 100: never the whole balance.
    setRaw(defaultPredictionPoints(spendable, MIN_CALL_POINTS));
    setSubmitting(false);
  }, [open, market?.id, initialSide]);

  const short = needsPointsForCall(spendablePoints, MIN_CALL_POINTS);
  const { points, error } = stakeError(raw, spendablePoints, { min: MIN_CALL_POINTS, max: MAX_CALL_POINTS });
  const yesPool = market?.yesPool ?? 0;
  const noPool = market?.noPool ?? 0;
  const preview = points ? potentialPayout(points, side, yesPool, noPool) : null;
  const previewOdds = computeOdds(yesPool + (side === "yes" ? points ?? 0 : 0), noPool + (side === "no" ? points ?? 0 : 0));
  const otherHeld = positions.find((p) => p.side !== side) ?? null;
  const canSubmit = Boolean(market) && !short && points !== null && !submitting;

  const submit = React.useCallback(async () => {
    if (!market || points === null || submitting) return;
    setSubmitting(true);
    try {
      const result = await api.placeCall({ marketId: market.id, side, points });
      toast.success(`Predicted ${sideLabel(side)} for ${formatPoints(points)} pts`, {
        description: `${market.ticker} above ${formatUsd(market.strike)} · ${formatPoints(result.position.potentialPayout)} pts back if ${sideLabel(side)}.`,
      });
      // Oracle (first Call) is evaluated inline by the server and lands in this response.
      for (const play of newlyCompletedOf(result)) {
        const copy = completedPlayToast(play);
        toast.success(copy.title, { description: copy.description });
      }
      onPlaced(result);
      onOpenChange(false);
      // The header chip and account menu read the balance from /auth/me.
      void refreshSession();
    } catch (e) {
      toast.error("Couldn't make that prediction", { description: errorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }, [market, onOpenChange, onPlaced, points, refreshSession, side, submitting]);

  const onRadioKeyDown = React.useCallback((current: CallSide, e: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = sideForKey(current, e.key);
    if (!next) return;
    e.preventDefault();
    setSide(next);
    radios.current[next]?.focus();
  }, []);

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  const earnFirst = (
    <div className="flex flex-col gap-5">
      <div className="border-t border-rule pt-5">
        <p className="font-display text-[1.625rem] leading-[1.05]">A prediction needs at least {MIN_CALL_POINTS} points.</p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          You have <span className="font-semibold tabular-nums text-foreground">{formatPoints(spendablePoints)}</span> points. Points only,
          no cash value.
        </p>
      </div>
      <ul className="border-t border-rule">
        <li>
          <Link href="/competition" onClick={close} className={cn(ROW_LINK, "font-semibold text-foreground")}>
            <span className="min-w-0 flex-1">{EARN_FIRST_POINTS_COPY}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href="/quests" onClick={close} className={cn(ROW_LINK, "text-muted-foreground")}>
            <span className="min-w-0 flex-1">Or complete a quest with points and virtual cash</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        </li>
      </ul>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{STAKE_LEAVES_SCORE_COPY}</p>
    </div>
  );

  const form = market ? (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
        {(["yes", "no"] as const).map((s) => {
          const active = side === s;
          const mult = s === "yes" ? market.odds.yesMultiplier : market.odds.noMultiplier;
          return (
            <button
              key={s}
              ref={(el) => {
                radios.current[s] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setSide(s)}
              onKeyDown={(e) => onRadioKeyDown(s, e)}
              className={cn(
                "flex min-h-[4.75rem] flex-col items-start justify-center gap-1 border px-4 py-3 text-left transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none",
                active ? SIDE[s].on : "border-rule-2 bg-ink-2 hover:border-[rgb(243_240_232/0.3)] hover:bg-ink-4",
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-lg leading-none font-semibold", active ? SIDE[s].word : "text-foreground")}>
                {active ? <Check className="size-4" aria-hidden /> : null}
                {sideLabel(s)}
                <span className="text-[0.8125rem] font-normal text-muted-foreground">{SIDE[s].hint}</span>
              </span>
              <span className="text-[0.8125rem] leading-snug text-muted-foreground tabular-nums">{backPerPoint(mult)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5">
        <label htmlFor={pointsId} className="flex items-baseline justify-between gap-2 text-[0.875rem]">
          <span className="font-semibold text-foreground">Points to put in</span>
          <span className="text-muted-foreground">
            Balance <span className="font-semibold tabular-nums text-foreground">{formatPoints(spendablePoints)}</span> pts
          </span>
        </label>
        <div className="relative">
          <Input
            id={pointsId}
            type="number"
            inputMode="numeric"
            min={MIN_CALL_POINTS}
            max={MAX_CALL_POINTS}
            step={1}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) void submit();
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${hintId} ${backId}`}
            className="h-12 border-rule-2 bg-ink pr-12 pl-3.5 text-xl font-semibold tabular-nums font-stretch-[85%] [appearance:textfield] focus-visible:ring-offset-popover md:text-xl [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
            pts
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_STAKES.map((q) => {
            const active = raw === String(q);
            return (
              <Button
                key={q}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={active}
                className={cn("min-w-14 tabular-nums focus-visible:ring-offset-popover", active && "border-paper bg-ink-4")}
                disabled={q > spendablePoints}
                onClick={() => setRaw(String(q))}
              >
                {q}
              </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-w-14 focus-visible:ring-offset-popover"
            disabled={spendablePoints < MIN_CALL_POINTS}
            onClick={() => setRaw(String(Math.min(spendablePoints, MAX_CALL_POINTS)))}
          >
            Max
          </Button>
        </div>
        <p id={hintId} className={cn("text-[0.8125rem]", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? `${MIN_CALL_POINTS}–${formatPoints(MAX_CALL_POINTS)} pts, whole numbers. Locked in until settlement.`}
        </p>
      </div>

      {/* The points back, before confirming: the loudest number in the form. */}
      <div className="flex flex-col gap-4 border-t border-rule pt-5">
        <div id={backId} className="flex items-end justify-between gap-4" aria-live="polite">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[0.9375rem] font-semibold text-foreground">If {sideLabel(side)} is right</span>
            <span className="text-[0.875rem] text-muted-foreground">
              Net{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {preview === null || points === null ? "—" : `+${formatPoints(preview - points)} pts`}
              </span>
            </span>
          </div>
          <span className="flex items-baseline gap-2 whitespace-nowrap">
            <span className={cn("figure text-[3.5rem] leading-[0.8]", preview === null ? "text-muted-foreground" : "text-foreground")}>
              {preview === null ? "—" : formatPoints(preview)}
            </span>
            <span className="text-[0.875rem] text-muted-foreground">points back</span>
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[0.8125rem] text-muted-foreground">The split with your points in</p>
          <PoolBar odds={previewOdds} highlight={side} />
        </div>
        <div className="flex flex-col gap-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
          <p>Points only, no cash value. Pools move until the lock, so your points back are set at settlement. {STAKE_LEAVES_SCORE_COPY}</p>
          <p>{PREDICTION_LOSS_COPY}</p>
          {otherHeld ? (
            <p>
              You already have {formatPoints(otherHeld.points)} pts on {sideLabel(otherHeld.side)}; both of your positions stay in.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  const body = market ? (short ? earnFirst : form) : null;

  // The question in the serif; the line and the day never split across a break.
  const title = market ? (
    <>
      Will {market.ticker} close above{" "}
      <span className="whitespace-nowrap">
        {formatUsd(market.strike)} on {formatSettleDay(market.settleAt)}?
      </span>
    </>
  ) : (
    "Make a prediction"
  );
  const pos = market ? trackPosition(market.quote?.price ?? null, market.strike) : null;
  // The trust lines: the live price with its source and age and where it stands against the line,
  // then the lock time. The pool is in the split below, so it is said once.
  const description = market ? (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        {market.quote ? <PriceChip quote={market.quote} symbol={market.symbol} /> : <span>No live price right now</span>}
        {pos ? (
          <span className="text-[0.84375rem] font-semibold whitespace-nowrap text-foreground">
            {gapLabel(pos.gap)}
            {Math.abs(pos.gap) >= 0.005 ? " the line" : ""}
          </span>
        ) : null}
      </span>
      <span className="mono-meta">
        <time dateTime={market.locksAt}>Locks {utcStamp(market.locksAt)}</time>
      </span>
    </span>
  ) : null;
  const kicker = market ? (
    <p className="flex items-center gap-2.5 text-[0.875rem] font-medium text-muted-foreground">
      <XStockLogo symbol={market.symbol} ticker={market.ticker} size={22} className="size-[22px]" />
      <b className="font-semibold text-foreground">{market.symbol}</b>
      <span aria-hidden className="h-3.5 w-px bg-rule-2" />
      Make a prediction
    </p>
  ) : null;
  const submitButton = short ? null : (
    <Button size="lg" onClick={() => void submit()} disabled={!canSubmit} className="h-12 w-full px-5 text-base">
      {submitting ? <Loader2Icon className="animate-spin motion-reduce:animate-none" data-icon="inline-start" aria-hidden /> : null}
      {points ? `Predict ${sideLabel(side)} for ${formatPoints(points)} pts` : `Predict ${sideLabel(side)}`}
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto">
          <SheetHeader className="gap-2.5 px-4 pt-5 pb-5 pr-14">
            {kicker}
            <SheetTitle className="text-[1.875rem] leading-[0.98] tracking-[-0.012em]">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className={cn("px-4", submitButton ? "pb-5" : "pb-[max(1.25rem,env(safe-area-inset-bottom))]")}>{body}</div>
          {/* Pinned to the bottom of the scrolling sheet, so the one action is on screen on a 667px phone too. */}
          {submitButton ? (
            <SheetFooter className="sticky bottom-0 z-10 border-t border-rule bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{submitButton}</SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[31rem]">
        <DialogHeader className="gap-3 px-6 pt-6 pr-14 pb-5">
          {kicker}
          <DialogTitle className="text-[2.125rem] leading-[0.98] tracking-[-0.012em]">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">{body}</div>
        {submitButton ? <DialogFooter className="sticky bottom-0 mx-0 mb-0 px-6 py-4">{submitButton}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export default PlaceCallDialog;
