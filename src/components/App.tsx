"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { activeCount, applyFilter, NO_FILTER, type Filter, type Sort } from "@/lib/filters";
import { buildSeries, useCloses } from "@/lib/networth";
import { todayMoves } from "@/lib/today";
import { cashBalances, cashTotal } from "@/lib/cash";
import { buildPositions, totals as sumTotals, type Totals } from "@/lib/portfolio";
import { compact } from "@/lib/format";
import { useMarket } from "@/lib/prices";
import { useMood } from "@/lib/mood";
import { AiProvider } from "@/lib/ai";
import { StoreProvider, useStore } from "@/lib/store";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { PrivacyProvider, usePrivacy } from "@/lib/privacy";
import { portfolioCard, type CardData } from "@/lib/shareCard";
import { ShareCard, ShareIcon } from "./ShareCard";
import type { Currency } from "@/lib/types";
import { AddHolding } from "./AddHolding";
import { AiConsent } from "./AiConsent";
import { AiOrb } from "./AiOrb";
import { Assistant } from "./Assistant";
import { CashCard } from "./Cash";
import { AssetView } from "./AssetView";
import { InsightsPage } from "./insights/InsightsPage";
import { HoldingsMap } from "./HoldingsMap";
import { HoldingsOrbit } from "./HoldingsOrbit";
import { ActiveFilters, FilterButton } from "./FilterBar";
import { Gate, Logo } from "./Gate";
import { Highlights } from "./Highlights";
import { History } from "./History";
import { Holdings } from "./Holdings";
import { ImportFlow } from "./ImportFlow";
import { NetWorthChart } from "./NetWorthChart";
import { DashboardLens } from "./DashboardLens";
import { MoversWaterfall } from "./MoversWaterfall";
import { CloudIcon, Dot, SyncPanel } from "./SyncPanel";
import { Button, Card, Icon, Modal, Segmented } from "./ui";

