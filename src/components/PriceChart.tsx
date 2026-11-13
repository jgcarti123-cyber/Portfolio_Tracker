"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineStyle,
  LineType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/types";

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

interface Pin {
  trade: ChartTrade;
  x: number;
  y: number;
}

/** The chart draws in UTC; shift so the axis reads in the viewer's local time. */
const tzShift = () => -new Date().getTimezoneOffset() * 60;

/** #rrggbb -> rgba(), since the chart library needs plain colour strings. */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Price chart for one asset. The chart is created once per style and theme; changing the
 * range only swaps its data, so there's no flash or rebuild. Real trades are drawn as
 * Folio's own stickers at the price paid — hover for details, click to jump to the trade.
 */
export function PriceChart({
  candles,
  mode,
  intraday,
  avgCost,
  trades,
  theme,
  onHover,
  onTradeClick,
  height = 380,
}: {
  candles: Candle[];
  mode: "candles" | "line";
  intraday: boolean;
  avgCost: number | null;
  trades: ChartTrade[];
  /** Only used to redraw with the right colours when the theme flips. */
  theme: string;
  /** Called with the bar under the cursor, or null when the cursor leaves. */
  onHover?: (p: ChartPoint | null) => void;
  onTradeClick?: (id: string) => void;
  height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const timesRef = useRef<number[]>([]);
  const tradesRef = useRef(trades);
  const hoverRef = useRef(onHover);
  const [pins, setPins] = useState<Pin[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    hoverRef.current = onHover;
    tradesRef.current = trades;
  }, [onHover, trades]);

  /** Pin each trade to its bar, at the price actually paid. */
  const place = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const times = timesRef.current;
    if (!chart || !series || !times.length) return setPins([]);
    const shift = tzShift();
    const out: Pin[] = [];
    for (const t of tradesRef.current) {
      const at = t.ts / 1000 + shift;
      if (at < times[0]) continue;
      let bar = times[0];
      for (const x of times) {
        if (x <= at) bar = x;
        else break;
      }
      const x = chart.timeScale().timeToCoordinate(bar as UTCTimestamp);
      const y = series.priceToCoordinate(t.price);
      if (x !== null && y !== null) out.push({ trade: t, x, y });
    }
    setPins(out);
  }, []);

  // Create the chart (only when the style or theme changes).
  useEffect(() => {
    if (!el.current) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const [UP, DOWN, ACCENT, MUTED, LINE] = ["--up", "--down", "--accent", "--ink-3", "--line"].map(v);

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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        vertLine: { color: MUTED, style: LineStyle.Dashed, labelBackgroundColor: ACCENT },
        horzLine: { color: MUTED, style: LineStyle.Dashed, labelBackgroundColor: ACCENT },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    const series =
      mode === "candles"
        ? chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            lineWidth: 2,
            lineType: LineType.Curved,
            topColor: alpha(ACCENT, 0.22),
            bottomColor: alpha(ACCENT, 0),
            crosshairMarkerRadius: 5,
            crosshairMarkerBorderColor: "#ffffff",
            crosshairMarkerBorderWidth: 2,
            priceLineVisible: false,
          });
    chartRef.current = chart;
    seriesRef.current = series;
    const shift = tzShift();
    lineRef.current = null;

    chart.subscribeCrosshairMove((param) => {
      const d = param.time !== undefined ? param.seriesData.get(series) : undefined;
      if (!d) return hoverRef.current?.(null);
      const price = Number("close" in d ? d.close : "value" in d ? d.value : NaN);
      hoverRef.current?.({ t: (param.time as number) - shift, price });
    });
    const replace = () => requestAnimationFrame(place);
    chart.timeScale().subscribeVisibleLogicalRangeChange(replace);
    // The box can stretch after the chart is drawn (it fills its card), so re-fit on resize.
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        chart.timeScale().fitContent();
        place();
      }),
    );
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [mode, theme, place]);

  // Swap data in place when the range changes — no rebuild.
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
    timesRef.current = data.map((c) => c.t);
    if (mode === "candles") (series as ISeriesApi<"Candlestick">).setData(data.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    else (series as ISeriesApi<"Area">).setData(data.map((c) => ({ time: c.t as UTCTimestamp, value: c.c })));
    chart.applyOptions({ timeScale: { timeVisible: intraday } });
    chart.timeScale().fitContent();
    requestAnimationFrame(place);
  }, [candles, intraday, mode, theme, place]);

  // Average-cost line.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (lineRef.current) series.removePriceLine(lineRef.current);
    lineRef.current = avgCost
      ? series.createPriceLine({
          price: avgCost,
          color: getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim(),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Avg cost",
        })
      : null;
  }, [avgCost, mode, theme]);

  useEffect(() => {
    requestAnimationFrame(place);
  }, [trades, place]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      {pins.map(({ trade, x, y }) => {
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
                className={`pop-in pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-white shadow-pop ${y < 70 ? "top-8" : "bottom-8"}`}
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
    </div>
  );
}
