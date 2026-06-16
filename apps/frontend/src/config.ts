import type { Address } from "viem";

import type { DemoStrategy, StrategyId } from "./demo";
export { rpcUrl } from "./chain";

const publicAcquirerAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_ACQUIRER_ADDRESS;
const publicStablecoinAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_STABLECOIN_ADDRESS;
const publicStablecoinAssetAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_STABLECOIN_ASSET_ADDRESS;
const publicStablecoinAdapterAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS;
const publicMmStablecoinAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_MM_STABLECOIN_ADDRESS;
const publicMmMoneyMarketAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_MM_MONEY_MARKET_ADDRESS;
const publicMmAdapterAddress = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_MM_ADAPTER_ADDRESS;

function requiredValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in apps/frontend/.env`);
  return value;
}

function envAddress(name: string, value: string | undefined): Address {
  const resolved = requiredValue(name, value);
  if (!/^0x[0-9a-fA-F]{40}$/.test(resolved)) throw new Error(`${name} must be an address`);
  return resolved as Address;
}

export const acquirer = envAddress(
  "BUN_PUBLIC_ACQUIRER_ADDRESS",
  publicAcquirerAddress,
);

export const strategies: Record<StrategyId, DemoStrategy> = {
  stablecoin: {
    stablecoin: envAddress("BUN_PUBLIC_STABLECOIN_ADDRESS", publicStablecoinAddress),
    asset: envAddress("BUN_PUBLIC_STABLECOIN_ASSET_ADDRESS", publicStablecoinAssetAddress),
    adapter: envAddress("BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS", publicStablecoinAdapterAddress),
  },
  "money-market": {
    stablecoin: envAddress("BUN_PUBLIC_MM_STABLECOIN_ADDRESS", publicMmStablecoinAddress),
    asset: envAddress("BUN_PUBLIC_MM_MONEY_MARKET_ADDRESS", publicMmMoneyMarketAddress),
    adapter: envAddress("BUN_PUBLIC_MM_ADAPTER_ADDRESS", publicMmAdapterAddress),
  },
};
