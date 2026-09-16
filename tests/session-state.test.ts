import { describe, expect, it, vi } from "vitest";

// WalletProvider imports the wallet modal stylesheet; the node test env has no CSS pipeline.
vi.mock("@solana/wallet-adapter-react-ui/styles.css", () => ({}));
import { createElement, useContext } from "react";
import { renderToString } from "react-dom/server";
import {
  INITIAL_INTENT_MEMO,
  INITIAL_SESSION_STATE,
  intentStep,
  queryKeyString,
  sessionIdentity,
  sessionReducer,
  shouldAwaitSession,
  shouldRefetchOnFocus,
  signInOutcome,
  type IntentInputs,
  type IntentMemo,
  type SessionAction,
  type SessionState,
} from "@/hooks/session-state";
import type { Session, SessionUser } from "@/hooks/session-helpers";
import { SessionContext } from "@/hooks/session-context";

const CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const A: Session = { userId: "u1", walletId: "w1", address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", chainId: CHAIN };
const A2: Session = { userId: "u1", walletId: "w2", address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", chainId: CHAIN };
const B: Session = { userId: "u2", walletId: "w3", address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", chainId: CHAIN };
const USER_A: SessionUser = { id: "u1", handle: null, wallets: [{ chainId: CHAIN, address: A.address, isPrimary: true }] };

function run(actions: SessionAction[], from: SessionState = INITIAL_SESSION_STATE): SessionState {
  return actions.reduce(sessionReducer, from);
}

describe("sessionReducer", () => {
  it("starts loading with no session, identical on server and client", () => {
    expect(INITIAL_SESSION_STATE).toEqual({ session: null, user: null, loading: true,signingIn: false, sessionVersion: 0 });
  });

  it("a signed-out first check settles loading without bumping the version (no refetch for anonymous visitors)", () => {
    const s = run([{ type: "loaded", session: null, user: null }]);
    expect(s.loading).toBe(false);
    expect(s.session).toBeNull();
    expect(s.sessionVersion).toBe(0);
  });

  it("a signed-in first check bumps the version once; repeating the same /me does not", () => {
    const s1 = run([{ type: "loaded", session: A, user: USER_A }]);
    expect(s1.session).toEqual(A);
    expect(s1.user).toEqual(USER_A);
    expect(s1.sessionVersion).toBe(1);
    const s2 = run([{ type: "loaded", session: { ...A }, user: USER_A }], s1);
    expect(s2.sessionVersion).toBe(1);
  });

  it("sign-in flow: start -> success bumps the version immediately (pages refetch) -> /me refresh -> end", () => {
    let s = run([{ type: "loaded", session: null, user: null }]);
    s = sessionReducer(s, { type: "signInStart" });
    expect(s.signingIn).toBe(true);
    expect(s.sessionVersion).toBe(0);

    s = sessionReducer(s, { type: "signInSuccess", session: A });
    expect(s.session).toEqual(A);
    expect(s.signingIn).toBe(true);
    expect(s.sessionVersion).toBe(1);

    s = sessionReducer(s, { type: "loaded", session: A, user: USER_A });
    expect(s.user).toEqual(USER_A);
    expect(s.sessionVersion).toBe(1); // same identity: no second refetch

    s = sessionReducer(s, { type: "signInEnd" });
    expect(s.signingIn).toBe(false);
  });

  it("linking a wallet to the same user still bumps the version (Plays change) and keeps the user", () => {
    const signedIn = run([{ type: "loaded", session: A, user: USER_A }]);
    const linked = sessionReducer(signedIn, { type: "signInSuccess", session: A2 });
    expect(linked.sessionVersion).toBe(signedIn.sessionVersion + 1);
    expect(linked.user).toEqual(USER_A);
    expect(signInOutcome(A, A2)).toBe("linked");
  });

  it("switching account drops the stale user and bumps the version", () => {
    const signedIn = run([{ type: "loaded", session: A, user: USER_A }]);
    const switched = sessionReducer(signedIn, { type: "signInSuccess", session: B });
    expect(switched.user).toBeNull();
    expect(switched.sessionVersion).toBe(signedIn.sessionVersion + 1);
    expect(signInOutcome(A, B)).toBe("signedIn");
    expect(signInOutcome(null, A)).toBe("signedIn");
    expect(signInOutcome(A, A)).toBe("signedIn");
  });

  it("sign-out clears the session and bumps only when there was one", () => {
    const signedIn = run([{ type: "loaded", session: A, user: USER_A }]);
    const out = sessionReducer(signedIn, { type: "signedOut" });
    expect(out.session).toBeNull();
    expect(out.user).toBeNull();
    expect(out.sessionVersion).toBe(signedIn.sessionVersion + 1);

    const anon = run([{ type: "loaded", session: null, user: null }, { type: "signedOut" }]);
    expect(anon.sessionVersion).toBe(0);
  });

  it("a failed first /me renders signed out; a failed later refresh keeps the session", () => {
    const first = run([{ type: "loadFailed" }]);
    expect(first.loading).toBe(false);
    expect(first.session).toBeNull();

    const signedIn = run([{ type: "loaded", session: A, user: USER_A }]);
    expect(sessionReducer(signedIn, { type: "loadFailed" })).toBe(signedIn);
  });

  it("the version never decreases across any action sequence", () => {
    const actions: SessionAction[] = [
      { type: "loaded", session: A, user: USER_A },
      { type: "signedOut" },
      { type: "loadFailed" },
      { type: "signInStart" },
      { type: "signInSuccess", session: B },
      { type: "loaded", session: null, user: null },
      { type: "signInEnd" },
      { type: "loaded", session: A, user: null },
    ];
    let s = INITIAL_SESSION_STATE;
    for (const a of actions) {
      const next = sessionReducer(s, a);
      expect(next.sessionVersion).toBeGreaterThanOrEqual(s.sessionVersion);
      s = next;
    }
    expect(s.sessionVersion).toBe(5);
  });

  it("start/end are idempotent (no new state object when nothing changes)", () => {
    const s = run([{ type: "signInStart" }]);
    expect(sessionReducer(s, { type: "signInStart" })).toBe(s);
    const e = run([{ type: "signInEnd" }]);
    expect(e).toBe(INITIAL_SESSION_STATE);
  });

  it("identity covers user, wallet and address", () => {
    expect(sessionIdentity(null)).toBe("");
    expect(sessionIdentity(A)).not.toBe(sessionIdentity(A2));
    expect(sessionIdentity(A)).toBe(sessionIdentity({ ...A }));
  });
});

describe("useApiQuery helpers", () => {
  it("queryKeyString keeps strings and joins parts stably", () => {
    expect(queryKeyString("abc")).toBe("abc");
    expect(queryKeyString(["wallet", "u1"])).toBe(queryKeyString(["wallet", "u1"]));
    expect(queryKeyString(["wallet", null])).toBe(queryKeyString(["wallet", ""]));
    expect(queryKeyString(["wallet", undefined])).toBe(queryKeyString(["wallet", ""]));
    // Signing in changes the key; part boundaries are not ambiguous.
    expect(queryKeyString(["wallet", ""])).not.toBe(queryKeyString(["wallet", "u1"]));
    expect(queryKeyString(["a:b", "c"])).not.toBe(queryKeyString(["a", "b:c"]));
  });

  it("holds the first request only while the session check is pending and the wait has not expired", () => {
    expect(shouldAwaitSession({ awaitSession: true, sessionLoading: true, waitExpired: false })).toBe(true);
    expect(shouldAwaitSession({ awaitSession: true, sessionLoading: false, waitExpired: false })).toBe(false);
    expect(shouldAwaitSession({ awaitSession: true, sessionLoading: true, waitExpired: true })).toBe(false);
    expect(shouldAwaitSession({ awaitSession: false, sessionLoading: true, waitExpired: false })).toBe(false);
  });

  it("never refetches on focus while signing in (the wallet popup returns focus before the cookie is set)", () => {
    const base = { hidden: false, sinceLastRunMs: 10_000, throttleMs: 2000, signingIn: false };
    expect(shouldRefetchOnFocus(base)).toBe(true);
    expect(shouldRefetchOnFocus({ ...base, signingIn: true })).toBe(false);
    expect(shouldRefetchOnFocus({ ...base, hidden: true })).toBe(false);
    expect(shouldRefetchOnFocus({ ...base, sinceLastRunMs: 500 })).toBe(false);
  });
});

describe("intentStep (Calls: pressed a side while signed out)", () => {
  const idle: IntentInputs = {
    hasPending: true,
    sessionLoading: false,
    hasSession: false,
    signingIn: false,
    connected: false,
    connecting: false,
    modalVisible: false,
  };

  /** Feed a sequence of input snapshots; return each action. */
  function play(frames: Partial<IntentInputs>[], memo: IntentMemo = INITIAL_INTENT_MEMO) {
    const actions: string[] = [];
    let m = memo;
    for (const f of frames) {
      const step = intentStep({ ...idle, ...f }, m);
      actions.push(step.action);
      m = step.memo;
    }
    return { actions, memo: m };
  }

  it("does nothing without a pending intent and resets its memory", () => {
    const step = intentStep({ ...idle, hasPending: false, connected: true }, { sawModal: true, attempted: true });
    expect(step).toEqual({ action: "none", memo: INITIAL_INTENT_MEMO });
  });

  it("not connected: modal opens, wallet picked, connects, then signs in exactly once and waits for the session", () => {
    const { actions } = play([
      { modalVisible: true },
      { modalVisible: true, connecting: true },
      { connecting: true }, // modal hides 150 ms after the pick
      { connected: true }, // -> auto sign-in, no second click
      { connected: true, signingIn: true },
      { connected: true, signingIn: true, hasSession: true },
      { connected: true, hasSession: true },
    ]);
    expect(actions).toEqual(["none", "none", "none", "signIn", "none", "none", "none"]);
  });

  it("clears when the modal is closed without picking a wallet", () => {
    expect(play([{ modalVisible: true }, {}]).actions).toEqual(["none", "clear"]);
  });

  it("clears when the connection fails or is rejected after picking", () => {
    expect(play([{ modalVisible: true }, { connecting: true }, {}]).actions).toEqual(["none", "none", "clear"]);
  });

  it("clears when the signature is cancelled or the sign-in fails (no retry loop, no surprise dialog later)", () => {
    const { actions, memo } = play([{ connected: true }, { connected: true, signingIn: true }, { connected: true }]);
    expect(actions).toEqual(["signIn", "none", "clear"]);
    expect(memo).toEqual(INITIAL_INTENT_MEMO);
  });

  it("already connected: signs in straight away, once, even if inputs re-render before signingIn lands", () => {
    const first = intentStep({ ...idle, connected: true }, INITIAL_INTENT_MEMO);
    expect(first.action).toBe("signIn");
    expect(first.memo.attempted).toBe(true);
  });

  it("waits for the first session check before signing in (the visitor may already be signed in)", () => {
    expect(play([{ connected: true, sessionLoading: true }, { connected: true, hasSession: true }]).actions).toEqual(["none", "none"]);
  });

  it("adopts a sign-in the user already started from the header instead of asking for a second signature", () => {
    expect(play([{ connected: true, signingIn: true }, { connected: true, signingIn: true, hasSession: true }, { connected: true, hasSession: true }]).actions).toEqual([
      "none",
      "none",
      "none",
    ]);
    // ...and drops the intent if that header sign-in is cancelled.
    expect(play([{ connected: true, signingIn: true }, { connected: true }]).actions).toEqual(["none", "clear"]);
  });

  it("with a session present it never signs in (the page opens the Call when its data catches up)", () => {
    expect(play([{ connected: true, hasSession: true }, { hasSession: true }]).actions).toEqual(["none", "none"]);
  });

  it("clears if the wallet disconnects after a sign-in attempt", () => {
    expect(play([{ connected: true }, { connected: true, signingIn: true }, { signingIn: false }]).actions).toEqual(["signIn", "none", "clear"]);
  });
});

describe("SSR / hydration", () => {
  it("the context default is null and a provider value renders identically on server and first client render", () => {
    function Probe() {
      const ctx = useContext(SessionContext);
      return createElement("span", null, ctx ? `${ctx.loading}:${ctx.session?.userId ?? "-"}:${ctx.sessionVersion}` : "none");
    }
    expect(renderToString(createElement(Probe))).toBe("<span>none</span>");

    const initial = {
      ...INITIAL_SESSION_STATE,
      walletMismatch: false,
      signIn: async () => false,
      signOut: async () => undefined,
      refresh: async () => undefined,
    };
    // SessionProvider's first render uses INITIAL_SESSION_STATE on both sides (no window, no storage).
    const html = renderToString(createElement(SessionContext.Provider, { value: initial }, createElement(Probe)));
    expect(html).toBe("<span>true:-:0</span>");
  });

  it("the real WalletProvider > SessionProvider tree server-renders the signed-out, loading state (banner hidden, one shared context)", async () => {
    const { default: WalletProvider } = await import("@/components/wallet/WalletProvider");
    const { SignInBanner } = await import("@/components/common/SignInBanner");
    const { useSession } = await import("@/hooks/useSession");
    function Probe({ id }: { id: string }) {
      const s = useSession();
      return createElement("i", { "data-id": id }, `${s.loading}:${s.session ? "in" : "out"}:${s.signingIn}:${s.sessionVersion}`);
    }
    const html = renderToString(
      createElement(
        WalletProvider,
        null,
        createElement(Probe, { id: "header" }),
        createElement(SignInBanner, { title: "Sign in to make a prediction." }),
        createElement(Probe, { id: "page" }),
      ),
    );
    expect(html).toContain('<i data-id="header">true:out:false:0</i>');
    expect(html).toContain('<i data-id="page">true:out:false:0</i>');
    expect(html).not.toContain("Sign in to make a prediction."); // banner waits for the session check
    // Cold-imports the whole wallet-adapter tree: ~1.5s alone, past vitest's 5s default when the
    // full suite transforms every file in parallel.
  }, 30_000);

  it("useSession outside the provider fails loudly instead of silently holding its own state", async () => {
    const { useSession } = await import("@/hooks/useSession");
    function Orphan() {
      useSession();
      return null;
    }
    expect(() => renderToString(createElement(Orphan))).toThrow(/SessionProvider/);
  });
});
