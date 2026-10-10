"use client";

import * as React from "react";
import { cn } from "cn";

const XSTOCK_LOGO = (symbol: string) => `https://xstocks-metadata.backed.fi/logos/tokens/${encodeURIComponent(symbol)}.png`;

export interface XStockLogoProps {
  /** "NVDAx": the xStocks metadata file name. */
  symbol: string;
  /** "NVDA": the fallback text when the logo does not load (omitted: the well stays empty). */
  ticker?: string;
  /** The image's intrinsic size in px. The well's size comes from `className` (default `size-7`). */
  size?: number;
  className?: string;
}

/**
 * A round greyscale xStock logo well (docs/DESIGN.md "Logos"), so green and red keep their only
 * meanings (Yes / No, gain / loss). One copy for every page that draws an xStock by its className
 * size: the landing stage and tabs, the predictions segments, results and dialog. (The competition
 * slip's SymbolLogo also draws pre-IPO tokens, at a px size.) Decorative: the symbol is always
 * written beside it. Falls back to the ticker's first four letters when the CDN has no file.
 */
export function XStockLogo({ symbol, ticker, size = 28, className }: XStockLogoProps) {
  const [failed, setFailed] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    // An <img> that failed before hydration never fires onError for React, so check it here.
    const img = imgRef.current;
    setFailed(Boolean(img && img.complete && img.naturalWidth === 0));
  }, [symbol]);
  return (
    <span
      aria-hidden
      data-slot="xstock-logo"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-4 text-[0.5625rem] font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--rule-2)]",
        className,
      )}
    >
      {failed ? (
        (ticker ?? "").slice(0, 4)
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- xStocks metadata CDN, no next/image remotePatterns to maintain
        <img
          ref={imgRef}
          src={XSTOCK_LOGO(symbol)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="logo-greyscale size-full scale-[1.42] object-cover mix-blend-luminosity"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default XStockLogo;
