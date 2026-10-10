import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Make your first prediction",
  description:
    "Make your first prediction, three paper trades with virtual cash, your quests and the Season leaderboard: a four-step tour. Sign in free with 1,000 starter points. Points only, no cash value.",
};

export default function StartLayout({ children }: { children: ReactNode }) {
  return children;
}
