# stablecoin-card-demo

A reference implementation of an **on-chain settlement mechanism for card payments
backed by stablecoins**, built on **[Monad](https://monad.xyz)**. A cardholder custodies
stablecoins in a settlement account, grants a card issuer a constrained authorization,
and the issuer pulls funds at settlement time — mirroring the real
`POS → acquirer → card network → issuer` flow.

**Monad's fast, deterministic finality lets settlement finalize
inside the card network's settlement window** — turning a multi-day, capital-intensive
process into final, irreversible money movement in seconds.

> [!WARNING]
> **This is a demo, not for production use.**

## Flow

A card transaction normally flows:

```
cardholder → POS terminal → acquirer → card network → issuer
```

The issuer decides whether to approve, then settles. This project models that
**settlement** step onchain:

1. **Holder** creates/uses a settlement account and **deposits** stablecoins.
2. **Holder** **authorizes** an issuer (a "spender") with permissions — e.g. a
   per-day limit and an expiry.
3. **Holder** uses the card at a POS. The request travels POS → acquirer →
   network → **issuer**.
4. **Issuer** checks its authorization and reads the holder's balance, then
   **settles**: it pulls funds from the holder's account to the acquirer.
5. **Holder** can **withdraw** un-spent funds at any time.

## One interface, many strategies

The settlement mechanism is built to adapt. New payment assets, yield sources, and
settlement behaviors can be added over time **without changing how issuers integrate**.
An issuer builds against the system once and keeps working as the ecosystem grows.

This works by defining a **standardized surface that issuers recognize**. Each
cardholder gets their **own account contract**, denominated in a single underlying
asset. However that account custodies funds behind the scenes, it conforms to the same
settlement-account surface. The issuer only ever depends on this contract; what
happens behind it is free to evolve.

```solidity
// account identity
function owner() external view returns (address);
function asset() external view returns (address);   // the underlying ERC-20

// owner operations
function deposit(uint256 amount) external;
function withdraw(uint256 amount) external;
function authorizeSpender(address spender, uint256 dailyLimit, uint64 expiry) external;
function revokeSpender(address spender) external;

// issuer operation
function settle(uint256 amount, address recipient, bytes32 paymentRef) external;

// views
function balanceOf() external view returns (uint256);
function authorizationOf(address spender) external view returns (Authorization memory);
function remainingDailyAllowance(address spender) external view returns (uint256);
```

Each **strategy is a separate account contract** that inherits the shared abstract
`SettlementAccount` (authorization + settlement state, the views above) and adds *how the
asset is custodied* — its own `deposit`, `withdraw`, `settle`, and `balanceOf`. The
issuer never has to know which strategy backs an account.

### Accounts and recognition

Accounts are **per-holder contracts** deployed by a `SettlementAccountFactory` using
`CREATE2`, so an account's address is **deterministic** — derivable from its owner and
underlying asset before it is even deployed. An issuer recognizes a conforming account by
computing the expected address from `(owner, asset)` (or reading
`factory.getAddress(owner, asset)`) and verifying its factory provenance.

## Strategies

Each strategy is a concrete account contract extending the abstract `SettlementAccount`.

| Strategy | Contract | What it does | Status |
| --- | --- | --- | --- |
| **Stablecoin** | `StablecoinAccount.sol` | Custodies the underlying ERC-20 directly — a 1:1 spendable balance. | ✅ Live |
| **Money market** | — | Deploys idle balance into a money market so it earns yield while remaining spendable. | 🚧 Coming soon |
| **Swap** | — | Settles in a different asset than the one held, swapping at settlement time. | 🚧 Coming soon |

Adding a strategy means writing one new account contract that implements `deposit`,
`withdraw`, `settle`, and `balanceOf` for its custody model — the surface issuers
integrate against does not change.

## Repository layout

This is a [Bun](https://bun.com) workspace monorepo.

| Path | Package | Responsibility |
| --- | --- | --- |
| `packages/contracts` | `@stablecoin-card/contracts` | **Source of truth.** Solidity + Foundry. Abstract `SettlementAccount` (shared authorization + settlement state), `StablecoinAccount` strategy, `SettlementAccountFactory`, and demo mocks. |
| `packages/sdk` | `@stablecoin-card/sdk` | **Integration layer.** Typesafe [viem](https://viem.sh) clients (`SettlementFactoryClient`, `SettlementAccountClient`) + ABIs for any TS consumer. |
| `apps/demo` | `@stablecoin-card/demo` | **The demo.** React + Tailwind frontend on `Bun.serve` (visual, in-browser simulation) **plus** a notebook-style script (`script/notebook.ts`) that exercises the real contracts via the SDK against a local `anvil` node. |

## Prerequisites

- [Bun](https://bun.com) `>= 1.3`
- [Foundry](https://book.getfoundry.sh) (`forge`, `anvil`, `cast`)

## Getting started

```bash
# install JS deps for every workspace
bun install

# install Solidity deps from GitHub (forge-std, OpenZeppelin)
bun run --filter '@stablecoin-card/contracts' install:deps
```

### Contracts

```bash
bun run contracts:build     # forge build
bun run contracts:test      # forge test -vvv  (12 passing)
```

### Visual demo (no chain needed)

```bash
bun run demo                # frontend at http://localhost:3000
```

## Usage

```bash
# 1. start a local node
bun run chain               # anvil

# 2. deploy the stablecoin strategy + mock USDC (prints the addresses)
bun run --filter '@stablecoin-card/contracts' deploy:local

# 3. run the notebook with the factory address (it mints + funds itself)
FACTORY_ADDRESS=0x... bun run notebook
```

## License

MIT
