"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CASH_COLOR } from "@/lib/cash";
import { compact, day, money, pct, signed } from "@/lib/format";
import type { DayValue } from "@/lib/networth";
import type { Totals } from "@/lib/portfolio";
import type { Today } from "@/lib/today";
import { CLASS_META, type AssetClass, type Currency } from "@/lib/types";
import { Delta, Icon, IconTile, Segmented } from "./ui";

/** Layers bottom to top: the steadiest money underneath, the jumpiest on top. */
const LAYERS = ["cash", "mf", "in_stock", "us_stock", "crypto"] as const;
type Layer = (typeof LAYERS)[number];
const layerVal = (d: DayValue, k: Layer) => (k === "cash" ? (d.cash ?? 0) : d.byClass[k as AssetClass]);
const layerColor = (k: Layer) => (k === "cash" ? CASH_COLOR : CLASS_META[k].color);
const layerLabel = (k: Layer) => (k === "cash" ? "Cash" : CLASS_META[k].label);

type Mode = "amount" | "mix";
type Span = "1W" | "1M" | "3M" | "1Y" | "ALL";
const SPAN_DAYS: Record<Span, number> = { "1W": 7, "1M": 30, "3M": 91, "1Y": 365, ALL: Infinity };
const SPANS = [
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
] as const;
const SPAN_WORD: Record<Span, string> = { "1W": "This week", "1M": "This month", "3M": "Last 3 months", "1Y": "This year", ALL: "Since tracking began" };

const PAD = { top: 10, bottom: 22, right: 48 };

