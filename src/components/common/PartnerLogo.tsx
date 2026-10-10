"use client";

import * as React from "react";
import { cn } from "cn";
import { initials } from "@/components/common/format";

export interface PartnerLogoProps {
  name: string;
  logoUrl: string | null | undefined;
  /** Rendered size in px (square). Default 32. */
  size?: number;
  className?: string;
}

/**
 * Partner logo with an initials fallback, in the Broadcast logo well (docs/DESIGN.md "Logos"):
 * a round ink-4 well on an inset rule-2 ring, the logo in greyscale so green and red keep their
 * only meanings. Logos are external URLs seeded by hand, so this is a plain <img> (no next/image
 * remotePatterns to maintain) that falls back to initials when the URL is missing or fails to load.
 */
export function PartnerLogo({ name, logoUrl, size = 32, className }: PartnerLogoProps) {
  const [failed, setFailed] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    // An <img> that already failed before hydration never fires onError for React, so check it here.
    const img = imgRef.current;
    setFailed(Boolean(img && img.complete && img.naturalWidth === 0 && img.getAttribute("src")));
  }, [logoUrl]);
  const showImage = Boolean(logoUrl) && !failed;
  const text = size >= 48 ? "text-base" : size >= 28 ? "text-xs" : "text-[0.5625rem]";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-4 font-semibold text-foreground uppercase ring-1 ring-rule-2 ring-inset select-none",
        text,
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden={showImage ? undefined : true}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external partner logos, seeded by hand
        <img
          ref={imgRef}
          src={logoUrl as string}
          alt={`${name} logo`}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="logo-greyscale size-full object-cover mix-blend-luminosity"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export default PartnerLogo;
