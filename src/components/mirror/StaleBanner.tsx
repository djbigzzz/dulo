import { AlertTriangle } from "lucide-react";
import { cn } from "cn";

export interface StaleBannerProps {
  /** True when the US session is closed (adds the weekend explanation). */
  marketClosed?: boolean;
  className?: string;
}

/** Shown when any leg's quote is stale: the USDC amounts are estimates, Jupiter shows the live quote. */
export function StaleBanner({ marketClosed = false, className }: StaleBannerProps) {
  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-[linear-gradient(90deg,rgb(252_211_77/0.06),transparent_70%)] px-4 py-3 text-sm", className)}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-300/15 bg-amber-300/[0.06] text-amber-300 shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]"
        aria-hidden
      >
        <AlertTriangle className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-amber-100">Prices are stale, so amounts are estimates.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {marketClosed ? "US markets are closed, so the latest prices are hours old. " : "At least one stock has no fresh price. "}
          The weights still hold, and Jupiter shows the live quote before you sign.
        </p>
      </div>
    </div>
  );
}

export default StaleBanner;
