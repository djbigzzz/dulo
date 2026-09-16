"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import type { SignInMessageSignerWalletAdapterProps } from "@solana/wallet-adapter-base";
import bs58 from "bs58";
import { toast } from "sonner";
import { buildSiwsMessage, siwsInputFromNonce } from "@/lib/auth/siws";
import {
  ApiClientError,
  apiFetch,
  errorMessage,
  isUserRejection,
  isWalletMismatch,
  signInToast,
  type NonceResponse,
  type Session,
  type SessionUser,
  type VerifyBody,
  type VerifyResult,
} from "@/hooks/session-helpers";
import { SessionContext, type SignInOptions, type UseSessionResult } from "@/hooks/session-context";
import { INITIAL_SESSION_STATE, sessionReducer, signInOutcome } from "@/hooks/session-state";

type MeResponse = { session: Session | null; user?: SessionUser | null };

/**
 * The /me user as the session keeps it. `points` is carried through as sent (a PointsSummary, or
 * null when the server could not read it); anything that is not an object is dropped, so an older
 * server or a malformed field never breaks the header.
 */
function sessionUserOf(user: SessionUser | null | undefined): SessionUser | null {
  if (!user) return null;
  const points = user.points && typeof user.points === "object" ? user.points : null;
  return { ...user, points };
}

