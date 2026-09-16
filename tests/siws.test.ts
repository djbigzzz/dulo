import { beforeAll, describe, expect, it } from "vitest";
import bs58 from "bs58";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import {
  SIWS_CHAIN_ID,
  SIWS_STATEMENT,
  buildSiwsMessage,
  parseSiwsMessage,
  siwsInputFromNonce,
  type SiwsNonceData,
} from "@/lib/auth/siws";
import { checkSiwsMessage, decodeBase58, isSolanaAddress, siwsSignedBytes } from "@/lib/auth/siws-verify";
import { JWT_SECRET_MIN_LENGTH, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken, type Session } from "@/lib/auth/token";
import { ApiError, assertSameOrigin, parseBody, requestOrigin } from "@/lib/server/api";
import { z } from "zod";

type VerifyFn = (address: string, message: Uint8Array, signature: Uint8Array) => boolean;

/** Local ed25519 verify used only when the ChainAdapter module is not present yet. */
const localVerify: VerifyFn = (address, message, signature) => {
  try {
    return nacl.sign.detached.verify(message, signature, bs58.decode(address));
  } catch {
    return false;
  }
};

let verifyEd25519: VerifyFn = localVerify;
let verifierSource = "local tweetnacl fallback";

function setTestEnv() {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.DIRECT_URL ??= process.env.DATABASE_URL;
  process.env.JWT_SECRET ??= "test-secret-with-at-least-32-characters";
  process.env.CRON_SECRET ??= "test-cron-secret";
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
}

beforeAll(async () => {
  setTestEnv();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const adapterPath = path.resolve(here, "../src/lib/adapters/solana.ts");
  if (!fs.existsSync(adapterPath)) {
    console.info("[siws.test] @/lib/adapters/solana not present; using local tweetnacl verifier");
    return;
  }
  try {
    const specifier = "../src/lib/adapters/" + "solana";
    const mod = (await import(/* @vite-ignore */ specifier)) as { verifyEd25519?: VerifyFn };
    if (typeof mod.verifyEd25519 === "function") {
      verifyEd25519 = mod.verifyEd25519;
      verifierSource = "@/lib/adapters/solana";
    }
  } catch (err) {
    console.warn("[siws.test] could not load @/lib/adapters/solana, using local verifier:", err);
  }
  console.info(`[siws.test] verifier: ${verifierSource}`);
});

const DOMAIN = "localhost:3000";
const URI = "http://localhost:3000";

function freshNonce(now = new Date()): SiwsNonceData {
  return {
    nonce: bs58.encode(nacl.randomBytes(16)),
    issuedAt: now.toISOString(),
    domain: DOMAIN,
    uri: URI,
    statement: SIWS_STATEMENT,
  };
}

function keypair() {
  const kp = nacl.sign.keyPair();
  return { kp, address: bs58.encode(kp.publicKey) };
}

function sign(kp: nacl.SignKeyPair, message: string): Uint8Array {
  return nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
}

