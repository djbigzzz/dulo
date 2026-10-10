import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Tamga } from "@/components/brand/Tamga";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false },
};

/**
 * Branded 404 inside the app chrome, laid out like a result card on the page (no panel): the cream
 * tamga, "404" as a scoreboard numeral in the dim grey, the serif line, one gold way back in and a
 * quiet link to the quests.
 */
export default function NotFound() {
  return (
    <section className="flex min-h-[60dvh] flex-col justify-center py-10 animate-in fade-in-0 duration-500 motion-reduce:animate-none sm:py-14">
      <div className="flex max-w-3xl flex-col gap-6 border-t border-rule-2 pt-8">
        <div className="flex items-center gap-4">
          <Tamga size={40} tone="gradient" title="Dulo" />
          <span className="figure text-[4.5rem] leading-[0.8] text-dim sm:text-[6.25rem]" aria-hidden>
            404
          </span>
        </div>
        <p className="text-[0.9375rem] font-medium text-muted-foreground">Not found</p>
        <h1 className="font-display text-[2.75rem] leading-none font-normal tracking-[-0.012em] text-balance text-foreground sm:text-[4.25rem]">
          Nothing to score here.
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem]">
          The page you asked for does not exist or has moved. Your points and quests are right where you left them.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link href="/" className={buttonVariants({ size: "xl" })}>
            Back to Dulo
          </Link>
          <Link href="/quests" className={buttonVariants({ variant: "link", className: "text-base" })}>
            See quests
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
