import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";

export const metadata: Metadata = {
  title: "Competition (virtual cash)",
  description: `A weekly paper trading competition with $10,000 of virtual cash at real xStock prices. Not real money. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points.`,
};

export default function LeagueLayout({ children }: { children: ReactNode }) {
  return children;
}
