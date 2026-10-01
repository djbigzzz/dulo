import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Make your first prediction",
  description: "Will an xStock close above its strike on Friday? Sign in free, get 1,000 starter points and make your pick in under a minute. Points only, no cash value.",
};

export default function StartLayout({ children }: { children: ReactNode }) {
  return children;
}
