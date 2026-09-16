/**
 * Small, dependency-free formatters shared by the read pages. Client-safe.
 */

/** "XsDoVfqe…JHzoB" — keeps `chars` on each side. */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** Handle when set, else a truncated address, else the fallback. */
export function displayName(handle: string | null | undefined, address: string | null | undefined, fallback = "Anonymous"): string {
  if (handle && handle.trim()) return handle.trim();
  if (address) return truncateAddress(address);
  return fallback;
}

/** Up to two characters for an avatar fallback. */
export function initials(name: string): string {
  const clean = name.replace(/[^a-z0-9 ]/gi, " ").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "1,250" */
export function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return intFmt.format(Math.round(n));
}

/** "$360.83"; sub-dollar prices get 4 decimals so they do not collapse to $0.00. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs === 0 ? 2 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Seconds between `publishedAt` and `now`; null when unknown. Never negative. */
export function ageSeconds(publishedAt: string | Date | null | undefined, now: number = Date.now()): number | null {
  if (publishedAt === null || publishedAt === undefined) return null;
  const t = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/** "just now" | "12s ago" | "3m ago" | "2h ago" | "3d ago" — or "unknown age" for null. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "unknown age";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** "14 Sep 2026" — empty string for null/invalid. */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** "14 Sep 2026, 16:05" in the viewer's zone — empty string for null/invalid. */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Human label for a CAIP-2 chain id. */
export function chainLabel(chainId: string): string {
  if (chainId.startsWith("solana:")) return chainId === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" ? "Solana" : "Solana (devnet)";
  if (chainId.startsWith("eip155:")) return "EVM";
  return chainId.split(":")[0] || chainId;
}

/** Explorer URL for an address on a chain. Only Solana is known in Season 0. */
export function explorerUrl(chainId: string, address: string): string | null {
  if (chainId.startsWith("solana:")) return `https://solscan.io/account/${address}`;
  return null;
}
