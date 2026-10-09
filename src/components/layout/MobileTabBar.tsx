"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, isActivePath } from "@/components/layout/nav";

/**
 * Fixed bottom tab bar, shown under lg (hidden from lg up, where the header nav takes over).
 * Respects the iOS home indicator.
 * The header nav is labelled "Primary"; two landmarks must not share a label, so this one
 * is "Primary, mobile".
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary, mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#09090b]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-6xl grid-cols-5">
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium outline-none transition-colors focus-visible:bg-white/[0.04] focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active ? (
                  <span
                    className="absolute -top-px left-1/2 h-px w-10 -translate-x-1/2 bg-foreground"
                    aria-hidden
                  />
                ) : null}
                <Icon className="size-5" strokeWidth={active ? 2.2 : 1.7} aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default MobileTabBar;