/**
 * The one server session (httpOnly cookie) for the whole app. Mounted once inside
 * WalletProvider, so the header ConnectButton, every SignInBanner and every page read the
 * same state: a sign-in anywhere updates all of them, and `sessionVersion` makes
 * useApiQuery refetch page data.
 *
 * - Fetches /api/v1/auth/me on mount and whenever the connected public key changes.
 * - Never drops a session because the wallet changed: users own N wallets, so a
 *   different connected address is surfaced as `walletMismatch` and the UI offers to
 *   add it to the account or switch accounts.
 * - signIn() prefers wallet-standard signIn (Phantom, Backpack, Solflare, MWA) and
 *   falls back to signMessage for adapters without it. The SIWS input comes from
 *   "@/lib/auth/siws" so the wallet signs exactly the text the server rebuilds.
 *
 * SSR: the initial state (loading, no session) is the same on the server and the first
 * client render; nothing here touches `window` during render.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { wallet, publicKey, connected, signMessage, disconnect } = useWallet();
  // A toast action's destination. The router lives in <RouterPush>, mounted only once an action
  // is pressed, so this provider still server-renders outside the app router (tests do that).
  const [navigateTo, setNavigateTo] = useState<string | null>(null);
  const [state, dispatch] = useReducer(sessionReducer, INITIAL_SESSION_STATE);
  const inflight = useRef(0);
  const signingInRef = useRef(false);
  // Latest session for signIn()'s "wallet added" toast without re-creating the callback.
  const sessionRef = useRef<Session | null>(state.session);
  sessionRef.current = state.session;

  const navigated = useCallback(() => setNavigateTo(null), []);

  const address = publicKey?.toBase58() ?? null;
  const walletMismatch = isWalletMismatch(state.session, connected, address);

  const refresh = useCallback(async () => {
    const id = ++inflight.current;
    try {
      const data = await apiFetch<MeResponse>("/api/v1/auth/me");
      if (id !== inflight.current) return; // a newer refresh, a sign-in or a sign-out won
      dispatch({ type: "loaded", session: data.session ?? null, user: sessionUserOf(data.user) });
    } catch (err) {
      if (id !== inflight.current) return;
      // A broken /me is not "signed out": keep what we have (first load renders signed out).
      console.warn("[dulo] /auth/me failed", err);
      dispatch({ type: "loadFailed" });
    }
  }, []);

  // Initial load + reload whenever the wallet (public key) changes.
  useEffect(() => {
    void refresh();
  }, [refresh, address]);

  const signIn = useCallback(
    async (opts?: SignInOptions): Promise<boolean> => {
      if (signingInRef.current) return false;
      if (!wallet || !connected || !address) {
        toast.error("Connect a wallet first");
        return false;
      }
      signingInRef.current = true;
      dispatch({ type: "signInStart" });
      try {
        const nonce = await apiFetch<NonceResponse>("/api/v1/auth/nonce");
        const input = siwsInputFromNonce(nonce, address);

        const adapter = wallet.adapter;
        const canSignIn =
          "signIn" in adapter &&
          typeof (adapter as Partial<SignInMessageSignerWalletAdapterProps>).signIn === "function";

        let body: VerifyBody;

        if (canSignIn) {
          const out = await (adapter as SignInMessageSignerWalletAdapterProps).signIn(input);
          // `message` is the decoded text the wallet actually signed, so the server's
          // signedMessage/message equality holds even if the wallet rendered the input
          // its own way. The server still parses that text strictly and checks domain,
          // URI, nonce and address, so a wallet-altered message is refused.
          body = {
            address: out.account?.address ?? address,
            message: new TextDecoder().decode(out.signedMessage),
            signature: bs58.encode(out.signature),
            signedMessage: bs58.encode(out.signedMessage),
          };
        } else {
          if (!signMessage) {
            toast.error("This wallet cannot sign messages", {
              description: "Try Phantom, Solflare or Backpack.",
            });
            return false;
          }
          const message = buildSiwsMessage(input);
          const sig = await signMessage(new TextEncoder().encode(message));
          body = { address, message, signature: bs58.encode(sig) };
        }
        if (opts?.switch) body.switch = true;

        const previous = sessionRef.current;
        const data = await apiFetch<VerifyResult>("/api/v1/auth/verify", {
          method: "POST",
          body: JSON.stringify(body),
        });
        // The cookie is set now. Invalidate any /me that left before it (it would answer
        // "signed out"), then publish the session: sessionVersion bumps and pages refetch.
        inflight.current++;
        dispatch({ type: "signInSuccess", session: data.session });
        // A first sign-in that wrote the starter grant says so (and points to a prediction);
        // otherwise "Signed in" or "Wallet added". `welcome` is read defensively.
        const { title, description, action } = signInToast(signInOutcome(previous, data.session), data.welcome);
        toast.success(
          title,
          action
            ? { description, duration: 12_000, action: { label: action.label, onClick: () => setNavigateTo(action.href) } }
            : { description },
        );
        await refresh(); // fills in `user` (and its points); same identity, so no second refetch
        return true;
      } catch (err) {
        if (isUserRejection(err)) {
          toast("Signature cancelled");
          return false;
        }
        if (err instanceof ApiClientError && err.status === 409) {
          toast.error("Wallet belongs to another account", {
            description: 'Use "Switch account" to sign in to it instead.',
          });
          return false;
        }
        console.warn("[dulo] sign-in failed", err);
        toast.error("Sign-in failed", { description: errorMessage(err) });
        return false;
      } finally {
        signingInRef.current = false;
        dispatch({ type: "signInEnd" });
      }
    },
    [address, connected, refresh, signMessage, wallet],
  );

  const signOut = useCallback(async () => {
    inflight.current++; // invalidate any in-flight /me
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch (err) {
      console.warn("[dulo] logout failed", err);
    }
    inflight.current++; // and any that started while logout was in flight
    dispatch({ type: "signedOut" });
    try {
      await disconnect();
    } catch (err) {
      console.warn("[dulo] wallet disconnect failed", err);
    }
  }, [disconnect]);

  const value = useMemo<UseSessionResult>(
    () => ({
      session: state.session,
      user: state.user,
      loading: state.loading,
      signingIn: state.signingIn,
      walletMismatch,
      sessionVersion: state.sessionVersion,
      signIn,
      signOut,
      refresh,
    }),
    [state, walletMismatch, signIn, signOut, refresh],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {navigateTo ? <RouterPush href={navigateTo} onDone={navigated} /> : null}
    </SessionContext.Provider>
  );
}

/** One client-side navigation with next/navigation's router; `onDone` unmounts it straight after. */
function RouterPush({ href, onDone }: { href: string; onDone: () => void }) {
  const router = useRouter();
  useEffect(() => {
    router.push(href);
    onDone();
  }, [router, href, onDone]);
  return null;
}

export default SessionProvider;
