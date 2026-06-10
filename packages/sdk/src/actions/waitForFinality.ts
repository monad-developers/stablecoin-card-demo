import type { Block, Hash, PublicClient, TransactionReceipt } from "viem";

export type FinalityBlocks = [Block, Block];

/**
 * Track a transaction receipt until it is finalized: two blocks built on top of
 * the inclusion block. Resolves with those confirming blocks — the artifacts an
 * issuer keeps as proof the settlement is irreversible.
 *
 * v1 uses a fixed confirmation depth. A later iteration can switch to the chain's
 * `finalized` block tag and add an authorization-window timeout.
 */
export async function waitForFinality(
  client: PublicClient,
  receipt: TransactionReceipt,
): Promise<FinalityBlocks> {
  const blocks: Block[] = [];
  let latestBlock: Block | undefined;
  let latestBlockNumber = receipt.blockNumber;
  let parentHash: Hash = receipt.blockHash;

  while (blocks.length < 2) {
    const blockNumber = receipt.blockNumber + BigInt(blocks.length + 1);

    if (latestBlockNumber < blockNumber) {
      latestBlock = await client.getBlock();
      if (latestBlock.number === null || latestBlock.number < blockNumber) {
        await new Promise((resolve) => setTimeout(resolve, client.pollingInterval));
        continue;
      }
      latestBlockNumber = latestBlock.number;
    }

    const block =
      latestBlock?.number === blockNumber ? latestBlock : await client.getBlock({ blockNumber });
    if (block.parentHash !== parentHash) {
      // TODO: handle reorgs by re-checking the receipt's inclusion on the canonical chain.
      throw new Error(
        `Reorg detected while waiting for finality: block ${blockNumber} parent ${block.parentHash} does not match ${parentHash}`,
      );
    }

    const blockHash = block.hash;
    if (!blockHash) throw new Error(`Block ${blockNumber} has no hash`);

    blocks.push(block);
    parentHash = blockHash;
  }

  return [blocks[0]!, blocks[1]!];
}
