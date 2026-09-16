import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Season 0 points leaderboard. Make predictions, finish the weekly competition (virtual cash) in the top 10 and complete quests.",
};

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return children;
}
