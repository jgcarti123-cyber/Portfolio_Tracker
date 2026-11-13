"use client";

import { useCallback, useMemo, useState } from "react";
import { activeCount, applyFilter, NO_FILTER, type Filter, type Sort } from "@/lib/filters";
import { buildSeries, useCloses } from "@/lib/networth";
import { todayMoves } from "@/lib/today";
import { buildPositions, totals as sumTotals } from "@/lib/portfolio";
import { useMarket } from "@/lib/prices";
import { AiProvider } from "@/lib/ai";
import { StoreProvider, useStore } from "@/lib/store";
import { ThemeProvider, useTheme } from "@/lib/theme";
import type { Currency } from "@/lib/types";
import { AddHolding } from "./AddHolding";
import { AiConsent } from "./AiConsent";
import { Allocation } from "./Allocation";
import { Assistant, Sparkle } from "./Assistant";
import { AssetView } from "./AssetView";
import { ActiveFilters, FilterButton } from "./FilterBar";
import { Gate, Logo } from "./Gate";
import { Highlights } from "./Highlights";
import { Holdings } from "./Holdings";
import { ImportFlow } from "./ImportFlow";
import { NetWorthChart } from "./NetWorthChart";
import { TodayMovers } from "./Today";
import { Button, Card, Icon, Segmented } from "./ui";

export function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <AiProvider>
          <Shell />
          <AiConsent />
        </AiProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}

function Shell() {
  const { status } = useStore();
  if (status === "loading") return null;
  if (status !== "open") return <Gate />;
  return <Portfolio />;
}

