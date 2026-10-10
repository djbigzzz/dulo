import { cn } from "cn";
import { issuerLabel } from "@/components/common/issuer";

/**
 * A square ruled tag naming the issuer a holding or quest belongs to ("xStocks" / "PreStocks"),
 * from Holding.source or Play.assetSource (Broadcast: a 1px rule, muted Archivo, no pill, no
 * tracking). Renders nothing for a source this build does not know.
 */
export function IssuerPill({ source, className }: { source: string | null | undefined; className?: string }) {
  const label = issuerLabel(source);
  if (!label) return null;
  return (
    <span
      data-slot="issuer-pill"
      data-source={source}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-[2px] border border-rule-2 px-1.5 text-xs leading-none font-medium text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}

export default IssuerPill;
