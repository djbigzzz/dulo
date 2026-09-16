import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  NO_CASH_VALUE,
  accountPointsLines,
  apiFetch,
  errorMessage,
  isUserRejection,
  isWalletMismatch,
  isWelcomeGrant,
  rankLabel,
  signInToast,
  signedPoints,
  starterPointsHint,
  truncateAddress,
  unwrapEnvelope,
  type Session,
  type SessionUser,
  type VerifyResult,
} from "@/hooks/session-helpers";
import { STARTER_POINTS, VIRTUAL_CASH_USD, WELCOME_COPY, WELCOME_TITLE, type PointsSummary } from "@/lib/games/ledger-policy";
import { signInOutcome } from "@/hooks/session-state";
import { withDefaults } from "@/lib/api-client";
import { isActivePath } from "@/components/layout/nav";

const ADDRESS = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const OTHER = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";

describe("isWalletMismatch", () => {
  const session: Session = { userId: "u1", walletId: "w1", address: ADDRESS, chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" };

  it("is true only when signed in, connected, and the connected address differs", () => {
    expect(isWalletMismatch(session, true, OTHER)).toBe(true);
    expect(isWalletMismatch(session, true, ADDRESS)).toBe(false);
  });

  it("is false with no session, no connection, or no address", () => {
    expect(isWalletMismatch(null, true, OTHER)).toBe(false);
    expect(isWalletMismatch(session, false, OTHER)).toBe(false);
    expect(isWalletMismatch(session, true, null)).toBe(false);
  });
});

describe("withDefaults", () => {
  it("keeps defaults when no headers are given", () => {
    const h = withDefaults(undefined, { accept: "application/json" });
    expect(h.get("accept")).toBe("application/json");
  });

  it("layers a plain record, a Headers instance, and a tuple list over the defaults", () => {
    const defaults = { accept: "application/json", "content-type": "application/json" };

    const fromRecord = withDefaults({ "X-Trace": "r", Accept: "text/plain" }, defaults);
    expect(fromRecord.get("x-trace")).toBe("r");
    expect(fromRecord.get("accept")).toBe("text/plain");
    expect(fromRecord.get("content-type")).toBe("application/json");

    const fromHeaders = withDefaults(new Headers({ "X-Trace": "h" }), defaults);
    expect(fromHeaders.get("x-trace")).toBe("h");
    expect(fromHeaders.get("accept")).toBe("application/json");

    const fromTuples = withDefaults([["X-Trace", "t"]], defaults);
    expect(fromTuples.get("x-trace")).toBe("t");
    expect(fromTuples.get("content-type")).toBe("application/json");
  });
});

describe("truncateAddress", () => {
  it("shows 4…4 by default (first 4 and last 4 characters)", () => {
    expect(truncateAddress(ADDRESS)).toBe("XsDo…HzoB");
  });
  it("keeps `head` and `tail` characters when given", () => {
    // ADDRESS ends in "...MLodqsJHzoB": the last 8 characters are "dqsJHzoB".
    expect(truncateAddress(ADDRESS, 8, 8)).toBe("XsDoVfqe…dqsJHzoB");
    expect(truncateAddress(ADDRESS, 6, 2)).toBe("XsDoVf…oB");
  });
  it("leaves short strings alone and handles empty", () => {
    expect(truncateAddress("abcdefgh")).toBe("abcdefgh");
    expect(truncateAddress("abcdefghi")).toBe("abcdefghi"); // head + tail + 1 = 9: nothing gained by an ellipsis
    expect(truncateAddress("abcdefghij")).toBe("abcd…ghij");
    expect(truncateAddress("")).toBe("");
  });
});

describe("unwrapEnvelope", () => {
  it("returns data on ok", () => {
    expect(unwrapEnvelope<{ a: number }>({ ok: true, data: { a: 1 } })).toEqual({ a: 1 });
  });
  it("throws ApiClientError with the server message on failure", () => {
    try {
      unwrapEnvelope({ ok: false, error: "Unauthorized", issues: [1] }, 401);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiClientError);
      expect((e as ApiClientError).message).toBe("Unauthorized");
      expect((e as ApiClientError).status).toBe(401);
      expect((e as ApiClientError).issues).toEqual([1]);
    }
  });
  it("throws on a non-envelope body", () => {
    expect(() => unwrapEnvelope("nope", 500)).toThrow(/Unexpected response/);
    expect(() => unwrapEnvelope(null, 502)).toThrow(/502/);
  });
});

