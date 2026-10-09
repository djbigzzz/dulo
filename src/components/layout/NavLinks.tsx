"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "@/components/layout/nav";

/**
 * Desktop header navigation, Broadcast: Archivo 15px in the muted grey, the active section in cream
 * with a 2px cream rule on the header's bottom edge (the mockup's nav). It starts at lg: at md
 * (768 to 1023px) the links overflowed the row by 231px and scrolled the page sideways. Labels never
 * wrap (whitespace-nowrap), so the row stays one line.
 */
export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("hidden h-full shrink-0 items-stretch gap-6 lg:flex xl:gap-7", className)}>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center whitespace-nowrap text-[0.9375rem] font-medium transition-colors outline-none focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] motion-reduce:transition-none",
              active
                ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
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