export function App() {
  return (
    <ThemeProvider>
      <PrivacyProvider>
        <StoreProvider>
          <AiProvider>
            <Shell />
            <AiConsent />
          </AiProvider>
        </StoreProvider>
      </PrivacyProvider>
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
  const { data, lock, sync } = useStore();
  const [syncOpen, setSyncOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const privacy = usePrivacy();
  const [currency, setCurrency] = useState<Currency>("INR");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [card, setCard] = useState<CardData | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const mood = useMood();
  // Which screen is showing lives in browser history, so Back, Forward and refresh work.
  const [route, setRoute] = useState<Route>(readRoute);
  const openId = route.openId;
  const view = route.view;
  const go = useCallback((next: Route) => {
    setRoute(next);
    window.history.pushState({ ...window.history.state, folio: next }, "");
    window.scrollTo({ top: 0 });
  }, []);
  const setOpenId = useCallback((id: string | null) => go({ view: readRoute().view, openId: id }), [go]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setRoute((e.state as { folio?: Route } | null)?.folio ?? HOME);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
  const filtered = activeCount(filter) > 0;
  // Cash counts towards net worth (as money in, so never a gain), except in a filtered view.
  const cashNow = useMemo(() => cashTotal(cashBalances(data), currency, market.usdInr), [data, currency, market.usdInr]);
  const withCash = useCallback((t: Totals): Totals => ({ ...t, value: t.value + cashNow, cost: t.cost + cashNow }), [cashNow]);
  const totals = useMemo(() => {
    const t = sumTotals(scoped.positions, currency, market.usdInr);
    return filtered ? t : withCash(t);
  }, [scoped.positions, currency, market.usdInr, filtered, withCash]);
  const series = useMemo(
    () => buildSeries(scoped.data, scoped.positions, closes, market, currency),
    [scoped, closes, market, currency],
  );
  const today = useMemo(() => todayMoves(scoped.positions, currency, market), [scoped.positions, currency, market]);
  // The Insights tab always sees everything, whatever the dashboard filter.
  const wholeSeries = useMemo(() => (filtered ? buildSeries(data, positions, closes, market, currency) : series), [filtered, data, positions, closes, market, currency, series]);
  const notify = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const [assistOpen, setAssistOpen] = useState(false);
  const closeAssist = useCallback(() => setAssistOpen(false), []);
  // The assistant always sees the whole portfolio, whatever the dashboard filter.
  const whole = useMemo(() => {
    if (!assistOpen) return null;
    if (!filtered) return { totals, today, series };
    return {
      totals: withCash(sumTotals(positions, currency, market.usdInr)),
      today: todayMoves(positions, currency, market),
      series: buildSeries(data, positions, closes, market, currency),
    };
  }, [assistOpen, filtered, totals, today, series, positions, currency, market, data, closes, withCash]);

  const openAsset = data.assets.find((a) => a.id === openId);
  const empty = data.txns.length === 0 && !(data.cash ?? []).length;

  return (
    <div className={`transition-[padding] duration-300 ${assistOpen ? "lg:pr-[400px]" : ""}`}>
      <header className="masthead scope-dark sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <button type="button" onClick={() => go(HOME)} aria-label="Folio home" className="press">
              <Logo />
            </button>
            {!empty && (
              <Segmented
                options={[
                  { value: "dashboard", label: "Dashboard" },
                  { value: "insights", label: "Insights" },
                  { value: "history", label: "History" },
                ]}
                value={view}
                onChange={(v) => go({ view: v, openId: null })}
                label="Page"
                size="sm"
                glass
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {!empty && (
              // The tooltip sits on a wrapper: the button's own ::before/::after draw its light ring.
              <span data-tip={assistOpen ? undefined : "Ask Folio"} className="relative mr-1 inline-flex max-sm:mr-0">
                <button
                  type="button"
                  onClick={() => setAssistOpen((o) => !o)}
                  aria-pressed={assistOpen}
                  aria-label="Ask Folio, your portfolio assistant"
                  className="press ai-btn ai-orb-host grid size-9 place-items-center rounded-full"
                >
                  <AiOrb />
                </button>
              </span>
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
              glass
            />
            {!openAsset && !empty && view === "dashboard" && (
              <FilterButton
                filter={filter}
                onChange={setFilter}
                all={positions}
                shown={scoped.positions.length}
                accounts={data.accounts}
                currency={currency}
              />
            )}
            {!openAsset && !empty && view === "dashboard" && (
              <button
                type="button"
                // The whole portfolio's investments (not cash, and whatever the filter shows).
                onClick={() => setCard(portfolioCard(positions, sumTotals(positions, currency, market.usdInr), currency, market.usdInr, todayMoves(positions, currency, market).total, data.txns.length ? Math.min(...data.txns.map((t) => t.ts)) : null))}
                aria-label="Share your portfolio"
                data-tip="Share card"
                className="press glass glass-btn streak-host relative grid size-9 place-items-center rounded-full"
              >
                <span className="streak-clip" aria-hidden />
                {ShareIcon}
              </button>
            )}
            {!openAsset && !empty && (
              <button type="button" onClick={() => setImporting(true)} aria-label="Import holdings" data-tip="Import a statement" className="press glass glass-btn streak-host relative grid size-9 place-items-center rounded-full">
                <span className="streak-clip" aria-hidden />
                {Icon.upload}
              </button>
            )}
            <div role="toolbar" aria-label="Privacy, appearance, sync and lock" className="glass flex items-center rounded-full p-[3px]">
              <button
                type="button"
                onClick={privacy.toggle}
                aria-pressed={privacy.hidden}
                aria-label={privacy.hidden ? "Show amounts" : "Hide amounts"}
                data-tip={privacy.hidden ? "Show amounts" : "Hide amounts"}
                className="press glass-tool streak-host"
              >
                <span className="streak-clip" aria-hidden />
                <span key={String(privacy.hidden)} className="pop-in">
                  {privacy.hidden ? Icon.eyeOff : Icon.eye}
                </span>
              </button>
              <button
                type="button"
                onClick={toggle}
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                data-tip={theme === "dark" ? "Light theme" : "Dark theme"}
                className="press glass-tool streak-host"
              >
                <span className="streak-clip" aria-hidden />
                <span key={theme} className="pop-in">
                  {theme === "dark" ? Icon.sun : Icon.moon}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSyncOpen(true)}
                aria-label={sync.state === "off" ? "Sync across devices" : `Sync: ${sync.state === "idle" ? "in sync" : sync.state}`}
                data-tip={sync.state === "off" ? "Sync devices" : sync.state === "idle" ? "In sync" : sync.state === "syncing" ? "Syncing…" : sync.state === "offline" ? "Offline" : "Sync needs attention"}
                className="press glass-tool streak-host"
              >
                <span className="streak-clip" aria-hidden />
                {CloudIcon}
                {sync.state !== "off" && (
                  <span className="absolute right-[7px] top-[6px]">
                    <Dot state={sync.state} />
                  </span>
                )}
              </button>
              <button type="button" onClick={lock} aria-label="Lock" data-tip="Lock Folio" className="press glass-tool streak-host">
                <span className="streak-clip" aria-hidden />
                {Icon.lock}
              </button>
            </div>
            {!openAsset && !empty && (
              <button type="button" onClick={() => setAdding(true)} aria-label="Add a holding" className="press cta-white streak-host relative inline-flex h-9 items-center gap-1.5 rounded-full pl-3 pr-4 text-[13px] font-semibold tracking-[-0.005em] max-sm:w-9 max-sm:justify-center max-sm:px-0">
                <span className="streak-clip" aria-hidden />
                {Icon.plus} <span className="hidden sm:inline">Add a holding</span>
              </button>
            )}
          </div>
        </div>
        {!openAsset && !empty && view === "dashboard" && (
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

      {empty && !openAsset ? (
        <Welcome onAdd={() => setAdding(true)} onImport={() => setImporting(true)} />
      ) : (
      <div className={`mx-auto max-w-[1180px] px-4 pt-2 sm:px-6 ${assistOpen ? "pb-[60dvh] lg:pb-16" : "pb-16"}`}>
        {openAsset ? (
          <AssetView
            key={openAsset.id}
            asset={openAsset}
            position={positions.find((p) => p.asset.id === openAsset.id)}
            onBack={() => (readRoute().openId ? window.history.back() : go({ view, openId: null }))}
            onSaved={notify}
          />
        ) : view === "history" ? (
          <History data={data} currency={currency} usdInr={market.usdInr} onOpen={setOpenId} />
        ) : view === "insights" ? (
          <InsightsPage
            data={data}
            positions={positions}
            closes={closes}
            market={market}
            currency={currency}
            series={wholeSeries}
            loading={loading}
          />
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
                <NetWorthChart
                  series={series}
                  totals={totals}
                  currency={currency}
                  loading={loading}
                  today={today}
                  filtered={filtered}
                  missingHistory={scoped.data.assets.filter((a) => missing.includes(a.id)).map((a) => a.name)}
                  moods={mood.readings}
                  classes={[...new Set(scoped.positions.map((p) => p.asset.cls))]}
                />
                <DashboardLens
                  tabs={[
                    {
                      key: "movers",
                      label: "Today's movers",
                      badge: (
                        <span className={`num text-[11.5px] font-semibold ${today.total < 0 ? "text-down" : today.total > 0 ? "text-up" : "text-ink-3"}`}>
                          {today.total < 0 ? "−" : "+"}
                          {compact(Math.abs(today.total), currency)}
                        </span>
                      ),
                      render: () => <MoversWaterfall bare today={today} currency={currency} moods={mood.readings} closes={closes} onOpen={setOpenId} />,
                    },
                    {
                      key: "orbit",
                      label: "Orbit",
                      render: () => (
                        <HoldingsOrbit
                          bare
                          positions={scoped.positions}
                          currency={currency}
                          usdInr={market.usdInr}
                          onOpen={setOpenId}
                          cash={filtered ? undefined : cashBalances(data)}
                          onCash={() => setCashOpen(true)}
                        />
                      ),
                    },
                    { key: "map", label: "Map", render: () => <HoldingsMap bare positions={scoped.positions} currency={currency} usdInr={market.usdInr} onOpen={setOpenId} /> },
                    {
                      key: "highlights",
                      label: "Highlights",
                      render: () => <Highlights bare series={series} positions={scoped.positions} today={today} currency={currency} usdInr={market.usdInr} closes={closes} onOpen={setOpenId} />,
                    },
                  ]}
                />
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
      )}

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
      {syncOpen && <SyncPanel onClose={() => setSyncOpen(false)} />}
      {card && <ShareCard data={card} onClose={() => setCard(null)} />}
      {importing && <ImportFlow onClose={() => setImporting(false)} onSaved={notify} />}
      {cashOpen && (
        <Modal title="Cash" header={<span />} onClose={() => setCashOpen(false)} wide>
          <CashCard currency={currency} usdInr={market.usdInr} onSaved={notify} />
        </Modal>
      )}

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

/**
 * The first room after the vault is made: the unlock panorama carries on behind an editorial
 * headline, with the header's white pill and glass button as the only two ways in.
 */
function Welcome({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <main className="relative flex min-h-[calc(100dvh-64px)] flex-col overflow-hidden text-ink">

      <p
        className="label rise-in pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 text-ink-3/70 sm:block sm:right-10"
        style={{ writingMode: "vertical-rl", animationDelay: "0.9s" }}
        aria-hidden
      >
        Entry 001 · Awaiting
      </p>

      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-10 sm:pb-9">
        <p className="label rise-in flex items-center gap-2.5 text-ink-3" style={{ animationDelay: "0.1s" }}>
          <span className="size-[6px] rounded-full bg-up shadow-[0_0_10px_var(--up)]" aria-hidden />
          PF-01 · Your ledger is ready
        </p>

        <div className="mt-auto max-w-[760px] pt-24">
          <h1 className="font-display text-[46px] font-normal leading-[0.98] tracking-[-0.015em] sm:text-[72px] lg:text-[88px]">
            <span className="rise-in block" style={{ animationDelay: "0.25s" }}>
              Your private ledger,
            </span>
            <span className="rise-in block italic text-ink-3" style={{ animationDelay: "0.4s" }}>
              waiting for its first entry.
            </span>
          </h1>
          <p className="rise-in mt-6 max-w-[520px] text-[15px] leading-relaxed text-ink-2 sm:text-[16px]" style={{ animationDelay: "0.55s" }}>
            Add what you own, from any broker. Folio prices it live, draws its history and keeps every figure encrypted on this device.
          </p>
          <div className="rise-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "0.7s" }}>
            <button type="button" onClick={onAdd} className="press cta streak-host relative inline-flex h-12 items-center gap-2 rounded-full pl-5 pr-6 text-[14.5px] font-semibold tracking-[-0.005em]">
              <span className="streak-clip" aria-hidden />
              {Icon.plus} Add your first holding
            </button>
            <button type="button" onClick={onImport} className="press pill streak-host relative inline-flex h-12 items-center gap-2 rounded-full pl-5 pr-6 text-[14.5px] font-semibold text-ink">
              <span className="streak-clip" aria-hidden />
              {Icon.upload} Import a statement
            </button>
          </div>
        </div>

        <footer className="rise-in mt-14 grid gap-x-8 gap-y-2 border-t border-line pt-5 sm:grid-cols-3" style={{ animationDelay: "0.9s" }}>
          <span className="label text-ink-2">Indian &amp; US stocks · Funds · Crypto</span>
          <span className="label text-ink-3 sm:text-center">Groww · INDmoney · CoinDCX · More</span>
          <span className="label text-ink-3 sm:text-right">AES-256 · Encrypted on this device</span>
        </footer>
      </div>
    </main>
  );
}

type Route = { view: "dashboard" | "insights" | "history"; openId: string | null };
const HOME: Route = { view: "dashboard", openId: null };

/** The screen recorded in this history entry (survives a refresh). */
function readRoute(): Route {
  const r = (window.history.state as { folio?: Route } | null)?.folio;
  return r ? { view: r.view === "history" || r.view === "insights" ? r.view : "dashboard", openId: typeof r.openId === "string" ? r.openId : null } : HOME;
}
