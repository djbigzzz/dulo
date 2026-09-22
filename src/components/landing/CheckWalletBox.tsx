"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { truncateAddress } from "@/components/common/format";
import { parseWalletInput } from "@/components/mirror/mirror-format";
import { CHECK_INVALID_MESSAGE, SAMPLE_WALLETS, checkHref } from "@/components/landing/check-wallet";

/** Inset well (DESIGN.md). */
const WELL = "rounded-xl border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";

export interface CheckWalletBoxProps {
  className?: string;
  /** Ember submit button. Off on the landing, where Connect is the one primary action. */
  primary?: boolean;
  /** Show the "Try a real holder" chips. Default true. */
  samples?: boolean;
}

/**
 * Paste any Solana address and open /check/[address]: its xStocks read live and the Plays it
 * already verifies. Three curated xStocks holders and one pre-IPO holder are one tap away for
 * visitors with no wallet.
 */
export function CheckWalletBox({ className, primary = false, samples = true }: CheckWalletBoxProps) {
  const router = useRouter();
  const inputId = React.useId();
  const errorId = React.useId();
  const samplesId = React.useId();
  const [raw, setRaw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const address = parseWalletInput(raw);
    if (!address) {
      setError(CHECK_INVALID_MESSAGE);
      return;
    }
    setError(null);
    router.push(checkHref(address));
  };

  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-card p-4 sm:p-6", className)}>
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
          placeholder="Paste a Solana wallet address"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className={cn(WELL, "h-11 min-w-0 flex-1 px-3.5 font-mono text-sm md:text-sm dark:bg-black/25")}
        />
        <Button type="submit" size="lg" variant={primary ? "default" : "outline"} className="h-11 shrink-0 rounded-xl px-5 font-semibold">
          Check wallet
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Button>
      </form>
      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-xs text-rose-400">
          {error}
        </p>
      ) : null}
      {samples && SAMPLE_WALLETS.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p id={samplesId} className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Try a real holder
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby={samplesId}>
            {SAMPLE_WALLETS.map((w) => (
              <li key={w.address} className="min-w-0">
                <Link
                  href={checkHref(w.address)}
                  className="group inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-black/25 px-3 py-1.5 text-xs shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] transition-colors duration-300 outline-none hover:border-white/[0.14] hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="font-medium text-foreground">{w.label}</span>
                  {w.tag ? (
                    <span data-slot="wallet-tag" className="inline-flex h-5 shrink-0 items-center rounded-full border border-gold/20 bg-gold/[0.06] px-1.5 text-xs font-medium text-gold">
                      {w.tag}
                    </span>
                  ) : null}
                  <span className="truncate font-mono text-muted-foreground">{truncateAddress(w.address)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground/80">Public wallets on Solana: not Dulo players, never scored. Nothing you check is stored.</p>
        </div>
      ) : null}
    </div>
  );
}

export default CheckWalletBox;