describe("buildSiwsMessage", () => {
  it("renders the Phantom / wallet-standard SIWS text exactly", () => {
    const { address } = keypair();
    const nonceData = freshNonce(new Date("2026-09-14T12:00:00.000Z"));
    const input = siwsInputFromNonce(nonceData, address);
    const text = buildSiwsMessage(input);

    expect(text).toBe(
      `${DOMAIN} wants you to sign in with your Solana account:\n` +
        `${address}\n\n` +
        `${SIWS_STATEMENT}\n\n` +
        `URI: ${URI}\n` +
        `Version: 1\n` +
        `Chain ID: mainnet\n` +
        `Nonce: ${nonceData.nonce}\n` +
        `Issued At: 2026-09-14T12:00:00.000Z`,
    );
  });

  it("is deterministic over the same input object", () => {
    const { address } = keypair();
    const input = siwsInputFromNonce(freshNonce(), address);
    expect(buildSiwsMessage(input)).toBe(buildSiwsMessage({ ...input }));
  });

  it("siwsInputFromNonce fills every wallet-standard field", () => {
    const { address } = keypair();
    const nonceData = freshNonce();
    const input = siwsInputFromNonce(nonceData, address);
    expect(input).toEqual({
      domain: DOMAIN,
      address,
      statement: SIWS_STATEMENT,
      uri: URI,
      version: "1",
      chainId: SIWS_CHAIN_ID,
      nonce: nonceData.nonce,
      issuedAt: nonceData.issuedAt,
    });
  });

  it("omits the statement block when no statement is given", () => {
    const { address } = keypair();
    const n = freshNonce();
    const text = buildSiwsMessage({ domain: DOMAIN, address, uri: URI, nonce: n.nonce, issuedAt: n.issuedAt });
    expect(text).toContain(`${address}\n\nURI: ${URI}\nVersion: 1\nNonce: ${n.nonce}`);
    expect(text).not.toContain("Chain ID");
  });

  it("refuses line breaks that would corrupt the format", () => {
    const { address } = keypair();
    const n = freshNonce();
    expect(() =>
      buildSiwsMessage({ domain: DOMAIN, address, uri: URI, nonce: n.nonce, issuedAt: n.issuedAt, statement: "a\nb" }),
    ).toThrow();
    expect(() =>
      buildSiwsMessage({ domain: "evil.com\nx", address, uri: URI, nonce: n.nonce, issuedAt: n.issuedAt }),
    ).toThrow();
    expect(() => buildSiwsMessage({ domain: DOMAIN, address: "not-base58!", uri: URI, nonce: n.nonce, issuedAt: n.issuedAt })).toThrow();
  });
});

describe("parseSiwsMessage", () => {
  it("round-trips a built message", () => {
    const { address } = keypair();
    const nonceData = freshNonce();
    const input = siwsInputFromNonce(nonceData, address);
    const parsed = parseSiwsMessage(buildSiwsMessage(input));
    expect(parsed).toEqual({
      domain: DOMAIN,
      address,
      statement: SIWS_STATEMENT,
      uri: URI,
      version: "1",
      chainId: "mainnet",
      nonce: nonceData.nonce,
      issuedAt: nonceData.issuedAt,
    });
  });

  it("round-trips without a statement or chain id", () => {
    const { address } = keypair();
    const n = freshNonce();
    const text = buildSiwsMessage({ domain: DOMAIN, address, uri: URI, nonce: n.nonce, issuedAt: n.issuedAt });
    const parsed = parseSiwsMessage(text);
    expect(parsed).toEqual({ domain: DOMAIN, address, uri: URI, version: "1", nonce: n.nonce, issuedAt: n.issuedAt });
  });

  it("round-trips the optional trailing fields", () => {
    const { address } = keypair();
    const n = freshNonce();
    const text = buildSiwsMessage({
      domain: DOMAIN,
      address,
      uri: URI,
      nonce: n.nonce,
      issuedAt: n.issuedAt,
      chainId: "mainnet",
      expirationTime: "2026-09-14T13:00:00.000Z",
      notBefore: "2026-09-14T11:00:00.000Z",
      requestId: "req-1",
      resources: ["https://dulo.fun/rewards", "https://dulo.fun/paper-trading"],
    });
    const parsed = parseSiwsMessage(text);
    expect(parsed?.expirationTime).toBe("2026-09-14T13:00:00.000Z");
    expect(parsed?.notBefore).toBe("2026-09-14T11:00:00.000Z");
    expect(parsed?.requestId).toBe("req-1");
    expect(parsed?.resources).toEqual(["https://dulo.fun/rewards", "https://dulo.fun/paper-trading"]);
  });

  it("rejects malformed and tampered text", () => {
    const { address } = keypair();
    const n = freshNonce();
    const good = buildSiwsMessage(siwsInputFromNonce(n, address));

    expect(parseSiwsMessage("")).toBeNull();
    expect(parseSiwsMessage("hello")).toBeNull();
    expect(parseSiwsMessage(good.replace(/\n/g, "\r\n"))).toBeNull();
    expect(parseSiwsMessage(good + "\n")).toBeNull();
    expect(parseSiwsMessage(good + "\nExtra: field")).toBeNull();
    expect(parseSiwsMessage(good.replace("Version: 1", "Version: 2"))).toBeNull();
    expect(parseSiwsMessage(good.replace("URI: ", "Uri: "))).toBeNull();
    expect(parseSiwsMessage(good.replace(`Nonce: ${n.nonce}`, "Nonce: short"))).toBeNull();
    expect(parseSiwsMessage(good.replace(`Issued At: ${n.issuedAt}`, "Issued At: yesterday"))).toBeNull();
    expect(parseSiwsMessage(good.replace(address, "not-an-address"))).toBeNull();
    // fields out of order
    expect(parseSiwsMessage(good.replace(`URI: ${URI}\nVersion: 1`, `Version: 1\nURI: ${URI}`))).toBeNull();
    // statement block without its trailing blank line
    expect(parseSiwsMessage(good.replace(`${SIWS_STATEMENT}\n\n`, `${SIWS_STATEMENT}\n`))).toBeNull();
  });
});

