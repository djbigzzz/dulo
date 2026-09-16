import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Copy a portfolio",
  description: "Copy a leader's xStocks portfolio. You swap in Jupiter from your own wallet, and the next snapshot checks whether your wallet matches.",
};

export default function MirrorLayout({ children }: { children: ReactNode }) {
  return children;
}
