"use client";

import * as React from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ApiClientError, errorMessage, mirrorApi, type MirrorTargetView } from "@/lib/api-client";
import { DEFAULT_BUDGET_USD, USDC_MINT, jupiterSwapUrl, mintOfAssetId, mirrorPlan } from "@/lib/mirror/allocation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIRROR_COMPLIANCE_LINE, formatUsdc, formatWeight, parseBudget, toleranceCopy } from "@/components/mirror/mirror-format";

export interface MirrorPlanCardProps {
  target: MirrorTargetView;
  signedIn: boolean;
  /** Any leg quote stale: label the amounts as estimates. */
  stale: boolean;
  /** mirror_match tolerance (fraction). */
  tolerance: number;
  /** Input mint for the Jupiter links (USDC). */
  usdcMint?: string;
  /** Called after the intent was recorded (the page refetches so `signedIn` / status stay honest). */
  onRecorded?: () => void;
  className?: string;
}

const QUICK_AMOUNTS = [50, 100, 250] as const;

/** A copy is built from the wallet's xStocks only (lib/mirror/allocation COPY_ASSET_SOURCE); pre-IPO tokens are left out. */
export const COPY_SCOPE_NOTE = "Pre-IPO tokens are not part of a copy: the plan covers this wallet's xStocks only.";


