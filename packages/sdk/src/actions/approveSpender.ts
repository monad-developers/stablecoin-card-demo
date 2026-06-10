import {
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
  type WriteContractSyncReturnType,
  maxUint256,
} from "viem";

import { erc20Abi } from "../abi";
import type { Strategy } from "../types";

export interface ApproveSpenderParameters {
  /** The strategy whose adapter the holder approves over `strategy.asset`. */
  strategy: Strategy;
  /** Allowance to grant the adapter, in `strategy.asset` base units. Defaults to unlimited. */
  amount?: bigint;
}

/**
 * Holder action — approve the strategy's adapter to pull the strategy asset.
 *
 * This is the authorization: a plain ERC-20 `approve(adapter, amount)`. The
 * `client` must be the holder's account-bound wallet client.
 */
export function approveSpender(
  client: WalletClient<Transport, Chain, Account>,
  { strategy, amount = maxUint256 }: ApproveSpenderParameters,
): Promise<WriteContractSyncReturnType<Chain>> {
  return client.writeContractSync({
    address: strategy.asset,
    abi: erc20Abi,
    functionName: "approve",
    args: [strategy.adapter, amount],
    throwOnReceiptRevert: true,
  });
}