function Portfolio() {
  const { data, lock } = useStore();
  const { theme, toggle } = useTheme();
  const [currency, setCurrency] = useState<Currency>("INR");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const market = useMarket(data.assets);
  const positions = useMemo(() => buildPositions(data, market.quotes), [data, market.quotes]);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [sort, setSort] = useState<Sort>({ key: "value", dir: "desc" });
  const { closes, loading, missing } = useCloses(data);

  // Everything on the dashboard follows the filter: totals, history, today's moves, allocation, table.
  const scoped = useMemo(
    () => applyFilter(positions, data, filter, currency, market.usdInr),
    [positions, data, filter, currency, market.usdInr],
  );
  const totals = useMemo(
    () => sumTotals(scoped.positions, currency, market.usdInr),
    [scoped.positions, currency, market.usdInr],
  );
  const series = useMemo(
    () => buildSeries(scoped.data, scoped.positions, closes, market, currency),
    [scoped, closes, market, currency],
  );
  const today = useMemo(() => todayMoves(scoped.positions, currency, market), [scoped.positions, currency, market]);
  const filtered = activeCount(filter) > 0;
  const notify = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const [assistOpen, setAssistOpen] = useState(false);
  const closeAssist = useCallback(() => setAssistOpen(false), []);
  // The assistant always sees the whole portfolio, whatever the dashboard filter.
  const whole = useMemo(() => {
    if (!assistOpen) return null;
    if (!filtered) return { totals, today, series };
    return {
      totals: sumTotals(positions, currency, market.usdInr),
      today: todayMoves(positions, currency, market),
      series: buildSeries(data, positions, closes, market, currency),
    };
  }, [assistOpen, filtered, totals, today, series, positions, currency, market, data, closes]);

  const openAsset = data.assets.find((a) => a.id === openId);
  const empty = data.txns.length === 0;

  return (
    <div className={`transition-[padding] duration-300 ${assistOpen ? "lg:pr-[400px]" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-transparent bg-[color-mix(in_srgb,var(--canvas)_78%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <button type="button" onClick={() => setOpenId(null)} aria-label="Folio home" className="press">
            <Logo />
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!empty && (
              <button
                type="button"
                onClick={() => setAssistOpen((o) => !o)}
                aria-pressed={assistOpen}
                aria-label="Ask Folio, your portfolio assistant"
                className={`press group inline-flex h-10 items-center gap-2 rounded-full pl-3 pr-3.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-10px_var(--accent)] transition-[filter,box-shadow] hover:brightness-110 max-sm:w-10 max-sm:justify-center max-sm:px-0 ${
                  assistOpen ? "ring-2 ring-accent/40 ring-offset-2 ring-offset-canvas" : ""
                }`}
                style={{ background: "linear-gradient(135deg, var(--accent), var(--cat-4))" }}
              >
                <span className="transition-transform duration-500 group-hover:rotate-[20deg]">
                  <Sparkle />
                </span>
                <span className="hidden sm:inline">Ask Folio</span>
              </button>
            )}
            <Segmented
              options={[
                { value: "INR", label: "₹ INR" },
                { value: "USD", label: "$ USD" },
              ]}
              value={currency}
              onChange={setCurrency}
              label="Display currency"
              size="sm"
            />
            {!openAsset && !empty && (
              <FilterButton
                filter={filter}
                onChange={setFilter}
                all={positions}
                shown={scoped.positions.length}
                accounts={data.accounts}
                currency={currency}
              />
            )}
            {!openAsset && !empty && (
              <Button variant="ghost" onClick={() => setImporting(true)} aria-label="Import holdings" className="max-sm:w-10 max-sm:px-0">
                {Icon.upload} <span className="hidden sm:inline">Import</span>
              </Button>
            )}
            {!openAsset && !empty && (
              <Button onClick={() => setAdding(true)}>
                {Icon.plus} <span className="hidden sm:inline">Add a holding</span>
                <span className="sm:hidden">Add</span>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={toggle}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="w-10 px-0"
            >
              <span key={theme} className="pop-in">
                {theme === "dark" ? Icon.sun : Icon.moon}
              </span>
            </Button>
            <Button variant="ghost" onClick={lock} aria-label="Lock" className="w-10 px-0">
              {Icon.lock}
            </Button>
          </div>
        </div>
        {!openAsset && !empty && (
          <ActiveFilters
            filter={filter}
            onChange={setFilter}
            accounts={data.accounts}
            shown={scoped.positions.length}
            total={positions.length}
            shownValue={totals.value}
            currency={currency}
          />
        )}
      </header>

      <div className={`mx-auto max-w-[1180px] px-4 pt-2 sm:px-6 ${assistOpen ? "pb-[60dvh] lg:pb-16" : "pb-16"}`}>
        {openAsset ? (
          <AssetView
            key={openAsset.id}
            asset={openAsset}
            position={positions.find((p) => p.asset.id === openAsset.id)}
            onBack={() => setOpenId(null)}
            onSaved={notify}
          />
        ) : empty ? (
          <Welcome onAdd={() => setAdding(true)} onImport={() => setImporting(true)} />
        ) : (
          <main className="space-y-4">
            {filtered && !scoped.positions.length ? (
              <Card className="grid place-items-center gap-3 px-6 py-16 text-center">
                <p className="text-[15px] font-semibold">No holdings match these filters</p>
                <p className="text-sm text-ink-2">Try fewer filters, or clear them to see everything again.</p>
                <Button variant="ghost" onClick={() => setFilter(NO_FILTER)}>
                  Clear all filters
                </Button>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <NetWorthChart
                    series={series}
                    totals={totals}
                    currency={currency}
                    loading={loading}
                    today={today}
                    filtered={filtered}
                    missingHistory={scoped.data.assets.filter((a) => missing.includes(a.id)).map((a) => a.name)}
                  />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
                    <Allocation positions={scoped.positions} accounts={data.accounts} currency={currency} usdInr={market.usdInr} />
                    <Highlights
                      series={series}
                      positions={scoped.positions}
                      today={today}
                      currency={currency}
                      usdInr={market.usdInr}
                      closes={closes}
                      onOpen={setOpenId}
                    />
                  </div>
                </div>
                <TodayMovers today={today} currency={currency} onOpen={setOpenId} />
                <Holdings
                  positions={scoped.positions}
                  accounts={data.accounts}
                  closes={closes}
                  onOpen={setOpenId}
                  sort={sort}
                  onSort={setSort}
                  currency={currency}
                  usdInr={market.usdInr}
                  total={positions.length}
                  onClear={() => setFilter(NO_FILTER)}
                />
              </>
            )}
            <p className="px-1 text-xs leading-relaxed text-ink-3">
              Prices refresh every minute and can lag the exchange. Dollar holdings are converted at $1 = ₹
              {market.usdInr.toFixed(2)}. This is a tracker, not investment advice.
            </p>
          </main>
        )}
      </div>

      {!empty && whole && (
        <Assistant
          open={assistOpen}
          onClose={closeAssist}
          positions={positions}
          totals={whole.totals}
          today={whole.today}
          series={whole.series}
          currency={currency}
          usdInr={market.usdInr}
          onSaved={notify}
        />
      )}
      {adding && <AddHolding onClose={() => setAdding(false)} onSaved={notify} />}
      {importing && <ImportFlow onClose={() => setImporting(false)} onSaved={notify} />}

      {toast && (
        <div
          key={toast.id}
          role="status"
          onAnimationEnd={() => setToast(null)}
          className="toast fixed bottom-6 left-1/2 z-[60] flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-canvas shadow-pop"
        >
          <span className="grid size-5 place-items-center rounded-full bg-up text-white">{Icon.check}</span>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Welcome({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <main className="grid min-h-[70dvh] place-items-center">
      <div className="max-w-[460px] text-center">
        <svg width="200" height="110" viewBox="0 0 200 110" className="mx-auto" aria-hidden>
          <defs>
            <pattern id="w-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--accent-soft)" />
              <rect width="2.4" height="6" fill="var(--accent)" opacity="0.55" />
            </pattern>
          </defs>
          {[34, 48, 42, 60, 54, 76, 70, 96].map((h, i) => (
            <rect
              key={i}
              className="bar-rise"
              style={{ animationDelay: `${i * 60}ms` }}
              x={8 + i * 24}
              y={104 - h}
              width="16"
              height={h}
              rx="5"
              fill={i === 7 ? "var(--accent)" : "url(#w-stripe)"}
            />
          ))}
        </svg>
        <h1 className="mt-8 text-[30px] font-extrabold leading-tight tracking-tight">
          Start with one thing you own
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Pick a stock, fund or coin, then type what you put in and what it&apos;s worth today. Folio works
          out the rest and tracks it from there, across every broker.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button onClick={onAdd} className="h-12 px-6 text-sm">
            {Icon.plus} Add your first holding
          </Button>
          <Button variant="ghost" onClick={onImport} className="h-12 px-6 text-sm">
            {Icon.upload} Import a statement
          </Button>
        </div>
      </div>
    </main>
  );
}
