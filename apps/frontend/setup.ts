import {
  type Abi,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { erc20Abi } from "@stablecoin-card/sdk";

const ARTIFACTS = `${import.meta.dir}/../../packages/contracts/out`;
const TOKEN_DECIMALS = 18;
const TOKEN_NAME = "USD Coin";
const TOKEN_SYMBOL = "USDC";
const YIELD_RESERVE = "500";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/frontend/.env`);
  return value;
}

function envPrivateKey(name: string): Hex {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a private key`);
  return value as Hex;
}

async function loadArtifact(name: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const file = Bun.file(`${ARTIFACTS}/${name}.sol/${name}.json`);
  if (!(await file.exists())) {
    throw new Error("Missing contract artifact. Run `bun run --filter '@stablecoin-card/contracts' build` from the repo root first.");
  }
  const artifact = (await file.json()) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function main(): Promise<void> {
  const rpcUrl = process.env.BUN_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  console.log(`Deploying frontend demo contracts to ${rpcUrl} (chain ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  issuer:   ${issuer.address}`);

  const mockErc20 = await loadArtifact("MockERC20");
  const stablecoinAdapter = await loadArtifact("StablecoinAdapter");
  const moneyMarketArtifact = await loadArtifact("MockMoneyMarket");
  const moneyMarketAdapter = await loadArtifact("MoneyMarketAdapter");

  const { contractAddress: stablecoin } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: mockErc20.abi,
      bytecode: mockErc20.bytecode,
      args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS],
    }),
    throwOnReceiptRevert: true,
  });
  if (!stablecoin) throw new Error("MockERC20 deployment produced no address");

  const { contractAddress: stablecoinAdapterAddress } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: stablecoinAdapter.abi,
      bytecode: stablecoinAdapter.bytecode,
      args: [issuer.address, stablecoin],
    }),
    throwOnReceiptRevert: true,
  });
  if (!stablecoinAdapterAddress) throw new Error("StablecoinAdapter deployment produced no address");

  const { contractAddress: moneyMarket } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: moneyMarketArtifact.abi,
      bytecode: moneyMarketArtifact.bytecode,
      args: [stablecoin],
    }),
    throwOnReceiptRevert: true,
  });
  if (!moneyMarket) throw new Error("MockMoneyMarket deployment produced no address");

  const { contractAddress: moneyMarketAdapterAddress } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: moneyMarketAdapter.abi,
      bytecode: moneyMarketAdapter.bytecode,
      args: [issuer.address, moneyMarket],
    }),
    throwOnReceiptRevert: true,
  });
  if (!moneyMarketAdapterAddress) throw new Error("MoneyMarketAdapter deployment produced no address");

  const yieldReserve = parseUnits(YIELD_RESERVE, TOKEN_DECIMALS);
  await deployerClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "mint",
    args: [moneyMarket, yieldReserve],
    throwOnReceiptRevert: true,
  });

  console.log(`\nPrefunded money market yield reserve with ${formatUnits(yieldReserve, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  console.log("\nAdd these values to apps/frontend/.env:");
  console.log(`BUN_PUBLIC_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`BUN_PUBLIC_STABLECOIN_ASSET_ADDRESS=${stablecoin}`);
  console.log(`BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS=${stablecoinAdapterAddress}`);
  console.log(`BUN_PUBLIC_MM_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`BUN_PUBLIC_MM_MONEY_MARKET_ADDRESS=${moneyMarket}`);
  console.log(`BUN_PUBLIC_MM_ADAPTER_ADDRESS=${moneyMarketAdapterAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
