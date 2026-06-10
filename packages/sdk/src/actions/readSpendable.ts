import type { Address, PublicClient } from "viem";

import { settlementAdapterAbi } from "../abi";
import type { Strategy } from "../types";

export interface ReadSpendableParameters {
  /** The strategy adapter to query. */
  strategy: Strategy;
  /** The cardholder whose spendable value to read. */
  holder: Address;
}

/**
 * Read action — the holder's spendable value (balance recognition), in stablecoin
 * base units, that the issuer may settle. Bounded by the holder's balance and the
 * allowance they granted the adapter.
 */
export function readSpendable(
  client: PublicClient,
  { strategy, holder }: ReadSpendableParameters,
): Promise<bigint> {
  return client.readContract({
    address: strategy.adapter,
    abi: settlementAdapterAbi,
    functionName: "spendable",
    args: [holder],
  });
}
