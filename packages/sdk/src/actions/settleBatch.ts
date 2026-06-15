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

export interface BatchSettlement {
  /** The cardholder whose funds are pulled. */
  holder: Address;
  /** Amount to settle, in stablecoin base units. */
  amount: bigint;
  /** Where the settled stablecoin is delivered (the acquirer). */
  recipient: Address;
}

export interface SettleBatchParameters {
  /** The strategy adapter to settle through. */
  strategy: Strategy;
  /** Settlements to execute atomically. */
  settlements: readonly BatchSettlement[];
}

/**
 * Issuer action — atomically settle a batch of card payments.
 *
 * The `client` must be the adapter's configured issuer; the contract rejects any
 * other caller. If any settlement fails, the full batch reverts.
 */
export function settleBatch(
  client: WalletClient<Transport, Chain, Account>,
  { strategy, settlements }: SettleBatchParameters,
): Promise<WriteContractSyncReturnType<Chain>> {
  return client.writeContractSync({
    address: strategy.adapter,
    abi: settlementAdapterAbi,
    functionName: "settleBatch",
    args: [settlements],
    throwOnReceiptRevert: true,
  });
}
