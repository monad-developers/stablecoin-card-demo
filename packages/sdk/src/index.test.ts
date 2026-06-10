import { test, expect } from "bun:test";
import type { Block, Hash, PublicClient, TransactionReceipt } from "viem";

import {
  approveSpender,
  erc20Abi,
  readSpendable,
  settle,
  settlementAdapterAbi,
  waitForFinality,
} from "./index";

test("adapter ABI exposes the issuer-facing surface", () => {
  const fns: string[] = settlementAdapterAbi
    .filter((e) => e.type === "function")
    .map((e) => e.name);
  for (const name of ["issuer", "stablecoin", "asset", "spendable", "settle"]) {
    expect(fns).toContain(name);
  }
});

test("settle takes (holder, amount, recipient)", () => {
  const fn = settlementAdapterAbi.find(
    (e): e is Extract<typeof e, { name: "settle" }> =>
      e.type === "function" && e.name === "settle",
  );
  const inputs: string[] = fn ? fn.inputs.map((i) => i.name) : [];
  expect(inputs).toEqual(["holder", "amount", "recipient"]);
});

test("erc20 ABI includes approve + balanceOf", () => {
  const fns: string[] = erc20Abi.filter((e) => e.type === "function").map((e) => e.name);
  expect(fns).toContain("approve");
  expect(fns).toContain("balanceOf");
});

test("the actions are exported as functions", () => {
  expect(typeof approveSpender).toBe("function");
  expect(typeof readSpendable).toBe("function");
  expect(typeof settle).toBe("function");
  expect(typeof waitForFinality).toBe("function");
});

test("waitForFinality returns two blocks built on the receipt block", async () => {
  const receiptBlockHash = `0x${"00".repeat(32)}` as Hash;
  const firstBlockHash = `0x${"01".repeat(32)}` as Hash;
  const secondBlockHash = `0x${"02".repeat(32)}` as Hash;
  const receipt = { blockHash: receiptBlockHash, blockNumber: 100n } as TransactionReceipt;
  const receiptBlock = { hash: receiptBlockHash, number: 100n } as Block;
  const firstBlock = { hash: firstBlockHash, parentHash: receiptBlockHash, number: 101n } as Block;
  const secondBlock = { hash: secondBlockHash, parentHash: firstBlockHash, number: 102n } as Block;
  const latestBlocks = [receiptBlock, firstBlock, secondBlock];
  const requestedBlocks: Array<"latest" | bigint> = [];
  const client = {
    pollingInterval: 0,
    getBlock: async (parameters?: { blockNumber?: bigint }) => {
      const blockNumber = parameters?.blockNumber;
      if (blockNumber !== undefined) {
        requestedBlocks.push(blockNumber);
        return blockNumber === 101n ? firstBlock : secondBlock;
      }

      requestedBlocks.push("latest");
      return latestBlocks.shift() ?? secondBlock;
    },
  } as unknown as PublicClient;

  await expect(waitForFinality(client, receipt)).resolves.toEqual([firstBlock, secondBlock]);
  expect(requestedBlocks).toEqual(["latest", "latest", "latest"]);
});

test("waitForFinality fetches missed confirming heights when latest is already ahead", async () => {
  const receiptBlockHash = `0x${"00".repeat(32)}` as Hash;
  const firstBlockHash = `0x${"01".repeat(32)}` as Hash;
  const secondBlockHash = `0x${"02".repeat(32)}` as Hash;
  const thirdBlockHash = `0x${"03".repeat(32)}` as Hash;
  const receipt = { blockHash: receiptBlockHash, blockNumber: 100n } as TransactionReceipt;
  const firstBlock = { hash: firstBlockHash, parentHash: receiptBlockHash, number: 101n } as Block;
  const secondBlock = { hash: secondBlockHash, parentHash: firstBlockHash, number: 102n } as Block;
  const thirdBlock = { hash: thirdBlockHash, parentHash: secondBlockHash, number: 103n } as Block;
  const requestedBlocks: Array<"latest" | bigint> = [];
  const client = {
    pollingInterval: 0,
    getBlock: async (parameters?: { blockNumber?: bigint }) => {
      const blockNumber = parameters?.blockNumber;
      if (blockNumber !== undefined) {
        requestedBlocks.push(blockNumber);
        return blockNumber === 101n ? firstBlock : secondBlock;
      }

      requestedBlocks.push("latest");
      return thirdBlock;
    },
  } as unknown as PublicClient;

  await expect(waitForFinality(client, receipt)).resolves.toEqual([firstBlock, secondBlock]);
  expect(requestedBlocks).toEqual(["latest", 101n, 102n]);
});

test("waitForFinality rejects when a confirming block does not build on its parent", async () => {
  const receiptBlockHash = `0x${"00".repeat(32)}` as Hash;
  const reorgParentHash = `0x${"ff".repeat(32)}` as Hash;
  const blockHash = `0x${"01".repeat(32)}` as Hash;
  const receipt = { blockHash: receiptBlockHash, blockNumber: 100n } as TransactionReceipt;
  const client = {
    pollingInterval: 0,
    getBlock: async () => ({ hash: blockHash, parentHash: reorgParentHash, number: 101n }) as Block,
  } as unknown as PublicClient;

  await expect(waitForFinality(client, receipt)).rejects.toThrow("Reorg detected");
});
