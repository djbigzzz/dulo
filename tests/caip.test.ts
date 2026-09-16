import { describe, expect, it } from "vitest";
import {
  SOLANA_MAINNET,
  formatAssetId,
  isAssetId,
  isChainId,
  mintFromAssetId,
  parseAssetId,
  parseChainId,
  solanaNativeAssetId,
  solanaTokenAssetId,
} from "@/lib/core/caip";

const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

describe("CAIP-2", () => {
  it("parses a Solana chain id", () => {
    const p = parseChainId(SOLANA_MAINNET);
    expect(p.namespace).toBe("solana");
    expect(p.reference).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });
  it("rejects garbage", () => {
    expect(isChainId("solana")).toBe(false);
    expect(isChainId("solana:")).toBe(false);
    expect(() => parseChainId("eip155")).toThrow();
  });
});

describe("CAIP-19", () => {
  it("formats and parses a Solana token id", () => {
    const id = solanaTokenAssetId(TSLAX);
    expect(id).toBe(`${SOLANA_MAINNET}/token:${TSLAX}`);
    const p = parseAssetId(id);
    expect(p.chainId).toBe(SOLANA_MAINNET);
    expect(p.assetNamespace).toBe("token");
    expect(p.assetReference).toBe(TSLAX);
    expect(mintFromAssetId(id)).toBe(TSLAX);
  });
  it("formats native SOL", () => {
    expect(solanaNativeAssetId()).toBe(`${SOLANA_MAINNET}/slip44:501`);
    expect(() => mintFromAssetId(solanaNativeAssetId())).toThrow();
  });
  it("round-trips through formatAssetId", () => {
    const id = formatAssetId(SOLANA_MAINNET, "token", TSLAX);
    expect(isAssetId(id)).toBe(true);
    expect(parseAssetId(id).assetId).toBe(id);
  });
  it("rejects malformed ids", () => {
    expect(isAssetId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe(false);
    expect(isAssetId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token")).toBe(false);
    expect(() => parseAssetId("foo")).toThrow();
  });
});
