/**
 * Compute per-payment gas cost statistics for the stablecoin-card settlement flow.
 *
 * Prerequisites for fresh local contracts:
 *   1. Build contracts:  bun run --filter '@stablecoin-card/contracts' build
 *   2. Start a node:     anvil --block-time 0.4
 *   3. Run:              bun run --filter '@stablecoin-card/sdk' costs
 *
 * If existing demo env vars are present, the script reuses them instead of deploying:
 *   RPC_URL or BUN_PUBLIC_RPC_URL
 *   DEMO_STABLECOIN_ADDRESS or BUN_PUBLIC_STABLECOIN_ADDRESS
 *   DEMO_ADAPTER_ADDRESS or BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS
 *   DEMO_ACQUIRER_ADDRESS or BUN_PUBLIC_ACQUIRER_ADDRESS
 *   DEMO_DEPLOYER_PRIVATE_KEY, DEMO_ISSUER_PRIVATE_KEY, DEMO_HOLDER_PRIVATE_KEY
 *
 * Set MON_PRICE_USD or NATIVE_TOKEN_PRICE_USD to convert native gas cost to USD.
 * Set GAS_PRICE_GWEI to override the default 100 gwei cost basis.
 */

import {
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type TransactionReceipt,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  formatGwei,
  http,
  maxUint256,
  parseEther,
  parseGwei,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  approveSpender,
  erc20Abi,
  settle,
  settleBatch,
  type Strategy,
} from "../src/index";

const RPC_URL = process.env.RPC_URL ?? process.env.BUN_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const ARTIFACTS = `${import.meta.dir}/../../contracts/out`;
const TOKEN_DECIMALS = 6;
const PAYMENT_AMOUNT = parseUnits("1", TOKEN_DECIMALS);
const BATCH_SIZE = 10;

const ANVIL_DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_ISSUER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ANVIL_HOLDER_PRIVATE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const ANVIL_ACQUIRER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function envPrivateKey(name: string, fallback: Hex): Hex {
  const value = process.env[name] ?? fallback;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a private key`);
  return value as Hex;
}

function envAddress(...names: string[]): Address | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be an address`);
    return value as Address;
  }
  return undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

async function loadArtifact(name: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const file = Bun.file(`${ARTIFACTS}/${name}.sol/${name}.json`);
  if (!(await file.exists())) {
    throw new Error(`Missing artifact ${name}.json. Run \`bun run build\` in packages/contracts first.`);
  }
  const artifact = await file.json();
  return { abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as Hex };
}

function createDemoChain(chainId: number): Chain {
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Native", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
}

function receiptCost(receipt: TransactionReceipt, nativeTokenPriceUsd: number, gasPriceWei: bigint) {
  const wei = receipt.gasUsed * gasPriceWei;
  const native = Number(formatEther(wei));
  return {
    gasUsed: receipt.gasUsed,
    gasPriceGwei: formatGwei(gasPriceWei),
    native,
    usd: native * nativeTokenPriceUsd,
  };
}

function usd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.0001) return `$${value.toFixed(14)}`;
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

