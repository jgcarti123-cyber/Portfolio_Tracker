"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

export interface ChartPoint {
  /** Unix seconds, as in the candles. */
  t: number;
  price: number;
}
import type { Candle, Txn } from "@/lib/types";
/** #rrggbb -> rgba(), since the chart library needs plain colour strings. */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function PriceChart({
  candles,
  mode,
  intraday,
  avgCost,
  txns,
  theme,
  onHover,
  height = 380,
}: {
  candles: Candle[];
  mode: "candles" | "line";
  intraday: boolean;
  avgCost: number | null;
  txns: Txn[];
  /** Only used to redraw with the right colours when the theme flips. */
  theme: string;
  /** Called with the bar under the cursor, or null when the cursor leaves. */
  onHover?: (p: ChartPoint | null) => void;
  height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    if (!el.current || !candles.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const [UP, DOWN, ACCENT, INK, MUTED, LINE] = ["--up", "--down", "--accent", "--ink", "--ink-3", "--line"].map(v);

    // The chart draws in UTC; shift so the axis reads in the viewer's local time.
    const shift = -new Date().getTimezoneOffset() * 60;
    const seen = new Set<number>();
    const data = candles
      .map((c) => ({ ...c, t: c.t + shift }))
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)))
      .sort((a, b) => a.t - b.t);

    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: MUTED,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: LINE, style: LineStyle.Dashed },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: intraday, secondsVisible: false },
      crosshair: {
        vertLine: { color: MUTED, labelBackgroundColor: MUTED },
        horzLine: { color: MUTED, labelBackgroundColor: MUTED },
      },
      handleScale: { axisPressedMouseMove: false },
    });

    const series =
      mode === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            borderVisible: false,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            lineWidth: 2,
            topColor: alpha(ACCENT, 0.24),
            bottomColor: alpha(ACCENT, 0),
          });

    if (mode === "candles") {
      series.setData(
        data.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })),
      );
    } else {
      series.setData(data.map((c) => ({ time: c.t as UTCTimestamp, value: c.c })));
    }

    if (avgCost) {
      series.createPriceLine({
        price: avgCost,
        color: INK,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Your avg. cost",
      });
    }

    // Pin each trade to the bar it happened in.
    const markers: SeriesMarker<Time>[] = [];
    for (const t of [...txns].sort((a, b) => a.ts - b.ts)) {
      const at = t.ts / 1000 + shift;
      if (at < data[0].t) continue;
      let bar = data[0].t;
      for (const c of data) {
        if (c.t <= at) bar = c.t;
        else break;
      }
      markers.push({
        time: bar as UTCTimestamp,
        position: t.type === "buy" ? "belowBar" : "aboveBar",
        shape: t.type === "buy" ? "arrowUp" : "arrowDown",
        color: t.type === "buy" ? ACCENT : INK,
        text: t.type === "buy" ? "Bought" : "Sold",
      });
    }
    if (markers.length) createSeriesMarkers(series, markers);

    chart.subscribeCrosshairMove((param) => {
      const d = param.time !== undefined ? param.seriesData.get(series) : undefined;
      if (!d) return hoverRef.current?.(null);
      const price = Number("close" in d ? d.close : "value" in d ? d.value : NaN);
      hoverRef.current?.({ t: (param.time as number) - shift, price });
    });

    chart.timeScale().fitContent();
    // The box can stretch after the chart is drawn (it fills its card), so re-fit on resize.
    const ro = new ResizeObserver(() => requestAnimationFrame(() => chart.timeScale().fitContent()));
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, mode, intraday, avgCost, txns, theme]);

  return <div ref={el} className="w-full" style={{ height }} />;
}
