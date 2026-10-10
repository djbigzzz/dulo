"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { truncateAddress } from "@/components/common/format";
import { parseWalletInput } from "@/components/mirror/mirror-format";
import { CHECK_INVALID_MESSAGE, SAMPLE_WALLETS, checkHref } from "@/components/landing/check-wallet";

export interface CheckWalletBoxProps {
  className?: string;
  /** Primary (gold) submit button. Off on the landing, where Connect is the one primary action. */
  primary?: boolean;
  /** Show the "Try a real holder" rows. Default true. */
  samples?: boolean;
  /** Field above the button at every width: for narrow columns (the /check/[address] sidebar). */
  stacked?: boolean;
  /** No panel of its own: the landing sets it straight on the page, between rules. */
  bare?: boolean;
}

/**
 * Paste any Solana address and open /check/[address]: its xStocks read live and the quests it
 * already verifies. Three curated xStocks holders and one more public holder are one tap away for
 * visitors with no wallet. Broadcast: an ink well on a strong rule, ruled sample rows, no pills.
 */
export function CheckWalletBox({ className, primary = false, samples = true, stacked = false, bare = false }: CheckWalletBoxProps) {
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
    <div className={cn("flex flex-col gap-4", bare ? "min-w-0" : "rounded-md bg-card p-4 ring-1 ring-rule sm:p-6", className)}>
      {/*
        Stacked below sm (always when `stacked`), so the field grows only in the sm row: flex-1 in a
        column would override its h-11 (44px).
      */}
      <form className={cn("flex flex-col gap-2", !stacked && "sm:flex-row")} onSubmit={submit} noValidate>
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
          className={cn(
            "h-11 min-w-0 rounded-sm border-rule-2 bg-ink-2 px-3.5 font-mono text-sm placeholder:font-sans md:text-sm dark:bg-ink-2",
            !stacked && "sm:h-12 sm:flex-1",
          )}
        />
        <Button
          type="submit"
          size="lg"
          variant={primary ? "default" : "outline"}
          className={cn("h-11 shrink-0 px-5 text-[0.9375rem] font-semibold", !stacked && "sm:h-12")}
        >
          Check wallet
          <span aria-hidden className="ml-1 font-medium">
            →
          </span>
        </Button>
      </form>
      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-[0.8125rem] text-no">
          {error}
        </p>
      ) : null}
      {samples && SAMPLE_WALLETS.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <p id={samplesId} className="text-sm font-medium text-muted-foreground">
            Try a real holder
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby={samplesId}>
            {SAMPLE_WALLETS.map((w) => (
              <li key={w.address} className="min-w-0">
                <Link
                  href={checkHref(w.address)}
                  className="group inline-flex min-h-10 max-w-full items-center gap-2.5 rounded-sm bg-ink-2 px-3 py-1.5 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--rule)] transition-[box-shadow,background-color] duration-200 outline-none hover:bg-ink-3 hover:shadow-[inset_0_0_0_1px_var(--rule-2)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                >
                  <span className="font-semibold text-foreground">{w.label}</span>
                  {w.tag ? (
                    <span
                      data-slot="wallet-tag"
                      className="inline-flex h-5 shrink-0 items-center rounded-sm border border-rule-2 px-1.5 text-[0.6875rem] leading-none font-semibold text-foreground"
                    >
                      {w.tag}
                    </span>
                  ) : null}
                  <span className="truncate text-muted-foreground tabular-nums">{truncateAddress(w.address)}</span>
                  <span
                    aria-hidden
                    className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">Public wallets, not Dulo players. Never scored.</p>
        </div>
      ) : null}
    </div>
  );
}

export default CheckWalletBox;
