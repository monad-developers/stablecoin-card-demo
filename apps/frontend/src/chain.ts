import { defineChain } from "viem";

function requiredValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in apps/frontend/.env`);
  return value;
}

function requiredNumber(name: string, value: string | undefined): number {
  const resolved = requiredValue(name, value);
  const parsed = Number(resolved);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requiredList(name: string, value: string | undefined): string[] {
  const values = requiredValue(name, value).split(",").map((item) => item.trim());
  if (values.some((item) => !item)) throw new Error(`${name} must be a comma-separated list`);
  return values;
}

function defaultChainName(chainId: number): string {
  if (chainId === 10_143) return "Monad Testnet";
  if (chainId === 31_337) return "Local Anvil";
  return `Chain ${chainId}`;
}

export const chainId = requiredNumber("BUN_PUBLIC_CHAIN_ID", process.env.BUN_PUBLIC_CHAIN_ID);
export const rpcUrls = requiredList("BUN_PUBLIC_RPC_URL", process.env.BUN_PUBLIC_RPC_URL);
export const chainName = defaultChainName(chainId);

export const demoChain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: {
    decimals: 18,
    name: chainId === 10_143 ? "Monad" : "Ether",
    symbol: chainId === 10_143 ? "MON" : "ETH",
  },
  rpcUrls: {
    default: {
      http: rpcUrls,
    },
  },
});
