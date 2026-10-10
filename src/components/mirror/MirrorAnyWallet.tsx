"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWalletInput } from "@/components/mirror/mirror-format";

/**
 * "Copy any wallet's portfolio": paste a Solana address and open /copy/[wallet]. A Dulo player opens
 * their snapshot; any other wallet is read live from the chain and is never scored. Drawn on the
 * page, not in a box: the line, the field and the page's one gold action in a row.
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
    <section className={cn("flex flex-col gap-3", className)} aria-labelledby={`${inputId}-title`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${inputId}-title`} className="text-[1.25rem] leading-tight font-semibold tracking-[-0.01em]">
          Copy any wallet&apos;s portfolio
        </h2>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          Paste a Solana address. Dulo reads its xStocks live from the chain. Wallets outside Dulo are never scored.
        </p>
      </div>
      <form className="flex flex-col gap-2 sm:flex-row sm:gap-3" onSubmit={submit} noValidate>
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
          className="h-12 min-w-0 px-3.5 text-[0.9375rem] sm:max-w-xl sm:flex-1 md:text-[0.9375rem]"
        />
        <Button type="submit" size="xl" className="h-12 shrink-0 px-6 text-base">
          Copy
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Button>
      </form>
      {error ? (
        <p id={errorId} role="alert" className="text-[0.84375rem] text-no">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default MirrorAnyWallet;
