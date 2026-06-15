import type { Address, Hash } from "viem";

export const TOKEN_DECIMALS = 18;
export const DEFAULT_HOLDER_BALANCE = "5";
export const SETTLEMENT_AMOUNT = "1";

export type StrategyId = "stablecoin" | "money-market";

export type DemoStrategy = {
  adapter: Address;
  asset: Address;
  stablecoin: Address;
};

export type HolderResponse = {
  holder: Address;
};

export type SerializedReceipt = {
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: string;
  status: "success" | "reverted";
};

export type SettleResponse = {
  receipt: SerializedReceipt;
};

export const strategyIds: StrategyId[] = ["stablecoin", "money-market"];

export function isStrategyId(value: string): value is StrategyId {
  return value === "stablecoin" || value === "money-market";
}
