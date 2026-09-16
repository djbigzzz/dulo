import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Dulo tamga: the Bulgar IYI symbol.
 *
 * A tall central Y whose stem reaches the baseline, flanked left and right by
 * two serifed vertical I bars, all the same height. Monochrome, stroke-based,
 * square line caps, draws with `currentColor` so it takes the text colour of
 * wherever it is placed. Keep the paths simple and bold; the same three paths
 * are reused verbatim in public/icons/*.svg and public/favicon.svg.
 */

/** Stroke width in viewBox units (64x64). Shared with the static icon files. */
export const TAMGA_STROKE = 6;

/** The three glyph paths (left I, central Y, right I) in a 64x64 viewBox. */
export const TAMGA_PATHS = [
  "M7 10h12M13 10v44M7 54h12",
  "M32 54V33M32 33L21 10M32 33L43 10",
  "M45 10h12M51 10v44M45 54h12",
] as const;

export interface TamgaProps extends Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Rendered width and height (the mark is square). Defaults to 24. */
  size?: number | string;
  /** Accessible name. When omitted the mark is decorative and hidden from AT. */
  title?: string;
  /** "gradient" strokes the mark from heritage gold to ember; "current" uses the text colour. */
  tone?: "current" | "gradient";
}

export function Tamga({ size = 24, className, title, tone = "current", ...props }: TamgaProps) {
  const gradientId = `tamga-${React.useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke={tone === "gradient" ? `url(#${gradientId})` : "currentColor"}
      strokeWidth={TAMGA_STROKE}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {tone === "gradient" ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f0d9a4" />
            <stop offset="45%" stopColor="#d8b46a" />
            <stop offset="100%" stopColor="#ff6a2a" />
          </linearGradient>
        </defs>
      ) : null}
      {TAMGA_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface DuloProps {
  /** Size of the tamga mark. Defaults to 28. */
  size?: number | string;
  /** Hide the "Dulo" text and show only the mark. */
  markOnly?: boolean;
  className?: string;
  markClassName?: string;
  textClassName?: string;
}

/** Wordmark: the ember tamga as the mark, followed by "Dulo". */
export function Dulo({ size = 28, markOnly = false, className, markClassName, textClassName }: DuloProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 leading-none", className)}>
      <Tamga size={size} title="Dulo" tone="gradient" className={cn("text-ember", markClassName)} />
      {markOnly ? null : (
        <span
          className={cn(
            "font-heading text-lg font-semibold tracking-tight text-foreground",
            textClassName,
          )}
        >
          Dulo
        </span>
      )}
    </span>
  );
}

export default Tamga;
