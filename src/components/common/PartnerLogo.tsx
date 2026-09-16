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
 * Partner logo with an initials fallback. Logos are external URLs seeded by hand,
 * so this is a plain <img> (no next/image remotePatterns to maintain) that falls
 * back to initials when the URL is missing or fails to load.
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
  const radius = size >= 48 ? "rounded-2xl" : size >= 32 ? "rounded-xl" : "rounded-lg";
  const text = size >= 48 ? "text-base" : "text-xs";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[linear-gradient(160deg,rgb(255_245_230/0.08),rgb(255_245_230/0.02))] font-heading font-semibold tracking-tight text-foreground/70 uppercase ring-1 ring-white/[0.08] select-none",
        radius,
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
          className="size-full bg-white/[0.04] object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export default PartnerLogo;
