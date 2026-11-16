"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateTime, money, pct, price as fmtPrice, qty, signed } from "@/lib/format";
import { isOpening, type Position } from "@/lib/portfolio";
import { fetchHistory } from "@/lib/prices";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CLASS_META, type Asset, type Candle, type Currency, type Range, type Txn } from "@/lib/types";
import { AddTrade } from "./AddTrade";
import { AssetBadge } from "./Holdings";
import { PriceWhatIf } from "./PriceWhatIf";
import { PriceChart, type ChartControls, type ChartPoint, type ChartTrade } from "./PriceChart";
import { ExternalIcon, TradingViewChart, tvEmbeddable, tvSymbol, tvUrl } from "./TradingView";
import { BigFigure, Button, Card, Delta, Icon, Segmented, useAnimatedNumber } from "./ui";

const RANGES = (["1D", "1W", "1M", "3M", "1Y", "5Y"] as const).map((r) => ({ value: r, label: r }));

/** Units held and their cost at a moment, replaying trades up to it (average-cost method). */
function heldAt(txns: Txn[], ts: number) {
  let q = 0;
  let cost = 0;
  for (const t of [...txns].sort((a, b) => a.ts - b.ts)) {
    if (t.ts > ts) break;
    if (t.type === "buy") (q += t.qty), (cost += t.qty * t.price);
    else {
      const sold = Math.min(t.qty, q);
      if (q > 0) cost -= (cost / q) * sold;
      q -= sold;
    }
  }
  return q < 1e-9 ? { q: 0, cost: 0 } : { q, cost };
}

