import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Predictions",
  description: "Yes or No predictions on weekly xStocks prices, for points only. Settled from the Friday close, with the source shown on every card.",
};

export default function CallsLayout({ children }: { children: ReactNode }) {
  return children;
}
