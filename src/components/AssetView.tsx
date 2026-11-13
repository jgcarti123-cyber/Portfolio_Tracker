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
import { PriceChart, type ChartControls, type ChartPoint, type ChartTrade } from "./PriceChart";
import { ExternalIcon, TradingViewChart, tvEmbeddable, tvSymbol, tvUrl } from "./TradingView";
import { Button, Card, CardHead, Delta, Icon, Segmented, useAnimatedNumber } from "./ui";

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
  function showTrade(id: string) {
    document.getElementById(`trade-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
  }

  // Funds publish one NAV a day, so there are no candles to draw.
  const lineOnly = !!candles?.length && candles.every((c) => c.o === c.c && c.h === c.l);
  const dayChange = position?.price && position.prevClose ? position.price - position.prevClose : null;

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
        <Button variant="ghost" onClick={onBack}>
          {Icon.back} All holdings
        </Button>
        <Button onClick={() => setAdding(true)}>{Icon.plus} Add a trade</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex flex-col p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="group">
                <AssetBadge position={position ?? { asset }} size={44} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-extrabold tracking-tight">{asset.name}</h1>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
                  {asset.ticker} · {CLASS_META[asset.cls].short}
                  {tv && (
                    <a href={tvUrl(tv)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                      Open in TradingView {ExternalIcon}
                    </a>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="num text-[28px] font-extrabold leading-none tracking-tight">{position?.price != null ? fmtPrice(position.price, cur) : "–"}</p>
              <p className="mt-2 text-xs text-ink-2">
                {position?.priceSource === "manual" ? (
                  <>entered by you, {position.priceTs ? dateTime(position.priceTs) : ""}</>
                ) : dayChange !== null && position?.prevClose ? (
                  <Delta value={dayChange}>
                    {signed(dayChange, cur)} ({pct((dayChange / position.prevClose) * 100)}) today
                  </Delta>
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
              <div className="relative mt-4 min-h-[360px] flex-1" onMouseLeave={() => setPoint(null)}>
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

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <CardHead icon={Icon.wallet} title="Your position" color="var(--cat-3)" />
            {position && position.qty > 0 ? (
              <>
                <dl className="num mt-4 space-y-3 text-sm">
                  <Row label="Quantity" value={`${qty(position.qty)} ${unit}`} />
                  <Row label="Average cost" value={fmtPrice(position.avgPrice, cur)} />
                  <Row label="Invested" value={money(position.cost, cur)} />
                  <Row label="Value now" value={position.value !== null ? money(position.value, cur) : "–"} strong />
                  {position.gain !== null && (
                    <div className="flex items-center justify-between border-t border-line pt-3">
                      <dt className="text-ink-2">Return</dt>
                      <dd className="flex items-center gap-2 font-bold">
                        {signed(position.gain, cur)}
                        <Delta value={position.gain}>{pct(position.cost > 0 ? (position.gain / position.cost) * 100 : 0)}</Delta>
                      </dd>
                    </div>
                  )}
                </dl>
                {Object.values(position.byAccount).filter((q) => q > 0).length > 1 && (
                  <p className="mt-3 text-xs text-ink-3">
                    {Object.entries(position.byAccount)
                      .filter(([, q]) => q > 0)
                      .map(([id, q]) => `${accountName(id)} ${qty(q)}`)
                      .join(" · ")}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-ink-2">You&apos;ve sold all of this.</p>
            )}
            {(!asset.symbol || asset.useManual) && (
              <form onSubmit={saveManual} className="mt-4 border-t border-line pt-4">
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
          </Card>

          {position && position.qty > 0 && position.price !== null && <WhatIf key={asset.id} position={position} cur={cur} unit={unit} />}

        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <CardHead icon={Icon.list} title="Trades" />
        <ul className="mt-3 divide-y divide-line">
          {txns.map((t) => {
            const opening = isOpening(t, data.txns);
            return (
            <li
              key={t.id}
              id={`trade-${t.id}`}
              className={`-mx-2 flex scroll-mt-24 items-center justify-between gap-3 rounded-xl px-2 py-3 text-sm transition-colors duration-500 ${flash === t.id ? "bg-accent-soft" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${opening ? "bg-sunken text-ink-3" : t.type === "buy" ? "bg-accent-soft text-accent" : "bg-sunken text-ink"}`}
                  aria-hidden
                >
                  {opening ? "+" : t.type === "buy" ? "B" : "S"}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    {opening ? "Added to Folio" : t.type === "buy" ? "Bought" : "Sold"} <span className="num">{qty(t.qty)}</span> {opening ? "at avg" : "at"}{" "}
                    <span className="num">{fmtPrice(t.price, cur)}</span>
                  </p>
                  <p className="text-xs text-ink-2">
                    {opening ? `${t.via ? `From ${t.via}` : "Added"} on ${new Date(t.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : dateTime(t.ts)} · {accountName(t.accountId)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="num font-bold">{money(t.qty * t.price, cur)}</span>
                <button
                  type="button"
                  aria-label="Delete this trade"
                  onClick={() => {
                    if (!confirm("Delete this trade? This can't be undone.")) return;
                    if (txns.length === 1) onBack();
                    deleteTxn(t.id);
                  }}
                  className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-down-soft hover:text-down"
                >
                  {Icon.trash}
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      </Card>

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

/** Drag a price and see what your holding would be worth there, with break-even marked. */
function WhatIf({ position, cur, unit }: { position: Position; cur: Currency; unit: string }) {
  const now = position.price!;
  const avg = position.avgPrice;
  const lo = Math.min(now, avg) * 0.5;
  const hi = Math.max(now, avg) * 1.6;
  const [target, setTarget] = useState(now);
  const value = position.qty * target;
  const gain = value - position.cost;
  const move = (target / now - 1) * 100;
  const toBreakEven = (avg / now - 1) * 100;
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const shownValue = useAnimatedNumber(value, 160);
  const shownGain = useAnimatedNumber(gain, 160);
  const presets: { label: string; v: number }[] = [
    { label: "−20%", v: now * 0.8 },
    { label: "−10%", v: now * 0.9 },
    { label: "Now", v: now },
    { label: "+10%", v: now * 1.1 },
    { label: "+25%", v: now * 1.25 },
    { label: "Break-even", v: avg },
  ];

  return (
    <Card className="flex-1 p-5">
      <CardHead
        icon={
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M2 8h12M5 5v6M11 4v8" />
          </svg>
        }
        title="What if the price moves?"
        color="var(--cat-4)"
      />

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="num text-[22px] font-extrabold tracking-tight">{fmtPrice(target, cur)}</p>
        <span className={`num text-[13px] font-semibold ${Math.abs(move) < 0.05 ? "text-ink-3" : move > 0 ? "text-up" : "text-down"}`}>
          {Math.abs(move) < 0.05 ? "today's price" : `${pct(move)} from today`}
        </span>
      </div>

      {/* Track: red below your break-even, green above it */}
      <div className="relative mt-6 h-9">
        <div
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{
            background: `linear-gradient(90deg, var(--down-soft) 0%, var(--down-soft) ${at(avg)}%, var(--up-soft) ${at(avg)}%, var(--up-soft) 100%)`,
          }}
        />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full transition-[left,width] duration-75"
          style={{
            left: `${Math.min(at(now), at(target))}%`,
            width: `${Math.abs(at(target) - at(now))}%`,
            background: target >= now ? "var(--up)" : "var(--down)",
            opacity: 0.7,
          }}
        />
        <Mark at={at(avg)} label="Break-even" dashed />
        <Mark at={at(now)} label="Now" below={Math.abs(at(avg) - at(now)) < 20} />
        <input
          type="range"
          min={lo}
          max={hi}
          step={(hi - lo) / 500}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          aria-label="Price to test"
          aria-valuetext={fmtPrice(target, cur)}
          className="whatif-range absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div className="num mt-4 flex justify-between text-[10px] text-ink-3">
        <span>{fmtPrice(lo, cur)}</span>
        <span>{fmtPrice(hi, cur)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setTarget(p.v)}
            className={`press rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
              Math.abs(target - p.v) < (hi - lo) / 1000 ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <dl className="num mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-sunken p-3.5">
        <div>
          <dt className="text-[11px] text-ink-3">Your {qty(position.qty)} {unit} would be worth</dt>
          <dd className="text-[15px] font-bold">{money(shownValue, cur)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-[11px] text-ink-3">{gain >= 0 ? "Gain" : "Loss"} on what you paid</dt>
          <dd className={`text-[15px] font-bold ${gain >= 0 ? "text-up" : "text-down"}`}>
            {signed(shownGain, cur)} <span className="text-[11px]">{pct(position.cost > 0 ? (gain / position.cost) * 100 : 0)}</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        {Math.abs(toBreakEven) < 0.05
          ? "Today's price is right at your break-even."
          : toBreakEven > 0
            ? `You break even at ${fmtPrice(avg, cur)}, ${pct(toBreakEven)} above today.`
            : `You're above break-even (${fmtPrice(avg, cur)}) by ${pct(-toBreakEven).replace("+", "")}.`}{" "}
        For exploring only; not a prediction.
      </p>
    </Card>
  );
}

function Mark({ at, label, dashed, below }: { at: number; label: string; dashed?: boolean; below?: boolean }) {
  return (
    <div className="pointer-events-none absolute top-0 h-full -translate-x-1/2" style={{ left: `${at}%` }} aria-hidden>
      <div className={`mx-auto h-full w-0 border-l-2 ${dashed ? "border-dashed border-ink-3" : "border-ink"}`} />
      <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-ink-3 ${below ? "-bottom-4" : "-top-4"}`}>{label}</span>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-2">{label}</dt>
      <dd className={strong ? "text-base font-extrabold" : "font-semibold"}>{value}</dd>
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
