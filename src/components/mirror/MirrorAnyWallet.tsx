"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWalletInput } from "@/components/mirror/mirror-format";

/** Inset well (DESIGN.md). */
const WELL = "rounded-xl border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";

/**
 * "Copy any wallet's portfolio": paste a Solana address and open /copy/[wallet]. A Dulo player opens
 * their snapshot; any other wallet is read live from the chain and is never scored.
 */
export function MirrorAnyWallet({ className }: { className?: string }) {
  const router = useRouter();
  const inputId = React.useId();
  const errorId = React.useId();
  const [raw, setRaw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const address = parseWalletInput(raw);
    if (!address) {
      setError("Paste a Solana wallet address (32 to 44 letters and numbers).");
      return;
    }
    setError(null);
    router.push(`/copy/${encodeURIComponent(address)}`);
  };

  return (
    <section className={cn("rounded-2xl border border-white/[0.07] bg-card p-4 sm:p-5", className)} aria-labelledby={`${inputId}-title`}>
      <div className="flex items-start gap-3">
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] sm:flex [&>svg]:size-4.5" aria-hidden>
          <Search />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={`${inputId}-title`} className="text-base font-semibold tracking-tight">
              Copy any wallet&apos;s portfolio
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">Paste a Solana address. Dulo reads its xStocks live from the chain. Wallets outside Dulo are never scored.</p>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit} noValidate>
            <label htmlFor={inputId} className="sr-only">
              Solana wallet address
            </label>
            <Input
              id={inputId}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Solana wallet address"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              className={cn(WELL, "h-11 min-w-0 flex-1 px-3.5 font-mono text-sm md:text-sm dark:bg-black/25")}
            />
            <Button type="submit" size="lg" className="h-11 shrink-0 rounded-xl px-5 font-semibold">
              Copy
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          </form>
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-rose-400">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default MirrorAnyWallet;