/** Width and height of a box, so the chart fills whatever space its card has. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((st) => n <= st) ?? 10) * pow;
}

/** Smooth curve through points that never overshoots (monotone cubic). */
function monotone(xs: number[], ys: number[], move = true) {
  const n = xs.length;
  if (!n) return "";
  if (n === 1) return `${move ? "M" : "L"}${xs[0]},${ys[0]}`;
  const m: number[] = [];
  for (let k = 0; k < n - 1; k++) m.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k] || 1));
  const t = xs.map((_, k) => (k === 0 ? m[0] : k === n - 1 ? m[n - 2] : m[k - 1] * m[k] <= 0 ? 0 : (m[k - 1] + m[k]) / 2));
  for (let k = 0; k < n - 1; k++) {
    if (m[k] === 0) {
      t[k] = 0;
      t[k + 1] = 0;
      continue;
    }
    const a = t[k] / m[k];
    const b = t[k + 1] / m[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[k] = tau * a * m[k];
      t[k + 1] = tau * b * m[k];
    }
  }
  let d = `${move ? "M" : "L"}${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let k = 0; k < n - 1; k++) {
    const dx = (xs[k + 1] - xs[k]) / 3;
    d += `C${(xs[k] + dx).toFixed(1)},${(ys[k] + t[k] * dx).toFixed(1)} ${(xs[k + 1] - dx).toFixed(1)},${(ys[k + 1] - t[k + 1] * dx).toFixed(1)} ${xs[k + 1].toFixed(1)},${ys[k + 1].toFixed(1)}`;
  }
  return d;
}

/**
 * Net worth as a river: each asset type (and cash) is a layer, so the height is your total
 * and the bands show what it's made of. The dashed line is what you put in; the gap above
 * it is what the market added.
 */
export function NetWorthChart({
  series,
  totals,
  currency,
  loading,
  today,
  filtered,
  missingHistory,
}: {
  series: DayValue[];
  totals: Totals;
  currency: Currency;
  loading: boolean;
  today: Today;
  filtered: boolean;
  /** Holdings whose price history couldn't be loaded. */
  missingHistory: string[];
}) {
  const [mode, setMode] = useState<Mode>("amount");
  const [span, setSpan] = useState<Span>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, size] = useSize<HTMLDivElement>();
  const W = size.w;
  const H = Math.max(190, size.h);

  // Only real days: the chart starts at the first day anything was held.
  const points = useMemo(() => {
    const want = SPAN_DAYS[span] === Infinity ? series.length : SPAN_DAYS[span];
    return series.slice(-Math.min(series.length, want));
  }, [series, span]);
  const n = points.length;
  const present = LAYERS.filter((k) => points.some((d) => layerVal(d, k) > 0));
  const active = hover !== null && hover < n ? hover : n - 1;
  const hovering = hover !== null && hover < n;
  const historyShort = series.length < 2;

  const plotW = Math.max(0, W - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const x = (i: number) => (n <= 1 ? plotW : (i / (n - 1)) * plotW);
  const maxV = niceMax(Math.max(1, ...points.map((d) => Math.max(d.value, d.invested))) * 1.06);
  const yAmt = (v: number) => base - (v / maxV) * plotH;
  const yMix = (f: number) => base - f * plotH;

  // Stacked boundaries per layer.
  const stacks = useMemo(() => {
    const lower = points.map(() => 0);
    return present.map((k) => {
      const lo = [...lower];
      const hi = points.map((d, i) => {
        const v = mode === "mix" ? (d.value > 0 ? layerVal(d, k) / d.value : 0) : layerVal(d, k);
        lower[i] += v;
        return lower[i];
      });
      return { k, lo, hi };
    });
  }, [points, present, mode]);

  const y = mode === "mix" ? yMix : yAmt;
  const xs = points.map((_, i) => x(i));
  // A day with nothing held has no mix: in "Mix %" it's a gap, not a dip to zero.
  const runs = useMemo(() => {
    if (mode !== "mix") return [points.map((_, i) => i)];
    const out: number[][] = [];
    let cur: number[] = [];
    points.forEach((d, i) => {
      if (d.value > 0) cur.push(i);
      else if (cur.length) {
        out.push(cur);
        cur = [];
      }
    });
    if (cur.length) out.push(cur);
    return out;
  }, [points, mode]);

  // The visible range in three parts that always add up.
  const rangeChange = n > 1 ? points[n - 1].value - points[0].value : 0;
  const rangeMarket = points.slice(1).reduce((a, d, i) => a + (i === n - 2 ? today.total : d.move), 0);
  const rangeAdded = rangeChange - rangeMarket;
  const todayPct = today.base > 0 ? (today.total / today.base) * 100 : 0;
  const a = points[active];
  const ticks = mode === "mix" ? [0, 0.25, 0.5, 0.75, 1] : [0, maxV / 4, maxV / 2, (maxV * 3) / 4, maxV];

  function pick(clientX: number, rect: DOMRect) {
    const px = clientX - rect.left;
    if (px < 0 || px > plotW + 8 || n < 2) return setHover(null);
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(n - 1, active + (e.key === "ArrowLeft" ? -1 : 1))));
  }

  return (
    <section className="flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile color="var(--cat-3)">{Icon.wallet}</IconTile>
          <h2 className="text-[15px] font-semibold">Net worth</h2>
          {filtered && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Filtered</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented
            options={[
              { value: "amount", label: currency === "INR" ? "₹" : "$" },
              { value: "mix", label: "%" },
            ]}
            value={mode} onChange={(m) => (setHover(null), setMode(m))} label="Show" size="sm" />
          <Segmented options={SPANS} value={span} onChange={(s) => (setHover(null), setSpan(s))} label="Time range" size="sm" />
        </div>
      </header>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <p className="num text-[26px] font-extrabold leading-none tracking-[-0.025em]">{money(totals.value, currency, { decimals: 0 })}</p>
          <Delta value={today.total}>
            {signed(today.total, currency)} ({pct(todayPct)}) today
          </Delta>
        </div>
        <p className="num mt-1.5 text-[12px] text-ink-3">
          Invested <b className="font-semibold text-ink-2">{money(totals.cost, currency, { decimals: 0 })}</b>
          <span className="mx-1.5">·</span>
          Return{" "}
          <b className={`font-semibold ${totals.gain < 0 ? "text-down" : totals.gain > 0 ? "text-up" : "text-ink-2"}`}>
            {signed(totals.gain, currency)} ({pct(totals.cost > 0 ? (totals.gain / totals.cost) * 100 : 0)})
          </b>
        </p>
      </div>

      <div
        ref={ref}
        className="relative mt-3 min-h-[190px] flex-1 touch-pan-y outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Net worth by asset type, ${SPAN_WORD[span].toLowerCase()}. Use the arrow keys to read each day.`}
        onKeyDown={onKey}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
      >
        {loading && !series.length ? (
          <div className="skeleton absolute inset-0 top-4" />
        ) : historyShort ? (
          <EmptyHistory />
        ) : (
          W > 0 && (
            <svg width={W} height={H} className="absolute inset-0 block overflow-visible" key={`${mode}-${span}`}>
              <defs>
                {present.map((k) => (
                  <linearGradient key={k} id={`nw-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={layerColor(k)} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={layerColor(k)} stopOpacity={0.7} />
                  </linearGradient>
                ))}
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 5"} />
                  <text x={W} y={y(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
                    {mode === "mix" ? `${Math.round(t * 100)}%` : compact(t, currency)}
                  </text>
                </g>
              ))}
              <g className="fade-in">
                {stacks.map(({ k, lo, hi }) => (
                  <g key={k}>
                    {runs.map((run) => {
                      const rx = run.map((i) => xs[i]);
                      // A single day is drawn as a thin column so it stays visible.
                      const px = rx.length === 1 ? [rx[0] - 3, rx[0] + 3] : rx;
                      const ph = rx.length === 1 ? [hi[run[0]], hi[run[0]]] : run.map((i) => hi[i]);
                      const pl = rx.length === 1 ? [lo[run[0]], lo[run[0]]] : run.map((i) => lo[i]);
                      const top = monotone(px, ph.map(y));
                      const bottom = monotone([...px].reverse(), [...pl].reverse().map(y), false);
                      return (
                        <g key={run[0]}>
                          <path d={`${top}${bottom}Z`} fill={`url(#nw-${k})`} />
                          {/* A thin surface line keeps adjacent layers crisp */}
                          <path d={top} fill="none" stroke="var(--surface)" strokeWidth={1.5} />
                        </g>
                      );
                    })}
                  </g>
                ))}
              </g>
              {mode === "amount" && (
                <path
                  d={monotone(
                    xs,
                    points.map((d) => yAmt(d.invested)),
                  )}
                  fill="none"
                  stroke="var(--ink)"
                  strokeOpacity={0.55}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              )}
              {/* Day under the cursor */}
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={base} stroke="var(--ink)" strokeOpacity={hovering ? 0.35 : 0} />
              {hovering &&
                stacks.map(({ k, hi }) => <circle key={k} cx={x(active)} cy={y(hi[active])} r={3.5} fill={layerColor(k)} stroke="var(--surface)" strokeWidth={2} />)}
              <XLabels points={points} x={x} height={H} width={plotW} active={hovering ? active : -1} />
            </svg>
          )
        )}
        {hovering && a && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl px-3 py-2 text-white shadow-pop"
            style={{
              background: "var(--tip)",
              left: Math.max(0, Math.min(x(active) + (x(active) > plotW / 2 ? -188 : 14), plotW - 176)),
              top: 4,
              width: 176,
            }}
          >
            <p className="text-[10.5px] font-medium text-white/60">{active === n - 1 ? "Today" : day(a.ts, true)}</p>
            <p className="num text-[14px] font-bold">{money(a.value, currency, { decimals: 0 })}</p>
            <p className={`num text-[11px] font-semibold ${a.value - a.invested >= 0 ? "text-[#5fdc9a]" : "text-[#ff8a92]"}`}>
              {signed(a.value - a.invested, currency)} vs invested
            </p>
          </div>
        )}
      </div>

      {/* Legend doubles as the readout for the day under the cursor */}
      {!historyShort && a && (
        <div className="mt-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11.5px] font-semibold text-ink">{hovering ? (active === n - 1 ? "Today" : day(a.ts, true)) : "Today"}</span>
            {[...present].reverse().map((k) => {
              const v = layerVal(a, k);
              return (
                <span key={k} className="flex items-center gap-1 text-[11.5px] text-ink-3">
                  <span className="size-2 rounded-[2px]" style={{ background: layerColor(k) }} />
                  {layerLabel(k)}
                  <b className="num font-semibold text-ink-2">{mode === "mix" ? `${a.value > 0 ? Math.round((v / a.value) * 100) : 0}%` : compact(v, currency)}</b>
                </span>
              );
            })}
            {mode === "amount" && (
              <span className="flex items-center gap-1 text-[11.5px] text-ink-3">
                <span className="w-3.5 border-t-2 border-dashed border-ink-3" />
                Invested <b className="num font-semibold text-ink-2">{compact(a.invested, currency)}</b>
              </span>
            )}
          </div>
        </div>
      )}
      {!historyShort && n > 1 && (
        <p className="num mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11.5px] text-ink-3">
          <span>
            {SPAN_WORD[span]} <b className={`font-bold ${rangeChange >= 0 ? "text-up" : "text-down"}`}>{signed(rangeChange, currency)}</b>
          </span>
          <span>
            from the market <b className={`font-bold ${rangeMarket >= 0 ? "text-up" : "text-down"}`}>{signed(rangeMarket, currency)}</b>
          </span>
          <span title="Value of holdings you added, minus anything you sold">
            added by you <b className="font-bold text-ink">{signed(rangeAdded, currency)}</b>
          </span>
          {series.length < SPAN_DAYS[span] && span !== "ALL" && <span className="ml-auto">Tracking since {day(series[0].ts, true)}</span>}
        </p>
      )}
      {missingHistory.length > 0 && (
        <p className="mt-3 rounded-xl bg-down-soft/60 px-3 py-2 text-xs text-ink-2">
          Price history for {missingHistory.slice(0, 3).join(", ")}
          {missingHistory.length > 3 ? ` and ${missingHistory.length - 3} more` : ""} couldn&apos;t load, so past days use the price you bought at. Today&apos;s figures are
          unaffected. Reload to try again.
        </p>
      )}
    </section>
  );
}

function XLabels({ points, x, height, width, active }: { points: DayValue[]; x: (i: number) => number; height: number; width: number; active: number }) {
  const n = points.length;
  // About one label per 80px, so they never run together on a phone.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 80))));
  return (
    <g>
      {points.map((d, i) => {
        const show = i === n - 1 || (i % every === 0 && x(n - 1) - x(i) > 56);
        if (!show) return null;
        return (
          <text
            key={d.ts}
            x={x(i)}
            y={height - 6}
            textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
            className={`text-[11px] ${i === active ? "fill-ink font-semibold" : "fill-ink-3"}`}
          >
            {i === n - 1 ? "Today" : day(d.ts)}
          </text>
        );
      })}
    </g>
  );
}

function EmptyHistory() {
  return (
    <div className="absolute inset-0 top-2 grid place-items-center rounded-2xl bg-sunken/60 px-6 text-center ring-1 ring-line">
      <div className="max-w-[340px]">
        <p className="text-sm font-semibold">Your chart starts today</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Folio only draws real history, from the day you added each holding or its buy date. The river grows a little every day.</p>
      </div>
    </div>
  );
}