export function AssetView({
  asset,
  position,
  onBack,
  onSaved,
}: {
  asset: Asset;
  position: Position | undefined;
  onBack: () => void;
  onSaved?: (message: string) => void;
}) {
  const { theme } = useTheme();
  const { data, updateAsset, deleteTxn } = useStore();
  const [range, setRange] = useState<Range>("3M");
  const [mode, setMode] = useState<"candles" | "line">("line");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [chartError, setChartError] = useState("");
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState("");
  const [point, setPoint] = useState<ChartPoint | null>(null);
  const [loadingRange, setLoadingRange] = useState(false);
  const chartControls = useRef<ChartControls | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [source, setSource] = useState<"folio" | "tv">("folio");
  const [flash, setFlash] = useState<string | null>(null);
  const [panel, setPanel] = useState<"whatif" | "trades">("whatif");

  const txns = useMemo(() => data.txns.filter((t) => t.assetId === asset.id).sort((a, b) => b.ts - a.ts), [data.txns, asset.id]);
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "Unknown";
  const cur = asset.currency;
  const unit = CLASS_META[asset.cls].unit;

  useEffect(() => {
    if (!asset.symbol) return;
    const ctrl = new AbortController();
    // Keep the current chart on screen while the next range loads (no blank flash).
    setLoadingRange(true);
    setChartError("");
    setPoint(null);
    fetchHistory(asset, range, false, ctrl.signal)
      .then((c) => (setCandles(c), setLoadingRange(false)))
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadingRange(false);
        setChartError("The price chart couldn't be loaded. Try another range, or again in a minute.");
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.symbol, asset.currency, range]);

  const tv = tvSymbol(asset);
  const embed = tv && tvEmbeddable(asset) ? tv : null;
  // Stickers only for real buys and sells, not the entry made when the holding was added.
  const chartTrades = useMemo<ChartTrade[]>(
    () =>
      txns
        .filter((t) => !isOpening(t, data.txns))
        .map((t) => ({
          id: t.id,
          ts: t.ts,
          price: t.price,
          type: t.type,
          title: `${t.type === "buy" ? "Bought" : "Sold"} ${qty(t.qty)} ${CLASS_META[asset.cls].unit} at ${fmtPrice(t.price, asset.currency)}`,
          detail: `${new Date(t.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · ${data.accounts.find((a) => a.id === t.accountId)?.name ?? ""}`,
        })),
    [txns, data.txns, data.accounts, asset.cls, asset.currency],
  );
  const canWhatIf = !!position && position.qty > 0 && position.price !== null;
  const shownPanel = canWhatIf ? panel : "trades";
  function showTrade(id: string) {
    setPanel("trades");
    requestAnimationFrame(() => document.getElementById(`trade-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
  }

  // Funds publish one NAV a day, so there are no candles to draw.
  const lineOnly = !!candles?.length && candles.every((c) => c.o === c.c && c.h === c.l);
  const dayChange = position?.price && position.prevClose && !position.closedToday ? position.price - position.prevClose : null;

  function saveManual(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(manual);
    if (!(p > 0)) return;
    updateAsset(asset.id, { manualPrice: { price: p, ts: Date.now() }, useManual: true });
    setManual("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="pill press inline-flex h-9 items-center gap-1.5 rounded-full pl-3 pr-4 text-[13px] font-semibold text-ink-2 hover:text-ink">
          {Icon.back} All holdings
        </button>
        <button type="button" onClick={() => setAdding(true)} className="cta press streak-host relative inline-flex h-9 items-center gap-1.5 rounded-full pl-3.5 pr-4 text-[13px] font-semibold">
          <span className="streak-clip" aria-hidden />
          {Icon.plus} Add a trade
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:h-[clamp(600px,calc(100dvh-188px),820px)] lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex min-h-0 flex-col p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="group">
                <AssetBadge position={position ?? { asset }} size={46} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">{asset.name}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-3">
                  <span className="label text-[10px] text-ink-2">{asset.ticker}</span>
                  <span className="size-[3px] rounded-full bg-ink-3/60" aria-hidden />
                  <span className="label text-[10px]">{CLASS_META[asset.cls].short}</span>
                  {tv && (
                    <a href={tvUrl(tv)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink">
                      TradingView {ExternalIcon}
                    </a>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right max-sm:w-full max-sm:text-left">
              <p className="text-[40px] text-ink">{position?.price != null ? <BigFigure text={fmtPrice(position.price, cur)} /> : "–"}</p>
              <p className="mt-2 text-[13px] text-ink-3">
                {position?.priceSource === "manual" ? (
                  <>entered by you, {position.priceTs ? dateTime(position.priceTs) : ""}</>
                ) : position?.closedToday ? (
                  <>Market closed today</>
                ) : dayChange !== null && position?.prevClose ? (
                  <span className={`num inline-flex items-center gap-1.5 font-semibold ${dayChange > 0 ? "text-up" : dayChange < 0 ? "text-down" : "text-ink-2"}`}>
                    {dayChange !== 0 && (
                      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={dayChange < 0 ? "rotate-180" : ""}>
                        <path d="M5 1.5 9 8H1z" fill="currentColor" />
                      </svg>
                    )}
                    {signed(dayChange, cur)} · {pct((dayChange / position.prevClose) * 100)}
                    <span className="label ml-0.5 text-[9.5px] text-ink-3">today</span>
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {asset.symbol ? (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {source === "folio" ? (
                  <div className="flex items-center gap-2">
                    <Segmented options={RANGES} value={range} onChange={setRange} label="Chart range" size="sm" />
                    {candles?.length ? (
                      <div className="flex items-center rounded-full bg-sunken p-0.5 ring-1 ring-line" role="group" aria-label="Zoom">
                        <ZoomBtn label="Zoom out" onClick={() => chartControls.current?.zoomOut()} d="M3.5 7h7" />
                        <ZoomBtn label="Zoom in" onClick={() => chartControls.current?.zoomIn()} d="M3.5 7h7M7 3.5v7" />
                        {zoomed && <ZoomBtn label="Reset zoom" onClick={() => chartControls.current?.reset()} d="M3 7a4 4 0 1 0 1.2-2.85M3 2.5v2.5h2.5" />}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-ink-3">TradingView&apos;s chart — your trades aren&apos;t drawn here</span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {source === "folio" && !lineOnly && (
                    <Segmented
                      options={[
                        { value: "line", label: "Line" },
                        { value: "candles", label: "Candles" },
                      ]}
                      value={mode}
                      onChange={setMode}
                      label="Chart style"
                      size="sm"
                    />
                  )}
                  {embed && (
                    <Segmented
                      options={[
                        { value: "folio", label: "Folio" },
                        { value: "tv", label: "TradingView" },
                      ]}
                      value={source}
                      onChange={setSource}
                      label="Chart source"
                      size="sm"
                    />
                  )}
                </div>
              </div>
              <div className="relative mt-4 min-h-[340px] flex-1 lg:min-h-0" onMouseLeave={() => setPoint(null)}>
                {source === "tv" && embed ? (
                  <div className="absolute inset-0">
                    <TradingViewChart symbol={embed} theme={theme} />
                  </div>
                ) : chartError && !candles ? (
                  <p className="absolute inset-0 grid place-items-center text-center text-sm text-ink-2">{chartError}</p>
                ) : candles === null ? (
                  <div className="skeleton absolute inset-0" />
                ) : candles.length === 0 ? (
                  <p className="absolute inset-0 grid place-items-center text-sm text-ink-2">No price data for this range.</p>
                ) : (
                  <div className={`absolute inset-0 transition-opacity duration-200 ${loadingRange ? "opacity-50" : ""}`}>
                    <PriceChart
                      candles={candles}
                      mode={lineOnly ? "line" : mode}
                      intraday={range === "1D" || range === "1W"}
                      avgCost={position && position.qty > 0 ? position.avgPrice : null}
                      trades={chartTrades}
                      theme={theme}
                      currency={cur}
                      onHover={setPoint}
                      onTradeClick={showTrade}
                      controlsRef={chartControls}
                      onZoomedChange={setZoomed}
                      height="100%"
                    />
                  </div>
                )}
                {loadingRange && source === "folio" && candles && (
                  <span className="absolute right-16 top-2 flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink-3 shadow-card ring-1 ring-line">
                    <span className="size-3 animate-spin rounded-full border-2 border-line border-t-accent" />
                    Loading {range}
                  </span>
                )}
              </div>
              {source === "folio" && <OnThisDay point={point} txns={txns} position={position} cur={cur} unit={unit} intraday={range === "1D" || range === "1W"} />}
            </>
          ) : (
            <p className="mt-6 rounded-2xl bg-sunken p-5 text-sm leading-relaxed text-ink-2">
              There&apos;s no live price feed for this asset, so there&apos;s no chart. It&apos;s valued at the price you enter on the right — update it whenever the price moves.
            </p>
          )}
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 px-5 pb-4 pt-5">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="size-[6px] rounded-full bg-up shadow-[0_0_10px_var(--up)]" aria-hidden />
                <h2 className="label text-[11px] text-ink-2">Your position</h2>
              </div>
              {position && position.qty > 0 && position.gain !== null && (
                <Delta value={position.gain}>{pct(position.cost > 0 ? (position.gain / position.cost) * 100 : 0)}</Delta>
              )}
            </header>
            {position && position.qty > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[34px] text-ink">{position.value !== null ? <BigFigure text={money(position.value, cur)} /> : "–"}</p>
                  {position.gain !== null && (
                    <p className={`num text-[13px] font-semibold ${position.gain > 0 ? "text-up" : position.gain < 0 ? "text-down" : "text-ink-2"}`}>
                      {signed(position.gain, cur)} <span className="label ml-0.5 text-[9.5px] text-ink-3">all time</span>
                    </p>
                  )}
                </div>
                <dl className="num mt-4 grid grid-cols-3 divide-x divide-line border-y border-line py-2.5">
                  <Row label="Holding" value={qty(position.qty)} sub={unit} />
                  <Row label="Avg cost" value={fmtPrice(position.avgPrice, cur)} sub="per unit" />
                  <Row label="Invested" value={money(position.cost, cur)} sub="in total" />
                </dl>
                {Object.values(position.byAccount).filter((q) => q > 0).length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(position.byAccount)
                      .filter(([, q]) => q > 0)
                      .map(([id, q]) => (
                        <span key={id} className="num inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[11px] text-ink-2 ring-1 ring-line">
                          {accountName(id)} <b className="font-semibold text-ink">{qty(q)}</b>
                        </span>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-2">You&apos;ve sold all of this.</p>
            )}
            {(!asset.symbol || asset.useManual) && (
              <form onSubmit={saveManual} className="mt-4">
                <label htmlFor="manual-price" className="mb-1.5 block text-xs text-ink-3">
                  {asset.symbol ? "Using a price you entered instead of the live one." : "No live price for this, so it's valued at the price you enter."}
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-price"
                    className="field num h-10"
                    inputMode="decimal"
                    placeholder={`New price in ${cur === "INR" ? "₹" : "$"}`}
                    value={manual}
                    onChange={(e) => setManual(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <Button type="submit" variant="ghost" className="shrink-0" disabled={!(Number(manual) > 0)}>
                    Update price
                  </Button>
                </div>
                {asset.useManual && asset.symbol && (
                  <button type="button" className="mt-2 text-xs font-semibold text-accent" onClick={() => updateAsset(asset.id, { useManual: false })}>
                    Go back to the live price
                  </button>
                )}
              </form>
            )}
          </div>

          <div className="shrink-0 px-5">
            <Segmented
              options={[...(canWhatIf ? [{ value: "whatif" as const, label: "What if" }] : []), { value: "trades" as const, label: `Trades · ${txns.length}` }]}
              value={shownPanel}
              onChange={setPanel}
              label="Panel"
              size="sm"
            />
          </div>

          <div className="panel-scroll min-h-0 flex-1 px-5 pb-5 pt-4 lg:overflow-y-auto">
            {shownPanel === "whatif" && canWhatIf ? (
              <PriceWhatIf key={asset.id} asset={asset} position={position!} cur={cur} unit={unit} />
            ) : (
              <ul className="fade-in -mt-1 divide-y divide-line">
                {txns.map((t) => {
                  const opening = isOpening(t, data.txns);
                  return (
                    <li
                      key={t.id}
                      id={`trade-${t.id}`}
                      className={`group -mx-2 flex scroll-mt-4 items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-[13px] transition-colors duration-500 hover:bg-sunken/60 ${flash === t.id ? "bg-sunken" : ""}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-line ${opening ? "bg-sunken text-ink-3" : t.type === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}
                          aria-hidden
                        >
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            {opening ? <path d="M7 3v8M3 7h8" /> : t.type === "buy" ? <path d="M10 4 4 10M4 5v5h5" /> : <path d="M4 10l6-6M5 4h5v5" />}
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {opening ? "Added" : t.type === "buy" ? "Bought" : "Sold"} <span className="num">{qty(t.qty)}</span> {opening ? "at avg" : "at"}{" "}
                            <span className="num">{fmtPrice(t.price, cur)}</span>
                          </p>
                          <p className="truncate text-[11.5px] text-ink-3">
                            {new Date(t.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {accountName(t.accountId)}
                            {opening && t.via ? ` · from ${t.via}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="num font-semibold">{money(t.qty * t.price, cur)}</span>
                        <button
                          type="button"
                          aria-label="Delete this trade"
                          onClick={() => {
                            if (!confirm("Delete this trade? This can't be undone.")) return;
                            if (txns.length === 1) onBack();
                            deleteTxn(t.id);
                          }}
                          className="grid size-7 place-items-center rounded-full text-ink-3 transition-opacity hover:bg-down-soft hover:text-down focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          {Icon.trash}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {adding && <AddTrade asset={asset} onClose={() => setAdding(false)} onSaved={onSaved} />}
    </div>
  );
}

/**
 * Under the chart: what YOUR holding was worth at the point under the cursor, using the
 * units you held then and what they cost. Shows today when the cursor is off the chart.
 */
function OnThisDay({
  point,
  txns,
  position,
  cur,
  unit,
  intraday,
}: {
  point: ChartPoint | null;
  txns: Txn[];
  position: Position | undefined;
  cur: Currency;
  unit: string;
  intraday: boolean;
}) {
  const [mounted] = useState(() => Date.now());
  const now = !point;
  const ts = point ? point.t * 1000 : mounted;
  const price = point ? point.price : (position?.price ?? 0);
  const { q, cost } = now && position ? { q: position.qty, cost: position.cost } : heldAt(txns, ts);
  const value = q * price;
  const gain = value - cost;
  const shownValue = useAnimatedNumber(value, 220);
  const shownGain = useAnimatedNumber(gain, 220);
  const label = now
    ? "Today"
    : new Date(ts).toLocaleString("en-IN", intraday ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-4" aria-live="polite">
      <Stat label={now ? "Price now" : "On this day"} value={label} sub={price > 0 ? `${fmtPrice(price, cur)} each` : "no live price"} />
      <Stat
        label="You held"
        value={q > 0 ? `${qty(q)} ${unit}` : txns.some((t) => t.ts <= ts) ? "Nothing" : "None yet"}
        sub={q > 0 ? `cost ${money(cost, cur)}` : txns.some((t) => t.ts <= ts) ? "you'd sold it all" : "before your first buy"}
      />
      <Stat label={now ? "Holding worth" : "Holding worth then"} value={q > 0 ? money(shownValue, cur) : "–"} sub={q > 0 && !now && position?.value ? `${pct((value / position.value - 1) * 100)} vs today` : now ? "live" : ""} />
      <Stat
        label={gain >= 0 ? "Your gain then" : "Your loss then"}
        value={q > 0 ? signed(shownGain, cur) : "–"}
        sub={q > 0 && cost > 0 ? pct((gain / cost) * 100) : ""}
        tone={q > 0 ? gain : undefined}
      />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: number }) {
  return (
    <div className="min-w-0 bg-surface px-3.5 py-3">
      <p className="truncate text-[11px] text-ink-3">{label}</p>
      <p className={`num mt-0.5 truncate text-[14px] font-bold ${tone === undefined ? "" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : ""}`}>{value}</p>
      <p className={`num truncate text-[11px] ${tone === undefined ? "text-ink-3" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ink-3"}`}>{sub || " "}</p>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="truncate text-[10.5px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold">{value}</dd>
      <dd className="truncate text-[10px] text-ink-3">{sub}</dd>
    </div>
  );
}

function ZoomBtn({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="pop-in grid size-7 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface hover:text-ink">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}
