import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  // A plain string here would drop the root " · Dulo" template for /partners/[slug].
  title: { default: "Partners", template: `%s · ${APP_NAME}` },
  description: "Projects listing quests on Dulo. Any Solana project can list an on-chain quest.",
};

export default function PartnersLayout({ children }: { children: ReactNode }) {
  return children;
}
