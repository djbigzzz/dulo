import type { LucideIcon } from "lucide-react";
import { CopyIcon, MedalIcon, TargetIcon, TrophyIcon, UserIcon, ZapIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Desktop header navigation (lg and up). Plain names, games first: Predictions, Competition, Quests,
 * then the Copy a portfolio tool and the Leaderboard. Partners left the header on 16 Sep; it stays in
 * the footer and on the landing page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/predictions", label: "Predictions", icon: TargetIcon },
  { href: "/competition", label: "Competition", icon: TrophyIcon },
  { href: "/quests", label: "Quests", icon: ZapIcon },
  { href: "/copy", label: "Copy a portfolio", icon: CopyIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: MedalIcon },
];

/**
 * Mobile tab bar (under lg): five tabs chosen explicitly. Profile is a tab because it carries the
 * points balance. Copy a portfolio is a tool, not a tab: it is reached from the header, the footer
 * and the Portfolio Match quest. Labels are the short form: five tabs share the width of a phone,
 * so the full desktop names ("Predictions", "Competition") would render ellipsized.
 */
export const MOBILE_TABS: NavItem[] = [
  { href: "/predictions", label: "Predict", icon: TargetIcon },
  { href: "/competition", label: "Compete", icon: TrophyIcon },
  { href: "/quests", label: "Quests", icon: ZapIcon },
  { href: "/leaderboard", label: "Board", icon: MedalIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
];

/** True when `pathname` is `href` or nested under it. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
