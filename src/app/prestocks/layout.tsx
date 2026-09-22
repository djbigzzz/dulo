import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Pre-IPO tokens",
  description:
    "Eight pre-IPO tokens from PreStocks, quoted on Solana around the clock. Paper trade them with virtual cash in the weekly competition, complete pre-IPO quests, and read what the mint says. Points only, no cash value.",
};

export default function PreStocksLayout({ children }: { children: ReactNode }) {
  return children;
}
