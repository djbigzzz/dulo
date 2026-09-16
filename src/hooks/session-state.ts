/**
 * Pure state logic behind SessionProvider, useApiQuery's session awareness and the
 * "sign in, then carry on" intent flow. No React, no window: unit-tested in node
 * (tests/session-state.test.ts).
 */

import type { Session, SessionUser } from "@/hooks/session-helpers";

// ---------------------------------------------------------------------------
// Session reducer
// ---------------------------------------------------------------------------

export interface SessionState {
  session: Session | null;
  user: SessionUser | null;
  /** True until the first /auth/me round-trip has settled. */
  loading: boolean;
  /** True while a sign-in (nonce -> signature -> verify) is in flight. */
  signingIn: boolean;
  /**
   * Bumped every time the server session changes in a way that can change what the
   * API returns: a different identity from /auth/me, every successful verify (linking a
   * wallet keeps the userId but changes the Plays), and sign-out. Data hooks key on it.
   * Never decreases.
   */
  sessionVersion: number;
}

export type SessionAction =
  /** /auth/me answered (session may be null). */
  | { type: "loaded"; session: Session | null; user: SessionUser | null }
  /** /auth/me failed (network / 5xx). */
  | { type: "loadFailed" }
  | { type: "signInStart" }
  /** /auth/verify accepted the signature; the cookie is set. */
  | { type: "signInSuccess"; session: Session }
  /** The sign-in attempt is over (success or not). */
  | { type: "signInEnd" }
  | { type: "signedOut" };

export const INITIAL_SESSION_STATE: SessionState = {
  session: null,
  user: null,
  loading: true,
  signingIn: false,
  sessionVersion: 0,
};

/** Stable identity string for a session; "" when signed out. */
export function sessionIdentity(session: Session | null): string {
  return session ? `${session.userId}|${session.walletId}|${session.address}` : "";
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "loaded": {
      const changed = sessionIdentity(state.session) !== sessionIdentity(action.session);
      return {
        ...state,
        session: action.session,
        user: action.session ? action.user : null,
        loading: false,
        sessionVersion: changed ? state.sessionVersion + 1 : state.sessionVersion,
      };
    }
    case "loadFailed":
      // First check failed: render as signed out. A later failed refresh keeps the
      // session we already have; only the server saying "no session" (or signOut) drops it.
      return state.loading ? { ...state, session: null, user: null, loading: false } : state;
    case "signInStart":
      return state.signingIn ? state : { ...state, signingIn: true };
    case "signInSuccess": {
      const sameUser = state.session?.userId === action.session.userId;
      return {
        ...state,
        session: action.session,
        user: sameUser ? state.user : null,
        loading: false,
        sessionVersion: state.sessionVersion + 1,
      };
    }
    case "signInEnd":
      return state.signingIn ? { ...state, signingIn: false } : state;
    case "signedOut":
      return {
        ...state,
        session: null,
        user: null,
        loading: false,
        sessionVersion: state.session ? state.sessionVersion + 1 : state.sessionVersion,
      };
    default:
      return state;
  }
}

/** Sign-in outcome as seen by the UI: a new account vs a wallet added to the current one. */
export function signInOutcome(previous: Session | null, next: Session): "linked" | "signedIn" {
  return previous !== null && previous.userId === next.userId && previous.address !== next.address ? "linked" : "signedIn";
}

// ---------------------------------------------------------------------------
// useApiQuery helpers
// ---------------------------------------------------------------------------

export type QueryKeyPart = string | number | boolean | null | undefined;
export type QueryKey = string | readonly QueryKeyPart[];

/** A string key stays as is; a parts list becomes one stable string ("" and null/undefined collapse). */
export function queryKeyString(key: QueryKey): string {
  if (typeof key === "string") return key;
  return key.map((p) => (p === null || p === undefined ? "" : String(p))).join("␟");
}

/**
 * Whether a query should hold its first request until the session check settles, so a
 * signed-in visitor does not fetch the page twice (once before /auth/me, once after).
 * `waitExpired` caps the wait so a slow /auth/me never blocks the page.
 */
export function shouldAwaitSession(opts: { awaitSession: boolean; sessionLoading: boolean; waitExpired: boolean }): boolean {
  return opts.awaitSession && opts.sessionLoading && !opts.waitExpired;
}

/**
 * Whether a focus / visibility event should refetch. Never while a sign-in is in flight:
 * the wallet popup steals focus and hands it back before /auth/verify has set the cookie,
 * so that refetch would read signed-out data. The session change refetches instead.
 */
export function shouldRefetchOnFocus(opts: {
  hidden: boolean;
  sinceLastRunMs: number;
  throttleMs: number;
  signingIn: boolean;
}): boolean {
  if (opts.hidden || opts.signingIn) return false;
  return opts.sinceLastRunMs >= opts.throttleMs;
}

// ---------------------------------------------------------------------------
// Sign-in intent ("pressed Yes while signed out: connect, sign in, then open the Call")
// ---------------------------------------------------------------------------

export interface IntentInputs {
  hasPending: boolean;
  sessionLoading: boolean;
  hasSession: boolean;
  signingIn: boolean;
  connected: boolean;
  connecting: boolean;
  modalVisible: boolean;
}

export interface IntentMemo {
  /** The wallet modal was open at some point for this intent. */
  sawModal: boolean;
  /** A sign-in ran (ours or one the user started from the header) for this intent. */
  attempted: boolean;
}

export const INITIAL_INTENT_MEMO: IntentMemo = { sawModal: false, attempted: false };

export type IntentAction = "none" | "signIn" | "clear";

/**
 * One step of the intent state machine, evaluated whenever its inputs change.
 *
 * - Session present: nothing to do; the page consumes the intent once its data says signed in.
 * - Connected, no session: sign in once. If that attempt ends without a session
 *   (cancelled, refused, failed), drop the intent so nothing opens later by surprise.
 * - Not connected: wait while the modal is open or a connection is in progress. The
 *   modal hides 150 ms after a wallet is picked, by which time `connecting` is already
 *   true, so "modal seen, now closed, not connecting, not connected" means the modal was
 *   dismissed or the connection failed (the adapter unselects the wallet): drop the intent.
 */
export function intentStep(inputs: IntentInputs, memo: IntentMemo): { action: IntentAction; memo: IntentMemo } {
  if (!inputs.hasPending) return { action: "none", memo: INITIAL_INTENT_MEMO };
  if (inputs.hasSession) return { action: "none", memo };

  if (inputs.connected) {
    if (inputs.sessionLoading) return { action: "none", memo };
    if (inputs.signingIn) return { action: "none", memo: memo.attempted ? memo : { ...memo, attempted: true } };
    if (memo.attempted) return { action: "clear", memo: INITIAL_INTENT_MEMO };
    return { action: "signIn", memo: { ...memo, attempted: true } };
  }

  if (inputs.modalVisible) return { action: "none", memo: memo.sawModal ? memo : { ...memo, sawModal: true } };
  if (inputs.connecting) return { action: "none", memo };
  // Modal dismissed / connection failed, or the wallet went away after a sign-in attempt.
  if (memo.sawModal || memo.attempted) return { action: "clear", memo: INITIAL_INTENT_MEMO };
  return { action: "none", memo };
}
