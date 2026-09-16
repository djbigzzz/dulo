/**
 * Stake bounds for Calls, split out so client components can import them without
 * pulling in lib/games/calls (Prisma, price sources). calls.ts re-exports these.
 */
export const MIN_CALL_POINTS = 10;
export const MAX_CALL_POINTS = 5000;
