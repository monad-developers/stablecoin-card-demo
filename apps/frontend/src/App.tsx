import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Block,
  type Address,
  type TransactionReceipt,
  createPublicClient,
  formatUnits,
  http,
} from "viem";
import { readSpendable, waitForFinality } from "@stablecoin-card/sdk";

import {
  SETTLEMENT_AMOUNT,
  TOKEN_DECIMALS,
  type HolderResponse,
  type SerializedReceipt,
  type SettleResponse,
  type StrategyId,
  strategyIds,
} from "./demo";
import { acquirer, rpcUrl, strategies } from "./config";
import { demoChain } from "./chain";

type FlowStatus = "idle" | "running" | "complete";

type FlowStep = {
  label: string;
  status: "pending" | "running" | "complete";
  durationMs?: number;
};

const publicClient = createPublicClient({
  chain: demoChain,
  transport: http(rpcUrl),
  pollingInterval: 200,
});

const initialFlowSteps: FlowStep[] = [
  { label: "settle() transaction", status: "pending" },
  { label: "Wait for transaction finality", status: "pending" },
];

const monadScanBaseUrl = "https://testnet.monadscan.com";

function getStrategyFromPath(): StrategyId {
  const path = window.location.pathname;
  if (path === "/money-market") return "money-market";
  if (path === "/aave-borrow") return "aave-borrow";
  return "stablecoin";
}

function getIsAboutFromPath(): boolean {
  const path = window.location.pathname;
  return path === "/about" || path === "/";
}

function deserializeReceipt(receipt: SerializedReceipt): TransactionReceipt {
  return {
    blockHash: receipt.blockHash,
    blockNumber: BigInt(receipt.blockNumber),
    transactionHash: receipt.transactionHash,
    status: receipt.status,
  } as TransactionReceipt;
}

function explorerTxUrl(hash: string): string {
  return `${monadScanBaseUrl}/tx/${hash}`;
}

