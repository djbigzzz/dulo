import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your wallets, Season points, quests completed and Badges.",
  robots: { index: false },
};

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return children;
}
