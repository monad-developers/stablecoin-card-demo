import { defineChain } from "viem";

const publicChainId = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_CHAIN_ID;
const publicRpcUrl = typeof process === "undefined" ? undefined : process.env.BUN_PUBLIC_RPC_URL;

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

function defaultChainName(chainId: number): string {
  if (chainId === 10_143) return "Monad Testnet";
  if (chainId === 31_337) return "Local Anvil";
  return `Chain ${chainId}`;
}

export const chainId = requiredNumber("BUN_PUBLIC_CHAIN_ID", publicChainId);
export const rpcUrl = requiredValue("BUN_PUBLIC_RPC_URL", publicRpcUrl);
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
      http: [rpcUrl],
    },
  },
});
