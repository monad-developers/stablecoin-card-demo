import type {
  Account,
  Address,
  Chain,
  Transport,
  WalletClient,
  WriteContractSyncReturnType,
} from "viem";

import { settlementAdapterAbi } from "../abi";
import type { Strategy } from "../types";

export interface SettleParameters {
  /** The strategy adapter to settle through. */
  strategy: Strategy;
  /** The cardholder whose funds are pulled. */
  holder: Address;
  /** Amount to settle, in stablecoin base units. */
  amount: bigint;
  /** Where the settled stablecoin is delivered (the acquirer). */
  recipient: Address;
}

/**
 * Issuer action — settle `amount` from `holder` to `recipient`.
 *
 * The `client` must be the adapter's configured issuer; the contract rejects any
 * other caller.
 */
export function settle(
  client: WalletClient<Transport, Chain, Account>,
  { strategy, holder, amount, recipient }: SettleParameters,
): Promise<WriteContractSyncReturnType<Chain>> {
  return client.writeContractSync({
    address: strategy.adapter,
    abi: settlementAdapterAbi,
    functionName: "settle",
    args: [holder, amount, recipient],
    throwOnReceiptRevert: true,
  });
}
