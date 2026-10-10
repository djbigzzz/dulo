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
  /**
   * "gradient" (name kept from an earlier theme) strokes the mark in solid Broadcast cream, inline,
   * so it reads without any stylesheet (offline page, global error, social card); "current" uses
   * the text colour. The mark is never gold: gold is the primary action and "now" only.
   */
  tone?: "current" | "gradient";
}

/** The cream the "gradient" tone strokes with (the --paper token), so it also works without CSS. */
export const TAMGA_INK = "#f3f0e8";

export function Tamga({ size = 24, className, title, tone = "current", ...props }: TamgaProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke={tone === "gradient" ? TAMGA_INK : "currentColor"}
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
      {TAMGA_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface DuloProps {
  /** Size of the tamga mark. Defaults to 28; the serif word scales with it. */
  size?: number | string;
  /** Hide the "Dulo" text and show only the mark. */
  markOnly?: boolean;
  className?: string;
  markClassName?: string;
  textClassName?: string;
}

/**
 * Wordmark (the mockup's header): the cream tamga, then "Dulo" in Instrument Serif at about
 * 1.15x the mark, nudged down 2px so the serif's x-height sits on the mark's optical centre.
 */
export function Dulo({ size = 28, markOnly = false, className, markClassName, textClassName }: DuloProps) {
  const word = typeof size === "number" ? `${Math.round(size * 1.15)}px` : `calc(${size} * 1.15)`;
  return (
    <span className={cn("inline-flex items-center gap-2.5 leading-none", className)}>
      <Tamga size={size} title="Dulo" tone="gradient" className={cn("text-foreground", markClassName)} />
      {markOnly ? null : (
        <span
          className={cn("mt-0.5 font-display leading-none font-normal tracking-[0.005em] text-foreground", textClassName)}
          style={{ fontSize: word }}
        >
          Dulo
        </span>
      )}
    </span>
  );
}

export default Tamga;
