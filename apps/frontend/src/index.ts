import index from "./index.html";
import {
  type Address,
  type Hex,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { approveSpender, erc20Abi, settle } from "@stablecoin-card/sdk";

import {
  DEFAULT_HOLDER_BALANCE,
  SETTLEMENT_AMOUNT,
  TOKEN_DECIMALS,
  type SerializedReceipt,
  isStrategyId,
} from "./demo";
import { acquirer, rpcUrl, strategies } from "./config";
import { demoChain } from "./chain";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const moneyMarketAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
] as const;

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

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function serializeReceipt(receipt: Awaited<ReturnType<typeof settle>>): SerializedReceipt {
  if (!receipt.blockHash) throw new Error("Settlement receipt has no block hash");

  return {
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
  };
}

async function handleError(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

const deployer = privateKeyToAccount(envPrivateKey("DEMO_DEPLOYER_PRIVATE_KEY"));
const issuer = privateKeyToAccount(envPrivateKey("DEMO_ISSUER_PRIVATE_KEY"));
const deployerClient = createWalletClient({ account: deployer, chain: demoChain, transport: http(rpcUrl) });
const issuerClient = createWalletClient({ account: issuer, chain: demoChain, transport: http(rpcUrl) });

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    "/stablecoin": index,
    "/money-market": index,
    "/api/holders/:strategyId": {
      POST: (req) => handleError(async () => {
        const { strategyId } = req.params;
        if (!isStrategyId(strategyId)) return json({ error: "Unknown strategy" }, 404);

        const privateKey = generatePrivateKey();
        const holder = privateKeyToAccount(privateKey);
        const holderClient = createWalletClient({ account: holder, chain: demoChain, transport: http(rpcUrl) });
        const strategy = strategies[strategyId];
        const balance = parseUnits(DEFAULT_HOLDER_BALANCE, TOKEN_DECIMALS);

        await deployerClient.sendTransactionSync({
          to: holder.address,
          value: parseEther("0.25"),
          throwOnReceiptRevert: true,
        });

        await deployerClient.writeContractSync({
          address: strategy.stablecoin,
          abi: erc20Abi,
          functionName: "mint",
          args: [holder.address, balance],
          throwOnReceiptRevert: true,
        });

        if (strategyId === "money-market") {
          await holderClient.writeContractSync({
            address: strategy.stablecoin,
            abi: erc20Abi,
            functionName: "approve",
            args: [strategy.asset, balance],
            throwOnReceiptRevert: true,
          });
          await holderClient.writeContractSync({
            address: strategy.asset,
            abi: moneyMarketAbi,
            functionName: "deposit",
            args: [balance, holder.address],
            throwOnReceiptRevert: true,
          });
        }

        await approveSpender(holderClient, { strategy });

        return json({ holder: holder.address });
      }),
    },
    "/api/settle": {
      POST: (req) => handleError(async () => {
        const body = (await req.json()) as { strategyId?: string; holder?: string };
        if (!body.strategyId || !isStrategyId(body.strategyId)) return json({ error: "Unknown strategy" }, 400);
        if (!body.holder || !/^0x[0-9a-fA-F]{40}$/.test(body.holder)) return json({ error: "Invalid holder" }, 400);

        const receipt = await settle(issuerClient, {
          strategy: strategies[body.strategyId],
          holder: body.holder as Address,
          amount: parseUnits(SETTLEMENT_AMOUNT, TOKEN_DECIMALS),
          recipient: acquirer,
        });

        return json({ receipt: serializeReceipt(receipt) });
      }),
    },
  },
  development: process.env.NODE_ENV === "production" ? false : {
    hmr: true,
    console: true,
  },
});

console.log(`Frontend dev server running at ${server.url}`);
