/**
 * End-to-end smoke test of the @stablecoin-card/sdk actions against a local anvil node.
 *
 * It deploys a mock USDC plus stablecoin and money-market adapters via viem
 * (using the forge build artifacts), then exercises approveSpender ->
 * readSpendable -> settle -> finality and asserts the money actually moved —
 * plus that the issuer gate holds.
 *
 * Prerequisites:
 *   1. Build the contracts so the artifacts exist:  bun run --filter '@stablecoin-card/contracts' build
 *   2. Start a node:                                 anvil --block-time 0.4
 *   3. Run this script:                              bun run --filter '@stablecoin-card/sdk' e2e
 */

import {
  type Abi,
  type Address,
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

import {
  approveSpender,
  erc20Abi,
  readSpendable,
  settle,
  waitForFinality,
  type Strategy,
} from "../src/index";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ARTIFACTS = `${import.meta.dir}/../../contracts/out`;

// Well-known anvil dev accounts (#0 deployer, #1 issuer, #2 acquirer, #3 holder).
const deployer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const issuer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const holder = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);
const acquirer = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(RPC_URL),
  pollingInterval: 200,
});
const deployerClient = createWalletClient({ account: deployer, chain: foundry, transport: http(RPC_URL) });
const holderClient = createWalletClient({ account: holder, chain: foundry, transport: http(RPC_URL) });
const issuerClient = createWalletClient({ account: issuer, chain: foundry, transport: http(RPC_URL) });

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "\u2713" : "\u2717"} ${label}`);
  if (!ok) failures += 1;
}

async function loadArtifact(name: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const file = Bun.file(`${ARTIFACTS}/${name}.sol/${name}.json`);
  if (!(await file.exists())) {
    throw new Error(`Missing artifact ${name}.json — run \`bun run build\` (forge build) first.`);
  }
  const artifact = await file.json();
  return { abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as Hex };
}

async function deploy(name: string, args: readonly unknown[]): Promise<Address> {
  const { abi, bytecode } = await loadArtifact(name);
  const { contractAddress } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({ abi, bytecode, args }),
    throwOnReceiptRevert: true,
  });
  if (!contractAddress) throw new Error(`${name} deployment produced no address`);
  return contractAddress;
}

