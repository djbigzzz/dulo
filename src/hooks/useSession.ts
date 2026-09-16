"use client";

import { useContext } from "react";
import { SessionContext, type UseSessionResult } from "@/hooks/session-context";

export type { Session, SessionUser } from "@/hooks/session-helpers";
export type { SignInOptions, UseSessionResult } from "@/hooks/session-context";

/**
 * The app's one server session, shared by every caller (header, banners, pages).
 * State and sign-in logic live in <SessionProvider> (src/components/providers), mounted
 * once inside WalletProvider; this hook only reads it.
 */
export function useSession(): UseSessionResult {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider> (mounted by WalletProvider)");
  return ctx;
}

/** Same as useSession() but null outside the provider (for hooks that also run in isolation). */
export function useOptionalSession(): UseSessionResult | null {
  return useContext(SessionContext);
}

export default useSession;
