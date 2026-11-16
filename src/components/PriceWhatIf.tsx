"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money, pct, price as fmtPrice, qty, signed } from "@/lib/format";
import type { Position } from "@/lib/portfolio";
import { fetchHistory } from "@/lib/prices";
import type { Asset, Candle, Currency } from "@/lib/types";
import { BigFigure, useAnimatedNumber, useWidth } from "./ui";

const CURVE_H = 124;
const TAG = { fontSize: 8.5, fontWeight: 600, letterSpacing: "0.14em" } as const;
const PAD_T = 18;
const PAD_B = 22;

/** A price as typed into a field: no grouping, enough decimals for its size. */
function plain(n: number) {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1) return n.toFixed(2);
  return String(Number(n.toFixed(n >= 0.01 ? 4 : 8)));
}
const plainPct = (p: number) => (Math.abs(p) < 0.005 ? "0.00" : `${p > 0 ? "+" : ""}${p.toFixed(2)}`);

/** The price span the curve covers: around today's price and break-even, stretched to fit a typed target. */
function span(now: number, avg: number, extent: number): [number, number] {
  let lo = Math.min(now, avg) * 0.5;
  let hi = Math.max(now, avg) * 1.6;
  if (extent > hi) hi = extent * 1.15;
  if (extent < lo) lo = extent * 0.85;
  return [Math.max(0, lo), hi];
}

/**
 * Type a future price or a % move and see the profit or loss on your holding there. A profit
 * line (red below break-even, green above) can be dragged to try prices; the past year's
 * prices put the target in context.
 */
