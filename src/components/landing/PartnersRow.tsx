"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { api, type PartnersResponse } from "@/lib/api-client";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { partnerRowCaption } from "@/components/plays/play-meta";
import { Skeleton } from "@/components/ui/skeleton";

const TILE =
  "group flex h-[4.5rem] items-center gap-3 rounded-2xl border px-4 outline-none transition-all duration-300 hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Listed Partners that have a real logo, plus a "Your project here" tile. The API already omits hidden Partners (the house "dulo" campaign). */
export function PartnersRow() {
  const [data, setData] = React.useState<PartnersResponse | null>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    api
      .partners()
      .then((d) => active && setData(d))
      .catch(() => undefined)
      .finally(() => active && setDone(true));
    return () => {
      active = false;
    };
  }, []);

  const partners = data?.partners.filter((p) => Boolean(p.logoUrl)) ?? [];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
      {!done
        ? [0, 1, 2].map((i) => (
            <li key={i} className={i === 2 ? "hidden sm:block" : undefined} aria-hidden>
              <div className="flex h-[4.5rem] items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4">
                <Skeleton className="size-9 shrink-0 rounded-xl bg-white/[0.06]" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-20 bg-white/[0.06]" />
                  <Skeleton className="h-3 w-12 bg-white/[0.06]" />
                </span>
              </div>
            </li>
          ))
        : partners.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/partners/${encodeURIComponent(p.slug)}`}
                className={`${TILE} border-white/[0.07] bg-card hover:border-white/[0.12] hover:bg-white/[0.04]`}
              >
                <span className="flex min-w-0 items-center gap-3 opacity-70 grayscale-[0.6] transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0 group-focus-visible:opacity-100 group-focus-visible:grayscale-0">
                  <PartnerLogo name={p.name} logoUrl={p.logoUrl} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold tracking-tight text-foreground">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{partnerRowCaption(p)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
      {/* On the two-column phone grid, span the add tile when it would otherwise sit alone on its row. */}
      <li className={(done ? partners.length : 2) % 2 === 0 ? "col-span-2 sm:col-span-1" : undefined}>
        <Link
          href="/partners"
          className={`${TILE} border-dashed border-gold/20 bg-white/[0.02] text-sm font-medium text-muted-foreground hover:border-gold/40 hover:bg-gold/[0.04] hover:text-foreground`}
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-gold/20 bg-gold/[0.06] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] transition-colors group-hover:border-gold/35"
            aria-hidden
          >
            <PlusIcon className="size-4 text-gold" />
          </span>
          Your project here
        </Link>
      </li>
    </ul>
  );
}

export default PartnersRow;
