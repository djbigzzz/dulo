/** Small helpers shared by the cron steps. No I/O here. */

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Prisma unique-constraint violation (the guard every idempotent insert relies on). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Run `fn` over `items` with at most `limit` in flight, in order of submission.
 * A rejection propagates; callers that want isolation catch inside `fn`.
 */
export async function forEachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  const size = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: size }, worker));
}
