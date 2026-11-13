"use client";

import { CASH_COLOR } from "@/lib/cash";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compact, day, money, pct, signed } from "@/lib/format";
import type { DayValue } from "@/lib/networth";
import type { Totals } from "@/lib/portfolio";
import type { Today } from "@/lib/today";
import { CLASS_META, CLASS_ORDER, type Currency } from "@/lib/types";
import { Delta, Icon, IconTile, Segmented } from "./ui";

/** Stacking order for "By type": each asset type, then cash on top. */
const STACK = [...CLASS_ORDER, "cash"] as const;
type StackKey = (typeof STACK)[number];
const stackVal = (d: DayValue, k: StackKey) => (k === "cash" ? (d.cash ?? 0) : d.byClass[k]);
const stackColor = (k: StackKey) => (k === "cash" ? CASH_COLOR : CLASS_META[k].color);

type Mode = "value" | "stack" | "change";
type Span = "1W" | "1M" | "3M" | "1Y" | "ALL";
const SPAN_DAYS: Record<Span, number> = { "1W": 7, "1M": 30, "3M": 91, "1Y": 365, ALL: Infinity };
const SPANS = [
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
] as const;
const MODES = [
  { value: "value", label: "Value" },
  { value: "stack", label: "By type" },
  { value: "change", label: "Gain / loss" },
] as const;
const SPAN_WORD: Record<Span, string> = { "1W": "This week", "1M": "This month", "3M": "Last 3 months", "1Y": "This year", ALL: "Since tracking began" };

interface Bar {
  ts: number;
  from: number;
  end: DayValue;
  /** Market gain or loss over the bar's days. */
  move: number;
}

/** Daily columns up to a month, weekly up to ~4 months, monthly beyond. */
function toBars(points: DayValue[]): Bar[] {
  const step = points.length <= 31 ? 1 : points.length <= 120 ? 7 : 30;
  const out: Bar[] = [];
  for (let end = points.length; end > 0; end -= step) {
    const chunk = points.slice(Math.max(0, end - step), end);
    out.push({ ts: chunk[chunk.length - 1].ts, from: chunk[0].ts, end: chunk[chunk.length - 1], move: chunk.reduce((a, d) => a + d.move, 0) });
  }
  return out.reverse();
}

const MIN_H = 260;
const PAD = { top: 44, bottom: 26, right: 54 };

