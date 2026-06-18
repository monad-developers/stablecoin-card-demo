import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  erc20Abi,
  readSpendable,
  settle,
  waitForFinality,
  type Strategy,
} from "@stablecoin-card/sdk";

const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 18;
const SETTLEMENT_AMOUNT = "120.00";

const takerPositionManagerAbi = [
  {
    type: "function",
    name: "borrowAllowance",
    stateMutability: "view",
    inputs: [
      { name: "spoke", type: "address" },
      { name: "reserveId", type: "uint256" },
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/aave-borrow/.env`);
  return value;
}

function envAddress(name: string): Address {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be an address`);
  return value as Address;
}

function envBigInt(name: string): bigint {
  const value = requiredEnv(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`);
  return BigInt(value);
}

function envPrivateKey(name: string): Hex {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a private key`);
  return value as Hex;
}

async function cell(title: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${"-".repeat(64)}\n> ${title}\n${"-".repeat(64)}`);
  await fn();
}

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

const holder = privateKeyToAccount(envPrivateKey("DEMO_HOLDER_PRIVATE_KEY"));
const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));
const acquirer = envAddress("DEMO_ACQUIRER_ADDRESS");
const stablecoin = envAddress("DEMO_AAVE_STABLECOIN_ADDRESS");
const spoke = envAddress("DEMO_AAVE_SPOKE_ADDRESS");
const takerPositionManager = envAddress("DEMO_AAVE_TAKER_POSITION_MANAGER_ADDRESS");
const debtReserveId = envBigInt("DEMO_AAVE_DEBT_RESERVE_ID");
const strategy: Strategy = {
  adapter: envAddress("DEMO_AAVE_ADAPTER_ADDRESS"),
  asset: takerPositionManager,
  stablecoin,
};

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(RPC_URL),
  pollingInterval: 200,
});
const issuerClient = createWalletClient({ account: issuer, chain: foundry, transport: http(RPC_URL) });

async function main(): Promise<void> {
  await publicClient.getChainId();

  await cell("Cell 0 - Holder has an Aave v4 borrow authorization", async () => {
    const borrowAllowance = await publicClient.readContract({
      address: takerPositionManager,
      abi: takerPositionManagerAbi,
      functionName: "borrowAllowance",
      args: [spoke, debtReserveId, holder.address, strategy.adapter],
    });

    console.log(`stablecoin             ${stablecoin}`);
    console.log(`spoke                  ${spoke}`);
    console.log(`debt reserve           ${debtReserveId}`);
    console.log(`taker position manager ${takerPositionManager}`);
    console.log(`adapter                ${strategy.adapter} (issuer ${issuer.address})`);
    console.log(`borrow allowance       ${formatUnits(borrowAllowance, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  });

  const request = {
    holder: holder.address,
    amount: parseUnits(SETTLEMENT_AMOUNT, TOKEN_DECIMALS),
    acquirer,
  };

  await cell("Cell 1 - Issuer recognizes borrow-backed spendable value", async () => {
    console.log(
      `network -> issuer: holder ${request.holder} wants ${formatUnits(request.amount, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`,
    );

    const spendable = await readSpendable(publicClient, { strategy, holder: request.holder });
    console.log(`recognized spendable: ${formatUnits(spendable, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  });

  await cell("Cell 2 - Issuer borrows through Aave and settles USDC", async () => {
    const acquirerBefore = await publicClient.readContract({
      address: stablecoin,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [request.acquirer],
    });
    const startedAt = Date.now();

    const receipt = await settle(issuerClient, {
      strategy,
      holder: request.holder,
      amount: request.amount,
      recipient: request.acquirer,
    });

    const finalizedBlocks = await waitForFinality(publicClient, receipt);
    const elapsedMs = Date.now() - startedAt;
    const acquirerAfter = await publicClient.readContract({
      address: stablecoin,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [request.acquirer],
    });

    console.log(`\nAPPROVED - borrow-backed settlement finalized in ${elapsedMs}ms`);
    console.log(`   settle tx:         ${receipt.transactionHash} (block ${receipt.blockNumber})`);
    console.log(`   confirming blocks: ${finalizedBlocks.map((b) => b.number).join(", ")}`);
    console.log(
      `   delivered:         ${formatUnits(acquirerAfter - acquirerBefore, TOKEN_DECIMALS)} ${TOKEN_SYMBOL} -> acquirer ${request.acquirer}`,
    );
  });

  console.log("\nThe holder kept collateral custody; settlement created Aave debt at swipe time.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
