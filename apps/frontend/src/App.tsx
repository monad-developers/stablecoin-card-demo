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
import { acquirer, rpcUrls, strategies } from "./config";
import { demoChain } from "./chain";
import monadLogo from "./monad.svg";
import aaveLogo from "./aave.svg";

type FlowStatus = "idle" | "running" | "complete";

type FlowStep = {
  label: string;
  status: "pending" | "running" | "complete";
  durationMs?: number;
};

const publicClient = createPublicClient({
  chain: demoChain,
  transport: http(rpcUrls[0]),
  pollingInterval: 200,
});

const initialFlowSteps: FlowStep[] = [
  { label: "settle() transaction", status: "pending" },
  { label: "Wait for transaction finality", status: "pending" },
];

const monadScanBaseUrl = "https://testnet.monadscan.com";

function getIsAboutFromPath(): boolean {
  const path = window.location.pathname;
  return path === "/" || path === "/about";
}

const strategyLabels: Record<StrategyId, string> = {
  stablecoin: "Stablecoin",
  "aave-borrow": "Aave borrow",
};

const strategyDescriptions: Record<StrategyId, string> = {
  stablecoin: "Holder authorizes direct settlement from their USDC balance.",
  "aave-borrow": "Holder authorizes the adapter to borrow USDC against Aave collateral at settlement.",
};

const settleEvents: Record<StrategyId, string[]> = {
  stablecoin: ["transfer USDC"],
  "aave-borrow": ["check health factor", "originate loan", "transfer USDC"],
};

const aaveSettleCode = `function settle(address holder, uint256 amount, address recipient) external override {
    if (msg.sender != issuer) revert NotIssuer();

    uint256 available = spendable(holder);
    if (amount > available) revert InsufficientSpendable(amount, available);

    (, uint256 borrowed) = IAaveV4TakerPositionManager(takerPositionManager)
        // Aave checks the holder's health factor and reverts if the borrow would breach it
        .borrowOnBehalfOf({
            spoke: spoke,
            reserveId: debtReserveId,
            amount: amount,
            onBehalfOf: holder
        });
    if (borrowed != amount) revert InsufficientBorrowed(amount, borrowed);

    ERC20(stablecoin).safeTransfer(recipient, amount);

    emit Settled(holder, recipient, amount);
}`;

const solidityTokenPattern =
  /(\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:contract|interface|function|external|override|public|view|pure|returns|return|address|uint256|uint16|uint8|bool|struct|calldata|memory|storage|immutable|constant|if|else|revert|require|emit|event|mapping)\b|\b\d+(?:_\d+)*(?:e\d+)?\b|[A-Za-z_]\w*(?=\())/g;

