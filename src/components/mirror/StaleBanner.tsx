import { cn } from "cn";

export interface StaleBannerProps {
  /** True when the US session is closed (adds the weekend explanation). */
  marketClosed?: boolean;
  className?: string;
}

/**
 * Shown when any leg's quote is stale: the USDC amounts are estimates, Jupiter shows the live
 * quote. A ruled row with the price chip's "stale" tag (no hue: Broadcast keeps colour for Yes / No
 * and gain / loss), so it reads as a fact about the prices, not an alarm.
 */
export function StaleBanner({ marketClosed = false, className }: StaleBannerProps) {
  return (
    <div role="status" className={cn("flex flex-col gap-1 border-y border-rule-2 py-3 sm:flex-row sm:items-baseline sm:gap-4", className)}>
      <p className="flex shrink-0 items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
        <span className="rounded-sm border border-rule-2 px-1 py-px text-[0.6875rem] leading-none font-semibold">stale</span>
        Prices are stale, so amounts are estimates.
      </p>
      <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
        {marketClosed ? "US markets are closed, so the latest prices are hours old. " : "At least one stock has no fresh price. "}
        The weights still hold, and Jupiter shows the live quote before you sign.
      </p>
    </div>
  );
}

export default StaleBanner;