export function PriceWhatIf({ asset, position, cur, unit }: { asset: Asset; position: Position; cur: Currency; unit: string }) {
  const now = position.price!;
  const avg = position.avgPrice;
  const [target, setTarget] = useState(now);
  const [extent, setExtent] = useState(now);
  const [draft, setDraft] = useState<{ field: "price" | "pct"; text: string } | null>(null);
  const [year, setYear] = useState<Candle[] | null>(null);
  const ids = useId();
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!asset.symbol) return;
    const ctrl = new AbortController();
    fetchHistory(asset, "1Y", true, ctrl.signal)
      .then((c) => setYear(c.length > 20 ? c : null))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.symbol]);

  const yearHigh = year ? Math.max(...year.map((c) => c.h)) : null;
  const yearLow = year ? Math.min(...year.map((c) => c.l)) : null;

  /** Set from a field or a chip: the curve's span stretches to show it. */
  function choose(p: number) {
    const v = Math.max(0, p);
    setTarget(v);
    setExtent(v);
  }

  const value = position.qty * target;
  const gain = value - position.cost;
  const gainPct = position.cost > 0 ? (gain / position.cost) * 100 : 0;
  const vsToday = position.qty * (target - now);
  const move = (target / now - 1) * 100;
  const moved = Math.abs(target - now) > now * 1e-6;
  const shownGain = useAnimatedNumber(gain, 200);
  const shownValue = useAnimatedNumber(value, 200);
  const shownVsToday = useAnimatedNumber(vsToday, 200);

  const priceText = draft?.field === "price" ? draft.text : plain(target);
  const pctText = draft?.field === "pct" ? draft.text : plainPct(move);

  function onPrice(raw: string) {
    const text = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setDraft({ field: "price", text });
    const n = Number(text);
    if (text !== "" && isFinite(n)) choose(n);
  }
  function onPct(raw: string) {
    const text = raw.replace(/[^0-9.+-]/g, "").replace(/(?!^)[+-]/g, "").replace(/(\..*)\./g, "$1");
    setDraft({ field: "pct", text });
    const n = Number(text);
    if (text !== "" && text !== "-" && text !== "+" && isFinite(n)) choose(now * (1 + Math.max(-100, n) / 100));
  }
  /** Arrow keys nudge: 1% of today's price (10% with Shift). */
  function nudge(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    setDraft(null);
    const step = (e.shiftKey ? 0.1 : 0.01) * now * (e.key === "ArrowUp" ? 1 : -1);
    choose(target + step);
  }

  const near = (v: number) => Math.abs(target - v) < Math.max(now * 1e-4, 1e-9);
  const moves = [-20, -10, 10, 25, 50];
  const levels = [
    Math.abs(avg - now) > now * 1e-3 ? { label: "Break-even", v: avg } : null,
    yearLow !== null ? { label: "1Y low", v: yearLow } : null,
    yearHigh !== null ? { label: "1Y high", v: yearHigh } : null,
  ].filter((x): x is { label: string; v: number } => !!x);

  const context = useMemo(() => {
    if (!moved || !year || yearHigh === null || yearLow === null) return null;
    if (target > yearHigh) return `Above its 1-year high of ${fmtPrice(yearHigh, cur)}; it hasn't traded this high in the past year.`;
    if (target < yearLow) return `Below its 1-year low of ${fmtPrice(yearLow, cur)}; it hasn't traded this low in the past year.`;
    for (let i = year.length - 1; i >= 0; i--) {
      const c = year[i];
      if (c.l <= target && target <= c.h) {
        const days = Math.round((mountedAt - c.t * 1000) / 86_400_000);
        if (days <= 1) return "It has traded at this price in the last day.";
        const d = new Date(c.t * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        return `It last traded at this price on ${d}, ${days} days ago.`;
      }
    }
    return null;
  }, [moved, year, yearHigh, yearLow, target, cur, mountedAt]);

  const toBreakEven = (avg / now - 1) * 100;
  const tone = Math.abs(gain) < 1e-9 ? "" : gain > 0 ? "text-up" : "text-down";

  return (
    <div className="fade-in flex min-h-full flex-col">
      {/* Linked fields: type either one and the other follows. */}
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2">
        <label htmlFor={`${ids}-price`} className="wi-field flex flex-col rounded-2xl px-3.5 pb-2.5 pt-2">
          <span className="label text-[9.5px] text-ink-3">Target price</span>
          <span className="mt-1 flex items-baseline gap-1">
            <span className="num text-[15px] text-ink-3">{cur === "INR" ? "₹" : "$"}</span>
            <input
              id={`${ids}-price`}
              inputMode="decimal"
              autoComplete="off"
              value={priceText}
              onChange={(e) => onPrice(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => setDraft(null)}
              onKeyDown={nudge}
              className="num w-full min-w-0 bg-transparent text-[20px] font-semibold tracking-tight outline-none"
            />
          </span>
        </label>
        <label htmlFor={`${ids}-pct`} className="wi-field flex flex-col rounded-2xl px-3.5 pb-2.5 pt-2">
          <span className="label text-[9.5px] text-ink-3">Move</span>
          <span className="mt-1 flex items-baseline gap-1">
            <input
              id={`${ids}-pct`}
              inputMode="decimal"
              autoComplete="off"
              value={pctText}
              onChange={(e) => onPct(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => setDraft(null)}
              onKeyDown={nudge}
              className={`num w-full min-w-0 bg-transparent text-[20px] font-semibold tracking-tight outline-none ${!moved ? "" : move > 0 ? "text-up" : "text-down"}`}
            />
            <span className="num text-[15px] text-ink-3">%</span>
          </span>
        </label>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {moves.map((m) => {
          const v = now * (1 + m / 100);
          return (
            <Chip key={m} on={near(v)} onClick={() => (setDraft(null), choose(v))}>
              {m > 0 ? "+" : "−"}
              {Math.abs(m)}%
            </Chip>
          );
        })}
        {levels.map((l) => (
          <Chip key={l.label} on={near(l.v)} onClick={() => (setDraft(null), choose(l.v))} title={fmtPrice(l.v, cur)}>
            {l.label}
          </Chip>
        ))}
        {moved && (
          <button type="button" onClick={() => (setDraft(null), choose(now))} className="pop-in rounded-full px-2 py-[5px] text-[11.5px] font-semibold text-ink-3 transition-colors hover:text-ink">
            Reset
          </button>
        )}
      </div>

      {/* The answer */}
      <div className="mt-4" aria-live="polite">
        <p className="label text-[9.5px] text-ink-3">
          {!moved ? "Your return at today's price" : gain >= 0 ? `Profit at ${fmtPrice(target, cur)}` : `Loss at ${fmtPrice(target, cur)}`}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <BigFigure text={signed(shownGain, cur)} className={`wi-glow text-[34px] ${tone}`} />
          <span className={`num text-[14px] font-semibold ${tone || "text-ink-2"}`}>{pct(gainPct)}</span>
        </div>
        <p className="mt-1 text-[12px] text-ink-3">on the {money(position.cost, cur)} you paid</p>
        <dl className="num mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
          <div className="bg-surface px-3.5 py-2.5">
            <dt className="text-[11px] text-ink-3">
              {qty(position.qty)} {unit} worth
            </dt>
            <dd className="mt-0.5 truncate text-[14px] font-semibold">{money(shownValue, cur)}</dd>
          </div>
          <div className="bg-surface px-3.5 py-2.5">
            <dt className="text-[11px] text-ink-3">Change from today</dt>
            <dd className={`mt-0.5 truncate text-[14px] font-semibold ${!moved ? "text-ink-3" : vsToday > 0 ? "text-up" : "text-down"}`}>{moved ? signed(shownVsToday, cur) : "–"}</dd>
          </div>
        </dl>
      </div>

      <ProfitCurve
        now={now}
        avg={avg}
        units={position.qty}
        cost={position.cost}
        target={target}
        extent={extent}
        cur={cur}
        onPick={(v) => (setDraft(null), setTarget(v))}
      />

      <div className="mt-auto space-y-1 pt-3 text-[11.5px] leading-relaxed text-ink-3">
        {context && <p className="fade-in text-ink-2">{context}</p>}
        <p>
          {Math.abs(toBreakEven) < 0.05
            ? `Today's price is right at your break-even (${fmtPrice(avg, cur)}).`
            : toBreakEven > 0
              ? `You break even at ${fmtPrice(avg, cur)}, ${pct(toBreakEven)} above today.`
              : `You're ${pct(-toBreakEven).replace("+", "")} above your break-even of ${fmtPrice(avg, cur)}.`}{" "}
          Before fees and tax; for exploring, not a prediction.
        </p>
      </div>
    </div>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-on={on}
      className={`pill press num rounded-full px-2.5 py-[5px] text-[11.5px] font-semibold ${on ? "" : "text-ink-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/**
 * Profit or loss (up the side) against price (along the bottom): a straight line through
 * break-even, red below it and green above. Press or drag anywhere to try a price; it snaps to
 * today's price and break-even when you pass close by.
 */
function ProfitCurve({
  now,
  avg,
  units,
  cost,
  target,
  extent,
  cur,
  onPick,
}: {
  now: number;
  avg: number;
  units: number;
  cost: number;
  target: number;
  extent: number;
  cur: Currency;
  onPick: (v: number) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [lo, hi] = span(now, avg, extent);
  const dragging = useRef(false);
  const gid = useId().replace(/:/g, "");
  const pnl = (p: number) => units * p - cost;
  const vMin = pnl(lo);
  const vMax = pnl(hi);
  const pad = (vMax - vMin) * 0.06;
  const x = (p: number) => ((p - lo) / (hi - lo)) * W;
  const y = (v: number) => PAD_T + (1 - (v - (vMin - pad)) / (vMax - vMin + 2 * pad)) * (CURVE_H - PAD_T - PAD_B);
  const zeroY = y(0);
  const beX = x(avg);
  const t = Math.min(hi, Math.max(lo, target));
  const tx = x(t);
  const ty = y(pnl(t));
  const nx = x(now);
  const up = target >= avg;

  function pick(clientX: number, el: Element) {
    const r = el.getBoundingClientRect();
    const px = Math.min(r.width, Math.max(0, clientX - r.left));
    const p = lo + (px / r.width) * (hi - lo);
    // Snap to today's price and break-even within 6px.
    for (const s of [now, avg]) if (Math.abs(x(s) - px) < 6) return onPick(s);
    onPick(p);
  }
  function key(e: React.KeyboardEvent) {
    const step = (e.shiftKey ? 0.05 : 0.005) * now;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onPick(Math.min(hi, target + step));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onPick(Math.max(lo, target - step));
    else if (e.key === "Home") onPick(now);
    else return;
    e.preventDefault();
  }

  const beFrac = Math.min(1, Math.max(0, beX / Math.max(W, 1)));
  const nowLabelBelow = Math.abs(nx - tx) < 34;

  return (
    <div ref={ref} className="relative mt-4">
      {W > 0 && (
        <svg
          width={W}
          height={CURVE_H}
          className="wi-curve block overflow-visible"
          role="slider"
          tabIndex={0}
          aria-label="Try a price on the profit line"
          aria-valuemin={lo}
          aria-valuemax={hi}
          aria-valuenow={target}
          aria-valuetext={fmtPrice(target, cur)}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e.clientX, e.currentTarget);
          }}
          onPointerMove={(e) => dragging.current && pick(e.clientX, e.currentTarget)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={key}
        >
          <defs>
            <linearGradient id={`${gid}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--down)" />
              <stop offset={beFrac} stopColor="var(--down)" />
              <stop offset={beFrac} stopColor="var(--up)" />
              <stop offset="1" stopColor="var(--up)" />
            </linearGradient>
            <linearGradient id={`${gid}-gain`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--up)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--up)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gid}-loss`} x1="0" x2="0" y1="1" y2="0">
              <stop offset="0" stopColor="var(--down)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--down)" stopOpacity="0" />
            </linearGradient>
            <filter id={`${gid}-glow`} x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Loss and profit areas between the line and break-even */}
          <path d={`M0 ${zeroY} L0 ${y(vMin)} L${beX} ${zeroY} Z`} fill={`url(#${gid}-loss)`} />
          <path d={`M${beX} ${zeroY} L${W} ${y(vMax)} L${W} ${zeroY} Z`} fill={`url(#${gid}-gain)`} />

          {/* The move from today to the target */}
          <rect x={Math.min(nx, tx)} y={PAD_T - 6} width={Math.abs(tx - nx)} height={CURVE_H - PAD_T - PAD_B + 6} fill="var(--ink)" opacity="0.05" rx="4" />

          {/* Break-even line */}
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--ink-3)" strokeDasharray="3 4" strokeWidth="1" opacity="0.7" />
          <text x="0" y={zeroY - 6} className="fill-ink-3" style={TAG}>
            BREAK-EVEN
          </text>
          <text x="0" y={PAD_T - 6} className="fill-up" style={TAG}>
            PROFIT
          </text>
          <text x={W} y={CURVE_H - PAD_B - 6} textAnchor="end" className="fill-down" style={TAG}>
            LOSS
          </text>

          {/* The profit line */}
          <line x1="0" y1={y(vMin)} x2={W} y2={y(vMax)} stroke={`url(#${gid}-line)`} strokeWidth="2" strokeLinecap="round" filter={`url(#${gid}-glow)`} />

          {/* Today */}
          <line x1={nx} x2={nx} y1={PAD_T - 6} y2={CURVE_H - PAD_B} stroke="var(--ink-3)" strokeWidth="1" opacity="0.5" />
          <circle cx={nx} cy={y(pnl(now))} r="3.5" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="1.5" />
          <text x={nx} y={nowLabelBelow ? CURVE_H - PAD_B - 4 : PAD_T - 6} textAnchor="middle" className="fill-ink-2" style={TAG}>
            NOW
          </text>

          {/* Target */}
          <line x1={tx} x2={tx} y1={ty} y2={CURVE_H - PAD_B} stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />
          <circle cx={tx} cy={ty} r="8" className="wi-halo" fill={up ? "var(--up)" : "var(--down)"} />
          <circle cx={tx} cy={ty} r="5.5" className="wi-target-ring" fill="var(--surface)" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2.5" />

          {/* Price axis */}
          <text x="0" y={CURVE_H - 4} className="num fill-ink-3 text-[10px]">
            {fmtPrice(lo, cur)}
          </text>
          <text x={W} y={CURVE_H - 4} textAnchor="end" className="num fill-ink-3 text-[10px]">
            {fmtPrice(hi, cur)}
          </text>
        </svg>
      )}
      {W === 0 && <div style={{ height: CURVE_H }} />}
      <p className="mt-0.5 text-center text-[10.5px] text-ink-3">Drag along the line to try a price</p>
    </div>
  );
}