function solidityTokenClass(token: string): string {
  if (token.startsWith("//")) return "text-stone-500";
  if (token.startsWith('"') || token.startsWith("'")) return "text-emerald-300";
  if (/^\d/.test(token)) return "text-amber-300";
  if (/^(address|uint256|uint16|uint8|bool|calldata|memory|storage)$/.test(token)) return "text-sky-300";
  if (/^[A-Za-z_]\w*$/.test(token) && !/^(contract|interface|function|external|override|public|view|pure|returns|return|struct|immutable|constant|if|else|revert|require|emit|event|mapping)$/.test(token)) {
    return "text-fuchsia-300";
  }
  return "text-violet-300";
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
  const [activeStrategyId, setActiveStrategyId] = useState<StrategyId>("stablecoin");
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

  function navigateToDemo() {
    window.history.pushState({}, "", "/demo");
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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
          <a
            className="flex items-center gap-3 rounded-full transition hover:opacity-80"
            href="/about"
            onClick={(event) => {
              event.preventDefault();
              navigateToAbout();
            }}
            aria-label="Monad Foundation x Aave demo"
          >
            <span className="flex h-9 items-center rounded-full border border-stone-200 bg-white px-3 shadow-sm shadow-stone-200/60">
              <img className="h-4 w-auto" src={monadLogo} alt="Monad Foundation" />
            </span>
            <span className="text-sm font-semibold text-stone-400">x</span>
            <span className="flex h-9 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#B6509E] to-[#2EBAC6] shadow-sm shadow-stone-200/60">
              <img className="h-5 w-auto" src={aaveLogo} alt="Aave" />
            </span>
          </a>
          <nav className="flex gap-2" aria-label="Pages">
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
          <AboutPage onTryDemo={navigateToDemo} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-8">
            <StrategyPicker activeStrategyId={activeStrategyId} onChange={setActiveStrategyId} />
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

function AboutPage({ onTryDemo }: { onTryDemo: () => void }) {
  const settlementFlow = [
    {
      title: "Issuer receives the card request",
      detail: "A swipe travels POS -> acquirer -> network -> issuer. The issuer has only a few seconds to answer yes or no.",
    },
    {
      title: "Issuer checks spendable value",
      detail: "The settlement integration reports how much value the holder can spend, denominated in USDC.",
    },
    {
      title: "Settlement executes on-chain",
      detail: "The integration performs the backing action and delivers USDC to the acquirer in one transaction.",
    },
    {
      title: "Finality closes authorization",
      detail: "After the transaction and confirming blocks finalize, the issuer can answer yes with settlement already complete.",
    },
  ];

  const gasUsage = [
    { label: "ERC-20 transfer()", note: undefined, gasPerPayment: 63_219, usd: "$0.000145" },
    { label: "settle()", note: undefined, gasPerPayment: 69_706, usd: "$0.000160" },
    { label: "settleBatch()", note: "batch of 10", gasPerPayment: 15_649, usd: "$0.00003599" },
  ];
  const maxGasPerPayment = Math.max(...gasUsage.map((operation) => operation.gasPerPayment));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="space-y-4">
        <div className="flex w-full items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">About</h1>
          <button
            className="w-fit cursor-pointer rounded-xl bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800"
            onClick={onTryDemo}
            type="button"
          >
            Try the demo
          </button>
        </div>

        <p className="text-base leading-7 text-stone-700">
          Stablecoin-backed card transactions are growing fast, but a few structural issues still stand
          between today's products and what's next.
        </p>

        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-stone-700">
          <li>
            <strong>Tight authorization windows.</strong> Card networks like Visa require a final yes
            or no in under ~1.5 seconds, so issuers need a hard guarantee that a transaction is fully
            settled — not just submitted.
          </li>
          <li>
            <strong>Spend is capped to idle balances.</strong> To avoid double-spends, issuers can
            only authorize against funds already confirmed in a user's wallet, so balances locked in
            DeFi — collateral, yield — can't be spent.
          </li>
          <li>
            <strong>Slow finality forces issuers to float.</strong> Legacy chains can't finalize
            inside that window, so issuers front the funds and absorb settlement risk, which raises
            cost and caps what they can offer.
          </li>
        </ul>

        <p className="text-base leading-7 text-stone-700">
          Monad Foundation and Aave have been working together on an open-source toolkit to mitigate
          these issues and help enable a new era of card products that settle faster and increase what's possible.
        </p>

        <p className="text-base leading-7 text-stone-700">
          By combining Monad's performance with Aave's deep liquidity, card
          issuers and apps can now let users spend their balance directly from DeFi and finalize
          transactions in around 600 milliseconds — meeting the obligations of card networks like Visa.
        </p>

        <p className="text-base leading-7 text-stone-700">
          This page is a live demo and reference implementation: it shows how the settlement contracts
          are written and how card issuers can unlock this experience without introducing new risk or
          additional cost.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Stablecoin settlement</h2>
        <p className="text-base leading-7 text-stone-700">
          Monad makes stablecoin settlement practical because the <strong>transaction can finalize inside the
          card network's authorization window and costs less than $0.001</strong>.
        </p>
        <ol className="space-y-3">
          {settlementFlow.map((step, index) => (
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
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Example: Aave borrow integration</h2>
        <p className="text-base leading-7 text-stone-700">
          Aave borrow is one concrete implementation. The holder keeps collateral in Aave, grants the
          settlement contract borrow permission, and the issuer settles a card request by originating
          USDC debt and sending the borrowed USDC to the acquirer.
        </p>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <CodeBlock code={aaveSettleCode} language="solidity" />
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

      <footer className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-900">Warning</p>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          This is a reference implementation for educational purposes and has not been audited. It may
          have significant errors and security vulnerabilities. Do not use the code in this example in a
          production environment without completing your own audits and application of best practices.
        </p>
      </footer>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: "solidity" }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-800 bg-stone-950">
      <div className="flex items-center justify-between border-b border-stone-800 px-4 py-2">
        <span className="text-xs font-medium text-stone-400">{language}</span>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6 text-stone-100">
        <code>
          {code.split("\n").map((line, lineIndex) => (
            <span className="block" key={`${line}-${lineIndex}`}>
              {highlightSolidity(line)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function highlightSolidity(line: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(solidityTokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    parts.push(
      <span className={solidityTokenClass(token)} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts.length > 0 ? parts : "\u00A0";
}

function StrategyPicker({
  activeStrategyId,
  onChange,
}: {
  activeStrategyId: StrategyId;
  onChange: (strategyId: StrategyId) => void;
}) {
  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-2 shadow-sm shadow-stone-200/60">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-3 py-2">
          <h1 className="text-2xl font-semibold tracking-tight">Card settlement demo</h1>
          <p className="mt-1 min-h-12 text-sm leading-6 text-stone-600">{strategyDescriptions[activeStrategyId]}</p>
        </div>
        <div
          className="grid grid-cols-2 rounded-2xl bg-stone-100 p-1 sm:w-80 sm:shrink-0"
          role="radiogroup"
          aria-label="Strategy"
        >
          {strategyIds.map((strategyId) => {
            const isActive = strategyId === activeStrategyId;

            return (
              <button
                className={`cursor-pointer rounded-xl px-4 py-3 text-center text-sm font-medium transition ${
                  isActive
                    ? "bg-white text-stone-950 shadow-sm ring-1 ring-stone-200"
                    : "text-stone-500 hover:text-stone-950"
                }`}
                key={strategyId}
                onClick={() => onChange(strategyId)}
                role="radio"
                aria-checked={isActive}
                type="button"
              >
                {strategyLabels[strategyId]}
              </button>
            );
          })}
        </div>
      </div>
    </section>
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
            <span className="break-all text-right font-mono text-sm leading-6 text-stone-800">{acquirer}</span>
          </div>
        </div>

        <ol className="mt-6 space-y-3">
          {steps.map((step, index) => {
            const showSettleEvents = step.label === "settle() transaction" && step.status === "complete";

            return (
              <li
                className={`rounded-xl border px-4 py-3 text-sm ${
                  step.status === "complete"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-transparent bg-stone-100"
                }`}
                key={step.label}
              >
                <div className="flex items-center justify-between gap-4">
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
                </div>
                {showSettleEvents ? (
                  <div className="mt-3 border-t border-emerald-200/80 pt-3 pl-7">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700">Events</p>
                    <ul className="flex flex-wrap gap-2">
                      {settleEvents[strategyId].map((event) => (
                        <li
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-950 shadow-sm shadow-emerald-950/5"
                          key={event}
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] leading-none text-emerald-700">
                            ✓
                          </span>
                          <span>{event}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
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
