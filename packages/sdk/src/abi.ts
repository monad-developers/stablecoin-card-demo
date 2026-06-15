/**
 * Hand-maintained ABIs mirroring `packages/contracts/src/*.sol`. After changing
 * the Solidity, regenerate the JSON ABI with `forge build` and update these
 * `as const` definitions so viem keeps full type inference.
 */

/** The issuer-facing settlement adapter surface (`ISettlementAdapter`). */
export const settlementAdapterAbi = [
  {
    type: "function",
    name: "issuer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "stablecoin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "spendable",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleBatch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "settlements",
        type: "tuple[]",
        components: [
          { name: "holder", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "recipient", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "holder", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 ABI for approvals/balances used by the SDK and demos. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
