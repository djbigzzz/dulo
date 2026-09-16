import { Sparkles } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { formatPoints } from "@/components/common/format";

export interface PointsChipProps {
  points: number;
  /** Prefix a "+" for quest points ("+100 pts") versus totals ("1,250 pts"). */
  signed?: boolean;
  size?: "sm" | "md" | "lg";
  /** Visually de-emphasise (locked Plays). */
  muted?: boolean;
  className?: string;
}

/** "+100 pts" — points only, no cash value, ever. */
export function PointsChip({ points, signed = false, size = "sm", muted = false, className }: PointsChipProps) {
  const prefix = signed && points > 0 ? "+" : "";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 tabular-nums shadow-[inset_0_1px_0_rgb(255_245_230/0.05)] [&>svg]:text-gold",
        size === "md" && "h-6 px-2.5 text-xs [&>svg]:size-3.5!",
        size === "lg" && "h-8 px-3 text-sm [&>svg]:size-4!",
        muted && "text-muted-foreground [&>svg]:text-muted-foreground",
        className,
      )}
    >
      {/* No aria-label: Badge renders a role-less span, so the visible "+100 pts" text is the accessible name. */}
      <Sparkles aria-hidden />
      {prefix}
      {formatPoints(points)} pts
    </Badge>
  );
}