function niceStep(range: number, count: number) {
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function niceDomain(lo: number, hi: number, count = 2): { lo: number; hi: number; ticks: number[] } {
  if (hi - lo < 1e-9) {
    const pad = Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(v);
  return { lo: a, hi: b, ticks };
}

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

/** Column with its data end fully rounded (top for gains, bottom for losses). */
function column(x: number, y0: number, y1: number, w: number) {
  const top = Math.min(y0, y1);
  const h = Math.max(Math.abs(y1 - y0), 1);
  const r = Math.min(w / 2, h, 6);
  if (y1 <= y0) return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
  return `M${x},${top}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + w - r}Q${x + w},${top + h} ${x + w},${top + h - r}V${top}Z`;
}

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
  const [mode, setMode] = useState<Mode>("value");
  const [span, setSpan] = useState<Span>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, size] = useSize<HTMLDivElement>();
  const width = size.w;
  const H = Math.max(MIN_H, size.h);

  // Today's column uses the same exact figure as the headline.
  const points = useMemo(() => {
    const want = SPAN_DAYS[span] === Infinity ? series.length : SPAN_DAYS[span];
    let list = series.slice(-Math.min(series.length, want));
    if (!list.length) return list;
    // Days before the first holding: empty, drawn as dots so the range keeps its shape.
    if (list.length < want) {
      const first = list[0];
      const empty = Array.from({ length: want - list.length }, (_, k) => ({
        ts: first.ts - (want - list.length - k) * 86_400_000,
        value: 0,
        invested: 0,
        move: 0,
        byClass: Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as DayValue["byClass"],
        cash: 0,
      }));
      list = [...empty, ...list];
    }
    const last = list[list.length - 1];
    return [...list.slice(0, -1), { ...last, move: today.total }];
  }, [series, span, today.total]);
  const bars = useMemo(() => toBars(points), [points]);
  const n = bars.length;
  const active = hover !== null && hover < n ? hover : n - 1;
  const hovering = hover !== null && hover < n;

  const plotW = Math.max(0, width - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const historyShort = series.length < 2;

  // The visible range in three parts that always add up (chart's own daily figures).
  const raw = series.slice(-points.length);
  const rangeChange = points.length > 1 ? points[points.length - 1].value - points[0].value : 0;
  const rangeMarket = raw.slice(1).reduce((a, d) => a + d.move, 0);
  const rangeAdded = rangeChange - rangeMarket;

  function pick(clientX: number, rect: DOMRect) {
    const x = clientX - rect.left;
    if (x < 0 || x > plotW || !n) return setHover(null);
    setHover(Math.min(n - 1, Math.floor((x / plotW) * n)));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(n - 1, active + (e.key === "ArrowLeft" ? -1 : 1))));
  }

  const slot = n ? plotW / n : 0;
  const bw = Math.max(4, Math.min(slot * 0.46, 16));
  const bx = (i: number) => i * slot + (slot - bw) / 2;
  const cx = (i: number) => bx(i) + bw / 2;
  const dim = (i: number) => (i === active ? 1 : hovering ? 0.45 : 0.9);

  let body: ReactNode = null;
  let tag: { x: number; y: number; title: string; value: string; note?: ReactNode } | null = null;
  const when = (b: Bar, i: number) =>
    i === n - 1 ? (b.from === b.ts ? "Today" : `${day(b.from)} – today`) : b.from === b.ts ? day(b.ts, true) : `${day(b.from)} – ${day(b.ts)}`;

  if (!historyShort && width > 0 && n) {
    if (mode === "value" || mode === "stack") {
      const dom = niceDomain(0, Math.max(...bars.map((b) => b.end.value), 1));
      const y = (v: number) => base - (v / dom.hi) * plotH;
      const a = bars[active];
      body = (
        <>
          <Grid ticks={dom.ticks} y={y} plotW={plotW} width={width} currency={currency} />
          {bars.map((b, i) => {
            if (b.end.value <= 0)
              return <circle key={b.ts} cx={cx(i)} cy={base - 2} r={1.6} fill="var(--ink-3)" opacity={0.45} />;
            if (mode === "value")
              return (
                <path
                  key={b.ts}
                  d={column(bx(i), base, y(b.end.value), bw)}
                  fill={i === active ? "url(#nw-solid)" : "url(#nw-stripe)"}
                  opacity={dim(i)}
                  className="bar-rise"
                  style={{ animationDelay: `${i * 12}ms`, transition: "opacity .2s" }}
                />
              );
            const segs = STACK.filter((c) => stackVal(b.end, c) > 0);
            let acc = 0;
            return (
              <g key={b.ts} className="bar-rise" style={{ animationDelay: `${i * 12}ms`, transition: "opacity .2s" }} opacity={i === active ? 1 : hovering ? 0.35 : 0.85}>
                {segs.map((c, k) => {
                  const v = stackVal(b.end, c);
                  const y0 = y(acc) - (k ? 2 : 0); // 2px surface gap between segments
                  const y1 = y(acc + v);
                  acc += v;
                  return k === segs.length - 1 ? (
                    <path key={c} d={column(bx(i), y0, Math.min(y1, y0 - 1), bw)} fill={stackColor(c)} />
                  ) : (
                    <rect key={c} x={bx(i)} y={y1} width={bw} height={Math.max(1, y0 - y1)} fill={stackColor(c)} />
                  );
                })}
              </g>
            );
          })}
          {hovering && a.end.value > 0 && (
            <line x1={0} x2={plotW} y1={y(a.end.value)} y2={y(a.end.value)} stroke="var(--accent)" strokeOpacity={0.55} strokeDasharray="3 4" />
          )}
        </>
      );
      const gain = a.end.value - a.end.invested;
      tag = {
        x: cx(active),
        y: a.end.value > 0 ? y(a.end.value) : base,
        title: when(a, active),
        value: money(a.end.value, currency, { decimals: 0 }),
        note: a.end.value > 0 && mode === "value" ? <span className={gain >= 0 ? "text-[#5fdc9a]" : "text-[#ff8a92]"}>{signed(gain, currency)} gain</span> : undefined,
      };
    } else {
      const moves = bars.map((b) => b.move);
      const dom = niceDomain(Math.min(0, ...moves), Math.max(0, ...moves), 3);
      const y = (v: number) => base - ((v - dom.lo) / (dom.hi - dom.lo)) * plotH;
      body = (
        <>
          <Grid ticks={dom.ticks} y={y} plotW={plotW} width={width} currency={currency} signedTicks />
          <line x1={0} x2={plotW} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeOpacity={0.45} />
          {bars.map((b, i) => {
            const up = b.move >= 0;
            const flat = Math.abs(y(b.move) - y(0)) < 1.5;
            if (flat) return <circle key={b.ts} cx={cx(i)} cy={y(0)} r={1.6} fill="var(--ink-3)" opacity={0.5} />;
            return (
              <path
                key={b.ts}
                d={column(bx(i), y(0), y(b.move), bw)}
                fill={i === active ? (up ? "var(--up)" : "var(--down)") : up ? "url(#nw-stripe-up)" : "url(#nw-stripe-down)"}
                opacity={dim(i)}
                className="bar-rise"
                style={{ animationDelay: `${i * 12}ms`, transformOrigin: up ? "bottom" : "top", transition: "opacity .2s" }}
              />
            );
          })}
        </>
      );
      const a = bars[active];
      tag = {
        x: cx(active),
        y: Math.min(y(a.move), y(0)),
        title: when(a, active),
        value: signed(a.move, currency),
        note: <span className="text-white/60">market {a.move >= 0 ? "gain" : "loss"}</span>,
      };
    }
  }

  const todayPct = today.base > 0 ? (today.total / today.base) * 100 : 0;

  return (
    <section className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconTile color="var(--cat-3)">{Icon.wallet}</IconTile>
          <h2 className="text-[15px] font-semibold">Net worth</h2>
          {filtered && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Filtered</span>}
        </div>
        <Segmented options={MODES} value={mode} onChange={(m) => (setHover(null), setMode(m))} label="Chart" size="sm" />
      </header>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="num text-[30px] font-extrabold leading-none tracking-[-0.025em] sm:text-[34px]">{money(totals.value, currency, { decimals: 0 })}</p>
          <Delta value={today.total}>
            {signed(today.total, currency)} ({pct(todayPct)}) today
          </Delta>
        </div>
        <dl className="num flex gap-5 text-right text-[13px]">
          <div>
            <dt className="text-[11px] text-ink-3">Invested</dt>
            <dd className="font-bold">{money(totals.cost, currency, { decimals: 0 })}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-3">Total return</dt>
            <dd className={`font-bold ${totals.gain < 0 ? "text-down" : totals.gain > 0 ? "text-up" : ""}`}>
              {signed(totals.gain, currency)} <span className="text-[11px] font-semibold">{pct(totals.cost > 0 ? (totals.gain / totals.cost) * 100 : 0)}</span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Legend mode={mode} bar={bars[active]} currency={currency} />
        <Segmented options={SPANS} value={span} onChange={(s) => (setHover(null), setSpan(s))} label="Time range" size="sm" />
      </div>

      <div
        ref={ref}
        className="relative mt-2 min-h-[260px] flex-1 touch-pan-y outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Net worth, ${MODES.find((m) => m.value === mode)!.label.toLowerCase()}, ${SPAN_WORD[span].toLowerCase()}. Use the arrow keys to read each column.`}
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
          <>
            <svg width={width} height={H} className="absolute inset-0 block overflow-visible" key={`${mode}-${span}`}>
              <defs>
                <pattern id="nw-stripe" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--accent-soft)" />
                  <rect width="2" height="5" fill="var(--accent)" opacity="0.45" />
                </pattern>
                <pattern id="nw-stripe-up" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--up-soft)" />
                  <rect width="2" height="5" fill="var(--up)" opacity="0.55" />
                </pattern>
                <pattern id="nw-stripe-down" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--down-soft)" />
                  <rect width="2" height="5" fill="var(--down)" opacity="0.55" />
                </pattern>
                <linearGradient id="nw-solid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.75" />
                </linearGradient>
              </defs>
              {body}
              <XLabels n={n} at={cx} ts={(i) => bars[i].ts} width={width} height={H} active={active} />
            </svg>
            {tag && hovering && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-center text-white shadow-pop transition-[left,top] duration-150 ease-out"
                style={{
                  background: "var(--tip)",
                  left: Math.max(56, Math.min(tag.x, plotW - 56)),
                  top: Math.max(0, tag.y - 52),
                  transform: "translateX(-50%)",
                }}
              >
                <p className="text-[10px] font-medium text-white/60">{tag.title}</p>
                <p className="num text-[13px] font-bold leading-tight">{tag.value}</p>
                {tag.note && <p className="num text-[10px] font-semibold">{tag.note}</p>}
              </div>
            )}
          </>
        )}
      </div>

      {!historyShort && points.length > 1 && (
        <p className="num mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3.5 text-xs text-ink-3">
          <span>
            {SPAN_WORD[span]} <b className={`font-bold ${rangeChange >= 0 ? "text-up" : "text-down"}`}>{signed(rangeChange, currency)}</b>
          </span>
          <span>
            from the market <b className={`font-bold ${rangeMarket >= 0 ? "text-up" : "text-down"}`}>{signed(rangeMarket, currency)}</b>
          </span>
          <span title="Value of holdings you added, minus anything you sold">
            added by you <b className="font-bold text-ink">{signed(rangeAdded, currency)}</b>
          </span>
        </p>
      )}
      {missingHistory.length > 0 && (
        <p className="mt-3 rounded-xl bg-down-soft/60 px-3 py-2 text-xs text-ink-2">
          Price history for {missingHistory.slice(0, 3).join(", ")}
          {missingHistory.length > 3 ? ` and ${missingHistory.length - 3} more` : ""} couldn&apos;t load, so past days use the price you bought at. Today&apos;s figures are
          unaffected. Reload to try again.
        </p>
      )}
      {!historyShort && series.length < SPAN_DAYS[span] && span !== "ALL" && (
        <p className="mt-2 text-xs text-ink-3">
          Dots are days before your earliest holding ({day(series[0].ts, true)}). Holdings without a buy date count from the day you added them.
        </p>
      )}
    </section>
  );
}

