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

const ARTIFACTS = `${import.meta.dir}/../../packages/contracts/out`;
const TOKEN_NAME = "USD Coin";
const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 18;
const DEBT_RESERVE_ID = 1n;
const BORROW_BUFFER_BPS = 9_000n;
const ORACLE_DECIMALS = 8;
const USDC_PRICE = 100_000_000n;
const HOLDER_COLLATERAL_VALUE = 20_000n * 100_000_000n;
const HOLDER_DEBT_VALUE = 0n;
const HOLDER_AVG_COLLATERAL_FACTOR = 750_000_000_000_000_000n;
const BORROW_ALLOWANCE = "5000";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/aave-borrow/.env`);
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
    throw new Error(
      "Missing contract artifact. Run `bun run --filter '@stablecoin-card/contracts' build` from the repo root first.",
    );
  }
  const artifact = (await file.json()) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const borrowAllowance = parseUnits(BORROW_ALLOWANCE, TOKEN_DECIMALS);

  const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
  const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));
  const holder = privateKeyToAccount(envPrivateKey("DEMO_HOLDER_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 200 });
  const deployerClient = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });
  const holderClient = createWalletClient({ account: holder, chain: foundry, transport: http(rpcUrl) });

  async function deploy(artifact: { abi: Abi; bytecode: Hex }, args: readonly unknown[] = []): Promise<Address> {
    const { contractAddress } = await deployerClient.sendTransactionSync({
      data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }),
      throwOnReceiptRevert: true,
    });
    if (!contractAddress) throw new Error("Contract deployment produced no address");
    return contractAddress;
  }

  const chainId = await publicClient.getChainId();
  console.log(`Deploying Aave-borrow demo contracts to ${rpcUrl} (chain ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  issuer:   ${issuer.address}`);
  console.log(`  holder:   ${holder.address}`);

  const mockErc20 = await loadArtifact("MockERC20");
  const oracleArtifact = await loadArtifact("MockAaveV4Oracle");
  const spokeArtifact = await loadArtifact("MockAaveV4Spoke");
  const takerArtifact = await loadArtifact("MockAaveV4TakerPositionManager");
  const adapterArtifact = await loadArtifact("AaveV4BorrowAdapter");

  const stablecoin = await deploy(mockErc20, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
  const oracle = await deploy(oracleArtifact, [ORACLE_DECIMALS]);
  const spoke = await deploy(spokeArtifact, [oracle]);
  const takerPositionManager = await deploy(takerArtifact);

  await deployerClient.writeContractSync({
    address: oracle,
    abi: oracleArtifact.abi,
    functionName: "setReservePrice",
    args: [DEBT_RESERVE_ID, USDC_PRICE],
    throwOnReceiptRevert: true,
  });
  await deployerClient.writeContractSync({
    address: spoke,
    abi: spokeArtifact.abi,
    functionName: "setReserve",
    args: [DEBT_RESERVE_ID, stablecoin, TOKEN_DECIMALS],
    throwOnReceiptRevert: true,
  });
  const adapter = await deploy(adapterArtifact, [
    issuer.address,
    spoke,
    takerPositionManager,
    DEBT_RESERVE_ID,
    BORROW_BUFFER_BPS,
  ]);
  await deployerClient.writeContractSync({
    address: spoke,
    abi: spokeArtifact.abi,
    functionName: "setUserAccountData",
    args: [
      holder.address,
      HOLDER_COLLATERAL_VALUE,
      HOLDER_DEBT_VALUE,
      HOLDER_AVG_COLLATERAL_FACTOR,
    ],
    throwOnReceiptRevert: true,
  });
  await holderClient.writeContractSync({
    address: takerPositionManager,
    abi: takerArtifact.abi,
    functionName: "approveBorrow",
    args: [spoke, DEBT_RESERVE_ID, adapter, borrowAllowance],
    throwOnReceiptRevert: true,
  });

  console.log(`\nConfigured mock Aave v4 debt reserve ${DEBT_RESERVE_ID} as ${TOKEN_SYMBOL}`);
  console.log(`Holder collateral value: $${formatUnits(HOLDER_COLLATERAL_VALUE, ORACLE_DECIMALS)}`);
  console.log(`Holder borrow allowance: ${formatUnits(borrowAllowance, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`);
  console.log("\nAdd these values to apps/aave-borrow/.env:");
  console.log(`DEMO_AAVE_STABLECOIN_ADDRESS=${stablecoin}`);
  console.log(`DEMO_AAVE_ORACLE_ADDRESS=${oracle}`);
  console.log(`DEMO_AAVE_SPOKE_ADDRESS=${spoke}`);
  console.log(`DEMO_AAVE_TAKER_POSITION_MANAGER_ADDRESS=${takerPositionManager}`);
  console.log(`DEMO_AAVE_ADAPTER_ADDRESS=${adapter}`);
  console.log(`DEMO_AAVE_DEBT_RESERVE_ID=${DEBT_RESERVE_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
