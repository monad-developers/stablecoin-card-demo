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

const ARTIFACTS = `${import.meta.dir}/../../../packages/contracts/out`;
const TOKEN_NAME = "USD Coin";
const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 18;
const INITIAL_HOLDER_BALANCE = "10000";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/demo/.env`);
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
    throw new Error(`Missing ${name} artifact. Run \`bun run build\` in packages/contracts first.`);
  }
  const artifact = (await file.json()) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const initialHolderBalance = parseUnits(INITIAL_HOLDER_BALANCE, TOKEN_DECIMALS);

  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));
  const holder = privateKeyToAccount(envPrivateKey("DEMO_HOLDER_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  console.log(`Deploying demo contracts to ${rpcUrl} (chain ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  issuer:   ${issuer.address}`);
  console.log(`  holder:   ${holder.address}`);

  const mockErc20 = await loadArtifact("MockERC20");
  const { contractAddress: stablecoin } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({ abi: mockErc20.abi, bytecode: mockErc20.bytecode, args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS] }),
    throwOnReceiptRevert: true,
  });
  if (!stablecoin) throw new Error("MockERC20 deployment produced no address");

  const adapterArtifact = await loadArtifact("StablecoinAdapter");
  const { contractAddress: adapter } = await deployerClient.sendTransactionSync({
    data: encodeDeployData({ abi: adapterArtifact.abi, bytecode: adapterArtifact.bytecode, args: [issuer.address, stablecoin] }),
    throwOnReceiptRevert: true,
  });
  if (!adapter) throw new Error("StablecoinAdapter deployment produced no address");

  await deployerClient.writeContractSync({
    address: stablecoin,
    abi: erc20Abi,
    functionName: "mint",
    args: [holder.address, initialHolderBalance],
    throwOnReceiptRevert: true,
  });

  console.log(`\nFunded holder with ${formatUnits(initialHolderBalance, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  console.log("\nDeployment env values:");
  console.log(`DEMO_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`DEMO_ASSET_ADDRESS=${stablecoin}`);
  console.log(`DEMO_ADAPTER_ADDRESS=${adapter}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
