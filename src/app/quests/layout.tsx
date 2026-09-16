import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Quests",
  description: "In-platform quests with points and virtual cash, and on-chain quests verified from your own wallet. Points only, no cash value.",
};

export default function PlaysLayout({ children }: { children: ReactNode }) {
  return children;
}