describe("apiFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends cookies, JSON headers for bodies, and unwraps the envelope", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: { echoed: init?.body } }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const data = await apiFetch<{ echoed: string }>("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
    });
    expect(data.echoed).toBe(JSON.stringify({ x: 1 }));
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("surfaces server errors and non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: "No session" }) })),
    );
    await expect(apiFetch("/api/v1/auth/me")).rejects.toThrow("No session");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    await expect(apiFetch("/api/v1/auth/me")).rejects.toThrow(/503/);
  });
});

describe("isUserRejection / errorMessage", () => {
  it("detects wallet rejections by name, message, or code", () => {
    expect(isUserRejection({ name: "WalletSignMessageError", message: "User rejected the request." })).toBe(true);
    expect(isUserRejection({ code: 4001, message: "" })).toBe(true);
    expect(isUserRejection(new Error("Transaction cancelled"))).toBe(true);
    expect(isUserRejection(new Error("Network down"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
  it("produces a readable message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage({})).toBe("Something went wrong");
    expect(errorMessage(undefined, "x")).toBe("x");
  });
});

describe("isActivePath", () => {
  it("matches exact and nested paths, never siblings", () => {
    expect(isActivePath("/rewards", "/rewards")).toBe(true);
    expect(isActivePath("/rewards/first_position", "/rewards")).toBe(true);
    expect(isActivePath("/rewardsx", "/rewards")).toBe(false);
    expect(isActivePath("/", "/rewards")).toBe(false);
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath(null, "/rewards")).toBe(false);
  });
});

describe("signInToast — the toast after a successful verify", () => {
  const welcome = { starterPoints: STARTER_POINTS, virtualCashUsd: VIRTUAL_CASH_USD };

  it("says Signed in for an ordinary sign-in and Wallet added for a linked wallet", () => {
    expect(signInToast("signedIn", null)).toEqual({ title: "Signed in", description: "The entertainment layer for xStocks." });
    expect(signInToast("signed_in")).toEqual({ title: "Signed in", description: "The entertainment layer for xStocks." });
    expect(signInToast("linked", null)).toEqual({ title: "Wallet added", description: "Quests now verify against this wallet too." });
    expect(signInToast("signedIn").action).toBeUndefined();
  });

  it("welcomes the request that wrote the starter grant, with the verbatim copy and a prediction action", () => {
    expect(signInToast("signedIn", welcome)).toEqual({
      title: WELCOME_TITLE,
      description: WELCOME_COPY,
      action: { label: "Make a prediction", href: "/predictions" },
    });
    expect(WELCOME_TITLE).toBe("Welcome to Dulo");
    // The copy states both numbers the policy grants, and that it is points only.
    expect(WELCOME_COPY).toContain(`${STARTER_POINTS.toLocaleString("en-US")} starter points`);
    expect(WELCOME_COPY).toContain(`$${VIRTUAL_CASH_USD.toLocaleString("en-US")} of virtual cash`);
    expect(WELCOME_COPY).toContain("The starter grant itself isn't ranked; once a prediction settles, what you put in and get back counts toward your Season points.");
    expect(WELCOME_COPY).toContain("Points only, no cash value.");
  });

  it("never loses the one-off welcome, even when the sign-in linked a wallet", () => {
    expect(signInToast("linked", welcome).title).toBe(WELCOME_TITLE);
  });

  it("reads the welcome defensively: null, zero, malformed or missing is no welcome", () => {
    for (const w of [null, undefined, { starterPoints: 0, virtualCashUsd: 10_000 }, { starterPoints: Number.NaN, virtualCashUsd: 0 }]) {
      expect(signInToast("signedIn", w as VerifyResult["welcome"]).title, JSON.stringify(w)).toBe("Signed in");
    }
    expect(isWelcomeGrant(welcome)).toBe(true);
    expect(isWelcomeGrant({ starterPoints: "1000" })).toBe(false);
    expect(isWelcomeGrant({})).toBe(false);
    expect(isWelcomeGrant("welcome")).toBe(false);
    expect(isWelcomeGrant(null)).toBe(false);
  });

  it("feeds from signInOutcome as SessionProvider calls it", () => {
    const a: Session = { userId: "u1", walletId: "w1", address: ADDRESS, chainId: "solana:x" };
    const b: Session = { ...a, walletId: "w2", address: OTHER };
    expect(signInToast(signInOutcome(a, b)).title).toBe("Wallet added");
    expect(signInToast(signInOutcome(null, a)).title).toBe("Signed in");
    expect(signInToast(signInOutcome(null, a), welcome).title).toBe(WELCOME_TITLE);
  });
});

describe("accountPointsLines — the account menu's points block", () => {
  const summary = (over: Partial<PointsSummary> = {}): PointsSummary => ({
    seasonId: "s0",
    balance: 1000,
    seasonPoints: 50,
    starterPoints: 1000,
    inPredictions: 0,
    rank: 12,
    ...over,
  });

  it("shows the balance, Season points with rank, and the compliance line", () => {
    expect(accountPointsLines(summary())).toEqual(["Points balance 1,000 pts", "Season points 50 · Rank #12", "Points only, no cash value"]);
  });

  it("says Not ranked yet without a rank, including after losses", () => {
    expect(accountPointsLines(summary({ seasonPoints: 0, rank: null }))[1]).toBe("Season points 0 · Not ranked yet");
    expect(accountPointsLines(summary({ balance: 825, seasonPoints: -50, rank: null }))).toEqual([
      "Points balance 825 pts",
      "Season points -50 · Not ranked yet",
      "Points only, no cash value",
    ]);
  });

  it("keeps only the compliance line when /me sent no points", () => {
    expect(accountPointsLines(null)).toEqual([NO_CASH_VALUE]);
    expect(accountPointsLines(undefined)).toEqual(["Points only, no cash value"]);
  });

  it("never prints NaN or a fraction", () => {
    const lines = accountPointsLines(summary({ balance: Number.NaN, seasonPoints: 12.6, rank: 0 }));
    expect(lines).toEqual(["Points balance 0 pts", "Season points 13 · Not ranked yet", "Points only, no cash value"]);
    expect(lines.join(" ")).not.toMatch(/NaN|undefined|null/);
  });

  it("formats large numbers with separators", () => {
    expect(accountPointsLines(summary({ balance: 12_345, seasonPoints: 4_500, rank: 1_234 })).slice(0, 2)).toEqual([
      "Points balance 12,345 pts",
      "Season points 4,500 · Rank #1,234",
    ]);
  });

  it("is carried on the session user without changing its other fields", () => {
    const user: SessionUser = { id: "u1", handle: null, wallets: [], points: summary() };
    expect(accountPointsLines(user.points)[0]).toBe("Points balance 1,000 pts");
    const older: SessionUser = { id: "u1", handle: null, wallets: [] };
    expect(accountPointsLines(older.points)).toEqual([NO_CASH_VALUE]);
  });
});

describe("points display helpers", () => {
  it("signs credits and debits with a true minus sign", () => {
    expect(signedPoints(1000)).toBe("+1,000");
    expect(signedPoints(50)).toBe("+50");
    expect(signedPoints(-100)).toBe("−100");
    expect(signedPoints(-2500)).toBe("−2,500");
    expect(signedPoints(0)).toBe("0");
    expect(signedPoints(-0.2)).toBe("0");
    expect(signedPoints(Number.NaN)).toBe("0");
  });

  it("labels a rank or its absence", () => {
    expect(rankLabel(1)).toBe("Rank #1");
    expect(rankLabel(1500)).toBe("Rank #1,500");
    for (const r of [null, undefined, 0, -1, Number.NaN]) expect(rankLabel(r), String(r)).toBe("Not ranked yet");
  });

  it("mentions starter points only while some are held this Season", () => {
    expect(starterPointsHint(1000)).toBe("Includes 1,000 starter points");
    expect(starterPointsHint(0)).toBe("Points only, no cash value");
    expect(starterPointsHint(undefined)).toBe("Points only, no cash value");
    expect(starterPointsHint(null)).toBe("Points only, no cash value");
  });
});
