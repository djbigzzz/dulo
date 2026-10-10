"use client";

import * as React from "react";
import { cn } from "cn";
import { useSession } from "@/hooks/useSession";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export interface SignInBannerProps {
  /** One short line, e.g. "Sign in to trade with $10,000 of virtual cash." */
  title: string;
  /** Optional second line; keep it under ~80 characters. */
  hint?: string;
  /**
   * The Connect button's look: "outline" where the page has another primary action (see ConnectButton).
   * "lg-outline": gold under lg, outline from lg, where a side panel that only shows from lg carries
   * the page's own gold Connect (/competition's trade panel; on a phone the banner is the action).
   */
  connectVariant?: "default" | "outline" | "lg-outline";
  className?: string;
}

/**
 * Compact, single-row sign-in prompt for signed-out visitors, drawn as the Broadcast "Your slot"
 * row: a dashed cream outline (an open seat, not a card), the line in cream and the hint muted,
 * with the Connect button at the end. Replaces large explanatory cards so the page's real content
 * stays above the fold on a phone.
 * Renders nothing once a session exists (and nothing until the session check settles,
 * so it never flashes for signed-in users). Reads the app-wide session context, so it
 * hides the moment a sign-in lands anywhere (header, this banner, a page action). Server
 * and first client render both see `loading`, so it renders nothing until mounted.
 */
export function SignInBanner({ title, hint, connectVariant = "default", className }: SignInBannerProps) {
  const { session, loading } = useSession();
  if (loading || session) return null;
  return (
    <div
      data-slot="sign-in-banner"
      className={cn(
        // One row on every width so the page content starts higher on a phone.
        "flex min-h-[3.75rem] items-center justify-between gap-3 border border-dashed border-[rgb(243_240_232/0.38)] px-3 py-2.5 sm:gap-5 sm:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {/* The open seat: a dashed ring where a rank would be. */}
        <span className="hidden size-[18px] shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground sm:block" aria-hidden />
        <div className="min-w-0">
          <p className="text-[0.9375rem] leading-snug font-semibold text-foreground">{title}</p>
          {hint ? <p className="hidden text-[0.84375rem] leading-snug text-muted-foreground sm:block">{hint}</p> : null}
        </div>
      </div>
      {connectVariant === "lg-outline" ? (
        <>
          <ConnectButton size="lg" className="h-10 shrink-0 lg:hidden" />
          <ConnectButton size="lg" variant="outline" className="hidden h-10 shrink-0 lg:inline-flex" />
        </>
      ) : (
        <ConnectButton size="lg" variant={connectVariant} className="h-10 shrink-0" />
      )}
    </div>
  );
}

export default SignInBanner;
