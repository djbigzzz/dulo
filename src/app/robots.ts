import type { MetadataRoute } from "next";

/**
 * Served at /robots.txt. Pages are public and indexable. /api/v1 reads stay crawlable because
 * every page renders its data from them on the client; only cron, auth and the offline shell are out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/cron/", "/api/v1/auth/", "/offline"] }],
  };
}
