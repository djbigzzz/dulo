"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "@/components/layout/nav";

/**
 * Desktop header navigation with a quiet filled pill on the active section. It starts at lg: at md
 * (768 to 1023px) the links overflowed the row by 231px and scrolled the page sideways. Labels never
 * wrap (whitespace-nowrap), so the row stays one line.
 */
export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("hidden shrink-0 items-center gap-1 lg:flex", className)}>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]",
              active
                ? "bg-white/[0.08] text-foreground"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default NavLinks;