describe("signature verification", () => {
  it("verifies a message signed by the address (plain signMessage flow)", () => {
    const { kp, address } = keypair();
    const message = buildSiwsMessage(siwsInputFromNonce(freshNonce(), address));
    const signature = sign(kp, message);

    const bytes = siwsSignedBytes(message);
    expect(bytes).not.toBeNull();
    expect(verifyEd25519(address, bytes!, signature)).toBe(true);
  });

  it("verifies through the wallet-standard signIn output (signedMessage bytes)", () => {
    const { kp, address } = keypair();
    const message = buildSiwsMessage(siwsInputFromNonce(freshNonce(), address));
    const signedMessage = bs58.encode(new TextEncoder().encode(message));
    const signatureB58 = bs58.encode(sign(kp, message));

    const bytes = siwsSignedBytes(message, signedMessage);
    expect(bytes).not.toBeNull();
    expect(verifyEd25519(address, bytes!, decodeBase58(signatureB58, "signature"))).toBe(true);
  });

  it("refuses a signedMessage that differs from message", () => {
    const { address } = keypair();
    const message = buildSiwsMessage(siwsInputFromNonce(freshNonce(), address));
    const other = bs58.encode(new TextEncoder().encode(message + " "));
    expect(siwsSignedBytes(message, other)).toBeNull();
    expect(() => siwsSignedBytes(message, "0OIl-not-base58")).toThrow();
  });

  it("rejects a tampered address", () => {
    const { kp, address } = keypair();
    const { address: otherAddress } = keypair();
    const message = buildSiwsMessage(siwsInputFromNonce(freshNonce(), address));
    const signature = sign(kp, message);

    // Signature was made by `address`; claiming another address must fail.
    expect(verifyEd25519(otherAddress, new TextEncoder().encode(message), signature)).toBe(false);

    // A message whose address line was swapped no longer matches the signature either.
    const swapped = message.replace(address, otherAddress);
    expect(verifyEd25519(address, new TextEncoder().encode(swapped), signature)).toBe(false);
    expect(verifyEd25519(otherAddress, new TextEncoder().encode(swapped), signature)).toBe(false);
  });

  it("rejects a tampered nonce", () => {
    const { kp, address } = keypair();
    const n = freshNonce();
    const message = buildSiwsMessage(siwsInputFromNonce(n, address));
    const signature = sign(kp, message);

    const replayed = message.replace(`Nonce: ${n.nonce}`, `Nonce: ${bs58.encode(nacl.randomBytes(16))}`);
    expect(replayed).not.toBe(message);
    expect(parseSiwsMessage(replayed)).not.toBeNull();
    expect(verifyEd25519(address, new TextEncoder().encode(replayed), signature)).toBe(false);
  });

  it("rejects garbage signatures and addresses", () => {
    const { address } = keypair();
    const message = buildSiwsMessage(siwsInputFromNonce(freshNonce(), address));
    expect(verifyEd25519(address, new TextEncoder().encode(message), new Uint8Array(64))).toBe(false);
    expect(verifyEd25519("11111111111111111111111111111111", new TextEncoder().encode(message), new Uint8Array(64))).toBe(false);
    expect(isSolanaAddress(address)).toBe(true);
    expect(isSolanaAddress("not-base58!")).toBe(false);
    expect(isSolanaAddress(bs58.encode(new Uint8Array(31)))).toBe(false);
  });
});

