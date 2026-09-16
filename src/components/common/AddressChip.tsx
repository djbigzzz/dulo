"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "cn";
import { explorerUrl, truncateAddress } from "@/components/common/format";

export interface AddressChipProps {
  address: string;
  /** CAIP-2 chain id; enables the explorer link when known. */
  chainId?: string;
  /** Characters kept on each side of the ellipsis. */
  chars?: number;
  /** Show a copy-to-clipboard button. */
  copy?: boolean;
  /** Show an explorer link (needs chainId). */
  explorer?: boolean;
  className?: string;
}

/** Monospace truncated address with optional copy + explorer actions. */
export function AddressChip({ address, chainId, chars = 4, copy = true, explorer = false, className }: AddressChipProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions). Fail silently; the text is selectable.
    }
  };

  const link = explorer && chainId ? explorerUrl(chainId, address) : null;

  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 font-mono text-xs text-foreground",
        className,
      )}
    >
      <span className="truncate" title={address}>
        {truncateAddress(address, chars)}
      </span>
      {copy ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy address"}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        </button>
      ) : null}
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in explorer"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </span>
  );
}
