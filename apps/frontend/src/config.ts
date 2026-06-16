import type { Address } from "viem";

import type { DemoStrategy, StrategyId } from "./demo";
export { rpcUrl } from "./chain";

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
  process.env.BUN_PUBLIC_ACQUIRER_ADDRESS,
);

export const strategies: Record<StrategyId, DemoStrategy> = {
  stablecoin: {
    stablecoin: envAddress("BUN_PUBLIC_STABLECOIN_ADDRESS", process.env.BUN_PUBLIC_STABLECOIN_ADDRESS),
    asset: envAddress("BUN_PUBLIC_STABLECOIN_ASSET_ADDRESS", process.env.BUN_PUBLIC_STABLECOIN_ASSET_ADDRESS),
    adapter: envAddress("BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS", process.env.BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS),
  },
  "money-market": {
    stablecoin: envAddress("BUN_PUBLIC_MM_STABLECOIN_ADDRESS", process.env.BUN_PUBLIC_MM_STABLECOIN_ADDRESS),
    asset: envAddress("BUN_PUBLIC_MM_MONEY_MARKET_ADDRESS", process.env.BUN_PUBLIC_MM_MONEY_MARKET_ADDRESS),
    adapter: envAddress("BUN_PUBLIC_MM_ADAPTER_ADDRESS", process.env.BUN_PUBLIC_MM_ADAPTER_ADDRESS),
  },
};