function Step({ n, title, description, children, done = false, last = false }: { n: number; title: string; description?: React.ReactNode; children: React.ReactNode; done?: boolean; last?: boolean }) {
  return (
    <li className={cn("relative flex gap-4 border-t border-rule pt-5", !last && "pb-6")}>
      {/* The step as a scoreboard numeral; a cream check once it is done. */}
      <span className={cn("figure w-6 shrink-0 text-[2rem] leading-[0.8]", done ? "text-foreground" : "text-muted-foreground")} aria-hidden>
        {done ? <CheckCircle2 className="mt-0.5 size-5" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[1.0625rem] leading-tight font-semibold">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h3>
          {description ? <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * Three steps to copy a target: choose a USDC amount, open one prefilled Jupiter swap per
 * stock (the user signs in Jupiter), then record "I've done my swaps" so the next snapshot
 * checks the wallet. Nothing here signs or sends a transaction.
 */
export function MirrorPlanCard({ target, signedIn, stale, tolerance, usdcMint = USDC_MINT, onRecorded, className }: MirrorPlanCardProps) {
  const [raw, setRaw] = React.useState(String(DEFAULT_BUDGET_USD));
  const [recording, setRecording] = React.useState(false);
  const [recordedAt, setRecordedAt] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(() => new Set());

  const budget = parseBudget(raw);
  const plan = React.useMemo(() => mirrorPlan({ target, budgetUsd: budget ?? 0 }), [target, budget]);
  const canVerify = signedIn && !recording && plan.legs.length > 0 && budget !== null;

  const record = async () => {
    if (!canVerify || budget === null) return;
    setRecording(true);
    try {
      const r = await mirrorApi.record({
        targetWallet: target.address,
        budgetUsd: budget,
      });
      setRecordedAt(r.recordedAt);
      toast.success("Got it. We're checking your wallet now.", {
        description: r.status === "complete" ? "Your wallet already matched a copied portfolio; this refreshes the check." : `${toleranceCopy(tolerance)} for the next snapshot to count it as a match.`,
      });
      onRecorded?.();
    } catch (e) {
      if (e instanceof ApiClientError && e.isUnauthorized) {
        toast.error("Sign in first", {
          description: "We need to know which wallet to check.",
        });
      } else {
        toast.error("Couldn't save your portfolio copy", {
          description: errorMessage(e),
        });
      }
    } finally {
      setRecording(false);
    }
  };

  return (
    <section className={cn("border border-rule bg-card p-5 sm:p-7", className)} aria-labelledby="mirror-plan">
      <div className="flex flex-col gap-2 pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="mirror-plan" className="font-display text-[2rem] leading-none font-normal tracking-[-0.012em] sm:text-[2.25rem]">
            Copy this portfolio
          </h2>
          <span className="shrink-0 text-[0.84375rem] text-muted-foreground">Your own wallet</span>
        </div>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">Dulo never touches your funds. Every swap happens in Jupiter, signed by you.</p>
      </div>
      <div>
        <ol className="flex flex-col">
          <Step
            n={1}
            title="Choose an amount"
            description={budget === null ? "Enter a positive USDC amount." : `${formatUsdc(plan.allocatedUsd)} split across ${plan.legs.length} ${plan.legs.length === 1 ? "stock" : "stocks"}.`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative w-full min-w-0 sm:flex-1">
                <span className="sr-only">Amount in USDC</span>
                <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden>
                  $
                </span>
                <Input inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={budget === null} className="h-11 pl-7 text-base font-semibold tabular-nums md:text-base" />
              </label>
              <div className="grid shrink-0 grid-cols-3 gap-1 sm:flex">
                {QUICK_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    type="button"
                    variant="outline"
                    size="lg"
                    className={cn(
                      "h-11 min-w-14 px-3 font-semibold tabular-nums",
                      budget === amount ? "border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={budget === amount}
                    onClick={() => setRaw(String(amount))}
                  >
                    ${amount}
                  </Button>
                ))}
              </div>
            </div>
          </Step>

          <Step
            n={2}
            title="Swap each stock in Jupiter"
            description={
              stale ? "Prices are stale, so these amounts are estimates. Jupiter shows the live quote before you sign." : "Each button opens Jupiter in a new tab with USDC and the amount filled in."
            }
            done={plan.legs.length > 0 && plan.legs.every((l) => opened.has(l.assetId))}
          >
            {plan.legs.length === 0 ? (
              <p className="border border-dashed border-[rgb(243_240_232/0.3)] px-3 py-4 text-center text-[0.9375rem] text-muted-foreground">
                {target.legs.length === 0 ? "This wallet holds nothing worth $1 or more right now." : "Raise the amount: every swap would be under $1."}
              </p>
            ) : (
              <ul className="border-b border-rule">
                {plan.legs.map((leg) => {
                  const mint = mintOfAssetId(leg.assetId);
                  const href = mint
                    ? jupiterSwapUrl({
                        inputMint: usdcMint,
                        outputMint: mint,
                        amountUi: leg.usdc,
                      })
                    : null;
                  const wasOpened = opened.has(leg.assetId);
                  return (
                    <li key={leg.assetId} className="flex min-h-14 items-center gap-3 border-t border-rule py-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[0.9375rem] font-semibold">{leg.symbol}</span>
                        <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
                          {stale ? "≈ " : ""}
                          {formatUsdc(leg.usdc)}
                          <span className="hidden sm:inline"> · {formatWeight(leg.weight)}</span>
                        </span>
                      </div>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpened((s) => new Set(s).add(leg.assetId))}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 shrink-0 px-3", wasOpened && "text-muted-foreground")}
                          aria-label={`Open Jupiter to swap ${formatUsdc(leg.usdc)} into ${leg.symbol} (opens in a new tab)`}
                        >
                          {wasOpened ? <CheckCircle2 data-icon="inline-start" className="text-foreground" aria-hidden /> : null}
                          Open in Jupiter
                          <ExternalLink data-icon="inline-end" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-[0.8125rem] text-muted-foreground">Not swappable</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {plan.dropped.length > 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                Skipped because they would be under $1: {plan.dropped.map((d) => `${d.symbol} (${formatWeight(d.weight)})`).join(", ")}. Your wallet can still match without them.
              </p>
            ) : null}
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{COPY_SCOPE_NOTE}</p>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{MIRROR_COMPLIANCE_LINE}</p>
          </Step>

          <Step
            n={3}
            last
            title="Verify"
            description={
              signedIn
                ? `We check your wallet on the next snapshot. ${toleranceCopy(tolerance)} to count as a match.`
                : "Sign in with the wallet you swapped from so we know which wallet to check."
            }
            done={recordedAt !== null}
          >
            <Button size="xl" onClick={() => void record()} disabled={!canVerify} className="h-12 w-full text-base sm:w-auto sm:self-start">
              {recording ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <CheckCircle2 data-icon="inline-start" aria-hidden />}
              I&apos;ve done my swaps
            </Button>
            {recordedAt ? (
              <p className="text-[0.9375rem] font-semibold text-foreground" role="status">
                Saved. We&apos;re checking your wallet now. If a swap is still landing, press Refresh on the Quests page in a minute.
              </p>
            ) : null}
          </Step>
        </ol>
      </div>
    </section>
  );
}

export default MirrorPlanCard;