function Grid({ ticks, y, plotW, width, currency, signedTicks }: { ticks: number[]; y: (v: number) => number; plotW: number; width: number; currency: Currency; signedTicks?: boolean }) {
  return (
    <g>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : "2 5"} />
          <text x={width} y={y(v) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
            {signedTicks && v > 0 ? "+" : ""}
            {compact(v, currency)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ n, at, ts, width, height, active }: { n: number; at: (i: number) => number; ts: (i: number) => number; width: number; height: number; active: number }) {
  const every = Math.max(1, Math.ceil(n / (width < 520 ? 4 : 7)));
  return (
    <g>
      {Array.from({ length: n }, (_, i) => i)
        .filter((i) => i === n - 1 || (n - 1 - i) % every === 0)
        .filter((i) => i === n - 1 || at(n - 1) - at(i) > 44)
        .map((i) => (
          <text
            key={i}
            x={at(i)}
            y={height - 6}
            textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
            dx={i === n - 1 ? 8 : 0}
            className={`text-[11px] ${i === active ? "fill-ink font-semibold" : "fill-ink-3"}`}
          >
            {i === n - 1 ? "Today" : day(ts(i))}
          </text>
        ))}
    </g>
  );
}

/** Legend that doubles as a readout for the column under the cursor. */
function Legend({ mode, bar, currency }: { mode: Mode; bar: Bar | undefined; currency: Currency }) {
  const box = (c: string) => <span className="size-2.5 rounded-[3px]" style={{ background: c }} />;
  const item = (key: string, swatch: ReactNode, label: string, value?: string) => (
    <span key={key} className="flex items-center gap-1.5 text-xs text-ink-2">
      {swatch}
      {label}
      {value && <b className="num font-semibold text-ink">{value}</b>}
    </span>
  );
  if (mode === "value")
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {item("nw", <span className="size-2.5 rounded-[3px] bg-[repeating-linear-gradient(45deg,var(--accent)_0_1.5px,var(--accent-soft)_1.5px_3.5px)]" />, "Net worth at close")}
        {bar && item("inv", box("var(--ink-3)"), "Invested", money(bar.end.invested, currency, { decimals: 0 }))}
      </div>
    );
  if (mode === "change")
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {item("g", box("var(--up)"), "Market gain")}
        {item("l", box("var(--down)"), "Market loss")}
        <span className="text-xs text-ink-3">New money not counted</span>
      </div>
    );
  const present = STACK.filter((c) => (bar ? stackVal(bar.end, c) : 0) > 0);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {present.map((c) => item(c, box(stackColor(c)), c === "cash" ? "Cash" : CLASS_META[c].label, compact(stackVal(bar!.end, c), currency)))}
    </div>
  );
}

function EmptyHistory() {
  return (
    <div className="absolute inset-0 top-2 grid place-items-center rounded-2xl bg-sunken/60 px-6 text-center ring-1 ring-line">
      <div className="max-w-[340px]">
        <svg width="120" height="40" viewBox="0 0 120 40" className="mx-auto" aria-hidden>
          {Array.from({ length: 11 }, (_, i) => (
            <circle key={i} cx={6 + i * 10} cy={34} r={1.8} fill="var(--ink-3)" opacity={0.4} />
          ))}
          <rect x="108" y="6" width="9" height="30" rx="4.5" fill="var(--accent)" />
        </svg>
        <p className="mt-3 text-sm font-semibold">Your chart starts today</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Folio only draws real history, from the day you added each holding or its buy date. A new column appears every day.
        </p>
      </div>
    </div>
  );
}
