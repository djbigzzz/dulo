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

/**
 * "+100 pts": points only, no cash value, ever. Broadcast: the outline tag (a 1px rule) with the
 * number in Archivo's tabular figures; no ornament and no gold (gold is the primary button and
 * "now" only).
 */
export function PointsChip({ points, signed = false, size = "sm", muted = false, className }: PointsChipProps) {
  const prefix = signed && points > 0 ? "+" : "";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 tabular-nums",
        size === "md" && "h-6 px-2.5 text-xs",
        size === "lg" && "h-8 px-3 text-sm",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {/* No aria-label: Badge renders a role-less span, so the visible "+100 pts" text is the accessible name. */}
      {prefix}
      {formatPoints(points)} pts
    </Badge>
  );
}
