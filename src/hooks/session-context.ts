"use client";

import { createContext } from "react";
import type { Session, SessionUser } from "@/hooks/session-helpers";

export interface SignInOptions {
  /**
   * Already signed in and the connected wallet belongs to another account: sign in to
   * that account (replacing the current session) instead of failing with 409.
   */
  switch?: boolean;
}

export interface UseSessionResult {
  session: Session | null;
  user: SessionUser | null;
  /** True until the first /auth/me round-trip has settled. */
  loading: boolean;
  /** True while a sign-in (nonce -> signature -> verify) is in flight. */
  signingIn: boolean;
  /**
   * Signed in, but the connected wallet is a different address. The session is kept:
   * signIn() adds the wallet to the account, signIn({ switch: true }) moves to the
   * account that already owns it.
   */
  walletMismatch: boolean;
  /**
   * Increases every time the server session changes (sign-in, wallet linked, account
   * switched, sign-out, or /auth/me reporting a different identity). useApiQuery refetches
   * on it, so page data follows the session without a reload.
   */
  sessionVersion: number;
  /**
   * Sign in with the connected wallet (SIWS). With an existing session this links the
   * wallet to the signed-in account. Errors are toasted, not thrown. Resolves true when
   * the server accepted the signature.
   */
  signIn(opts?: SignInOptions): Promise<boolean>;
  /** Clear the server session and disconnect the wallet. */
  signOut(): Promise<void>;
  /** Re-fetch /api/v1/auth/me. */
  refresh(): Promise<void>;
}

/** Null outside <SessionProvider> (mounted once inside WalletProvider). */
export const SessionContext = createContext<UseSessionResult | null>(null);
SessionContext.displayName = "SessionContext";
