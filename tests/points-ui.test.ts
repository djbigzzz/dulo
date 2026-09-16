import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_TRADES_FOR_WEEKLY_POINTS,
  PREDICTION_LOSS_COPY,
  SEASON_POINTS_HINT,
  STARTER_HINT,
  STARTER_POINTS,
  VIRTUAL_CASH_USD,
  WELCOME_COPY,
  WELCOME_TITLE,
  type PointsSummary,
} from "@/lib/games/ledger-policy";
import { STARTING_CASH_USD } from "@/lib/games/league";
import { NO_CASH_VALUE, accountPointsLines, rankLabel, signInToast, signedPoints, starterPointsHint } from "@/hooks/session-helpers";
import { STAKE_LEAVES_SCORE_COPY, defaultPredictionPoints } from "@/components/calls/calls-format";
import { MIN_CALL_POINTS } from "@/lib/games/calls-limits";

/**
 * Points UI (16 Sep 2026): the welcome toast, the balance in the account menu and the xl header
 * chip, the /profile tiles and points history, the /predictions balance and loss line, the
 * leaderboard's own Season points tile, the competition's 3-trade and house bot rules, and a
 * session refresh after every prediction and trade. Source-level pins plus helper checks: the
 * pages are client components that need the wallet and session providers to render.
 */

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

/** The betting and retired words the UI never uses (tests/plain-names.test.ts has the full scan). */
const BANNED = /\bstakes?\b|\bodds\b|\bpayouts?\b|\bbets?\b|\bbetting\b|\bprediction markets?\b|\bplays?\b|\bleagues?\b|\bcalls?\b|\bmirror\b|\brewards?\b/i;

const summary = (over: Partial<PointsSummary> = {}): PointsSummary => ({
  seasonId: "season-0",
  balance: 950,
  seasonPoints: 50,
  starterPoints: STARTER_POINTS,
  inPredictions: 100,
  rank: 1,
  ...over,
});

describe("points UI — the policy numbers the copy quotes", () => {
  it("states the same numbers the ledger and the competition use", () => {
    expect(STARTER_POINTS).toBe(1000);
    expect(VIRTUAL_CASH_USD).toBe(STARTING_CASH_USD);
    expect(MIN_TRADES_FOR_WEEKLY_POINTS).toBe(3);
    expect(STARTER_HINT).toBe(`Includes ${STARTER_POINTS.toLocaleString("en-US")} starter points`);
    expect(starterPointsHint(STARTER_POINTS)).toBe(STARTER_HINT);
    expect(SEASON_POINTS_HINT).toBe("Starter grant not ranked; settled predictions are");
    expect(PREDICTION_LOSS_COPY).toBe("If it doesn't settle your way, the points you put in count against your Season points.");
  });

  it("uses no betting or retired words in any sentence it shows", () => {
    const shown = [
      WELCOME_TITLE,
      WELCOME_COPY,
      STARTER_HINT,
      SEASON_POINTS_HINT,
      PREDICTION_LOSS_COPY,
      STAKE_LEAVES_SCORE_COPY,
      NO_CASH_VALUE,
      ...accountPointsLines(summary()),
      ...accountPointsLines(summary({ rank: null, seasonPoints: 0 })),
      ...accountPointsLines(null),
      ...Object.values(signInToast("signedIn", { starterPoints: 1000, virtualCashUsd: 10_000 })).flatMap((v) =>
        typeof v === "string" ? [v] : v ? [v.label] : [],
      ),
      signInToast("linked").title,
      signInToast("linked").description,
      signInToast("signedIn").description,
    ];
    for (const text of shown) expect(BANNED.test(text), text).toBe(false);
  });

  it("walks the first session in numbers: 1,000 starter, one prediction of 100, First Prediction +50", () => {
    // After the prediction: balance 950, Season points 50 (the open prediction does not count yet).
    const after = summary({ balance: 950, seasonPoints: 50, inPredictions: 100, rank: 1 });
    // Identity from the policy: balance = Season points + starter points - points in open predictions.
    expect(after.balance).toBe(after.seasonPoints + after.starterPoints - after.inPredictions);
    expect(accountPointsLines(after)).toEqual(["Points balance 950 pts", "Season points 50 · Rank #1", "Points only, no cash value"]);
    // The next dialog still opens on 100, not on the 950 left.
    expect(defaultPredictionPoints(after.balance, MIN_CALL_POINTS)).toBe("100");
  });

  it("shows a history row's amount with its sign, and never a negative balance as a credit", () => {
    expect(signedPoints(STARTER_POINTS)).toBe("+1,000");
    expect(signedPoints(-100).startsWith("+")).toBe(false);
    expect(rankLabel(null)).toBe("Not ranked yet");
  });
});