function explorerBlockUrl(blockNumber: bigint): string {
  return `${monadScanBaseUrl}/block/${blockNumber}`;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Check that Anvil is running and the frontend env addresses match this chain.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function App() {
  const queryClient = useQueryClient();
  const initializedStrategies = useRef(new Set<StrategyId>());
  const [activeStrategyId, setActiveStrategyId] = useState<StrategyId>(getStrategyFromPath);
  const [isAbout, setIsAbout] = useState<boolean>(getIsAboutFromPath);
  const [holders, setHolders] = useState<Partial<Record<StrategyId, Address>>>({});
  const [refreshingStrategyId, setRefreshingStrategyId] = useState<StrategyId | null>(null);

  const holder = holders[activeStrategyId];
  const strategy = strategies[activeStrategyId];

  const refreshHolder = useMutation({
    mutationFn: (strategyId: StrategyId) => postJson<HolderResponse>(`/api/holders/${strategyId}`),
    onSuccess: ({ holder }, strategyId) => {
      setHolders((current) => ({ ...current, [strategyId]: holder }));
      queryClient.removeQueries({ queryKey: ["spendable", strategyId] });
    },
    onError: (_error, strategyId) => {
      initializedStrategies.current.delete(strategyId);
    },
    onSettled: (_data, _error, strategyId) => {
      setRefreshingStrategyId((current) => (current === strategyId ? null : current));
    },
  });

  const spendable = useQuery({
    queryKey: ["spendable", activeStrategyId, holder],
    enabled: holder !== undefined,
    queryFn: () => readSpendable(publicClient, { strategy, holder: holder! }),
    refetchInterval: 500,
    staleTime: 500,
  });

  useEffect(() => {
    function onPopState() {
      setActiveStrategyId(getStrategyFromPath());
      setIsAbout(getIsAboutFromPath());
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (isAbout || holder || initializedStrategies.current.has(activeStrategyId)) return;

    initializedStrategies.current.add(activeStrategyId);
    setRefreshingStrategyId(activeStrategyId);
    refreshHolder.mutate(activeStrategyId);
    // `refreshHolder` is intentionally omitted: the mutation object is recreated
    // across renders, and including it can retrigger provisioning before a holder is set.
  }, [activeStrategyId, holder, isAbout]);

  function navigate(strategyId: StrategyId) {
    const path = `/${strategyId}`;
    window.history.pushState({}, "", path);
    setActiveStrategyId(strategyId);
    setIsAbout(false);
  }

  function navigateToAbout() {
    window.history.pushState({}, "", "/about");
    setIsAbout(true);
  }

  function handleRefresh() {
    setRefreshingStrategyId(activeStrategyId);
    refreshHolder.mutate(activeStrategyId);
  }

  const isRefreshingActiveStrategy = refreshingStrategyId === activeStrategyId;

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <a
            className="text-sm font-semibold tracking-tight"
            href="/stablecoin"
            onClick={(event) => {
              event.preventDefault();
              navigate("stablecoin");
            }}
          >
            Stablecoin Card Demo
          </a>
          <nav className="flex gap-2" aria-label="Pages">
            {strategyIds.map((strategyId) => (
              <a
                className={`px-1 py-1.5 text-sm transition ${
                  strategyId === activeStrategyId && !isAbout
                    ? "font-medium text-stone-950"
                    : "text-stone-500 hover:text-stone-950"
                }`}
                href={`/${strategyId}`}
                key={strategyId}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(strategyId);
                }}
              >
                /{strategyId}
              </a>
            ))}
            <a
              className={`px-1 py-1.5 text-sm transition ${
                isAbout ? "font-medium text-stone-950" : "text-stone-500 hover:text-stone-950"
              }`}
              href="/about"
              onClick={(event) => {
                event.preventDefault();
                navigateToAbout();
              }}
            >
              /about
            </a>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-10">
        {isAbout ? (
          <AboutPage />
        ) : (
          <div className="mx-auto max-w-3xl space-y-8">
            <CardholderPanel
              error={refreshHolder.error ?? spendable.error}
              holder={holder}
              isRefreshing={isRefreshingActiveStrategy}
              onRefresh={handleRefresh}
              spendable={spendable.data}
              spendableStatus={spendable.status}
            />
            <TransactionPanel
              holder={holder}
              onFinalized={() => queryClient.invalidateQueries({ queryKey: ["spendable", activeStrategyId, holder] })}
              spendable={spendable.data}
              strategyId={activeStrategyId}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function AboutPage() {
  const flowSteps = [
    {
      title: "Onboarding (once)",
      detail: "The holder keeps stablecoins in their own wallet and approves the strategy's adapter.",
    },
    {
      title: "Request",
      detail: "A swipe travels POS → acquirer → network → issuer: holder H wants N.",
    },
    {
      title: "Settle",
      detail:
        "The issuer calls settle on the adapter, pulling N from the holder's wallet to the acquirer. The attempt is the decision. If it can't pull, it reverts and the issuer answers no.",
    },
    {
      title: "Finality",
      detail:
        "The issuer tracks the settle transaction to finality, waiting for two confirming blocks. Once final the movement is irreversible and the issuer answers yes.",
    },
  ];

  const strategies = [
    { name: "Stablecoin", holds: "the stablecoin itself", status: "Live" },
    { name: "Money market", holds: "yield-bearing shares (ERC-4626 / aToken)", status: "Live" },
    { name: "Aave borrow", holds: "collateral in Aave, borrowing USDC at settlement", status: "Live" },
    { name: "Swap", holds: "a different asset", status: "Planned" },
  ];

  const gasUsage = [
    { label: "ERC-20 transfer()", note: undefined, gasPerPayment: 63_219, usd: "$0.000145" },
    { label: "settle()", note: undefined, gasPerPayment: 69_706, usd: "$0.000160" },
    { label: "settleBatch()", note: "batch of 10", gasPerPayment: 15_649, usd: "$0.00003599" },
  ];
  const maxGasPerPayment = Math.max(...gasUsage.map((operation) => operation.gasPerPayment));

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">About</h1>
        <p className="text-base leading-7 text-stone-700">
          Monad enables simple on-chain settlement of card payments. It finalizes within the card
          network's authorization window, and is both fast and cheap.
        </p>
        <p className="text-base leading-7 text-stone-700">
          A cardholder keeps stablecoins in their existing wallet and uses the standard ERC-20{" "}
          <code className="font-mono">approve</code> flow, and the card issuer pulls the funds at
          payment time.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">The flow</h2>
        <p className="text-base leading-7 text-stone-700">
          A card transaction reaches the issuer last (POS → acquirer → network → issuer), and the
          issuer must answer the network yes or no within 3 seconds.
        </p>
        <ol className="space-y-3">
          {flowSteps.map((step, index) => (
            <li
              className="flex gap-4 rounded-xl border border-stone-200 bg-white px-4 py-3"
              key={step.title}
            >
              <span className="text-base font-semibold text-stone-400">{index + 1}</span>
              <div>
                <p className="text-base font-medium text-stone-900">{step.title}</p>
                <p className="mt-1 text-base leading-7 text-stone-600">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">One interface, many strategies</h2>
        <p className="text-base leading-7 text-stone-700">
          Every strategy is an adapter: a single contract, deployed once and shared by all holders,
          that implements balance recognition (<code className="font-mono">spendable</code>)
          and settlement (<code className="font-mono">settle</code>). New payment assets,
          yield sources, and settlement behaviors can be added over time without changing how
          issuers integrate.
        </p>
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-base">
            <thead className="border-b border-stone-200 text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium">Holder holds</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => (
                <tr className="border-b border-stone-100 last:border-0" key={strategy.name}>
                  <td className="px-4 py-3 font-medium text-stone-900">{strategy.name}</td>
                  <td className="px-4 py-3 text-stone-600">{strategy.holds}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        strategy.status === "Live"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {strategy.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Gas usage</h2>
        <div className="space-y-5 rounded-xl border border-stone-200 bg-white p-5">
          {gasUsage.map((operation) => (
            <div key={operation.label}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-sm text-stone-800">{operation.label}</span>
                  {operation.note ? (
                    <span className="text-xs text-stone-400">{operation.note}</span>
                  ) : null}
                </span>
                <span className="text-sm text-stone-500">
                  {operation.gasPerPayment.toLocaleString()} gas/payment · {operation.usd}
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-stone-900"
                  style={{ width: `${(operation.gasPerPayment / maxGasPerPayment) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-base leading-7 text-stone-700">
          Measured against the stablecoin adapter at a 100 gwei gas price and $0.023 per MON.
        </p>
      </section>
    </div>
  );
}

function CardholderPanel({
  error,
  holder,
  isRefreshing,
  onRefresh,
  spendable,
  spendableStatus,
}: {
  error: Error | null;
  holder: Address | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  spendable: bigint | undefined;
  spendableStatus: "pending" | "error" | "success";
}) {
  const balance = spendable === undefined ? "-" : `${Number(formatUnits(spendable, TOKEN_DECIMALS)).toFixed(2)} USDC`;
  const balanceText = spendable !== undefined
    ? balance
    : isRefreshing
      ? "Refreshing..."
      : spendableStatus === "error"
      ? "Unavailable"
      : spendableStatus === "pending" && holder
        ? "Reading..."
        : balance;

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-medium text-stone-500">Cardholder</h2>
      </div>

      <dl className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6">
        <div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-sm text-stone-500">Spendable balance</dt>
            <button
              className="cursor-pointer text-sm font-medium text-stone-700 underline underline-offset-4 hover:text-stone-950 disabled:cursor-not-allowed disabled:text-stone-400"
              disabled={isRefreshing}
              onClick={onRefresh}
              type="button"
            >
              {isRefreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
          <dd className="mt-2 text-4xl font-semibold tracking-tight">{balanceText}</dd>
        </div>
        <div className="border-t border-stone-100 pt-5">
          <dt className="text-sm text-stone-500">Address</dt>
          <dd className="mt-2 break-all font-mono text-sm leading-6 text-stone-800">
            {holder ?? "Provisioning..."}
          </dd>
        </div>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
      </dl>
    </section>
  );
}

function TransactionPanel({
  holder,
  onFinalized,
  spendable,
  strategyId,
}: {
  holder: Address | undefined;
  onFinalized: () => void;
  spendable: bigint | undefined;
  strategyId: StrategyId;
}) {
  const [flowError, setFlowError] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [settleReceipt, setSettleReceipt] = useState<SerializedReceipt | null>(null);
  const [confirmingBlocks, setConfirmingBlocks] = useState<Block[]>([]);
  const [steps, setSteps] = useState<FlowStep[]>(initialFlowSteps);
  const settlementAmount = BigInt(10) ** BigInt(TOKEN_DECIMALS);
  const canSettle = holder !== undefined && spendable !== undefined && spendable >= settlementAmount;

  const settleMutation = useMutation({
    mutationFn: () => postJson<SettleResponse>("/api/settle", { strategyId, holder }),
  });

  useEffect(() => {
    setFlowError(null);
    setFlowStatus("idle");
    setSettleReceipt(null);
    setConfirmingBlocks([]);
    setSteps(initialFlowSteps);
  }, [holder, strategyId]);

  async function runFlow() {
    if (!canSettle || flowStatus === "running") return;

    setFlowError(null);
    setFlowStatus("running");
    setSettleReceipt(null);
    setConfirmingBlocks([]);
    setSteps([
      { label: "settle() transaction", status: "running" },
      { label: "Wait for transaction finality", status: "pending" },
    ]);

    try {
      const settleStartedAt = performance.now();
      const { receipt } = await settleMutation.mutateAsync();
      const settleDuration = performance.now() - settleStartedAt;
      setSettleReceipt(receipt);

      setSteps([
        { label: "settle() transaction", status: "complete", durationMs: settleDuration },
        { label: "Wait for transaction finality", status: "running" },
      ]);

      const finalityStartedAt = performance.now();
      const finalizedBlocks = await waitForFinality(publicClient, deserializeReceipt(receipt));
      const finalityDuration = performance.now() - finalityStartedAt;
      setConfirmingBlocks(finalizedBlocks);

      setSteps([
        { label: "settle() transaction", status: "complete", durationMs: settleDuration },
        { label: "Wait for transaction finality", status: "complete", durationMs: finalityDuration },
      ]);
      setFlowStatus("complete");
      onFinalized();
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Settlement failed");
      setFlowStatus("idle");
    }
  }

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-medium text-stone-500">Card request</h2>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-2xl font-semibold">Settle $1 payment</h3>
          </div>
          <button
            className="cursor-pointer rounded-xl bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            disabled={!canSettle || flowStatus === "running"}
            onClick={runFlow}
            type="button"
          >
            {flowStatus === "running" ? "Running..." : "Run card request"}
          </button>
        </div>

        <div className="mt-8 space-y-4 text-sm">
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
            <span className="text-stone-500">Requested</span>
            <span className="font-medium">{Number(SETTLEMENT_AMOUNT).toFixed(2)} USDC</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-stone-500">Acquirer</span>
            <span className="break-all text-right font-mono text-xs">{acquirer}</span>
          </div>
        </div>

        <ol className="mt-6 space-y-3">
          {steps.map((step, index) => (
            <li
              className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
                step.status === "complete"
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-transparent bg-stone-100"
              }`}
              key={step.label}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-4 text-sm font-medium ${
                    step.status === "complete" ? "text-emerald-700" : "text-stone-400"
                  }`}
                >
                  {step.status === "complete" ? "✓" : index + 1}
                </span>
                <span
                  className={`font-medium ${
                    step.status === "complete" ? "text-emerald-950" : "text-stone-800"
                  }`}
                >
                  {step.label === "settle() transaction" ? (
                    <>
                      <code className="font-mono text-xs">settle()</code> transaction
                    </>
                  ) : (
                    step.label
                  )}
                </span>
              </div>
              <span className={step.status === "complete" ? "text-emerald-700" : "text-stone-500"}>
                {step.status === "running"
                  ? "Running"
                  : step.durationMs
                    ? `${Math.round(step.durationMs)}ms`
                    : flowStatus === "idle"
                      ? ""
                      : "Pending"}
              </span>
            </li>
          ))}
        </ol>

        {settleReceipt ? (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
              <span className="text-stone-500">Transaction hash</span>
              <a
                className="break-all text-right font-mono text-xs text-stone-800 underline underline-offset-4 hover:text-stone-950"
                href={explorerTxUrl(settleReceipt.transactionHash)}
                rel="noreferrer"
                target="_blank"
                title={settleReceipt.transactionHash}
              >
                {settleReceipt.transactionHash}
              </a>
            </div>
            {confirmingBlocks.length > 0 ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-stone-500">Confirming blocks</span>
                <span className="flex flex-wrap justify-end gap-2 text-right font-mono text-xs">
                  {confirmingBlocks.map((block) => (
                    block.number === null ? null : (
                      <a
                        className="text-stone-800 underline underline-offset-4 hover:text-stone-950"
                        href={explorerBlockUrl(block.number)}
                        key={block.number.toString()}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {block.number.toString()}
                      </a>
                    )
                  ))}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {holder && spendable !== undefined && !canSettle ? (
          <p className="mt-4 text-sm text-red-700">Not enough spendable balance to settle $1.</p>
        ) : null}
        {flowError ? <p className="mt-4 text-sm text-red-700">{flowError}</p> : null}
      </div>
    </section>
  );
}
