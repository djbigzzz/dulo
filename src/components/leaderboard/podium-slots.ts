/**
 * Podium slot maths (15 Sep review M-P). Client-safe, no JSX.
 *
 * Slots are visual: 2nd on the left, 1st in the centre (tallest), 3rd on the right, filled from
 * the first three ranked rows in that order. The MEDAL is not the slot: it comes from the row's
 * own rank, Math.min(rank, 3), because the boards use competition ranking ("1224") and two
 * players tied on points both hold rank 1. A tie is marked "=1st" (spoken "Tied 1st").
 */

export type PodiumTier = 1 | 2 | 3;

const ORDINAL: Record<PodiumTier, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

export interface PodiumSlot<T> {
  /** Visual position: sets the plinth height and the centre glow. */
  slot: PodiumTier;
  /** Null when fewer than three rows exist. */
  row: T | null;
  /** Medal tone, crown and chip: from the row's rank (the slot for an empty spot). */
  tier: PodiumTier;
  /** Another podium row shares this rank. */
  tied: boolean;
  /** "1st", or "=1st" when tied. */
  label: string;
  /** "1st", or "Tied 1st" when tied (aria-label). */
  spokenLabel: string;
}

/** Medal tier for a 1-based rank: 1, 2, or 3 for anything below the podium. */
export function medalTier(rank: number): PodiumTier {
  const r = Number.isFinite(rank) ? Math.floor(rank) : 3;
  return (Math.max(1, Math.min(r, 3)) as PodiumTier);
}

/** The three podium slots in visual order (2nd, 1st, 3rd). */
export function podiumSlots<T extends { rank: number }>(rows: readonly T[]): Array<PodiumSlot<T>> {
  const top = rows.slice(0, 3);
  const order: Array<[PodiumTier, T | null]> = [
    [2, top[1] ?? null],
    [1, top[0] ?? null],
    [3, top[2] ?? null],
  ];
  return order.map(([slot, row]) => {
    if (!row) return { slot, row: null, tier: slot, tied: false, label: ORDINAL[slot], spokenLabel: ORDINAL[slot] };
    const tier = medalTier(row.rank);
    const tied = top.some((other) => other !== row && other.rank === row.rank);
    return {
      slot,
      row,
      tier,
      tied,
      label: `${tied ? "=" : ""}${ORDINAL[tier]}`,
      spokenLabel: `${tied ? "Tied " : ""}${ORDINAL[tier]}`,
    };
  });
}
