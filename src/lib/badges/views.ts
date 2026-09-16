/**
 * Wire shaping for /api/v1/badges/me. Server-only (Prisma).
 */
import { db } from "@/lib/server/db";
import type { MyBadgeView } from "@/lib/api-client";
import { badgeImagePath, badgeInfo, txExplorerUrl } from "./keys";

export interface BadgeRowInput {
  playKey: string;
  mint: string | null;
  txSig: string | null;
  createdAt: Date;
}

/** Badge row + design copy -> MyBadgeView. Unknown keys still render (name = key) so a row is never hidden. */
export function toMyBadgeView(row: BadgeRowInput, title: string | null = null): MyBadgeView {
  const info = badgeInfo(row.playKey);
  const minted = Boolean(row.mint && row.txSig);
  return {
    playKey: row.playKey,
    title: info?.title ?? title ?? row.playKey,
    name: info?.name ?? title ?? row.playKey,
    description: info?.description ?? "",
    accent: info?.accent ?? null,
    color: info?.color ?? null,
    imageUrl: info ? badgeImagePath(row.playKey) : null,
    mint: row.mint ?? null,
    txSig: row.txSig ?? null,
    txUrl: row.txSig ? txExplorerUrl(row.txSig) : null,
    state: minted ? "minted" : "pending",
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every Badge row of a user, newest first, joined with the design copy. */
export async function listBadgesForUser(userId: string): Promise<MyBadgeView[]> {
  const rows = await db.badge.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { playKey: true, mint: true, txSig: true, createdAt: true },
  });
  const keys = rows.map((r) => r.playKey);
  const plays = keys.length > 0 ? await db.play.findMany({ where: { key: { in: keys } }, select: { key: true, title: true } }) : [];
  const titleByKey = new Map(plays.map((p) => [p.key, p.title]));
  return rows.map((r) => toMyBadgeView(r, titleByKey.get(r.playKey) ?? null));
}