async function main(): Promise<void> {
  console.log(`\nDeploying to ${RPC_URL} ...`);
  const usdc = await deploy("MockERC20", ["USD Coin", "USDC", 6]);
  const adapter = await deploy("StablecoinAdapter", [issuer.address, usdc]);
  const strategy: Strategy = { adapter, asset: usdc, stablecoin: usdc };
  console.log(`  USDC:    ${usdc}`);
  console.log(`  Adapter: ${adapter}  (issuer ${issuer.address})\n`);

  const fund = parseUnits("10000", 6);
  const charge = parseUnits("42.5", 6);

  // Fund the holder's own wallet — no deposit, they keep custody.
  await holderClient.writeContractSync({
    address: usdc,
    abi: erc20Abi,
    functionName: "mint",
    args: [holder.address, fund],
    throwOnReceiptRevert: true,
  });

  // 1. Holder approves the adapter (the authorization).
  await approveSpender(holderClient, { strategy });

  // 2. Issuer reads spendable (balance recognition).
  const spendableBefore = await readSpendable(publicClient, { strategy, holder: holder.address });
  check(`spendable after approve == ${formatUnits(fund, 6)} USDC`, spendableBefore === fund);

  // 3. Issuer settles to the acquirer.
  const settleReceipt = await settle(issuerClient, {
    strategy,
    holder: holder.address,
    amount: charge,
    recipient: acquirer,
  });
  check("settle mined successfully", settleReceipt.status === "success");

  const finalizedBlocks = await waitForFinality(publicClient, settleReceipt);
  check(
    "settle finalized by two blocks",
    finalizedBlocks[0].number === settleReceipt.blockNumber + 1n &&
      finalizedBlocks[1].number === settleReceipt.blockNumber + 2n,
  );

  const acquirerBalance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [acquirer],
  });
  check(`acquirer received ${formatUnits(charge, 6)} USDC`, acquirerBalance === charge);

  const spendableAfter = await readSpendable(publicClient, { strategy, holder: holder.address });
  check(`spendable reduced to ${formatUnits(fund - charge, 6)} USDC`, spendableAfter === fund - charge);

  // 4. Issuer gate: a non-issuer cannot settle.
  let gated = false;
  try {
    const receipt = await settle(holderClient, {
      strategy,
      holder: holder.address,
      amount: charge,
      recipient: acquirer,
    });
    gated = receipt.status === "reverted";
  } catch {
    gated = true;
  }
  check("non-issuer settle is rejected", gated);

  console.log("\nDeploying money market strategy ...");
  const moneyMarket = await deploy("MockMoneyMarket", [usdc]);
  const moneyMarketAdapter = await deploy("MoneyMarketAdapter", [issuer.address, moneyMarket]);
  const moneyMarketStrategy: Strategy = {
    adapter: moneyMarketAdapter,
    asset: moneyMarket,
    stablecoin: usdc,
  };
  const { abi: moneyMarketAbi } = await loadArtifact("MockMoneyMarket");
  console.log(`  MoneyMarket: ${moneyMarket}`);
  console.log(`  Adapter:     ${moneyMarketAdapter}  (issuer ${issuer.address})\n`);

  const marketFund = parseUnits("10000", 6);
  const marketCharge = parseUnits("101", 6);
  const yieldReserve = parseUnits("500", 6);

  // Holder deposits stablecoin and receives yield-bearing receipt tokens.
  await holderClient.writeContractSync({
    address: usdc,
    abi: erc20Abi,
    functionName: "mint",
    args: [holder.address, marketFund],
    throwOnReceiptRevert: true,
  });
  await holderClient.writeContractSync({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [moneyMarket, marketFund],
    throwOnReceiptRevert: true,
  });
  const depositReceipt = await holderClient.writeContractSync({
    address: moneyMarket,
    abi: moneyMarketAbi,
    functionName: "deposit",
    args: [marketFund, holder.address],
    throwOnReceiptRevert: true,
  });
  check("money market deposit mined successfully", depositReceipt.status === "success");

  const receiptBalance = await publicClient.readContract({
    address: moneyMarket,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder.address],
  });
  check("holder received money market receipt tokens", receiptBalance > 0n && receiptBalance <= marketFund);

  // The mock pays yield from prefunded reserves while its conversion rate rises per block.
  await deployerClient.writeContractSync({
    address: usdc,
    abi: erc20Abi,
    functionName: "mint",
    args: [moneyMarket, yieldReserve],
    throwOnReceiptRevert: true,
  });

  await approveSpender(holderClient, { strategy: moneyMarketStrategy });

  const moneyMarketSpendableBefore = await readSpendable(publicClient, {
    strategy: moneyMarketStrategy,
    holder: holder.address,
  });
  check("money market spendable includes accrued yield", moneyMarketSpendableBefore > marketFund);

  const acquirerBeforeMoneyMarket = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [acquirer],
  });

  const moneyMarketSettleReceipt = await settle(issuerClient, {
    strategy: moneyMarketStrategy,
    holder: holder.address,
    amount: marketCharge,
    recipient: acquirer,
  });
  check("money market settle mined successfully", moneyMarketSettleReceipt.status === "success");

  const acquirerAfterMoneyMarket = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [acquirer],
  });
  check(
    `acquirer received ${formatUnits(marketCharge, 6)} USDC from money market`,
    acquirerAfterMoneyMarket - acquirerBeforeMoneyMarket === marketCharge,
  );

  const receiptBalanceAfter = await publicClient.readContract({
    address: moneyMarket,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder.address],
  });
  check("holder receipt balance reduced after money market settle", receiptBalanceAfter < receiptBalance);

  const moneyMarketSpendableAfter = await readSpendable(publicClient, {
    strategy: moneyMarketStrategy,
    holder: holder.address,
  });
  check(
    "money market spendable reduced after settle",
    moneyMarketSpendableAfter < moneyMarketSpendableBefore,
  );

  console.log("");
  if (failures > 0) {
    console.error(`\u274c e2e failed: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\u2705 e2e passed: stablecoin + money market settlement flows");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