describe("points UI — ConnectButton (header chip and account menu)", () => {
  const src = read("src/components/wallet/ConnectButton.tsx");

  it("shows the balance chip from xl only, labelled as points with no cash value", () => {
    expect(src).toContain("hidden xl:inline-flex");
    expect(src).toMatch(/<PointsChip points=\{balance\}/);
    expect(src).toContain('"Points balance, points only, no cash value"');
    expect(src).toMatch(/user\?\.points/);
  });

  it("puts the points lines in the account menu at every width", () => {
    expect(src).toContain("accountPointsLines(points)");
    expect(src).toMatch(/pointsLines\.map/);
    expect(src).toContain("tabular-nums");
    // No breakpoint hides the menu block.
    const block = src.slice(src.indexOf("pointsLines.map") - 300, src.indexOf("pointsLines.map"));
    expect(block).not.toMatch(/\b(?:hidden|sm:block|md:block|xl:block)\b/);
  });

  it("keeps the Profile link the focus-nav test pins", () => {
    expect(src).toMatch(/<Link href="\/profile" \/>/);
  });
});

describe("points UI — PlaceCallDialog", () => {
  const src = read("src/components/calls/PlaceCallDialog.tsx");

  it("shows the balance and the loss line, and opens on the 100-point default", () => {
    expect(src).toContain("{PREDICTION_LOSS_COPY}");
    expect(src).toContain("defaultPredictionPoints(spendable, MIN_CALL_POINTS)");
    expect(src).toMatch(/Balance <span[^>]*>\{formatPoints\(spendablePoints\)\}<\/span> pts/);
    expect(src).not.toMatch(/\bSpendable\b/);
    expect(src).not.toContain("spendable. Points");
    // The old default put the whole balance in.
    expect(src).not.toMatch(/String\(Math\.min\(spendable, MAX_CALL_POINTS\)\)/);
  });

  it("says how many points the viewer has below the minimum and links only to the competition and quests", () => {
    expect(src).toMatch(/You have <span[^>]*>\{formatPoints\(spendablePoints\)\}<\/span> points\./);
    const hrefs = [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.sort()).toEqual(["/competition", "/quests"]);
  });

  it("re-reads the session after a placement", () => {
    expect(src).toContain("const { refresh: refreshSession } = useSession();");
    const submit = src.slice(src.indexOf("const submit = React.useCallback"), src.indexOf("const onRadioKeyDown"));
    expect(submit).toContain("void refreshSession();");
    expect(submit.indexOf("onPlaced(result)")).toBeLessThan(submit.indexOf("void refreshSession();"));
  });

  it("keeps the amount chips unlabelled", () => {
    const chips = src.slice(src.indexOf("QUICK_STAKES.map"), src.indexOf("Max\n"));
    expect(chips).not.toMatch(/aria-label/);
  });
});

describe("points UI — /predictions", () => {
  const src = read("src/app/predictions/page.tsx");

  it("labels the balance and says when it includes starter points", () => {
    expect(src).toContain('label: "Your points balance"');
    expect(src).not.toContain("Your spendable points");
    expect(src).toContain("starterPointsHint(starterPoints, me.spendablePoints)");
    expect(src).toMatch(/user\?\.points\?\.starterPoints/);
  });

  it("lists the loss line in the details", () => {
    expect(src).toContain("<li>{PREDICTION_LOSS_COPY}</li>");
  });

  it("keeps the session chip and the closed-market line", () => {
    expect(src).toContain("<MarketSessionChip />");
    expect(src).toContain("Wall Street is closed outside market hours. Solana is not,");
  });
});

