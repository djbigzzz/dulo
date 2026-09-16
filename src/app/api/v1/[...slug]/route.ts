import { fail } from "@/lib/server/api";

/**
 * /api/v1/* fallback. Any path no real handler matches gets the API envelope,
 * `{ ok: false, error: "Not found" }` with 404, for every method, instead of the HTML 404 page.
 * Real routes always win: Next resolves static and dynamic segments before a catch-all.
 */
function notFound(): Response {
  const res = fail("Not found", 404);
  res.headers.set("cache-control", "no-store");
  return res;
}

async function respond(): Promise<Response> {
  return notFound();
}

export const GET = respond;
export const HEAD = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
export const OPTIONS = respond;