describe("checkSiwsMessage", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  function parsedFor(address: string, overrides: Partial<SiwsNonceData> = {}) {
    const n = { ...freshNonce(now), ...overrides };
    const parsed = parseSiwsMessage(buildSiwsMessage(siwsInputFromNonce(n, address)));
    if (!parsed) throw new Error("test message did not parse");
    return parsed;
  }

  it("accepts a message for this app, address, and time", () => {
    const { address } = keypair();
    expect(checkSiwsMessage(parsedFor(address), { address, domain: DOMAIN, appUrl: URI, now })).toEqual({ ok: true });
  });

  it("tolerates a trailing slash on the configured app URL", () => {
    const { address } = keypair();
    expect(checkSiwsMessage(parsedFor(address), { address, domain: DOMAIN, appUrl: `${URI}/`, now }).ok).toBe(true);
  });

  it("rejects a mismatched address", () => {
    const { address } = keypair();
    const { address: other } = keypair();
    const r = checkSiwsMessage(parsedFor(address), { address: other, domain: DOMAIN, appUrl: URI, now });
    expect(r.ok).toBe(false);
  });

  it("rejects a mismatched domain or URI origin", () => {
    const { address } = keypair();
    expect(checkSiwsMessage(parsedFor(address, { domain: "evil.com" }), { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(false);
    expect(checkSiwsMessage(parsedFor(address, { uri: "https://evil.com" }), { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(false);
  });

  it("rejects messages issued outside the ±10 minute window", () => {
    const { address } = keypair();
    const old = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
    const future = new Date(now.getTime() + 11 * 60 * 1000).toISOString();
    const edge = new Date(now.getTime() - 9 * 60 * 1000).toISOString();
    expect(checkSiwsMessage(parsedFor(address, { issuedAt: old }), { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(false);
    expect(checkSiwsMessage(parsedFor(address, { issuedAt: future }), { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(false);
    expect(checkSiwsMessage(parsedFor(address, { issuedAt: edge }), { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(true);
  });

  it("rejects an unsupported chain id", () => {
    const { address } = keypair();
    const n = freshNonce(now);
    const text = buildSiwsMessage({ ...siwsInputFromNonce(n, address), chainId: "devnet" });
    const parsed = parseSiwsMessage(text);
    expect(parsed?.chainId).toBe("devnet");
    expect(checkSiwsMessage(parsed!, { address, domain: DOMAIN, appUrl: URI, now }).ok).toBe(false);
  });
});

describe("session token", () => {
  const secret = "test-secret-with-at-least-32-characters";
  const session: Session = {
    userId: "user_1",
    walletId: "wallet_1",
    address: "11111111111111111111111111111111",
    chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  };

  it("signs and verifies a 30-day HS256 token with the expected claims", async () => {
    const issued = new Date("2026-09-14T12:00:00.000Z");
    const token = await signSessionToken(session, secret, issued);
    expect(await verifySessionToken(token, secret, issued)).toEqual(session);

    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(payload.sub).toBe(session.userId);
    expect(payload.wid).toBe(session.walletId);
    expect(payload.adr).toBe(session.address);
    expect(payload.cid).toBe(session.chainId);
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("HS256");
  });

  it("rejects expired, tampered, and wrong-secret tokens", async () => {
    const issued = new Date("2026-09-14T12:00:00.000Z");
    const token = await signSessionToken(session, secret, issued);

    const after31Days = new Date(issued.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await verifySessionToken(token, secret, after31Days)).toBeNull();
    expect(await verifySessionToken(token, "another-secret-with-32-characters!!", issued)).toBeNull();
    expect(await verifySessionToken(token.slice(0, -2) + "xx", secret, issued)).toBeNull();
    expect(await verifySessionToken("", secret, issued)).toBeNull();
    expect(await verifySessionToken("not.a.jwt", secret, issued)).toBeNull();
  });
});

describe("session cookie", () => {
  it("sets an httpOnly lax cookie carrying a verifiable token and clears it", async () => {
    setTestEnv();
    const { SESSION_COOKIE, clearSessionCookie, createSessionCookie } = await import("@/lib/auth/session");
    const { NextResponse } = await import("next/server");

    const session: Session = {
      userId: "user_1",
      walletId: "wallet_1",
      address: "11111111111111111111111111111111",
      chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    };

    const res = NextResponse.json({ ok: true });
    await createSessionCookie(session, res);
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(SESSION_COOKIE).toBe("dulo_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(await verifySessionToken(cookie!.value, process.env.JWT_SECRET!)).toEqual(session);

    clearSessionCookie(res);
    const cleared = res.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
  });
});

describe("JWT secret floor", () => {
  it("refuses secrets shorter than 32 characters", async () => {
    expect(JWT_SECRET_MIN_LENGTH).toBe(32);
    const session: Session = { userId: "u", walletId: "w", address: "11111111111111111111111111111111", chainId: "solana:x" };
    await expect(signSessionToken(session, "only-sixteen-chars")).rejects.toThrow(/32 characters/);
    await expect(signSessionToken(session, "x".repeat(32))).resolves.toBeTypeOf("string");
  });
});

describe("api helpers (login CSRF + request origin)", () => {
  const schema = z.object({ a: z.number() });

  function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
    return new Request(url, init);
  }

  it("parseBody refuses non-JSON content types with 415", async () => {
    const plain = req("http://localhost:3000/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ a: 1 }),
    });
    await expect(parseBody(plain, schema)).rejects.toMatchObject({ status: 415 });

    const none = req("http://localhost:3000/api/v1/auth/verify", { method: "POST", body: JSON.stringify({ a: 1 }) });
    // Request adds text/plain;charset=UTF-8 for a string body; still not JSON.
    await expect(parseBody(none, schema)).rejects.toMatchObject({ status: 415 });

    const json = req("http://localhost:3000/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ a: 1 }),
    });
    await expect(parseBody(json, schema)).resolves.toEqual({ a: 1 });

    const bad = req("http://localhost:3000/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    await expect(parseBody(bad, schema)).rejects.toMatchObject({ status: 400 });
  });

  it("assertSameOrigin passes same-origin and header-less requests, refuses cross-site ones", () => {
    const base = "http://localhost:3000/api/v1/auth/logout";
    expect(() => assertSameOrigin(req(base, { method: "POST", headers: { host: "localhost:3000" } }))).not.toThrow();
    expect(() =>
      assertSameOrigin(req(base, { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } })),
    ).not.toThrow();
    // Behind a proxy the public host is x-forwarded-host.
    expect(() =>
      assertSameOrigin(
        req(base, { method: "POST", headers: { host: "10.0.0.1", "x-forwarded-host": "dulo.fun", origin: "https://dulo.fun" } }),
      ),
    ).not.toThrow();

    const cross = () => assertSameOrigin(req(base, { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example" } }));
    expect(cross).toThrow(ApiError);
    expect(cross).toThrow(/cross-site/i);
    try {
      cross();
    } catch (e) {
      expect((e as ApiError).status).toBe(403);
    }
    expect(() => assertSameOrigin(req(base, { method: "POST", headers: { host: "localhost:3000", origin: "null" } }))).toThrow(ApiError);
    expect(() => assertSameOrigin(req(base, { method: "POST", headers: { origin: "http://localhost:3000" } }))).toThrow(ApiError);
  });

  it("requestOrigin derives uri/domain from proxy headers and falls back to the app URL", () => {
    const fallback = "https://fallback.example";
    expect(requestOrigin(req("http://x/api", { headers: { host: "localhost:3000" } }), fallback)).toEqual({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    });
    expect(
      requestOrigin(req("http://x/api", { headers: { host: "10.0.0.1", "x-forwarded-host": "dulo.fun, proxy", "x-forwarded-proto": "https, http" } }), fallback),
    ).toEqual({ origin: "https://dulo.fun", host: "dulo.fun" });
    // An unknown scheme is ignored rather than trusted.
    expect(requestOrigin(req("http://x/api", { headers: { host: "dulo.fun", "x-forwarded-proto": "gopher" } }), fallback).origin).toMatch(
      /^https?:\/\/dulo\.fun$/,
    );
    expect(requestOrigin(req("http://x/api"), fallback)).toEqual({ origin: "https://fallback.example", host: "fallback.example" });
  });
});