async function main(): Promise<void> {
  const nativeTokenPriceUsd = Number(
    process.env.MON_PRICE_USD ?? process.env.NATIVE_TOKEN_PRICE_USD ?? envNumber("NATIVE_TOKEN_USD", 1),
  );
  if (!Number.isFinite(nativeTokenPriceUsd) || nativeTokenPriceUsd < 0) {
    throw new Error("MON_PRICE_USD must be a non-negative number");
  }
  const gasPriceGwei = process.env.GAS_PRICE_GWEI ?? "100";
  if (!/^\d+(\.\d+)?$/.test(gasPriceGwei)) throw new Error("GAS_PRICE_GWEI must be a non-negative number");
  const gasPriceWei = parseGwei(gasPriceGwei);

  const chainProbe = createPublicClient({ transport: http(RPC_URL) });
  const chain = createDemoChain(await chainProbe.getChainId());
  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY", ANVIL_DEPLOYER_PRIVATE_KEY));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY", ANVIL_ISSUER_PRIVATE_KEY));
  const holder = privateKeyToAccount(envPrivateKey("DEMO_HOLDER_PRIVATE_KEY", ANVIL_HOLDER_PRIVATE_KEY));
  const acquirer = envAddress("DEMO_ACQUIRER_ADDRESS", "BUN_PUBLIC_ACQUIRER_ADDRESS") ?? ANVIL_ACQUIRER;

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain, transport: http(RPC_URL) });
  const holderClient = createWalletClient({ account: holder, chain, transport: http(RPC_URL) });
  const issuerClient = createWalletClient({ account: issuer, chain, transport: http(RPC_URL) });

  const configuredStablecoin = envAddress("DEMO_STABLECOIN_ADDRESS", "BUN_PUBLIC_STABLECOIN_ADDRESS");
  const configuredAdapter = envAddress("DEMO_ADAPTER_ADDRESS", "BUN_PUBLIC_STABLECOIN_ADAPTER_ADDRESS");

  let stablecoin = configuredStablecoin;
  let adapter = configuredAdapter;
  if (!stablecoin || !adapter) {
    const mockErc20 = await loadArtifact("MockERC20");
    const stablecoinAdapter = await loadArtifact("StablecoinAdapter");

    const stablecoinReceipt = await deployerClient.sendTransactionSync({
      data: encodeDeployData({
        abi: mockErc20.abi,
        bytecode: mockErc20.bytecode,
        args: ["USD Coin", "USDC", TOKEN_DECIMALS],
      }),
      throwOnReceiptRevert: true,
    });
    if (!stablecoinReceipt.contractAddress) throw new Error("MockERC20 deployment produced no address");
    stablecoin = stablecoinReceipt.contractAddress;

    const adapterReceipt = await deployerClient.sendTransactionSync({
      data: encodeDeployData({
        abi: stablecoinAdapter.abi,
        bytecode: stablecoinAdapter.bytecode,
        args: [issuer.address, stablecoin],
      }),
      throwOnReceiptRevert: true,
    });
    if (!adapterReceipt.contractAddress) throw new Error("StablecoinAdapter deployment produced no address");
    adapter = adapterReceipt.contractAddress;
  }

  const strategy: Strategy = { adapter, asset: stablecoin, stablecoin };
  const requiredNativeBalance = parseEther("0.05");
  if (await publicClient.getBalance({ address: holder.address }) < requiredNativeBalance) {
    await deployerClient.sendTransactionSync({
      to: holder.address,
      value: requiredNativeBalance,
      throwOnReceiptRevert: true,
    });
    await Bun.sleep(2_000);
  }

  const setupAmount = PAYMENT_AMOUNT * BigInt(BATCH_SIZE + 5);
  await deployerClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "mint",
    args: [holder.address, setupAmount],
    throwOnReceiptRevert: true,
  });
  await approveSpender(holderClient, { strategy, amount: maxUint256 });

  const transferReceipt = await holderClient.writeContractSync({
    address: stablecoin,
    abi: transferAbi,
    functionName: "transfer",
    args: [acquirer, PAYMENT_AMOUNT],
    throwOnReceiptRevert: true,
  });

  const settleReceipt = await settle(issuerClient, {
    strategy,
    holder: holder.address,
    amount: PAYMENT_AMOUNT,
    recipient: acquirer,
  });

  const batchReceipt = await settleBatch(issuerClient, {
    strategy,
    settlements: Array.from({ length: BATCH_SIZE }, () => ({
      holder: holder.address,
      amount: PAYMENT_AMOUNT,
      recipient: acquirer,
    })),
  });

  const transferCost = receiptCost(transferReceipt, nativeTokenPriceUsd, gasPriceWei);
  const settleCost = receiptCost(settleReceipt, nativeTokenPriceUsd, gasPriceWei);
  const batchCost = receiptCost(batchReceipt, nativeTokenPriceUsd, gasPriceWei);

  console.log(`\nCost stats for ${RPC_URL} (chain ${chain.id})`);
  console.log(`Native token price: ${usd(nativeTokenPriceUsd)}`);
  console.log(`Gas price used: ${formatGwei(gasPriceWei)} gwei`);
  console.log(`Stablecoin: ${stablecoin}`);
  console.log(`Adapter:    ${adapter}`);
  console.log("");
  console.table([
    {
      operation: "ERC20 transfer",
      payments: 1,
      gasUsed: transferCost.gasUsed.toString(),
      gasPriceGwei: transferCost.gasPriceGwei,
      totalNative: transferCost.native.toFixed(18),
      totalUsd: usd(transferCost.usd),
      perPaymentUsd: usd(transferCost.usd),
    },
    {
      operation: "settle()",
      payments: 1,
      gasUsed: settleCost.gasUsed.toString(),
      gasPriceGwei: settleCost.gasPriceGwei,
      totalNative: settleCost.native.toFixed(18),
      totalUsd: usd(settleCost.usd),
      perPaymentUsd: usd(settleCost.usd),
    },
    {
      operation: "settleBatch(10)",
      payments: BATCH_SIZE,
      gasUsed: batchCost.gasUsed.toString(),
      gasPriceGwei: batchCost.gasPriceGwei,
      totalNative: batchCost.native.toFixed(18),
      totalUsd: usd(batchCost.usd),
      perPaymentUsd: usd(batchCost.usd / BATCH_SIZE),
    },
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
