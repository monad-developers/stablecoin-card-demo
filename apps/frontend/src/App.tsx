import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  { label: "Call settle on adapter", status: "pending" },
  { label: "Wait for transaction finality", status: "pending" },
];

function getStrategyFromPath(): StrategyId {
  return window.location.pathname === "/money-market" ? "money-market" : "stablecoin";
}

function deserializeReceipt(receipt: SerializedReceipt): TransactionReceipt {
  return {
    blockHash: receipt.blockHash,
    blockNumber: BigInt(receipt.blockNumber),
    transactionHash: receipt.transactionHash,
    status: receipt.status,
  } as TransactionReceipt;
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
    staleTime: 5_000,
  });

  useEffect(() => {
    function onPopState() {
      setActiveStrategyId(getStrategyFromPath());
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (holder || initializedStrategies.current.has(activeStrategyId)) return;

    initializedStrategies.current.add(activeStrategyId);
    setRefreshingStrategyId(activeStrategyId);
    refreshHolder.mutate(activeStrategyId);
    // `refreshHolder` is intentionally omitted: the mutation object is recreated
    // across renders, and including it can retrigger provisioning before a holder is set.
  }, [activeStrategyId, holder]);

  function navigate(strategyId: StrategyId) {
    const path = strategyId === "stablecoin" ? "/stablecoin" : "/money-market";
    window.history.pushState({}, "", path);
    setActiveStrategyId(strategyId);
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
          <nav className="flex gap-2" aria-label="Strategies">
            {strategyIds.map((strategyId) => (
              <a
                className={`px-1 py-1.5 text-sm transition ${
                  strategyId === activeStrategyId
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
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-10">
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
      </section>
    </main>
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
  const balance = spendable === undefined ? "-" : `${formatUnits(spendable, TOKEN_DECIMALS)} USDC`;
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
  const [steps, setSteps] = useState<FlowStep[]>(initialFlowSteps);
  const settlementAmount = BigInt(10) ** BigInt(TOKEN_DECIMALS);
  const canSettle = holder !== undefined && spendable !== undefined && spendable >= settlementAmount;

  const settleMutation = useMutation({
    mutationFn: () => postJson<SettleResponse>("/api/settle", { strategyId, holder }),
  });

  useEffect(() => {
    setFlowError(null);
    setFlowStatus("idle");
    setSteps(initialFlowSteps);
  }, [holder, strategyId]);

  async function runFlow() {
    if (!canSettle || flowStatus === "running") return;

    setFlowError(null);
    setFlowStatus("running");
    setSteps([
      { label: "Call settle on adapter", status: "running" },
      { label: "Wait for transaction finality", status: "pending" },
    ]);

    try {
      const settleStartedAt = performance.now();
      const { receipt } = await settleMutation.mutateAsync();
      const settleDuration = performance.now() - settleStartedAt;

      setSteps([
        { label: "Call settle on adapter", status: "complete", durationMs: settleDuration },
        { label: "Wait for transaction finality", status: "running" },
      ]);

      const finalityStartedAt = performance.now();
      await waitForFinality(publicClient, deserializeReceipt(receipt));
      const finalityDuration = performance.now() - finalityStartedAt;

      setSteps([
        { label: "Call settle on adapter", status: "complete", durationMs: settleDuration },
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
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
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
                  {step.label}
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

        {holder && spendable !== undefined && !canSettle ? (
          <p className="mt-4 text-sm text-red-700">Not enough spendable balance to settle $1.</p>
        ) : null}
        {flowError ? <p className="mt-4 text-sm text-red-700">{flowError}</p> : null}
      </div>
    </section>
  );
}
