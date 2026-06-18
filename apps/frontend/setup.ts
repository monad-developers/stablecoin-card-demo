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

import { erc20Abi } from "@stablecoin-card/sdk";
import { demoChain, rpcUrl } from "./src/chain";

const ARTIFACTS = `${import.meta.dir}/../../packages/contracts/out`;
const TOKEN_DECIMALS = 18;
const TOKEN_NAME = "USD Coin";
const TOKEN_SYMBOL = "USDC";
const YIELD_RESERVE = "500";
const AAVE_DEBT_RESERVE_ID = 1n;
const AAVE_BORROW_BUFFER_BPS = 9_000n;
const AAVE_ORACLE_DECIMALS = 8;
const AAVE_USDC_PRICE = 100_000_000n;

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
  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: demoChain, transport: http(rpcUrl), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain: demoChain, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  console.log(`Deploying frontend demo contracts to ${rpcUrl} (chain ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  issuer:   ${issuer.address}`);

  const mockErc20 = await loadArtifact("MockERC20");
  const stablecoinAdapter = await loadArtifact("StablecoinAdapter");
  const moneyMarketArtifact = await loadArtifact("MockMoneyMarket");
  const moneyMarketAdapter = await loadArtifact("MoneyMarketAdapter");
  const aaveOracleArtifact = await loadArtifact("MockAaveV4Oracle");
  const aaveSpokeArtifact = await loadArtifact("MockAaveV4Spoke");
  const aaveTakerArtifact = await loadArtifact("MockAaveV4TakerPositionManager");
  const aaveAdapterArtifact = await loadArtifact("AaveV4BorrowAdapter");

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

  const { contractAddress: aaveOracle } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: aaveOracleArtifact.abi,
      bytecode: aaveOracleArtifact.bytecode,
      args: [AAVE_ORACLE_DECIMALS],
    }),
    throwOnReceiptRevert: true,
  });
  if (!aaveOracle) throw new Error("MockAaveV4Oracle deployment produced no address");

  const { contractAddress: aaveSpoke } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: aaveSpokeArtifact.abi,
      bytecode: aaveSpokeArtifact.bytecode,
      args: [aaveOracle],
    }),
    throwOnReceiptRevert: true,
  });
  if (!aaveSpoke) throw new Error("MockAaveV4Spoke deployment produced no address");

  const { contractAddress: aaveTakerPositionManager } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: aaveTakerArtifact.abi,
      bytecode: aaveTakerArtifact.bytecode,
    }),
    throwOnReceiptRevert: true,
  });
  if (!aaveTakerPositionManager) {
    throw new Error("MockAaveV4TakerPositionManager deployment produced no address");
  }

  await deployerClient.writeContractSync({
    address: aaveOracle,
    abi: aaveOracleArtifact.abi,
    functionName: "setReservePrice",
    args: [AAVE_DEBT_RESERVE_ID, AAVE_USDC_PRICE],
    throwOnReceiptRevert: true,
  });
  await deployerClient.writeContractSync({
    address: aaveSpoke,
    abi: aaveSpokeArtifact.abi,
    functionName: "setReserve",
    args: [AAVE_DEBT_RESERVE_ID, stablecoin, TOKEN_DECIMALS],
    throwOnReceiptRevert: true,
  });

  const { contractAddress: aaveAdapterAddress } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({
      abi: aaveAdapterArtifact.abi,
      bytecode: aaveAdapterArtifact.bytecode,
      args: [
        issuer.address,
        aaveSpoke,
        aaveTakerPositionManager,
        AAVE_DEBT_RESERVE_ID,
        AAVE_BORROW_BUFFER_BPS,
      ],
    }),
    throwOnReceiptRevert: true,
  });
  if (!aaveAdapterAddress) throw new Error("AaveV4BorrowAdapter deployment produced no address");

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
  console.log(`BUN_PUBLIC_AAVE_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`BUN_PUBLIC_AAVE_ORACLE_ADDRESS=${aaveOracle}`);
  console.log(`BUN_PUBLIC_AAVE_SPOKE_ADDRESS=${aaveSpoke}`);
  console.log(`BUN_PUBLIC_AAVE_TAKER_POSITION_MANAGER_ADDRESS=${aaveTakerPositionManager}`);
  console.log(`BUN_PUBLIC_AAVE_ADAPTER_ADDRESS=${aaveAdapterAddress}`);
  console.log(`BUN_PUBLIC_AAVE_DEBT_RESERVE_ID=${AAVE_DEBT_RESERVE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
