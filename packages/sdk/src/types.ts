import type { Address } from "viem";

/**
 * A deployed settlement adapter and the tokens it works with.
 *
 * One adapter is deployed per strategy and shared by every holder, so a
 * `Strategy` is just the handle the three actions need: which adapter to call,
 * which token a holder approves, and which stablecoin settlement is delivered in.
 */
export interface Strategy {
  /** The adapter contract — what the holder approves and the issuer settles through. */
  adapter: Address;
  /** The token a holder approves the adapter to pull (equals `stablecoin` for the 1:1 strategy). */
  asset: Address;
  /** The stablecoin settlements are denominated in and delivered as. */
  stablecoin: Address;
}