describe("points UI — /competition", () => {
  const src = read("src/app/competition/page.tsx");

  it("states the 3-trade minimum in the prize hint and the rules", () => {
    expect(src).toContain("hint: `Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points`");
    expect(src).toContain("The top 10 by virtual portfolio value on Friday earn points (1,000 for first, down to 100 for tenth) if they made at least");
    expect(src).toMatch(/\{MIN_TRADES_FOR_WEEKLY_POINTS\} trades that week\./);
    expect(src).not.toContain("Top 10 score points");
  });

  it("says house bots are ranked but never earn points, and their places give points to no one", () => {
    expect(src).toContain("House bots keep the board busy. They are ranked but never earn points, and a place held by a house bot gives its points to no one.");
    expect(src).toContain("never earn points");
    expect(src).not.toContain("never score points");
  });

  it("keeps the no-cash-value line, the virtual cash wording and the pinned layout pieces", () => {
    expect(src).toContain("<li>Points only, no cash value.</li>");
    expect(src.match(/virtual cash/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toContain('data-slot="league-trade-fab"');
    expect(src).toContain("<MarketSessionChip />");
    // The competition shows virtual cash, never the points balance.
    expect(src).not.toMatch(/points balance/i);
  });

  it("re-reads the session after a trade", () => {
    const onPlaced = src.slice(src.indexOf("const onPlaced = React.useCallback"), src.indexOf("const closed ="));
    expect(onPlaced).toContain("void refreshSession();");
    expect(src).toContain("const { session, refresh: refreshSession } = useSession();");
  });
});

describe("points UI — /profile", () => {
  const src = read("src/app/profile/page.tsx");

  it("shows the five tiles with the balance first and the Season points hint", () => {
    const labels = [...src.matchAll(/\{ label: "([^"]+)"/g), ...src.matchAll(/^\s+label: "([^"]+)",$/gm)].map((m) => m[1]);
    for (const label of ["Points balance", "Season points", "Rank", "Quests completed", "Badges"]) expect(labels, label).toContain(label);
    expect(src.indexOf('label: "Points balance"')).toBeLessThan(src.indexOf('label: "Season points"'));
    expect(src).toContain("hint: SEASON_POINTS_HINT");
    expect(src).toContain("starterPointsHint(profile.starterPoints, balance)");
    expect(src).toContain("Not ranked yet");
    // The balance falls back to Season points for an older server.
    expect(src).toMatch(/typeof profile\.balance === "number"[^\n]*: profile\.points;/);
  });

  it("lists the points history with signed amounts, and hides it when the server sends none", () => {
    expect(src).toContain("Points history");
    expect(src).toContain('"No points yet. Your starter points appear after you sign in."');
    expect(src).toContain("historyRows(profile.history)");
    expect(src).toContain("{history ? (");
    expect(src).toContain("signedPoints(row.delta)");
    expect(src).toContain('row.delta > 0 ? "text-emerald-400" : "text-muted-foreground"');
    expect(src).toContain("formatAge(ageSeconds(row.ts))");
    expect(src).toContain("HISTORY_LIMIT = 20");
  });

  it("stays inside 375px: labels truncate, amounts never shrink", () => {
    const list = src.slice(src.indexOf("history.map"), src.indexOf("{/* Quests completed */}"));
    expect(list).toContain('className="truncate text-sm font-medium"');
    expect(list).toMatch(/"shrink-0 [^"]*tabular-nums/);
    expect(list).toContain("min-w-0 flex-1");
  });

  it("always shows the no-cash-value line", () => {
    const body = src.slice(src.indexOf("function ProfileBody"));
    expect(body).toContain("Points only, no cash value.");
    expect(body.indexOf("Points only, no cash value.")).toBeLessThan(body.indexOf("{history ? ("));
  });
});

describe("points UI — /leaderboard", () => {
  const src = read("src/app/leaderboard/page.tsx");

  it("always shows the signed-in player's Season points tile, even with an empty board", () => {
    expect(src).toContain("Your Season points");
    expect(src).toContain("{profile ? <YourSeasonPoints");
    // Not gated on the board having rows.
    expect(src).toMatch(/stats \|\| profile \?/);
    expect(src).toContain("{rankLabel(profile.rank)}</span> · {SEASON_POINTS_HINT}");
    expect(src).toContain("Points balance {formatPoints(balance)}");
    expect(src).not.toContain("Not scored yet");
    expect(rankLabel(null)).toBe("Not ranked yet");
  });

  it("describes where Season points come from, and that the starter grant itself doesn't count", () => {
    expect(src).toContain('description="Season points from quests, weekly competition finishes and settled predictions. The starter grant itself doesn\'t count."');
  });
});

describe("points UI — SessionProvider", () => {
  const src = read("src/components/providers/SessionProvider.tsx");

  it("renders the welcome toast from the verify response", () => {
    expect(src).toContain("signInToast(signInOutcome(previous, data.session), data.welcome)");
    expect(src).toContain("apiFetch<VerifyResult>(\"/api/v1/auth/verify\"");
    expect(src).not.toContain('toast.success("Signed in"');
  });

  it("navigates with next/navigation's router, mounted only when the action is pressed", () => {
    expect(src).toContain('import { useRouter } from "next/navigation";');
    expect(src).toMatch(/function RouterPush[\s\S]*useRouter\(\)[\s\S]*router\.push\(href\)/);
    // The provider itself never calls useRouter, so it still renders outside the app router.
    const provider = src.slice(src.indexOf("export function SessionProvider"), src.indexOf("function RouterPush"));
    expect(provider).not.toContain("useRouter()");
  });

  it("carries /me points into the session user and keeps refresh public", () => {
    expect(src).toContain("user: sessionUserOf(data.user)");
    expect(src).toMatch(/refresh,\n/);
  });
});
