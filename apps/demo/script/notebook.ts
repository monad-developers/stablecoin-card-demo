/**
 * Notebook-style walkthrough of the issuer's card-settlement flow.
 *
 * We model the moment a card request reaches the issuer. The issuer has to answer the
 * card network yes/no, fast — and because settlement here is a direct debit (pull the
 * holder's stablecoin to the acquirer, no credit), a truthful "yes" means the money has
 * already, finally moved. So the issuer settles inside the window and waits for finality.
 *
 * Each `cell()` is a self-contained step you can read top-to-bottom. It runs against a
 * local anvil node (producing blocks continuously) using the real contracts via
 * `@stablecoin-card/sdk`.
 *
 * Prerequisites:
 *   1. Build the contracts:  bun run build      (or: forge build)
 *   2. Start a node:         bun run chain       (anvil --block-time 1)
 *   3. Run the notebook:     bun run notebook
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
} from "@stablecoin-card/sdk";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ARTIFACTS = `${import.meta.dir}/../../../packages/contracts/out`;

// Well-known anvil dev accounts (#0 deployer/platform, #1 issuer, #2 acquirer, #3 holder).
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

async function cell(title: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${"\u2500".repeat(64)}\n\u25b6 ${title}\n${"\u2500".repeat(64)}`);
  await fn();
}

async function loadArtifact(name: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const file = Bun.file(`${ARTIFACTS}/${name}.sol/${name}.json`);
  if (!(await file.exists())) {
    throw new Error(`Missing artifact ${name}.json \u2014 run \`bun run build\` first.`);
  }
  const artifact = await file.json();
  return { abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as Hex };
}

async function deployContract(name: string, args: readonly unknown[]): Promise<Address> {
  const { abi, bytecode } = await loadArtifact(name);
  const { contractAddress } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({ abi, bytecode, args }),
    throwOnReceiptRevert: true,
  });
  if (!contractAddress) throw new Error(`${name} deployment produced no address`);
  return contractAddress;
}

async function main(): Promise<void> {
  let strategy!: Strategy;

  await cell("Cell 0 \u00b7 Onboarding (one-time): the holder approves the adapter", async () => {
    // The platform deploys one StablecoinAdapter per strategy, bound to this issuer.
    const usdc = await deployContract("MockERC20", ["USD Coin", "USDC", 6]);
    const adapter = await deployContract("StablecoinAdapter", [issuer.address, usdc]);
    strategy = { adapter, asset: usdc, stablecoin: usdc };
    console.log(`adapter ${adapter} (issuer ${issuer.address})`);

    // The holder keeps custody in their own wallet \u2014 no deposit.
    await holderClient.writeContractSync({
      address: usdc,
      abi: erc20Abi,
      functionName: "mint",
      args: [holder.address, parseUnits("10000", 6)],
      throwOnReceiptRevert: true,
    });

    // The standing authorization is a plain ERC-20 approval of the adapter.
    await approveSpender(holderClient, { strategy });
    console.log("holder approved the adapter; funds stay liquid in their wallet until settlement");
  });

  // A card request arrives from the network.
  const request = { holder: holder.address, amount: parseUnits("42.50", 6), acquirer };

  await cell("Cell 1 \u00b7 A card request reaches the issuer", async () => {
    console.log(
      `network \u2192 issuer: holder ${request.holder} wants ${formatUnits(request.amount, 6)} USDC`,
    );
    // Balance recognition \u2014 context for the issuer. The settle attempt is the real decision.
    const spendable = await readSpendable(publicClient, { strategy, holder: request.holder });
    console.log(`recognized spendable: ${formatUnits(spendable, 6)} USDC`);
  });

  await cell("Cell 2 \u00b7 Issuer settles in the window and waits for finality", async () => {
    const startedAt = Date.now();

    // The settle attempt IS the decision: if it cannot pull, it reverts (a "no").
    const receipt = await settle(issuerClient, {
      strategy,
      holder: request.holder,
      amount: request.amount,
      recipient: request.acquirer,
    });

    // Track to finality: the two blocks built on top of the settle tx.
    const finalizedBlocks = await waitForFinality(publicClient, receipt);
    const elapsedMs = Date.now() - startedAt;

    console.log(`\n\u2705 APPROVED \u2014 settlement finalized in ${elapsedMs}ms`);
    console.log(`   settle tx:         ${receipt.transactionHash} (block ${receipt.blockNumber})`);
    console.log(`   confirming blocks: ${finalizedBlocks.map((b) => b.number).join(", ")}`);
    console.log(
      `   delivered:         ${formatUnits(request.amount, 6)} USDC \u2192 acquirer ${request.acquirer}`,
    );
  });

  console.log("\nThe issuer's \"yes\" is backed by a finalized, irreversible settlement.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
