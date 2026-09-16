"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { toast } from "sonner";
import { RPC_URL } from "@/lib/config";
import { SessionProvider } from "@/components/providers/SessionProvider";

// The wallet modal's base stylesheet; dark-theme overrides live in src/app/globals.css.
import "@solana/wallet-adapter-react-ui/styles.css";

/** Errors that are the user's own choice (closing the popup) and not worth a toast. */
const USER_CANCELLED = /reject|cancel|denied|closed|dismiss/i;

/**
 * Connection > Wallet > WalletModal > Session providers for the whole app.
 *
 * SSR: every provider here is safe to render on the server. The adapters detect
 * `window` lazily, wallet-standard registration is guarded, wallet name storage
 * is behind try/catch, and the modal only mounts when opened. Nothing wallet-
 * dependent is rendered until the client is mounted (see ConnectButton), so a
 * dynamic `ssr:false` import is not required and would only cost SSR of the shell.
 */
export default function WalletProvider({ children }: { children: ReactNode }) {
  // Backpack and Mobile Wallet Adapter (MWA) are auto-detected via wallet-standard by @solana/wallet-adapter-react 0.15.40; only legacy adapters are listed here.
  const wallets = useMemo<Adapter[]>(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    const message = error.message || error.name;
    if (USER_CANCELLED.test(message)) return;
    if (error.name === "WalletNotReadyError") {
      toast.error(`${adapter?.name ?? "Wallet"} not found`, {
        description: "Install the wallet extension, or open Dulo from inside the wallet app on mobile.",
      });
      return;
    }
    if (error.name === "WalletNotSelectedError") return;
    console.warn("[dulo] wallet error", error);
    toast.error(message || "Wallet error");
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <SolanaWalletProvider wallets={wallets} autoConnect onError={onError} localStorageKey="dulo:wallet">
        <WalletModalProvider>
          {/* The one session for the app: header, banners and pages all read this. */}
          <SessionProvider>{children}</SessionProvider>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

export { WalletProvider };
