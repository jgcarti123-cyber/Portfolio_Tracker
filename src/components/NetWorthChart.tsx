"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CASH_COLOR } from "@/lib/cash";
import { compact, day, money, pct, signed } from "@/lib/format";
import type { DayValue } from "@/lib/networth";
import type { Totals } from "@/lib/portfolio";
import type { Today } from "@/lib/today";
import { CLASS_META, type AssetClass, type Currency } from "@/lib/types";
import { MOOD_FOR, MOOD_NAME, moodChange, moodColor, moodExplain, moodPosition, moodStamp, type MoodReading } from "@/lib/mood";
import { MoodGauge } from "./MoodStrip";
import { Segmented } from "./ui";

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

const CHART_H = 180;
const PAD = { top: 12, bottom: 26, right: 52 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Counts up from zero the first time, then glides between values. */
function useCountUp(target: number, ms = 1100) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const v = origin + (target - origin) * (1 - Math.pow(1 - p, 4));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
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

/** A money figure set large: a small, quiet currency sign and light digits. */
export function BigMoney({ value, currency }: { value: number; currency: Currency }) {
  const text = money(value, currency, { decimals: 0 });
  const sign = text.match(/^-?[^\d-]+/)?.[0] ?? "";
  const digits = text.slice(sign.length);
  return (
    <span className="num inline-flex items-start leading-none tracking-[-0.04em]" aria-label={text}>
      <span className="mr-1.5 mt-[0.16em] text-[0.42em] font-normal opacity-55">{sign.replace("-", "")}</span>
      <span className="font-light">
        {value < 0 ? "−" : ""}
        {digits}
      </span>
    </span>
  );
}

/**
 * The dashboard hero: net worth set large over a faint glow of the unlock panorama, with
 * the river of asset types drawn as light trails. Hovering scrubs through the days.
 */
export function NetWorthChart({
  series,
  totals,
  currency,
  loading,
  today,
  filtered,
  missingHistory,
  moods = [],
  classes = [],
}: {
  series: DayValue[];
  totals: Totals;
  currency: Currency;
  loading: boolean;
  today: Today;
  filtered: boolean;
  /** Holdings whose price history couldn't be loaded. */
  missingHistory: string[];
  /** Market mood readings, shown along the bottom for the markets you hold. */
  moods?: MoodReading[];
  classes?: AssetClass[];
}) {
  const moodKeys = (["crypto", "india", "us"] as const).filter((k) => classes.some((c) => MOOD_FOR[c] === k));
  const [mode, setMode] = useState<Mode>("amount");
  const [span, setSpan] = useState<Span>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();
  const shownTotal = useCountUp(totals.value);

  const points = useMemo(() => {
    const want = SPAN_DAYS[span] === Infinity ? series.length : SPAN_DAYS[span];
    return series.slice(-Math.min(series.length, want));
  }, [series, span]);
  const n = points.length;
  const present = LAYERS.filter((k) => points.some((d) => layerVal(d, k) > 0));
  const hovering = hover !== null && hover < n;
  const active = hovering ? hover : n - 1;
  const historyShort = series.length < 2;

  const plotW = Math.max(0, W - PAD.right);
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const x = (i: number) => (n <= 1 ? plotW : (i / (n - 1)) * plotW);
  const maxV = niceMax(Math.max(1, ...points.map((d) => Math.max(d.value, d.invested))) * 1.06);
  const y = mode === "mix" ? (f: number) => base - f * plotH : (v: number) => base - (v / maxV) * plotH;
  const xs = points.map((_, i) => x(i));

  const stacks = useMemo(() => {
    const lower = points.map(() => 0);
    return present.map((k) => {
      const lo = [...lower];
      const hi = points.map((d, i) => {
        lower[i] += mode === "mix" ? (d.value > 0 ? layerVal(d, k) / d.value : 0) : layerVal(d, k);
        return lower[i];
      });
      return { k, lo, hi };
    });
  }, [points, present, mode]);
  // A day with nothing held has no mix: in "%" it's a gap, not a dip to zero.
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

  const rangeChange = n > 1 ? points[n - 1].value - points[0].value : 0;
  const rangeMarket = points.slice(1).reduce((acc, d, i) => acc + (i === n - 2 ? today.total : d.move), 0);
  const rangeAdded = rangeChange - rangeMarket;
  const todayPct = today.base > 0 ? (today.total / today.base) * 100 : 0;
  const a = points[active];
  const ticks = mode === "mix" ? [0, 0.5, 1] : [0, maxV / 2, maxV];
  const heroValue = hovering && a ? a.value : shownTotal;
  const heroGain = hovering && a ? a.value - a.invested : totals.gain;
  const heroCost = hovering && a ? a.invested : totals.cost;

  function pick(clientX: number, rect: DOMRect) {
    const px = clientX - rect.left;
    if (px < 0 || px > plotW + 8 || n < 2) return setHover(null);
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  }

  return (
    <section className="scope-dark relative isolate overflow-hidden rounded-[22px] border border-white/10 bg-[#07080a] px-6 pb-5 pt-5 text-ink shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)] sm:px-8 sm:pb-6 sm:pt-6">
      {/* The unlock panorama, glowing faintly behind */}
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative backdrop, already cached from the unlock page */}
      <img src="/unlock/panorama.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-[0.38]" style={{ objectPosition: "16% 58%" }} />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(7,8,10,0.94)_0%,rgba(7,8,10,0.72)_45%,rgba(7,8,10,0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-[#07080a] to-transparent" />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="size-[6px] rounded-full bg-up shadow-[0_0_10px_var(--up)]" aria-hidden />
          <h2 className="label text-[11.5px] text-white/75">Net worth</h2>
          {filtered && <span className="label rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent-ink">Filtered</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented
            options={[
              { value: "amount", label: currency === "INR" ? "₹" : "$" },
              { value: "mix", label: "%" },
            ]}
            value={mode}
            onChange={(m) => (setHover(null), setMode(m))}
            label="Show"
            size="sm"
          />
          <Segmented options={SPANS} value={span} onChange={(s) => (setHover(null), setSpan(s))} label="Time range" size="sm" />
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="label mb-2 h-3 text-[10px] text-white/40">{hovering && a ? (active === n - 1 ? "Today" : day(a.ts, true)) : " "}</p>
          <p className="text-[46px] text-white sm:text-[62px]">
            <BigMoney value={heroValue} currency={currency} />
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className={`num inline-flex items-center gap-1.5 text-[14px] font-semibold ${today.total < 0 ? "text-down" : today.total > 0 ? "text-up" : "text-white/70"}`}>
              <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={today.total < 0 ? "rotate-180" : ""}>
                <path d="M5 1.5 9 8H1z" fill="currentColor" />
              </svg>
              {signed(today.total, currency)} · {pct(todayPct)} <span className="label ml-1 text-[10px] text-white/45">today</span>
            </span>
            <Stat label={hovering ? "Invested then" : "Invested"} value={money(heroCost, currency, { decimals: 0 })} />
            <Stat label="Return" value={`${signed(heroGain, currency)} (${pct(heroCost > 0 ? (heroGain / heroCost) * 100 : 0)})`} tone={heroGain} />
          </div>
        </div>
        {!historyShort && n > 1 && (
          <dl className="grid w-full grid-cols-3 gap-x-3 gap-y-1 sm:w-auto sm:shrink-0 sm:gap-x-6 lg:grid-cols-1 lg:text-right">
            <Period label={SPAN_WORD[span]} value={signed(rangeChange, currency)} tone={rangeChange} />
            <Period label="From the market" value={signed(rangeMarket, currency)} tone={rangeMarket} />
            <Period label="Added by you" value={signed(rangeAdded, currency)} />
          </dl>
        )}
      </div>

      <div
        ref={ref}
        className="relative mt-4 touch-pan-y"
        style={{ height: CHART_H }}
        role="img"
        aria-label={`Net worth by asset type, ${SPAN_WORD[span].toLowerCase()}. Hover to read each day.`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        {loading && !series.length ? (
          <div className="absolute inset-0 animate-pulse rounded-2xl bg-white/[0.04]" />
        ) : historyShort ? (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-white/[0.03] px-6 text-center ring-1 ring-white/10">
            <div className="max-w-[340px]">
              <p className="text-sm font-semibold">Your river starts today</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/60">Folio only draws real history. A little more of it appears every day.</p>
            </div>
          </div>
        ) : (
          W > 0 && (
            <svg width={W} height={CHART_H} className="absolute inset-0 block overflow-visible" key={`${mode}-${span}`}>
              <defs>
                <filter id="trail-glow" x="-5%" y="-40%" width="110%" height="180%">
                  <feGaussianBlur stdDeviation="3.2" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {present.map((k) => (
                  <linearGradient key={k} id={`trail-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={layerColor(k)} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={layerColor(k)} stopOpacity={0.08} />
                  </linearGradient>
                ))}
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" strokeDasharray={t === 0 ? undefined : "1 6"} />
                  <text x={W} y={y(t) + 4} textAnchor="end" className="num fill-white/35 text-[10.5px]">
                    {mode === "mix" ? `${Math.round(t * 100)}%` : compact(t, currency)}
                  </text>
                </g>
              ))}
              <g className="fade-in">
                {stacks.map(({ k, lo, hi }) => (
                  <g key={k}>
                    {runs.map((run) => {
                      const rx = run.map((i) => xs[i]);
                      const px = rx.length === 1 ? [rx[0] - 3, rx[0] + 3] : rx;
                      const ph = rx.length === 1 ? [hi[run[0]], hi[run[0]]] : run.map((i) => hi[i]);
                      const pl = rx.length === 1 ? [lo[run[0]], lo[run[0]]] : run.map((i) => lo[i]);
                      const top = monotone(px, ph.map(y));
                      const bottom = monotone([...px].reverse(), [...pl].reverse().map(y), false);
                      return (
                        <g key={run[0]}>
                          <path d={`${top}${bottom}Z`} fill={`url(#trail-${k})`} />
                          {/* The bright edge of each layer, glowing like a light trail */}
                          <path d={top} fill="none" stroke={layerColor(k)} strokeWidth={1.6} filter="url(#trail-glow)" pathLength={1} className="draw" />
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
                    points.map((d) => y(d.invested)),
                  )}
                  fill="none"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth={1.2}
                  strokeDasharray="3 5"
                />
              )}
              {hovering && (
                <g>
                  <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={base} stroke="rgba(255,255,255,0.35)" />
                  {stacks.map(({ k, hi }) => (
                    <circle key={k} cx={x(active)} cy={y(hi[active])} r={4} fill={layerColor(k)} stroke="#07080a" strokeWidth={2} style={{ filter: `drop-shadow(0 0 6px ${layerColor(k)})` }} />
                  ))}
                </g>
              )}
              {points.map((d, i) => {
                const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));
                const show = i === n - 1 || (i % every === 0 && x(n - 1) - x(i) > 90);
                if (!show) return null;
                return (
                  <text key={d.ts} x={x(i)} y={CHART_H - 6} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} className="label fill-white/35 text-[9.5px]">
                    {i === n - 1 ? "Today" : day(d.ts)}
                  </text>
                );
              })}
            </svg>
          )
        )}
      </div>

      {!historyShort && a && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {[...present].reverse().map((k) => {
            const v = layerVal(a, k);
            return (
              <span key={k} className="flex items-center gap-2 text-[12px] text-white/55">
                <span className="h-[3px] w-4 rounded-full" style={{ background: layerColor(k), boxShadow: `0 0 8px ${layerColor(k)}` }} />
                {layerLabel(k)}
                <b className="num font-semibold text-white/90">{mode === "mix" ? `${a.value > 0 ? Math.round((v / a.value) * 100) : 0}%` : compact(v, currency)}</b>
              </span>
            );
          })}
          {mode === "amount" && (
            <span className="flex items-center gap-2 text-[12px] text-white/55">
              <span className="w-4 border-t border-dashed border-white/50" />
              Invested <b className="num font-semibold text-white/90">{compact(a.invested, currency)}</b>
            </span>
          )}
        </div>
      )}

      {moodKeys.length > 0 && (
        <div className={`mt-4 grid grid-cols-1 gap-3 border-t border-white/10 pt-4 ${moodKeys.length === 3 ? "md:grid-cols-3" : moodKeys.length === 2 ? "md:grid-cols-2" : ""} md:gap-0 md:divide-x md:divide-white/10`}>
          {moodKeys.map((k, i) => {
            const r = moods.find((x) => x.key === k);
            const yours = today.byClass.filter((c) => MOOD_FOR[c.cls] === k).reduce((acc, c) => acc + c.total, 0);
            const pos = r ? moodPosition(r) : 0.5;
            const stamp = r ? moodStamp(r) : null;
            const changes = r ? ([[moodChange(r, r.weekAgo), "7d"], [moodChange(r, r.monthAgo), "30d"]] as const).filter(([c]) => c) : [];
            return (
              <div key={k} className={`flex items-center gap-3 ${i ? "md:pl-5" : ""} ${i < moodKeys.length - 1 ? "md:pr-5" : ""}`} title={r ? moodExplain(r) : undefined}>
                {r ? (
                  <span className={stamp?.stale ? "opacity-55 saturate-[0.6]" : ""}>
                    <MoodGauge reading={r} size={44} />
                  </span>
                ) : (
                  <span className="size-[44px]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="label truncate text-[9.5px] text-white/45">
                    {MOOD_NAME[k]} mood{r?.scale === "vix" ? " · VIX" : ""}
                  </p>
                  {r ? (
                    <p className="mt-0.5 flex items-baseline gap-2 whitespace-nowrap">
                      <span className="num text-[18px] font-light leading-none">{r.value}</span>
                      <span className="text-[12px] font-semibold" style={{ color: moodColor(pos) }}>
                        {r.label}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-white/45">Unavailable</p>
                  )}
                  {stamp && (
                    <p className="num mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-white/40">
                      <span className={`shrink-0 rounded-full px-1.5 text-[8.5px] font-semibold uppercase leading-[1.6] tracking-[0.1em] ${stamp.stale ? "bg-white/[0.07] text-white/45" : "bg-up/15 text-up"}`}>{stamp.text}</span>
                      <span className="truncate">
                        {changes.map(([c, span], j) => (
                          <span key={span}>
                            {j > 0 && " · "}
                            {span} <span className={c!.size === 0 ? "" : c!.fearer ? "text-down" : "text-up"}>{c!.delta > 0 ? "▲" : c!.delta < 0 ? "▼" : "•"}{c!.size}</span>
                          </span>
                        ))}
                      </span>
                    </p>
                  )}
                </div>
                {!today.byClass.some((c) => MOOD_FOR[c.cls] === k) && today.closed.some((c) => MOOD_FOR[c] === k) ? (
                  // Your holdings in this market haven't traded today: nothing of yours moved.
                  <span className="shrink-0 text-right text-[12px] font-semibold text-white/50">
                    Closed
                    <span className="label block text-[8.5px] font-normal text-white/35">today</span>
                  </span>
                ) : (
                  <span className={`num shrink-0 text-right text-[12.5px] font-semibold ${yours < 0 ? "text-down" : yours > 0 ? "text-up" : "text-white/60"}`}>
                    {signed(yours, currency)}
                    <span className="label block text-[8.5px] font-normal text-white/35">yours today</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {missingHistory.length > 0 && (
        <p className="mt-3 rounded-xl bg-down-soft/40 px-3 py-2 text-xs text-white/70">
          Price history for {missingHistory.slice(0, 3).join(", ")}
          {missingHistory.length > 3 ? ` and ${missingHistory.length - 3} more` : ""} couldn&apos;t load, so past days use the price you bought at. Reload to try again.
        </p>
      )}
    </section>
  );
}

function Period({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate text-[9.5px] text-white/40">{label}</dt>
      <dd className={`num text-[13.5px] font-semibold ${tone === undefined || Math.abs(tone) < 1e-9 ? "text-white/85" : tone > 0 ? "text-up" : "text-down"}`}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="label text-[10px] text-white/40">{label}</span>
      <span className={`num text-[14px] font-semibold ${tone === undefined || Math.abs(tone) < 1e-9 ? "text-white/90" : tone > 0 ? "text-up" : "text-down"}`}>{value}</span>
    </span>
  );
}
