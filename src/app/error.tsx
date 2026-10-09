"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Tamga } from "@/components/brand/Tamga";
import { Button, buttonVariants } from "@/components/ui/button";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route error boundary (renders inside the app chrome). One gold (primary) retry that re-renders the
 * segment; the digest is shown so a report can be matched to the server log line.
 */
export default function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center">
      <div className="relative flex w-full max-w-xl flex-col items-center gap-6 overflow-hidden rounded-md border-gradient bg-card px-6 py-12 sm:px-10 sm:py-16">
        <Tamga size={64} tone="gradient" title="Dulo" />
        <p className="text-sm font-medium text-muted-foreground">Something broke</p>
        <h1 className="font-display text-[2.75rem] leading-none font-normal tracking-[-0.012em] text-balance text-foreground sm:text-[3.5rem]">
          This page <span className="text-muted-foreground">missed a beat</span>
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">
          Nothing was lost: Points live in an append-only ledger and your wallet is untouched. Try again, or head back to
          the board.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Ref <span className="text-foreground">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => reset()} className="h-11 px-6">
            <RefreshCw data-icon="inline-start" aria-hidden />
            Try again
          </Button>
          <Link href="/" className={buttonVariants({ size: "lg", variant: "outline", className: "h-11 px-6" })}>
            Back to Dulo
          </Link>
        </div>
      </div>
    </section>
  );
}
