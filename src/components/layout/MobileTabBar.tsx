"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, isActivePath } from "@/components/layout/nav";

/**
 * Fixed bottom tab bar, shown under lg (hidden from lg up, where the header nav takes over).
 * Broadcast: fully opaque ink, a 1px cream rule on top, five text labels (no icons) in Archivo's
 * slightly narrow cut, the active one in cream under a 2px cream bar. Respects the iOS home indicator.
 * The header nav is labelled "Primary"; two landmarks must not share a label, so this one
 * is "Primary, mobile".
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary, mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-2 bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-6xl grid-cols-5">
        {MOBILE_TABS.map(({ href, label }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full items-center justify-center text-sm font-semibold font-stretch-[92%] outline-none transition-colors focus-visible:bg-white/[0.04] focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] motion-reduce:transition-none",
                  active ? "text-foreground" : "text-dim hover:text-foreground",
                )}
              >
                {active ? <span className="absolute -top-px right-[24%] left-[24%] h-0.5 bg-foreground" aria-hidden /> : null}
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
