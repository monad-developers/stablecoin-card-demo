import { defineChain } from "viem";

function optionalValue(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

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

function defaultRpcUrl(chainId: number): string {
  if (chainId === 10_143) return "https://rpc-testnet.monad.xyz";
  if (chainId === 31_337) return "http://127.0.0.1:8545";
  throw new Error(`Missing BUN_PUBLIC_RPC_URL for unsupported chain ${chainId}`);
}

function defaultChainName(chainId: number): string {
  if (chainId === 10_143) return "Monad Testnet";
  if (chainId === 31_337) return "Local Anvil";
  return `Chain ${chainId}`;
}

export const chainId = requiredNumber("BUN_PUBLIC_CHAIN_ID", process.env.BUN_PUBLIC_CHAIN_ID);
export const rpcUrl = optionalValue(process.env.BUN_PUBLIC_RPC_URL, defaultRpcUrl(chainId));
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
