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
const TOKEN_NAME = "USD Coin";
const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 18;
const INITIAL_DEPOSIT = "10000";
const YIELD_RESERVE = "500";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/money-market/.env`);
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
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const initialDeposit = parseUnits(INITIAL_DEPOSIT, TOKEN_DECIMALS);
  const yieldReserve = parseUnits(YIELD_RESERVE, TOKEN_DECIMALS);

  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));
  const holder = privateKeyToAccount(envPrivateKey("DEMO_HOLDER_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });
  const holderClient = createWalletClient({ account: holder, chain: foundry, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  console.log(`Deploying money-market demo contracts to ${rpcUrl} (chain ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  issuer:   ${issuer.address}`);
  console.log(`  holder:   ${holder.address}`);

  const mockErc20 = await loadArtifact("MockERC20");
  const { contractAddress: stablecoin } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: mockErc20.abi,
      bytecode: mockErc20.bytecode,
      args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS],
    }),
    throwOnReceiptRevert: true,
  });
  if (!stablecoin) throw new Error("MockERC20 deployment produced no address");

  const moneyMarketArtifact = await loadArtifact("MockMoneyMarket");
  const { contractAddress: moneyMarket } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: moneyMarketArtifact.abi,
      bytecode: moneyMarketArtifact.bytecode,
      args: [stablecoin],
    }),
    throwOnReceiptRevert: true,
  });
  if (!moneyMarket) throw new Error("MockMoneyMarket deployment produced no address");

  const adapterArtifact = await loadArtifact("MoneyMarketAdapter");
  const { contractAddress: adapter } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: adapterArtifact.abi,
      bytecode: adapterArtifact.bytecode,
      args: [issuer.address, moneyMarket],
    }),
    throwOnReceiptRevert: true,
  });
  if (!adapter) throw new Error("MoneyMarketAdapter deployment produced no address");

  await deployerClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "mint",
    args: [holder.address, initialDeposit],
    throwOnReceiptRevert: true,
  });
  await holderClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "approve",
    args: [moneyMarket, initialDeposit],
    throwOnReceiptRevert: true,
  });
  await holderClient.writeContractSync({
    address: moneyMarket,
    abi: moneyMarketArtifact.abi,
    functionName: "deposit",
    args: [initialDeposit, holder.address],
    throwOnReceiptRevert: true,
  });
  await deployerClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "mint",
    args: [moneyMarket, yieldReserve],
    throwOnReceiptRevert: true,
  });

  const receiptBalance = await publicClient.readContract({
    address: moneyMarket,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder.address],
  });

  console.log(`\nDeposited ${formatUnits(initialDeposit, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  console.log(`Holder receipt balance: ${formatUnits(receiptBalance, TOKEN_DECIMALS)} mUSDC`);
  console.log(`Prefunded market yield reserve: ${formatUnits(yieldReserve, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  console.log("\nAdd these values to apps/money-market/.env:");
  console.log(`DEMO_MM_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`DEMO_MM_MONEY_MARKET_ADDRESS=${moneyMarket}`);
  console.log(`DEMO_MM_ADAPTER_ADDRESS=${adapter}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
