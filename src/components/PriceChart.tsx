"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import { pct, price as fmtPrice, signed } from "@/lib/format";
import type { Candle, Currency } from "@/lib/types";

export interface ChartPoint {
  /** Unix seconds, as in the candles. */
  t: number;
  price: number;
}

/** A real buy or sell to pin on the chart (not a holding added to Folio as it stood). */
export interface ChartTrade {
  id: string;
  ts: number;
  price: number;
  type: "buy" | "sell";
  /** e.g. "Bought 5 shares at $166.19". */
  title: string;
  /** e.g. "12 Nov 2026 · Groww". */
  detail: string;
}

/** Zoom controls the page can place wherever it likes (they live in the range bar). */
export interface ChartControls {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface Pin {
  trade: ChartTrade;
  x: number;
  y: number;
}

/** Everything drawn in HTML over the canvas, recomputed whenever the view moves. */
interface Spot {
  x: number;
  y: number;
  c: Candle;
}

interface Overlay {
  pins: Pin[];
  /** y of the average-cost line, and the plot box it sits in. */
  avgY: number | null;
  plotW: number;
  plotH: number;
  /** The two ends of a measurement, in screen position. */
  measure: { from: Spot; to: Spot; dragging: boolean } | null;
}

interface Tip {
  x: number;
  y: number;
  bar: Candle;
  /** First bar of the range, for the change "in view". */
  first: Candle;
  index: number;
  /** Just appeared: jump to the cursor instead of gliding from the last spot. */
  fresh: boolean;
}

const EMPTY: Overlay = { pins: [], avgY: null, plotW: 0, plotH: 0, measure: null };

/** The chart draws in UTC; shift so the axis reads in the viewer's local time. */
const tzShift = () => -new Date().getTimezoneOffset() * 60;

/** #rrggbb -> rgba(), since the chart library needs plain colour strings. */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Price chart for one asset. The chart is created once per style and theme; changing the
 * range only swaps its data. The line takes the colour of the move over the range, the
 * band above your average cost is tinted as profit and below as loss, a tooltip follows
 * the cursor, dragging measures the change between two days, and zoom stays where you
 * put it. Real trades are pinned at the price paid — click one to jump to it.
 */
export function PriceChart({
  candles,
  mode,
  intraday,
  avgCost,
  trades,
  theme,
  currency,
  onHover,
  onTradeClick,
  controlsRef,
  onZoomedChange,
  height = 380,
}: {
  candles: Candle[];
  mode: "candles" | "line";
  intraday: boolean;
  avgCost: number | null;
  trades: ChartTrade[];
  /** Only used to redraw with the right colours when the theme flips. */
  theme: string;
  currency: Currency;
  /** Called with the bar under the cursor, or null when the cursor leaves. */
  onHover?: (p: ChartPoint | null) => void;
  onTradeClick?: (id: string) => void;
  /** Filled with zoom in / out / reset, for buttons outside the chart. */
  controlsRef?: React.RefObject<ChartControls | null>;
  /** Told whether the view is zoomed, so a Reset button can show. */
  onZoomedChange?: (zoomed: boolean) => void;
  height?: number | string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const glowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const dataRef = useRef<Candle[]>([]);
  const tradesRef = useRef(trades);
  const avgRef = useRef(avgCost);
  const hoverRef = useRef(onHover);
  const measureRef = useRef<{ a: number; b: number; dragging: boolean } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY);
  const [active, setActive] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    hoverRef.current = onHover;
    tradesRef.current = trades;
    avgRef.current = avgCost;
  }, [onHover, trades, avgCost]);

  /** Recompute everything drawn over the canvas: trade pins, the avg-cost band. */
  const place = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const data = dataRef.current;
    if (!chart || !series || !data.length) return setOverlay(EMPTY);
    const shift = tzShift();
    const pins: Pin[] = [];
    for (const t of tradesRef.current) {
      const at = t.ts / 1000 + shift;
      if (at < data[0].t) continue;
      let bar = data[0].t;
      for (const c of data) {
        if (c.t <= at) bar = c.t;
        else break;
      }
      const x = chart.timeScale().timeToCoordinate(bar as UTCTimestamp);
      const y = series.priceToCoordinate(t.price);
      if (x !== null && y !== null) pins.push({ trade: t, x, y });
    }
    const w = el.current?.clientWidth ?? 0;
    const h = el.current?.clientHeight ?? 0;
    const plotW = w - chart.priceScale("right").width();
    const plotH = h - chart.timeScale().height();
    const avgY = avgRef.current ? series.priceToCoordinate(avgRef.current) : null;
    const spot = (i: number): Spot | null => {
      const c = data[i];
      const x = c ? chart.timeScale().timeToCoordinate(c.t as UTCTimestamp) : null;
      const y = c ? series.priceToCoordinate(c.c) : null;
      return c && x !== null && y !== null ? { x, y, c } : null;
    };
    const m = measureRef.current;
    let measure: Overlay["measure"] = null;
    if (m && m.a !== m.b) {
      const from = spot(Math.min(m.a, m.b));
      const to = spot(Math.max(m.a, m.b));
      if (from && to) measure = { from, to, dragging: m.dragging };
    }
    setOverlay({ pins, avgY, plotW, plotH, measure });
  }, []);

  /** Sets (or clears) the measurement and redraws it. */
  const setMeasure = useCallback(
    (v: { a: number; b: number; dragging: boolean } | null) => {
      measureRef.current = v;
      setMeasuring(!!v);
      requestAnimationFrame(place);
    },
    [place],
  );

  /** Whether the person has zoomed or scrolled away from the whole range. */
  const checkZoom = useCallback(() => {
    const r = chartRef.current?.timeScale().getVisibleLogicalRange();
    const n = dataRef.current.length;
    setZoomed(!!r && n > 1 && (r.from > 0.5 || r.to < n - 1.5));
  }, []);

  // Create the chart (only when the style or theme changes).
  useEffect(() => {
    if (!el.current) return;
    const [ACCENT, MUTED, LINE, UP, DOWN] = ["--accent", "--ink-3", "--line", "--up", "--down"].map(cssVar);

    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: MUTED,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: LINE, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.08 } },
      timeScale: { borderVisible: false, secondsVisible: false, fixLeftEdge: true, rightOffset: 2, minBarSpacing: 0.2 },
      crosshair: {
        vertLine: { color: alpha(MUTED.startsWith("#") ? MUTED : "#8b91a0", 0.45), width: 1, style: LineStyle.Solid, labelBackgroundColor: ACCENT },
        horzLine: { visible: false, labelVisible: true, labelBackgroundColor: ACCENT },
      },
      // Dragging measures; scroll, trackpad swipe, pinch and the buttons move and zoom.
      handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false, mouseWheel: true, pinch: true, axisDoubleClickReset: true },
    });
    let glow: ISeriesApi<"Line"> | null = null;
    if (mode === "line") {
      // A soft, wide copy under the line gives it a glow.
      glow = chart.addSeries(LineSeries, {
        color: alpha(ACCENT, 0.18),
        lineWidth: 4,
        lineType: LineType.Curved,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    const series =
      mode === "candles"
        ? chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            lineWidth: 2,
            lineType: LineType.Curved,
            topColor: alpha(ACCENT, 0.2),
            bottomColor: alpha(ACCENT, 0),
            crosshairMarkerRadius: 5,
            crosshairMarkerBorderColor: "#ffffff",
            crosshairMarkerBorderWidth: 2,
            priceLineVisible: false,
          });
    chartRef.current = chart;
    seriesRef.current = series;
    glowRef.current = glow;
    lineRef.current = null;
    const shift = tzShift();

    chart.subscribeCrosshairMove((param) => {
      const d = param.time !== undefined ? param.seriesData.get(series) : undefined;
      if (!d || !param.point || param.logical === undefined) {
        setTip(null);
        return hoverRef.current?.(null);
      }
      const price = Number("close" in d ? d.close : "value" in d ? d.value : NaN);
      hoverRef.current?.({ t: (param.time as number) - shift, price });
      const bars = dataRef.current;
      // Find the bar by its exact time (the logical index can drift from the data index).
      const time = param.time as number;
      let lo = 0;
      let hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].t < time) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      // "In view" is measured from the first bar actually on screen, so it follows zoom.
      const vis = chart.timeScale().getVisibleLogicalRange();
      const f = Math.max(0, Math.min(bars.length - 1, Math.ceil(vis?.from ?? 0)));
      const point = param.point;
      setTip((prev) => (bars[i] ? { x: point.x, y: point.y, bar: bars[i], first: bars[f], index: i - f, fresh: !prev } : null));
      // Extend a measurement while dragging.
      const m = measureRef.current;
      if (m?.dragging && m.b !== i) setMeasure({ ...m, b: i });
    });
    const moved = () =>
      requestAnimationFrame(() => {
        place();
        checkZoom();
      });
    chart.timeScale().subscribeVisibleLogicalRangeChange(moved);
    // Resizing keeps the zoom; only an un-zoomed chart re-fits to fill its new width.
    let lastW = el.current.clientWidth;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        const w = el.current?.clientWidth ?? 0;
        const r = chart.timeScale().getVisibleLogicalRange();
        const n = dataRef.current.length;
        const atFull = !r || (r.from <= 0.5 && r.to >= n - 1);
        if (w !== lastW && atFull) chart.timeScale().fitContent();
        lastW = w;
        place();
      }),
    );
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      glowRef.current = null;
    };
  }, [mode, theme, place, checkZoom, setMeasure]);

  // Swap data in place when the range changes — no rebuild. The line takes the colour of the move.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const shift = tzShift();
    const seen = new Set<number>();
    const data = candles
      .map((c) => ({ ...c, t: c.t + shift }))
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)))
      .sort((a, b) => a.t - b.t);
    dataRef.current = data;
    if (mode === "candles") (series as ISeriesApi<"Candlestick">).setData(data.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    else {
      const line = data.map((c) => ({ time: c.t as UTCTimestamp, value: c.c }));
      (series as ISeriesApi<"Area">).setData(line);
      glowRef.current?.setData(line);
      const up = data.length < 2 || data[data.length - 1].c >= data[0].c;
      const col = cssVar(up ? "--up" : "--down");
      (series as ISeriesApi<"Area">).applyOptions({ lineColor: col, topColor: alpha(col, 0.22), bottomColor: alpha(col, 0) });
      glowRef.current?.applyOptions({ color: alpha(col, 0.12) });
      chart.applyOptions({ crosshair: { vertLine: { labelBackgroundColor: col }, horzLine: { labelBackgroundColor: col } } });
    }
    chart.applyOptions({ timeScale: { timeVisible: intraday } });
    chart.timeScale().fitContent();
    measureRef.current = null;
    requestAnimationFrame(() => {
      setMeasuring(false);
      place();
      checkZoom();
    });
  }, [candles, intraday, mode, theme, place, checkZoom]);

  // Average cost: a quiet dashed line. Its label is a pill on the left, away from the live price.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (lineRef.current) series.removePriceLine(lineRef.current);
    lineRef.current = avgCost
      ? series.createPriceLine({ price: avgCost, color: cssVar("--ink-3"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" })
      : null;
    requestAnimationFrame(place);
  }, [avgCost, mode, theme, place]);

  useEffect(() => {
    requestAnimationFrame(place);
  }, [trades, place]);

  // Esc clears a measurement.
  useEffect(() => {
    if (!measuring) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMeasure(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring, setMeasure]);

  function zoom(factor: number) {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const n = dataRef.current.length;
    // Zoom towards the latest bar when it's in view, otherwise around the middle.
    const anchor = r.to >= n - 1 ? n - 1 : (r.from + r.to) / 2;
    const span = Math.max(5, Math.min(n + 4, (r.to - r.from) * factor));
    const frac = (anchor - r.from) / (r.to - r.from);
    ts.setVisibleLogicalRange({ from: anchor - span * frac, to: anchor + span * (1 - frac) });
  }
  const reset = () => chartRef.current?.timeScale().fitContent();

  // Hand the zoom controls to the page, and tell it when the view is zoomed.
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = { zoomIn: () => zoom(0.6), zoomOut: () => zoom(1.6), reset };
  });
  useEffect(() => onZoomedChange?.(zoomed), [zoomed, onZoomedChange]);

  /** Start measuring on a press anywhere on the plot (not on a pin or button). */
  function down(e: React.PointerEvent) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const ts = chartRef.current?.timeScale();
    const rect = el.current?.getBoundingClientRect();
    if (!ts || !rect) return;
    const x = e.clientX - rect.left;
    if (x > overlay.plotW || e.clientY - rect.top > overlay.plotH) return;
    const time = ts.coordinateToTime(x) as number | null;
    if (time === null) return;
    const bars = dataRef.current;
    let i = bars.findIndex((c) => c.t >= time);
    if (i < 0) i = bars.length - 1;
    setMeasure({ a: i, b: i, dragging: true });
  }
  function up() {
    const m = measureRef.current;
    if (!m?.dragging) return;
    // A click without a drag clears it.
    setMeasure(m.a === m.b ? null : { ...m, dragging: false });
  }

  const when = (t: number) =>
    new Date((t - tzShift()) * 1000).toLocaleString("en-IN", intraday ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" });

  // Measurement between two bars.
  const m = overlay.measure;
  const mv = m ? m.to.c.c - m.from.c.c : 0;
  const mUp = mv >= 0;
  const days = m ? Math.round((m.to.c.t - m.from.c.t) / 86400) : 0;

  // Tooltip at the cursor (hidden while dragging a measurement).
  const tipBar = tip && !m?.dragging ? tip.bar : null;
  const plotW = overlay.plotW;
  const plotH = overlay.plotH;
  const avgY = overlay.avgY;
  const avgInView = avgY !== null && avgY > 0 && avgY < plotH;

  return (
    <div
      ref={box}
      className={`group/chart relative w-full select-none ${m?.dragging ? "cursor-ew-resize" : "cursor-crosshair"}`}
      style={{ height }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={() => (setTip(null), up())}
      onDoubleClick={reset}
    >
      {/* Profit / loss tint either side of your average cost, behind the transparent chart. */}
      {avgCost && avgY !== null && plotW > 0 && (
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: plotW, height: plotH }} aria-hidden>
          <div className="absolute inset-x-0 top-0" style={{ height: Math.max(0, Math.min(plotH, avgY)), background: "linear-gradient(to top, color-mix(in srgb, var(--up) 6%, transparent), transparent 70%)" }} />
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ top: Math.max(0, Math.min(plotH, avgY)), background: "linear-gradient(to bottom, color-mix(in srgb, var(--down) 5%, transparent), transparent 70%)" }}
          />
        </div>
      )}

      <div ref={el} className="absolute inset-0" />

      {/* Average cost pill, on the left edge of the line */}
      {avgCost && avgInView && (
        <span
          className="pointer-events-none absolute left-1 z-[5] flex -translate-y-1/2 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-ink-2 shadow-card ring-1 ring-line"
          style={{ top: avgY! }}
        >
          <span className="size-1.5 rounded-full bg-ink-3" />
          Your avg <span className="num text-ink">{fmtPrice(avgCost, currency)}</span>
        </span>
      )}

      {/* Measurement: shaded band, end dots and the change between them */}
      {m && (
        <>
          <div
            className="pointer-events-none absolute top-0 z-[4]"
            style={{
              left: m.from.x,
              width: Math.max(1, m.to.x - m.from.x),
              height: plotH,
              background: `color-mix(in srgb, var(${mUp ? "--up" : "--down"}) 10%, transparent)`,
              borderLeft: `1px dashed var(${mUp ? "--up" : "--down"})`,
              borderRight: `1px dashed var(${mUp ? "--up" : "--down"})`,
            }}
          />
          {[m.from, m.to].map((p, k) => (
            <span
              key={k}
              className="pointer-events-none absolute z-[6] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
              style={{ left: p.x, top: p.y, background: `var(${mUp ? "--up" : "--down"})` }}
            />
          ))}
          <div
            className="pop-in absolute top-2 z-20 -translate-x-1/2 whitespace-nowrap rounded-xl px-3 py-2 text-white shadow-pop"
            style={{ left: Math.min(Math.max((m.from.x + m.to.x) / 2, 90), Math.max(90, plotW - 90)), background: "var(--tip)" }}
          >
            <p className={`num text-[13px] font-bold ${mUp ? "text-[#5fdc9a]" : "text-[#ff8a92]"}`}>
              {signed(mv, currency)} ({pct((m.to.c.c / m.from.c.c - 1) * 100)})
            </p>
            <p className="num text-[11px] text-white/65">
              {when(m.from.c.t)} → {when(m.to.c.t)}
              {!intraday && ` · ${days} day${days === 1 ? "" : "s"}`}
            </p>
            {!m.dragging && (
              <button type="button" onClick={() => setMeasure(null)} className="mt-1 text-[10.5px] font-semibold text-white/80 underline-offset-2 hover:underline">
                Clear
              </button>
            )}
          </div>
        </>
      )}

      {/* Floating tooltip */}
      {/* Slim tooltip: glides with the cursor, date and price only */}
      {plotW > 0 && (
        <div
          className={`pointer-events-none absolute left-0 top-0 z-20 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white shadow-pop ease-out ${tip?.fresh ? "transition-opacity duration-150" : "transition-[transform,opacity] duration-75"}`}
          style={{
            background: "var(--tip)",
            opacity: tipBar ? 1 : 0,
            transform: tip ? `translate(${tip.x + 150 > plotW ? tip.x - 138 : tip.x + 12}px, ${Math.min(Math.max(tip.y - 46, 4), Math.max(4, plotH - 48))}px)` : undefined,
          }}
        >
          {tipBar && (
            <>
              <p className="text-[10.5px] text-white/60">{when(tipBar.t)}</p>
              <p className="num text-[13px] font-bold">{fmtPrice(tipBar.c, currency)}</p>
            </>
          )}
        </div>
      )}

      {/* Trade pins */}
      {overlay.pins.map(({ trade, x, y }) => {
        if (x < 0 || x > plotW) return null;
        const buy = trade.type === "buy";
        const on = active === trade.id;
        return (
          <button
            key={trade.id}
            type="button"
            onClick={() => onTradeClick?.(trade.id)}
            onMouseEnter={() => setActive(trade.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(trade.id)}
            onBlur={() => setActive(null)}
            aria-label={`${trade.title}, ${trade.detail}`}
            className="pin-in absolute z-10 -translate-x-1/2 -translate-y-1/2 outline-none"
            style={{ left: x, top: y }}
          >
            <span className={`absolute inset-0 rounded-full ${buy ? "bg-accent" : "bg-ink"} opacity-30 ${on ? "" : "ping"}`} aria-hidden />
            <span
              className={`relative grid size-6 place-items-center rounded-full text-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.45)] ring-2 ring-surface transition-transform duration-200 ease-out-quint ${on ? "scale-125" : ""} ${buy ? "bg-accent" : "bg-ink text-canvas"}`}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={buy ? "" : "rotate-180"}>
                <path d="M5 1.5v7M2 4.5 5 1.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {on && (
              <span
                className={`pop-in pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-white shadow-pop ${y < 70 ? "top-8" : "bottom-8"}`}
                style={{ background: "var(--tip)" }}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-bold">
                  <span className={`size-1.5 rounded-full ${buy ? "bg-[#7f9cff]" : "bg-white"}`} />
                  {trade.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-white/65">{trade.detail} · click to see it</span>
              </span>
            )}
          </button>
        );
      })}

      {/* A quiet hint, only while the cursor is over the chart */}
      {plotW > 0 && !measuring && (
        <span className="pointer-events-none absolute bottom-[32px] left-2 z-[5] hidden text-[10.5px] text-ink-3 opacity-0 transition-opacity duration-300 group-hover/chart:opacity-80 sm:block">
          Point at any day · drag to measure · scroll to zoom
        </span>
      )}
    </div>
  );
}
