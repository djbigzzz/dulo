"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Coins, Gamepad2, Loader2Icon, Target, Zap } from "lucide-react";
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
import { PointsChip } from "@/components/common/PointsChip";
import { formatPoints, formatUsd } from "@/components/common/format";
import { PoolBar } from "@/components/calls/PoolBar";
import {
  EARN_FIRST_POINTS_COPY,
  QUICK_STAKES,
  STAKE_LEAVES_SCORE_COPY,
  completedPlayToast,
  defaultPredictionPoints,
  formatMultiplier,
  marketQuestion,
  needsPointsForCall,
  newlyCompletedOf,
  sideForKey,
  sideLabel,
  stakeError,
} from "@/components/calls/calls-format";

export interface PlaceCallDialogProps {
  market: CallMarketView | null;
  /** The viewer's existing stakes on this market. */
  positions: CallPositionView[];
  spendablePoints: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the server response after a successful placement. */
  onPlaced: (result: PlaceCallResponse) => void;
  /** Side preselected when the dialog opens (the card button that was pressed). */
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

const WELL = "rounded-xl border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";
const LIFTED = "shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_1px_2px_rgb(0_0_0/0.35)]";
const ICON_TILE =
  "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";
const ROW_LINK =
  "group/row flex min-h-14 items-center gap-3 px-4 py-3 text-sm outline-none transition-colors duration-200 hover:bg-white/[0.03] focus-visible:bg-white/[0.05]";

/**
 * Prediction form: Yes/No radio group (roving tabindex, arrow keys), points with quick chips, a live
 * points-back preview against the current pools, the points balance and the loss line. It opens on
 * 100 points (10 when the balance is 10 to 99), never the whole balance. Below the 10-point minimum it
 * shows the way to more points instead (First Paper Trades in the competition, or a quest). A Dialog
 * on desktop, a bottom Sheet on phones. A placement re-reads the session so the header balance moves.
 */
export function PlaceCallDialog({ market, positions, spendablePoints, open, onOpenChange, onPlaced, initialSide }: PlaceCallDialogProps) {
  const isMobile = useIsMobile();
  const { refresh: refreshSession } = useSession();
  const [side, setSide] = React.useState<CallSide>("yes");
  const [raw, setRaw] = React.useState("100");
  const [submitting, setSubmitting] = React.useState(false);
  const pointsId = React.useId();
  const hintId = React.useId();
  const radios = React.useRef<Record<CallSide, HTMLButtonElement | null>>({ yes: null, no: null });

  // Reset the form only when a market is opened (or the preselected side changes). Positions and
  // the balance are read through a ref: the page polls and ticks every second, and re-running
  // the reset on every new array would wipe the stake while the user is typing.
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
    <div className="flex flex-col gap-4">
      <div className={cn(WELL, "flex items-start gap-3 p-4")}>
        <span className={ICON_TILE} aria-hidden>
          <Coins className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold tracking-tight">A prediction needs at least {MIN_CALL_POINTS} points.</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You have <span className="font-medium tabular-nums text-foreground">{formatPoints(spendablePoints)}</span> points. Points only,
            no cash value.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <li>
          <Link href="/competition" onClick={close} className={ROW_LINK}>
            <Gamepad2 className="size-4 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1 font-medium">{EARN_FIRST_POINTS_COPY}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href="/quests" onClick={close} className={ROW_LINK}>
            <Zap className="size-4 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1">Or complete a quest with points and virtual cash</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">{STAKE_LEAVES_SCORE_COPY}</p>
    </div>
  );

