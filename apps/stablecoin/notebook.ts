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
  approveSpender,
  readSpendable,
  settle,
  waitForFinality,
  type Strategy,
} from "@stablecoin-card/sdk";

const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 18;
const SETTLEMENT_AMOUNT = "42.50";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/stablecoin/.env`);
  return value;
}

function envAddress(name: string): Address {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be an address`);
  return value as Address;
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
const stablecoin = envAddress("DEMO_STABLECOIN_ADDRESS");
const strategy: Strategy = {
  adapter: envAddress("DEMO_ADAPTER_ADDRESS"),
  asset: process.env.DEMO_ASSET_ADDRESS ? envAddress("DEMO_ASSET_ADDRESS") : stablecoin,
  stablecoin,
};

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(RPC_URL),
  pollingInterval: 200,
});
const holderClient = createWalletClient({ account: holder, chain: foundry, transport: http(RPC_URL) });
const issuerClient = createWalletClient({ account: issuer, chain: foundry, transport: http(RPC_URL) });

async function main(): Promise<void> {
  await publicClient.getChainId();

  await cell("Cell 0 - Holder approves the configured adapter", async () => {
    console.log(`stablecoin ${strategy.stablecoin}`);
    console.log(`adapter   ${strategy.adapter} (issuer ${issuer.address})`);

    await approveSpender(holderClient, { strategy });
    console.log("holder approved the adapter; funds stay liquid in their wallet until settlement");
  });

  const request = {
    holder: holder.address,
    amount: parseUnits(SETTLEMENT_AMOUNT, TOKEN_DECIMALS),
    acquirer,
  };

  await cell("Cell 1 - A card request reaches the issuer", async () => {
    console.log(
      `network -> issuer: holder ${request.holder} wants ${formatUnits(request.amount, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`,
    );
    const spendable = await readSpendable(publicClient, { strategy, holder: request.holder });
    console.log(`recognized spendable: ${formatUnits(spendable, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  });

  await cell("Cell 2 - Issuer settles in the window and waits for finality", async () => {
    const startedAt = Date.now();

    const receipt = await settle(issuerClient, {
      strategy,
      holder: request.holder,
      amount: request.amount,
      recipient: request.acquirer,
    });

    const finalizedBlocks = await waitForFinality(publicClient, receipt);
    const elapsedMs = Date.now() - startedAt;

    console.log(`\nAPPROVED - settlement finalized in ${elapsedMs}ms`);
    console.log(`   settle tx:         ${receipt.transactionHash} (block ${receipt.blockNumber})`);
    console.log(`   confirming blocks: ${finalizedBlocks.map((b) => b.number).join(", ")}`);
    console.log(
      `   delivered:         ${formatUnits(request.amount, TOKEN_DECIMALS)} ${TOKEN_SYMBOL} -> acquirer ${request.acquirer}`,
    );
  });

  console.log("\nThe issuer's yes is backed by a finalized, irreversible settlement.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
