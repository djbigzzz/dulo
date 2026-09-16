import { PageHeader } from "@/components/common/PageHeader";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";

/** /check: the paste box on its own page (footer link, and the way back from a bad address). */
export default function CheckIndexPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0"
        eyebrow="No sign-in needed"
        title={
          <>
            Check <span className="italic">any wallet</span>
          </>
        }
        description="Paste a Solana address. Dulo reads its xStocks straight from Token-2022 balances, multiplier-correct, and shows which on-chain quests that wallet already meets."
      />
      <CheckWalletBox primary className="max-w-2xl animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none" />
      <p className="text-xs text-muted-foreground/80">Points only, no cash value. A check reads the chain once; nothing is stored and nothing is scored.</p>
    </div>
  );
}
