# stablecoin-card-demo

A reference implementation of an **on-chain settlement mechanism for card payments backed by stablecoins**, built on **[Monad](https://monad.xyz)**.

A cardholder keeps stablecoins **in their own wallet**, grants a shared **settlement adapter** an **allowance**, the same ERC-20 `approve` every wallet already speaks, and the issuer settles through that adapter at payment time. There is no custodial account to fund and no per-holder permission system: the authorization *is* the allowance, settlement *is* a `transferFrom`, and the adapter is deployed **once per strategy** and shared by every holder.

**Monad's fast, deterministic finality lets settlement finalize inside the card network's authorization window**. It combines traditional authorization and settlement into one action, eliminating inventory risk from double spend.

> [!WARNING]
> **This is a demo, not for production use.**

## Flow

A card transaction reaches the issuer last:

```
POS terminal → acquirer → card network → issuer
```

The issuer has to answer the network yes or no, within 3 seconds.

1. **Onboarding (once).** The holder keeps stablecoins in their own wallet and `approve`s the strategy's adapter.
2. **Request.** A swipe travels POS → acquirer → network → **issuer**: *holder H wants N*.
3. **Settle.** The issuer calls `settle` on the adapter, pulling N from the holder's wallet to the acquirer. The attempt **is** the decision. If it cannot pull (not enough spendable balance) it reverts, and the issuer answers **no**.
4. **Finality.** The issuer tracks the `settle` transaction to finality, waiting for two confirming blocks to be confirmed. Once final the movement is irreversible, and the issuer answers **yes**.

The artifact of a "yes" is the **finalized `settle` transaction and its two confirming blocks**.

## One interface, many strategies

The settlement mechanism is built to adapt. New payment assets, yield sources, and
settlement behaviors can be added over time **without changing how issuers integrate**. An
issuer builds against the system once and keeps working as the ecosystem grows.

Every strategy is an **adapter**: a single contract, deployed once and shared by all
holders, that implements **balance recognition** and **settlement**. Whatever a holder's
funds are doing behind the scenes, the issuer only ever needs this surface:

```solidity
struct Settlement {
    address holder;
    uint256 amount;
    address recipient;
}

// balance recognition — spendable value, denominated in the settlement stablecoin
function spendable(address holder) external view returns (uint256);

// settle — pull `amount`, converting to the stablecoin if needed, and deliver it
function settle(address holder, uint256 amount, address recipient) external;

// settleBatch — atomically settle many holder payments in one transaction
function settleBatch(Settlement[] calldata settlements) external;
```

## Strategies

Each strategy describes *what the holder holds* and *how `settle` turns it into the
stablecoin* — all behind the same `spendable` + `settle` surface.

| Strategy | Holder holds | What it does | Status |
| --- | --- | --- | --- |
| **Stablecoin** | the stablecoin itself | `transferFrom` straight to the issuer. | ✅ |
| **Money market** | yield-bearing shares (ERC-4626 / aToken) | pull shares, redeem to the underlying stablecoin, deliver it — funds earn yield until the instant of settlement. | ✅ |
| **Swap** | a different asset | pull the asset, swap it to the stablecoin at settlement time, deliver it. | 🚧 Planned |

## Repository layout

This is a [Bun](https://bun.com) workspace monorepo.

| Path | Package | Responsibility |
| --- | --- | --- |
| `packages/contracts` | `@stablecoin-card/contracts` | **Source of truth.** Solidity + Foundry. The `spendable` + `settle` adapter interface, the no-op stablecoin adapter, the money-market adapter, and (planned) the swap adapter, plus demo mocks. |
| `packages/sdk` | `@stablecoin-card/sdk` | **Integration layer.** Typesafe [viem](https://viem.sh) actions for approving an allowance, reading spendable balance, settling, and tracking a settlement to finality — for any TS consumer. |
| `apps/stablecoin` | `@stablecoin-card/stablecoin` | **Stablecoin flow.** Setup and notebook scripts for direct ERC-20 settlement through `StablecoinAdapter`. |
| `apps/money-market` | `@stablecoin-card/money-market` | **Money-market flow.** Setup and notebook scripts for yield-bearing receipt-token settlement through `MoneyMarketAdapter`. |
| `apps/frontend` | `@stablecoin-card/frontend` | **Frontend app.** Bun + React + Tailwind workspace for building the demo UI. |

## Prerequisites

- [Bun](https://bun.com) `>= 1.3`
- [Foundry](https://book.getfoundry.sh) (`forge`, `anvil`, `cast`)

## Getting started

```bash
# install deps for every workspace
bun install

# build contracts and client code
bun run build
```

## Usage

### Local chain

Start Anvil in one terminal and keep it running:

```bash
anvil --block-time 0.4
```

The scripts default to `RPC_URL=http://127.0.0.1:8545`.

### Stablecoin flow

This flow demonstrates direct stablecoin settlement: the holder owns USDC, approves `StablecoinAdapter`, and the issuer pulls USDC to the acquirer.

Move to the stablecoin directory:

```bash
cd apps/stablecoin
```

Prepare the app env file:

```bash
cp .env.example .env
```

Deploy mock USDC, deploy `StablecoinAdapter`, and fund the holder:

```bash
bun setup.ts
```

The setup command prints these values:

```bash
DEMO_STABLECOIN_ADDRESS=...
DEMO_ASSET_ADDRESS=...
DEMO_ADAPTER_ADDRESS=...
```

Add those printed addresses to `apps/stablecoin/.env`, then run the notebook flow:

```bash
bun notebook.ts
```

### Money-Market Flow

This flow demonstrates yield-bearing settlement: the holder deposits USDC into `MockMoneyMarket`, approves `MoneyMarketAdapter`, and the issuer redeems receipt tokens at settlement time.

Move to the money market directory:

```bash
cd apps/money-market
```

Prepare the app env file:

```bash
cp .env.example .env
```

Deploy mock USDC, deploy `MockMoneyMarket`, deploy `MoneyMarketAdapter`, deposit holder funds, and pre-fund market yield:

```bash
bun setup.ts
```

The setup command prints these values:

```bash
DEMO_MM_STABLECOIN_ADDRESS=...
DEMO_MM_MONEY_MARKET_ADDRESS=...
DEMO_MM_ADAPTER_ADDRESS=...
```

Add those printed addresses to `apps/money-market/.env`, then run the notebook flow:

```bash
bun notebook.ts
```

### Frontend

Prepare the frontend env file:

```bash
cd apps/frontend
cp .env.example .env
```

With Anvil running, deploy both frontend demo strategies:

```bash
bun run setup
```

Add the printed `BUN_PUBLIC_*` addresses to `apps/frontend/.env`, then run the Bun React dev server:

```bash
bun run dev
```

The server prints the local URL, usually `http://localhost:3000`.

## License

MIT
