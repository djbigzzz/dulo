/**
 * Sign-In-With-Solana (SIWS) message helpers.
 *
 * CLIENT-SAFE: this file must never import from src/lib/server, prisma, or
 * anything that touches env(). Both the browser (to build the text the wallet
 * signs) and the verify route (to parse it back) import it.
 *
 * Text format is the wallet-standard / Phantom SIWS format (EIP-4361 / CAIP-122
 * flavoured for Solana):
 *
 *   <domain> wants you to sign in with your Solana account:
 *   <address>
 *
 *   <statement>
 *
 *   URI: <uri>
 *   Version: 1
 *   Chain ID: mainnet
 *   Nonce: <nonce>
 *   Issued At: <issuedAt>
 *
 * Sign-in flow (see src/components/providers/SessionProvider.tsx for the client side):
 *   1. GET /api/v1/auth/nonce                      -> NonceData
 *   2. input = siwsInputFromNonce(nonceData, address)
 *   3a. wallet supports wallet-standard signIn:   out = wallet.signIn(input)
 *       message = buildSiwsMessage(input); signedMessage = out.signedMessage
 *   3b. otherwise:                                message = buildSiwsMessage(input)
 *       signature = wallet.signMessage(utf8(message))
 *   4. POST /api/v1/auth/verify { address, message, signature(b58), signedMessage?(b58) }
 *
 * buildSiwsMessage is deterministic over the input object so the server can
 * rebuild exactly what a wallet-standard wallet produced from the same input.
 */

export const SIWS_STATEMENT =
  "Sign in to Dulo. Points only, no cash value. This does not trigger a transaction.";

/** SIWS chain id for Solana mainnet (wallet-standard values: mainnet | devnet | testnet | localnet). */
export const SIWS_CHAIN_ID = "mainnet";

/** Only EIP-4361 version 1 exists. */
export const SIWS_VERSION = "1";

/** What buildSiwsMessage needs. Structurally assignable to wallet-standard SolanaSignInInput. */
export interface SiwsMessageInput {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  uri: string;
  statement?: string;
  chainId?: string;
  version?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: readonly string[];
}

/** The object handed to wallet.signIn(input). Every field the wallet needs is set explicitly. */
export interface SiwsInput {
  readonly domain: string;
  readonly address: string;
  readonly statement: string;
  readonly uri: string;
  readonly version: "1";
  readonly chainId: "mainnet";
  readonly nonce: string;
  readonly issuedAt: string;
}

/** Shape returned by GET /api/v1/auth/nonce. */
export interface SiwsNonceData {
  nonce: string;
  issuedAt: string;
  domain: string;
  uri: string;
  statement?: string;
}

/** Result of parseSiwsMessage. */
export interface ParsedSiwsMessage {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  uri: string;
  statement?: string;
  chainId?: string;
  version: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NONCE_RE = /^[A-Za-z0-9]{8,}$/;
const NO_WHITESPACE_RE = /^\S+$/;

function assertSingleLine(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`SIWS ${name} must be a non-empty string`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`SIWS ${name} must not contain line breaks`);
  }
}

/**
 * Build the exact text a wallet-standard wallet signs for `input`.
 * Throws on inputs that would corrupt the line-based format.
 */