  const form = market ? (
    <div className="flex flex-col gap-5">
      <div className={cn(WELL, "grid grid-cols-2 gap-1 p-1")} role="radiogroup" aria-label="Side">
        {(["yes", "no"] as const).map((s) => {
          const active = side === s;
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
                "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-semibold transition-all duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? cn(LIFTED, s === "yes" ? "border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-300" : "border-rose-400/40 bg-rose-400/[0.12] text-rose-300")
                  : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              <span>{sideLabel(s)}</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {formatMultiplier(s === "yes" ? market.odds.yesMultiplier : market.odds.noMultiplier)} now
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5">
        <label htmlFor={pointsId} className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium tracking-[0.14em] text-muted-foreground uppercase">Points to put in</span>
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
            aria-describedby={hintId}
            className="h-12 rounded-xl border-white/[0.06] bg-black/25 pr-12 pl-3.5 text-lg font-semibold tracking-tight tabular-nums shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] [appearance:textfield] md:text-lg dark:bg-black/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                className={cn("h-8 min-w-14 rounded-full px-3.5 text-xs tabular-nums", active && "border-white/25 bg-white/[0.09]")}
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
            className="h-8 min-w-14 rounded-full px-3.5 text-xs"
            disabled={spendablePoints < MIN_CALL_POINTS}
            onClick={() => setRaw(String(Math.min(spendablePoints, MAX_CALL_POINTS)))}
          >
            Max
          </Button>
        </div>
        <p id={hintId} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? `${MIN_CALL_POINTS}–${formatPoints(MAX_CALL_POINTS)} pts, whole numbers. Locked in until settlement.`}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-black/20 bg-[radial-gradient(90%_120%_at_100%_0%,rgb(255_106_42/0.12),transparent_60%)] p-4 text-sm shadow-[inset_0_1px_0_rgb(255_245_230/0.05)]">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">If {sideLabel(side)} is right, points back</span>
            <span className="text-muted-foreground">
              Net{" "}
              <span className="font-medium tabular-nums text-foreground">
                {preview === null || points === null ? "—" : `+${formatPoints(preview - points)} pts`}
              </span>
            </span>
          </div>
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className={cn("text-3xl leading-none font-semibold tracking-tight tabular-nums", preview === null ? "text-muted-foreground" : "text-gradient-ember")}>
              {preview === null ? "—" : formatPoints(preview)}
            </span>
            {preview === null ? null : <span className="text-sm text-muted-foreground">pts</span>}
          </span>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
        <PoolBar odds={previewOdds} highlight={side} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pools move until the lock, so your points back are set at settlement. {STAKE_LEAVES_SCORE_COPY}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{PREDICTION_LOSS_COPY}</p>
        {otherHeld ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            You already have {formatPoints(otherHeld.points)} pts on {sideLabel(otherHeld.side)}; both of your positions stay in.
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  const body = market ? (short ? earnFirst : form) : null;

  const title = market ? marketQuestion(market) : "Make a prediction";
  const description = market ? (
    <>
      Strike <span className="font-medium text-gold tabular-nums">{formatUsd(market.strike)}</span> · {formatPoints(market.odds.total)} pts in the pool. Points only, no cash value.
    </>
  ) : null;
  const submitButton = short ? null : (
    <Button size="lg" onClick={() => void submit()} disabled={!canSubmit} className="h-11 w-full rounded-xl px-4 sm:w-auto">
      {submitting ? <Loader2Icon className="animate-spin" data-icon="inline-start" aria-hidden /> : <Target data-icon="inline-start" aria-hidden />}
      {points ? `Predict ${sideLabel(side)} for ${formatPoints(points)} pts` : `Predict ${sideLabel(side)}`}
    </Button>
  );

  // The popups are `position: fixed` and `.border-gradient` sets `position: relative`, so the
  // gradient hairline lives on an inner panel while the popup itself stays transparent.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto border-0 bg-transparent shadow-none">
          <div className="border-gradient flex flex-col rounded-t-3xl bg-popover shadow-[0_-24px_64px_rgb(0_0_0/0.55)]">
            <SheetHeader className="gap-1.5 p-5 pr-14">
              <SheetTitle className="text-lg leading-snug font-semibold tracking-tight">{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
              {market ? (
                <div className="mt-1">
                  <PointsChip points={spendablePoints} />
                </div>
              ) : null}
            </SheetHeader>
            <div className={cn("px-5", submitButton ? "pb-2" : "pb-[max(1.25rem,env(safe-area-inset-bottom))]")}>{body}</div>
            {submitButton ? <SheetFooter className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{submitButton}</SheetFooter> : null}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 bg-transparent p-0 ring-0 sm:max-w-md">
        <div className="border-gradient grid gap-5 rounded-2xl bg-popover p-6 shadow-[0_32px_80px_-12px_rgb(0_0_0/0.7)]">
          <DialogHeader className="gap-2 pr-8">
            <DialogTitle className="text-lg leading-snug font-semibold tracking-tight">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {body}
          {submitButton ? (
            <DialogFooter className="-mx-6 -mb-6 rounded-b-2xl border-white/[0.06] bg-white/[0.02] px-6 py-4">{submitButton}</DialogFooter>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlaceCallDialog;
