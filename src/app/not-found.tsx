import type { Metadata } from "next";
import Link from "next/link";
import { Tamga } from "@/components/brand/Tamga";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false },
};

/** The landing's large button size (44px, a full touch target). */
const BIG = "h-11 rounded-lg px-5";

/** Branded 404 inside the app chrome: accent tamga, heavy sans title, one white way back in. */
export default function NotFound() {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
      <div className="relative flex w-full max-w-xl flex-col items-center gap-6 overflow-hidden rounded-3xl border-gradient bg-card px-6 py-12 ember-glow sm:px-10 sm:py-16">
        <Tamga size={64} tone="gradient" title="Dulo" />
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">404 · Not found</p>
        <h1 className="font-display text-3xl leading-[1.05] font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
          Nothing to <span className="text-gradient-ember">score</span> here
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-balance text-muted-foreground sm:text-base">
          The page you asked for does not exist or has moved. Your points and quests are right where you left them.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className={buttonVariants({ size: "lg", className: BIG })}>
            Back to Dulo
          </Link>
          <Link href="/quests" className={buttonVariants({ size: "lg", variant: "outline", className: BIG })}>
            See quests
          </Link>
        </div>
      </div>
    </section>
  );
}