export function buildSiwsMessage(input: SiwsMessageInput): string {
  assertSingleLine("domain", input.domain);
  assertSingleLine("address", input.address);
  assertSingleLine("uri", input.uri);
  assertSingleLine("nonce", input.nonce);
  assertSingleLine("issuedAt", input.issuedAt);
  if (!NO_WHITESPACE_RE.test(input.domain)) throw new Error("SIWS domain must not contain whitespace");
  if (!BASE58_ADDRESS_RE.test(input.address)) throw new Error("SIWS address must be a base58 public key");

  const version = input.version ?? SIWS_VERSION;
  assertSingleLine("version", version);

  let message = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`;

  if (input.statement !== undefined && input.statement !== "") {
    assertSingleLine("statement", input.statement);
    message += `\n\n${input.statement}`;
  }

  const fields: string[] = [`URI: ${input.uri}`, `Version: ${version}`];
  if (input.chainId !== undefined && input.chainId !== "") {
    assertSingleLine("chainId", input.chainId);
    fields.push(`Chain ID: ${input.chainId}`);
  }
  fields.push(`Nonce: ${input.nonce}`, `Issued At: ${input.issuedAt}`);
  if (input.expirationTime) {
    assertSingleLine("expirationTime", input.expirationTime);
    fields.push(`Expiration Time: ${input.expirationTime}`);
  }
  if (input.notBefore) {
    assertSingleLine("notBefore", input.notBefore);
    fields.push(`Not Before: ${input.notBefore}`);
  }
  if (input.requestId) {
    assertSingleLine("requestId", input.requestId);
    fields.push(`Request ID: ${input.requestId}`);
  }
  if (input.resources && input.resources.length > 0) {
    fields.push("Resources:");
    for (const r of input.resources) {
      assertSingleLine("resource", r);
      fields.push(`- ${r}`);
    }
  }

  return `${message}\n\n${fields.join("\n")}`;
}

/**
 * Produce the wallet-standard SolanaSignInInput for a nonce response. The client
 * passes this to wallet.signIn(input); the server rebuilds the identical text with
 * buildSiwsMessage(input).
 */
export function siwsInputFromNonce(nonceData: SiwsNonceData, address: string): SiwsInput {
  if (!BASE58_ADDRESS_RE.test(address)) throw new Error("Invalid Solana address");
  return {
    domain: nonceData.domain,
    address,
    statement: nonceData.statement && nonceData.statement.length > 0 ? nonceData.statement : SIWS_STATEMENT,
    uri: nonceData.uri,
    version: SIWS_VERSION,
    chainId: SIWS_CHAIN_ID,
    nonce: nonceData.nonce,
    issuedAt: nonceData.issuedAt,
  };
}

/** Read one "Key: value" field line; returns null when the line does not carry that key. */
function readField(line: string | undefined, key: string): string | null {
  if (line === undefined) return null;
  const prefix = `${key}: `;
  if (!line.startsWith(prefix)) return null;
  const value = line.slice(prefix.length);
  return value.length > 0 ? value : null;
}

/**
 * Strictly parse a SIWS message produced by buildSiwsMessage (or a wallet-standard
 * wallet). Returns null on ANY deviation from the format: wrong header line, bad
 * address, missing required fields, fields out of order, CRLF, trailing lines.
 */
export function parseSiwsMessage(text: string): ParsedSiwsMessage | null {
  if (typeof text !== "string" || text.length === 0 || text.length > 8192) return null;
  if (text.includes("\r")) return null;

  const lines = text.split("\n");
  if (lines.length < 7) return null;

  // Line 0: "<domain> wants you to sign in with your Solana account:"
  const header = /^(\S+) wants you to sign in with your Solana account:$/.exec(lines[0]);
  if (!header) return null;
  const domain = header[1];

  // Line 1: address
  const address = lines[1];
  if (!BASE58_ADDRESS_RE.test(address)) return null;

  // Line 2: blank
  if (lines[2] !== "") return null;

  // Optional statement block: "<statement>\n\n" before the fields.
  let i = 3;
  let statement: string | undefined;
  if (readField(lines[3], "URI") === null) {
    statement = lines[3];
    if (!statement || statement.length === 0) return null;
    if (lines[4] !== "") return null;
    i = 5;
  }

  // Required, in order: URI, Version, [Chain ID], Nonce, Issued At.
  const uri = readField(lines[i], "URI");
  if (uri === null || !NO_WHITESPACE_RE.test(uri)) return null;
  i += 1;

  const version = readField(lines[i], "Version");
  if (version === null || version !== SIWS_VERSION) return null;
  i += 1;

  let chainId: string | undefined;
  const maybeChain = readField(lines[i], "Chain ID");
  if (maybeChain !== null) {
    if (!NO_WHITESPACE_RE.test(maybeChain)) return null;
    chainId = maybeChain;
    i += 1;
  }

  const nonce = readField(lines[i], "Nonce");
  if (nonce === null || !NONCE_RE.test(nonce)) return null;
  i += 1;

  const issuedAt = readField(lines[i], "Issued At");
  if (issuedAt === null || Number.isNaN(Date.parse(issuedAt))) return null;
  i += 1;

  // Optional trailing fields, in order.
  let expirationTime: string | undefined;
  let notBefore: string | undefined;
  let requestId: string | undefined;
  let resources: string[] | undefined;

  const exp = readField(lines[i], "Expiration Time");
  if (exp !== null) {
    if (Number.isNaN(Date.parse(exp))) return null;
    expirationTime = exp;
    i += 1;
  }
  const nbf = readField(lines[i], "Not Before");
  if (nbf !== null) {
    if (Number.isNaN(Date.parse(nbf))) return null;
    notBefore = nbf;
    i += 1;
  }
  const rid = readField(lines[i], "Request ID");
  if (rid !== null) {
    requestId = rid;
    i += 1;
  }
  if (lines[i] === "Resources:") {
    i += 1;
    resources = [];
    while (i < lines.length && lines[i].startsWith("- ")) {
      const r = lines[i].slice(2);
      if (r.length === 0) return null;
      resources.push(r);
      i += 1;
    }
    if (resources.length === 0) return null;
  }

  // Nothing may follow.
  if (i !== lines.length) return null;

  const out: ParsedSiwsMessage = { domain, address, nonce, issuedAt, uri, version };
  if (statement !== undefined) out.statement = statement;
  if (chainId !== undefined) out.chainId = chainId;
  if (expirationTime !== undefined) out.expirationTime = expirationTime;
  if (notBefore !== undefined) out.notBefore = notBefore;
  if (requestId !== undefined) out.requestId = requestId;
  if (resources !== undefined) out.resources = resources;
  return out;
}
