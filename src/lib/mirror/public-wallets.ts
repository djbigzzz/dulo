/**
 * Curated public Solana wallets that hold tokenized stocks (15 Sep review M-D).
 * Client-safe constant.
 *
 * These are NOT Dulo players: they never signed in, they are never snapshotted into the
 * database and they are never scored. /mirror lists them under "Public wallets on Solana — not
 * Dulo players, never scored" so a visitor can mirror a real mainnet allocation on day one.
 *
 * Labels are neutral on purpose ("Public holder A"): no names, no guessed identities.
 * Addresses are public on-chain data; any holder can be removed on request.
 *
 * How they were picked (checkedAt): every Token-2022 account of NVDAx, TSLAx, SPYx, QQQx and
 * AAPLx read from the public RPC and ranked by balance (getTokenLargestAccounts is rate-limited
 * per method on api.mainnet-beta, so the same ranking was computed from getProgramAccounts),
 * owners resolved from the accounts, then kept only when the owner is on the ed25519 curve (a
 * keypair, not a program-derived pool or vault), is a plain System-owned account, holds at least
 * 2 different xStocks worth $50+ in total, and shows none of the exchange / market-maker /
 * issuer signals (six-figure SOL balances, hundreds of token accounts, dozens of xStocks,
 * sub-hour transaction bursts). Each was then valued once through Dulo's own read path.
 */

export interface PublicWallet {
  address: string;
  /** Neutral display label. */
  label: string;
  /** ISO date the wallet was last checked against the criteria above. */
  checkedAt: string;
}

const CHECKED_AT = "2026-09-15";

/**
 * Approved by the founder on 15 Sep 2026. Values at check
 * time through Dulo's read path, for orientation only (the page always reads live):
 *   A ~$178k 7 legs (top 21%) · B ~$192k 6 legs (24%) · C ~$111k 7 legs (23%) · D ~$116k 7 legs (32%)
 *   E ~$65k 7 legs (31%) · F ~$61k 11 legs (32%) · G ~$111k 6 legs (36%) · H ~$139k 3 legs (36%)
 *   I ~$118k 6 legs (36%) · J ~$483k 5 legs (37%)
 */
export const PUBLIC_WALLETS: readonly PublicWallet[] = Object.freeze([
  { address: "ARdaJWDopB4J8ukZe7q3s6yZmJjoTF3PhoeeYYVQ9sWh", label: "Public holder A", checkedAt: CHECKED_AT },
  { address: "5aN7PpP1n69hNiFgZEDxG6oXbdQUwJjBBijL7dU8bEwX", label: "Public holder B", checkedAt: CHECKED_AT },
  { address: "8sTSoSw9TRtjGQVQDKSSZWwv5HtQkF7LLExfdcqatB4q", label: "Public holder C", checkedAt: CHECKED_AT },
  { address: "4HzNaqxJZSwcTgMqcJWNZVQPnMmEeLjizSyqpBsm8ne9", label: "Public holder D", checkedAt: CHECKED_AT },
  { address: "9PiMXBFbhj39mx96wwLJsDWpYMtAY2p2v6D9Zxq2M1T", label: "Public holder E", checkedAt: CHECKED_AT },
  { address: "67yfrS5y9bBZgHcVV3HDXae8XAcZEL2LokPFzaWy3EG1", label: "Public holder F", checkedAt: CHECKED_AT },
  { address: "8ai3igNNGSyCKqLb4ZEwR4vEUFFMoEDUseuEsxuSqCU4", label: "Public holder G", checkedAt: CHECKED_AT },
  { address: "DDi6aVfoT6dfoXhpSruajhWyonQUpKBZ7BzQMMyynGGz", label: "Public holder H", checkedAt: CHECKED_AT },
  { address: "HoPivrs2rH29YXGkeRmit7Jsb56RZLWLYbAGfpEMe5mN", label: "Public holder I", checkedAt: CHECKED_AT },
  { address: "NubBLzV4kG1mu9u9XRQ7bHfEMm9pEduyMisBfj9L2pd", label: "Public holder J", checkedAt: CHECKED_AT },
]);

const LABELS: ReadonlyMap<string, string> = new Map(PUBLIC_WALLETS.map((w) => [w.address, w.label]));

/** The curated label for an address, null when it is not on the list. */
export function publicWalletLabel(address: string): string | null {
  return LABELS.get(address) ?? null;
}

/** True when `address` is on the curated list. */
export function isCuratedPublicWallet(address: string): boolean {
  return LABELS.has(address);
}
