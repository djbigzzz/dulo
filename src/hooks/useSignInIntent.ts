"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSession } from "@/hooks/useSession";
import { INITIAL_INTENT_MEMO, intentStep, type IntentMemo } from "@/hooks/session-state";

export interface SignInIntent<T> {
  /** What the user asked for while signed out; null when nothing is waiting. */
  pending: T | null;
  /**
   * Remember `value` and get the user signed in: opens the wallet modal when no wallet is
   * connected, then signs in automatically once it connects (one signature, no second
   * click). Dropped when the modal is dismissed, the connection fails, or the sign-in is
   * cancelled or refused.
   */
  start(value: T): void;
  /** Forget the pending value (call after acting on it). */
  clear(): void;
}

/**
 * "Pressed a button that needs a session while signed out": connect, sign in, then let the
 * page carry on. The page decides when it is ready (usually when its own data says signed
 * in, which follows the session through useApiQuery) and then consumes `pending`.
 *
 * `onSessionAlready` runs when start() is called but a session already exists (the page's
 * data is behind the session); pass the page's refetch.
 */
export function useSignInIntent<T>(onSessionAlready?: () => void): SignInIntent<T> {
  const { connected, connecting } = useWallet();
  const { visible, setVisible } = useWalletModal();
  const { session, loading, signingIn, signIn } = useSession();
  const [pending, setPending] = useState<T | null>(null);
  const memo = useRef<IntentMemo>(INITIAL_INTENT_MEMO);

  const clear = useCallback(() => {
    memo.current = INITIAL_INTENT_MEMO;
    setPending(null);
  }, []);

  const start = useCallback(
    (value: T) => {
      memo.current = INITIAL_INTENT_MEMO;
      setPending(value);
      if (session) {
        onSessionAlready?.();
        return;
      }
      if (!connected && !connecting) setVisible(true);
      // Connected: the effect below signs in on the next render.
    },
    [session, connected, connecting, setVisible, onSessionAlready],
  );

  const hasPending = pending !== null;
  useEffect(() => {
    const step = intentStep(
      {
        hasPending,
        sessionLoading: loading,
        hasSession: session !== null,
        signingIn,
        connected,
        connecting,
        modalVisible: visible,
      },
      memo.current,
    );
    memo.current = step.memo;
    if (step.action === "clear") {
      setPending(null);
    } else if (step.action === "signIn") {
      void signIn().then((ok) => {
        if (!ok) clear();
      });
    }
  }, [hasPending, loading, session, signingIn, connected, connecting, visible, signIn, clear]);

  return { pending, start, clear };
}

export default useSignInIntent;
