import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { isWeakEd25519PublicKey, verifyEd25519 } from "@/lib/adapters/solana";

const ZERO_KEY = "11111111111111111111111111111111"; // all-zero pubkey = System Program
const ZERO_SIG = new Uint8Array(64);

describe("verifyEd25519 small-order and non-canonical keys", () => {
  it("rejects the all-zero key with an all-zero signature for every message", () => {
    // Without the small-order check ~23% of random messages verify under this key.
    for (let i = 0; i < 400; i++) {
      const msg = new TextEncoder().encode(`dulo nonce ${i} ${Math.random()}`);
      expect(verifyEd25519(ZERO_KEY, msg, ZERO_SIG)).toBe(false);
    }
  });

  it("flags every canonical small-order encoding as weak", () => {
    const hexes = [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "0100000000000000000000000000000000000000000000000000000000000000",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    ];
    for (const h of hexes) {
      const bytes = Uint8Array.from(Buffer.from(h, "hex"));
      expect(isWeakEd25519PublicKey(bytes)).toBe(true);
      expect(verifyEd25519(bs58.encode(bytes), new Uint8Array([1, 2, 3]), ZERO_SIG)).toBe(false);
    }
  });

  it("flags non-canonical encodings (y >= p) as weak", () => {
    // y = p exactly, sign bit clear.
    const y = (1n << 255n) - 19n;
    const bytes = new Uint8Array(32);
    let v = y;
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    expect(isWeakEd25519PublicKey(bytes)).toBe(true);
    expect(isWeakEd25519PublicKey(Uint8Array.from({ length: 32 }, () => 0xff))).toBe(true);
  });

  it("still accepts a genuine keypair signature and rejects a tampered one", () => {
    const kp = Keypair.generate();
    const msg = new TextEncoder().encode("dulo.fun wants you to sign in");
    const sig = nacl.sign.detached(msg, kp.secretKey);
    expect(isWeakEd25519PublicKey(kp.publicKey.toBytes())).toBe(false);
    expect(verifyEd25519(kp.publicKey.toBase58(), msg, sig)).toBe(true);
    const tampered = new TextEncoder().encode("dulo.fun wants you to sign in!");
    expect(verifyEd25519(kp.publicKey.toBase58(), tampered, sig)).toBe(false);
  });
});
