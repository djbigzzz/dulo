"use client";

import * as React from "react";
import { cn } from "cn";
import { WalletIcon } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export interface SignInBannerProps {
  /** One short line, e.g. "Sign in to trade with $10,000 of virtual cash." */
  title: string;
  /** Optional second line; keep it under ~80 characters. */
  hint?: string;
  className?: string;
}

/**
 * Compact, single-row sign-in prompt for signed-out visitors. Replaces the large
 * explanatory cards so the page's real content stays above the fold on a phone.
 * Renders nothing once a session exists (and nothing until the session check settles,
 * so it never flashes for signed-in users). Reads the app-wide session context, so it
 * hides the moment a sign-in lands anywhere (header, this banner, a page action). Server
 * and first client render both see `loading`, so it renders nothing until mounted.
 */
export function SignInBanner({ title, hint, className }: SignInBannerProps) {
  const { session, loading } = useSession();
  if (loading || session) return null;
  return (
    <div
      className={cn(
        // One row on every width so the page content starts higher on a phone.
        "border-gradient flex items-center justify-between gap-3 rounded-2xl bg-[linear-gradient(100deg,rgb(255_106_42/0.09),rgb(216_180_106/0.04)_55%,rgb(255_245_230/0.02))] px-3 py-2.5 sm:px-4 sm:py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-ember/25 bg-ember/10 text-ember shadow-[inset_0_1px_0_rgb(255_245_230/0.08)] sm:flex" aria-hidden>
          <WalletIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {hint ? <p className="hidden text-sm text-muted-foreground sm:block">{hint}</p> : null}
        </div>
      </div>
      <ConnectButton size="lg" className="h-10 shrink-0" />
    </div>
  );
}

export default SignInBanner;
