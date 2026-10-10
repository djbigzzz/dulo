"use client";

import * as React from "react";
import { cn } from "cn";
import { preIpoLogoUrl } from "@/components/prestocks/tokens";

/** xStocks metadata CDN: `${base}/${symbol}.png` (lib/assets/xstocks XSTOCKS_LOGO_BASE, client-safe copy). */
const XSTOCKS_LOGO_BASE = "https://xstocks-metadata.backed.fi/logos/tokens";

/** The logo URL of a competition symbol: an xStock from its metadata CDN, a pre-IPO token from the issuer. */
export function symbolLogoUrl(symbol: string, preIpo: boolean): string {
  return preIpo ? preIpoLogoUrl(symbol) : `${XSTOCKS_LOGO_BASE}/${encodeURIComponent(symbol.trim())}.png`;
}

export interface SymbolLogoProps {
  symbol: string;
  /** A pre-IPO token: the issuer's logo, the serif initial of `name` when it fails. */
  preIpo?: boolean;
  /** The name the fallback initial comes from (default: the symbol). */
  name?: string;
  /** Rendered size in px (a circle). Default 34. */
  size?: number;
  className?: string;
}

/**
 * Broadcast logo well (docs/DESIGN.md "Logos"): a round ink-4 well on an inset strong rule, the
 * logo in greyscale so green and red keep their only meanings (Yes / No, gain / loss). xStock
 * logos carry their own ring, so they are scaled to crop it (the mockup's 1.42). A logo that fails
 * to load falls back to the name's initial in the serif. Decorative: the symbol is always printed
 * beside it, so the image carries an empty alt.
 */
export function SymbolLogo({ symbol, preIpo = false, name, size = 34, className }: SymbolLogoProps) {
  const [failed, setFailed] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const src = symbolLogoUrl(symbol, preIpo);
  React.useEffect(() => {
    // An <img> that failed before hydration never fires onError for React, so check it here.
    const img = imgRef.current;
    setFailed(Boolean(img && img.complete && img.naturalWidth === 0));
  }, [src]);
  const initial = (name ?? symbol).trim().charAt(0).toUpperCase();
  return (
    <span
      data-slot="symbol-logo"
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-ink-4 ring-1 ring-rule-2 ring-inset select-none", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {failed ? (
        <span className="font-display leading-none font-normal text-foreground" style={{ fontSize: Math.round(size * 0.55) }}>
          {initial}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- external issuer CDNs, no next/image remotePatterns to maintain
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className={cn("logo-greyscale size-full object-cover mix-blend-luminosity", preIpo ? "" : "scale-[1.42]")}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default SymbolLogo;
