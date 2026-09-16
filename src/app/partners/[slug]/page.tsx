import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPartner } from "@/lib/server/queries";
import { PartnerView } from "@/components/partners/PartnerView";

type Props = { params: Promise<{ slug: string }> };

/**
 * How long the server waits for the Partner lookup before degrading (metadata to the slug title,
 * page to the client view). Not exported: Next rejects unknown exports from page files.
 */
const PARTNER_LOOKUP_TIMEOUT_MS = 1_500;

const TIMED_OUT = Symbol("timed-out");

/** "kamino-lend" -> "Kamino Lend": the tab-title fallback when the Partner is unknown. */
function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * One lookup per request, shared by generateMetadata and the page (React cache). Resolves to the
 * detail, null for an unknown slug, or TIMED_OUT when the DB is slower than the budget; throws on DB error.
 */
const lookupPartner = cache(async (slug: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), PARTNER_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([getPartner(slug), timeout]);
  } finally {
    clearTimeout(timer);
  }
});

/**
 * Tab title from the Partner's real name ("xStocks", not "Xstocks" from the slug). Metadata is a
 * server read, so it goes straight to lib/server/queries; a DB error or a lookup slower than
 * PARTNER_LOOKUP_TIMEOUT_MS degrades to the slug title rather than holding the page.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fallback = titleFromSlug(slug) || "Partner";
  try {
    const detail = await lookupPartner(slug);
    if (detail === TIMED_OUT) return { title: fallback };
    if (!detail) return { title: "Partner not found", robots: { index: false } };
    const name = detail.partner.name.trim() || fallback;
    const blurb = detail.partner.blurb.trim();
    return blurb ? { title: name, description: blurb } : { title: name };
  } catch {
    return { title: fallback };
  }
}

/**
 * Server shell; the data comes from /api/v1/partners/[slug] on the client like every other read.
 * The server only answers "does this slug exist": a definite miss is a real 404 (not-found.tsx);
 * a slow or failing DB falls through to the client view, which has its own empty and error states.
 */
export default async function PartnerPage({ params }: Props) {
  const { slug } = await params;
  let detail: Awaited<ReturnType<typeof lookupPartner>> | undefined;
  try {
    detail = await lookupPartner(slug);
  } catch {
    detail = undefined;
  }
  if (detail === null) notFound();
  return <PartnerView slug={slug} />;
}
