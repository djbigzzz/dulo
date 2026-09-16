import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Check a wallet",
  description: "Paste any Solana address: Dulo reads its xStocks live from the chain and shows which on-chain quests it already meets. Nothing stored, never scored.",
};

export default function CheckLayout({ children }: { children: ReactNode }) {
  return children;
}
