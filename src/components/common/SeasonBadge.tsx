import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SeasonView } from "@/lib/api-client";
import { formatDate } from "@/components/common/format";

/**
 * Placeholder with the badge's footprint for while the season is still loading. Pages
 * render this instead of <SeasonBadge season={undefined}> so "No Season yet" only ever
 * means the API answered with no season.
 */
export function SeasonBadgeSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-6 w-36 rounded-4xl", className)} aria-hidden />;
}

export interface SeasonBadgeProps {
  season: SeasonView | null | undefined;
  className?: string;
}

const PHASE_LABEL: Record<SeasonView["phase"], string> = {
  active: "Live",
  upcoming: "Upcoming",
  ended: "Ended",
};

/**
 * "Stocks Season · Live" from the API's SeasonView (unlike the header's static chip).
 * Renders a neutral "No Season yet" when nothing is seeded.
 */
export function SeasonBadge({ season, className }: SeasonBadgeProps) {
  if (!season) {
    return (
      <Badge variant="outline" className={cn("h-7 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
        No Season yet
      </Badge>
    );
  }
  const live = season.phase === "active";
  const range = `${formatDate(season.startsAt)} – ${formatDate(season.endsAt)}`;
  return (
    <Badge
      variant="outline"
      className={cn("h-7 max-w-full gap-1.5 rounded-full border-gold/20 bg-gold/[0.06] px-3 text-xs font-medium", className)}
      title={`${season.name}: ${range}`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-ember" : "bg-muted-foreground/60")} aria-hidden />
      <span className="truncate text-foreground">{season.name}</span>
      <span className="text-muted-foreground">· {PHASE_LABEL[season.phase]}</span>
    </Badge>
  );
}

export default SeasonBadge;
