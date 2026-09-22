import { cn } from "cn";
import { issuerLabel } from "@/components/common/issuer";

/**
 * Small glass pill naming the issuer a holding or quest belongs to ("xStocks" / "PreStocks"),
 * from Holding.source or Play.assetSource. Renders nothing for a source this build does not know.
 */
export function IssuerPill({ source, className }: { source: string | null | undefined; className?: string }) {
  const label = issuerLabel(source);
  if (!label) return null;
  return (
    <span
      data-slot="issuer-pill"
      data-source={source}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2 text-[11px] font-medium tracking-wide text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.05)]",
        className,
      )}
    >
      {label}
    </span>
  );
}

export default IssuerPill;
