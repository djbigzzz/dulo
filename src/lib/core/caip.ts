/**
 * CAIP-2 chain ids and CAIP-19 asset ids.
 *
 *   chain:  solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp                    (Solana mainnet)
 *   asset:  solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:<mint>       (SPL / Token-2022 mint)
 *   native: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501         (SOL)
 *
 * Nothing in the app keys on a bare mint or a bare pubkey; always carry the chain.
 */

export type ChainId = `${string}:${string}`;
export type AssetId = `${ChainId}/${string}:${string}`;

export const SOLANA_MAINNET: ChainId = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET: ChainId = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const CHAIN_RE = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/;
const ASSET_RE = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})\/([-a-z0-9]{3,8}):([-.%a-zA-Z0-9]{1,128})$/;

export interface ParsedChainId {
  namespace: string;
  reference: string;
  chainId: ChainId;
}

export interface ParsedAssetId extends ParsedChainId {
  assetNamespace: string;
  assetReference: string;
  assetId: AssetId;
}

export function isChainId(s: string): s is ChainId {
  return CHAIN_RE.test(s);
}

export function isAssetId(s: string): s is AssetId {
  return ASSET_RE.test(s);
}

export function parseChainId(s: string): ParsedChainId {
  const m = CHAIN_RE.exec(s);
  if (!m) throw new Error(`Invalid CAIP-2 chain id: ${s}`);
  return { namespace: m[1], reference: m[2], chainId: s as ChainId };
}

export function parseAssetId(s: string): ParsedAssetId {
  const m = ASSET_RE.exec(s);
  if (!m) throw new Error(`Invalid CAIP-19 asset id: ${s}`);
  const chainId = `${m[1]}:${m[2]}` as ChainId;
  return {
    namespace: m[1],
    reference: m[2],
    chainId,
    assetNamespace: m[3],
    assetReference: m[4],
    assetId: s as AssetId,
  };
}

export function formatAssetId(chainId: ChainId, assetNamespace: string, assetReference: string): AssetId {
  const id = `${chainId}/${assetNamespace}:${assetReference}`;
  if (!isAssetId(id)) throw new Error(`Cannot form a valid CAIP-19 asset id from ${id}`);
  return id as AssetId;
}

/** CAIP-19 id for an SPL / Token-2022 mint on a Solana chain. */
export function solanaTokenAssetId(mint: string, chainId: ChainId = SOLANA_MAINNET): AssetId {
  return formatAssetId(chainId, "token", mint);
}

/** CAIP-19 id for native SOL. */
export function solanaNativeAssetId(chainId: ChainId = SOLANA_MAINNET): AssetId {
  return formatAssetId(chainId, "slip44", "501");
}

/** Extract the mint from a Solana token CAIP-19 id. Throws if it is not a Solana token id. */
export function mintFromAssetId(assetId: string): string {
  const p = parseAssetId(assetId);
  if (p.namespace !== "solana" || p.assetNamespace !== "token") {
    throw new Error(`Not a Solana token asset id: ${assetId}`);
  }
  return p.assetReference;
}

export function isSolanaChain(chainId: string): boolean {
  return parseChainId(chainId).namespace === "solana";
}
