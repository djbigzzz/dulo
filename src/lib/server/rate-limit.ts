/**
 * In-memory abuse limits for the public read routes (Check any wallet, Mirror any wallet). Server-only.
 * Limits are per server instance; each route pairs a per-IP limiter with its own global budget.
 */

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string, nowMs?: number): RateLimitDecision;
  reset(): void;
}

/** Fixed-window counter per key, in memory. Old windows are pruned once `maxKeys` is reached. */
export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = Math.max(1, opts.maxKeys ?? 10_000);
  const hits = new Map<string, { windowStart: number; count: number }>();
  return {
    take(key, nowMs = Date.now()) {
      let entry = hits.get(key);
      if (!entry || nowMs - entry.windowStart >= windowMs) {
        if (!entry && hits.size >= maxKeys) {
          for (const [k, e] of hits) if (nowMs - e.windowStart >= windowMs) hits.delete(k);
          while (hits.size >= maxKeys) {
            const oldest = hits.keys().next();
            if (oldest.done) break;
            hits.delete(oldest.value);
          }
        }
        entry = { windowStart: nowMs, count: 0 };
        hits.set(key, entry);
      }
      if (entry.count >= limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - nowMs) / 1000)) };
      }
      entry.count += 1;
      return { ok: true };
    },
    reset() {
      hits.clear();
    },
  };
}

/** The eight 16-bit groups of an IPv6 address (brackets, zone id and a dotted IPv4 tail allowed), or null. */
function ipv6Groups(raw: string): number[] | null {
  let s = raw.trim();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end < 0) return null;
    s = s.slice(1, end);
  }
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // A dotted IPv4 tail (::ffff:1.2.3.4) is the last two groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".");
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) return null;
    const [a, b, c, d] = octets.map(Number);
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let parts: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    parts = [...head, ...Array<string>(missing).fill("0"), ...rest];
  } else {
    parts = head;
  }
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/i.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

/**
 * The rate-limit key for an IP: an IPv4 address as is, an IPv4-mapped IPv6 address as its IPv4
 * form, any other IPv6 address as its /64 prefix (one subscriber usually holds a whole /64, so
 * per-address keys would let one client rotate through 2^64 of them). Unparseable input is kept as is.
 */
export function ipRateLimitKey(ip: string): string {
  const groups = ipv6Groups(ip);
  if (!groups) return ip.trim();
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/**
 * The caller's rate-limit key: first `x-forwarded-for` entry (set by the platform proxy), else
 * `x-real-ip`, else "unknown"; IPv6 clients are keyed on their /64 prefix (ipRateLimitKey).
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  const ip = forwarded || real;
  return ip ? ipRateLimitKey(ip) : "unknown";
}
