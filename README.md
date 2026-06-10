# stablecoin-card-demo

A reference implementation of an **on-chain settlement mechanism for card payments
backed by stablecoins**, built on **[Monad](https://monad.xyz)**. A cardholder keeps
stablecoins **in their own wallet**, grants a shared **settlement adapter** an
**allowance** — the same ERC-20 `approve` every wallet already speaks — and the issuer
settles through that adapter at payment time, mirroring the real
`POS → acquirer → card network → issuer` flow. There is no custodial account to fund and
no per-holder permission system: the authorization *is* the allowance, settlement *is* a
`transferFrom`, and the adapter is deployed **once per strategy** and shared by every
holder. The holder never gives up control of their money.

**Monad's fast, deterministic finality lets settlement finalize
inside the card network's authorization window** — turning a multi-day, capital-intensive
process into final, irreversible money movement in seconds.

> [!WARNING]
> **This is a demo, not for production use.**

## Flow

A card transaction reaches the issuer last:

```
POS terminal → acquirer → card network → issuer
```

The issuer has to answer the network **yes or no, fast**. Settlement here is a direct
**debit** — the issuer pulls the holder's stablecoin straight to the acquirer rather than
fronting credit — so a truthful "yes" means the money has *already* moved and cannot be
undone. The issuer therefore settles inside the authorization window and waits for that
settlement to finalize:

1. **Onboarding (once).** The holder keeps stablecoins in their own wallet and `approve`s
   the strategy's adapter. That standing allowance is the authorization; revoking is
   `approve(…, 0)`.
2. **Request.** A swipe travels POS → acquirer → network → **issuer**: *holder H wants N*.
3. **Settle.** The issuer calls `settle` on the adapter, pulling N from the holder's wallet
   to the acquirer. The attempt **is** the decision — if it cannot pull (no allowance or not
   enough balance) it reverts, and the issuer answers **no**.
4. **Finality.** The issuer tracks the settlement to finality — the `settle` transaction
   plus the two blocks built on top of it. Once final the movement is irreversible, and the
   issuer answers **yes**.

The artifact of a "yes" is the **finalized `settle` transaction and its two confirming
blocks**. This is why it runs on **Monad**: fast, deterministic finality lands the
settlement inside the authorization window, so the issuer can treat *capture as
authorization* — no multi-day settlement, no separate hold.

## One interface, many strategies

The settlement mechanism is built to adapt. New payment assets, yield sources, and
settlement behaviors can be added over time **without changing how issuers integrate**. An
issuer builds against the system once and keeps working as the ecosystem grows.

Every strategy is an **adapter**: a single contract, deployed once and shared by all
holders, that implements **balance recognition** and **settle**. Whatever a holder's funds
are doing behind the scenes, the issuer only ever needs those two things:

```solidity
// balance recognition — spendable value, denominated in the settlement stablecoin
function spendable(address holder) external view returns (uint256);

// settle — pull `amount`, converting to the stablecoin if needed, and deliver it
function settle(address holder, uint256 amount, address recipient) external;
```

## Strategies

Each strategy describes *what the holder holds* and *how `settle` turns it into the
stablecoin* — all behind the same `spendable` + `settle` surface.

| Strategy | Holder holds | What it does | Status |
| --- | --- | --- | --- |
| **Stablecoin** | the stablecoin itself | `transferFrom` straight to the issuer. | ✅ Reference |
| **Money market** | yield-bearing shares (ERC-4626 / aToken) | pull shares, redeem to the underlying stablecoin, deliver it — funds earn yield until the instant of settlement. | 🚧 Planned |
| **Swap** | a different asset | pull the asset, swap it to the stablecoin at settlement time, deliver it. | 🚧 Planned |

## Authorization model

Today the authorization is a plain ERC-20 allowance granted to the strategy's adapter:
simple, universally supported, and non-custodial. It intentionally does **not** carry the
per-day limit or expiry that the old custodial account enforced on-chain; that risk logic
lives with the issuer, as it does in the real card network.

> **Future consideration:** [Permit2](https://github.com/Uniswap/permit2) can layer expiry
> and signature-based (gasless) approvals on top of this model, and is the natural place to
> re-introduce on-chain spend limits if they are wanted later.

## Repository layout

This is a [Bun](https://bun.com) workspace monorepo.

| Path | Package | Responsibility |
| --- | --- | --- |
| `packages/contracts` | `@stablecoin-card/contracts` | **Source of truth.** Solidity + Foundry. The `spendable` + `settle` adapter interface, the no-op stablecoin adapter, and (planned) money-market and swap adapters, plus demo mocks. |
| `packages/sdk` | `@stablecoin-card/sdk` | **Integration layer.** Typesafe [viem](https://viem.sh) actions for approving an allowance, reading spendable balance, settling, and tracking a settlement to finality — for any TS consumer. |
| `apps/demo` | `@stablecoin-card/demo` | **The demo.** Bun + React shell **plus** a notebook-style script (`script/notebook.ts`) that exercises the real contracts via the SDK against a local `anvil` node. |

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

### Frontend shell

```bash
bun run demo                # React shell at http://localhost:3000
```

## Usage

The notebook walks through the issuer settlement flow end-to-end and deploys a mock USDC +
adapter itself, so you only need a running node.

```bash
# 1. start a local node that produces blocks continuously (so settlement can finalize)
bun run chain               # anvil --block-time 1

# 2. walk through the issuer settlement flow
bun run notebook

# or run the SDK end-to-end smoke test
bun run e2e
```

## License

MIT
