"use client";

import { useMemo, useState } from "react";
import { compact, money, pct } from "@/lib/format";
import { convert, type Position } from "@/lib/portfolio";
import { CLASS_META, CLASS_ORDER, type Currency } from "@/lib/types";
import { shortName } from "@/lib/insights";
import { useSize } from "./insights/kit";
import { Card, CardHead } from "./ui";

interface Bubble {
  id: string;
  label: string;
  name: string;
  color: string;
  value: number;
  /** Total return since you bought, %. */
  ret: number;
  /** Today's price move, % (null when there's no daily price). */
  day: number | null;
}

const bubbleIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="5.5" cy="10" r="3" />
    <circle cx="11" cy="5.5" r="2.5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

/**
 * Everything you hold on one map: across = total return, up = today's move, size = what it's
 * worth, colour = asset type. Winners sit top-right, laggards bottom-left. Click to open one.
 */
export function HoldingsMap({ positions, currency, usdInr, onOpen }: { positions: Position[]; currency: Currency; usdInr: number; onOpen: (id: string) => void }) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const bubbles = useMemo<Bubble[]>(
    () =>
      positions
        .filter((p) => p.qty > 0)
        .map((p) => ({
          id: p.asset.id,
          label: shortName(p.asset),
          name: p.asset.name,
          color: CLASS_META[p.asset.cls].color,
          value: convert(p.value ?? p.cost, p.asset.currency, currency, usdInr),
          ret: p.cost > 0 && p.gain !== null ? (p.gain / p.cost) * 100 : 0,
          day: p.price !== null && p.prevClose ? (p.price / p.prevClose - 1) * 100 : null,
        }))
        .sort((a, b) => b.value - a.value),
    [positions, currency, usdInr],
  );
  if (!bubbles.length) return null;

  const W = box.w;
  const H = Math.max(220, box.h);
  const M = { l: 40, r: 10, t: 10, b: 26 };
  const plotW = Math.max(10, W - M.l - M.r);
  const plotH = H - M.t - M.b;
  const rets = bubbles.map((b) => b.ret);
  const lo0 = Math.min(0, ...rets);
  const hi0 = Math.max(0, ...rets);
  const padX = Math.max(2, (hi0 - lo0) * 0.12);
  const xLo = lo0 - padX;
  const xHi = hi0 + padX;
  const yM = Math.max(0.5, ...bubbles.map((b) => Math.abs(b.day ?? 0))) * 1.3;
  const x = (v: number) => M.l + ((v - xLo) / (xHi - xLo)) * plotW;
  const y = (v: number) => M.t + ((yM - v) / (2 * yM)) * plotH;
  const maxV = bubbles[0].value;
  const rMax = Math.max(14, Math.min(32, plotW / 15));
  const r = (v: number) => Math.max(5, rMax * Math.sqrt(v / maxV));
  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(-yM, yM, 4);

  const up = bubbles.filter((b) => (b.day ?? 0) > 0).length;
  const priced = bubbles.filter((b) => b.day !== null).length;
  const winners = bubbles.filter((b) => b.ret > 0).length;
  const big = bubbles[0];
  const h = bubbles.find((b) => b.id === hover) ?? null;
  const labels = W > 0 ? placeLabels(bubbles, x, y, r, { l: 0, r: W }) : new Map<string, { x: number; y: number; anchor: "start" | "end" | "middle"; inside: boolean }>();
  const classes = CLASS_ORDER.filter((c) => positions.some((p) => p.qty > 0 && p.asset.cls === c));

  return (
    <Card className="flex h-full flex-col p-5">
      <CardHead icon={bubbleIcon} title="Your holdings" color="var(--cat-2)">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
          {priced > 0 && (
            <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-2 ring-1 ring-line">
              <span className={up > 0 ? "text-up" : "text-ink"}>{up}</span>/{priced} up today
            </span>
          )}
          <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-2 ring-1 ring-line">
            <span className={winners > 0 ? "text-up" : "text-ink"}>{winners}</span>/{bubbles.length} in profit
          </span>
        </div>
      </CardHead>
      <p className="num mt-3 text-[12.5px] text-ink-3 [&_b]:font-semibold [&_b]:text-ink-2">
        Biggest: <b>{big.label}</b> {compact(big.value, currency)} · <b className={big.ret >= 0 ? "!text-up" : "!text-down"}>{pct(big.ret)}</b> overall
        {big.day !== null && (
          <>
            {" "}
            · <b className={big.day >= 0 ? "!text-up" : "!text-down"}>{pct(big.day)}</b> today
          </>
        )}
      </p>

      <div ref={ref} className="relative mt-2 min-h-[220px] flex-1" onPointerLeave={() => setHover(null)}>
        {W > 0 && (
          <svg width={W} height={H} className="absolute inset-0 block overflow-visible">
            {/* Quadrants: in profit and up today, at a loss and down today */}
            <rect x={x(0)} y={M.t} width={Math.max(0, M.l + plotW - x(0))} height={Math.max(0, y(0) - M.t)} fill="var(--up)" opacity={0.05} />
            <rect x={M.l} y={y(0)} width={Math.max(0, x(0) - M.l)} height={Math.max(0, M.t + plotH - y(0))} fill="var(--down)" opacity={0.05} />
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={M.l} x2={M.l + plotW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={Math.abs(t) < 1e-9 ? undefined : "2 5"} strokeWidth={Math.abs(t) < 1e-9 ? 1.3 : 1} />
                <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="num fill-ink-3 text-[10.5px]">
                  {Math.abs(t) < 1e-9 ? "0%" : `${t > 0 ? "+" : "−"}${Math.abs(t).toFixed(Math.abs(t) < 1 ? 1 : 0)}%`}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <g key={`x${t}`}>
                {Math.abs(t) < 1e-9 && <line x1={x(0)} x2={x(0)} y1={M.t} y2={M.t + plotH} stroke="var(--line)" strokeWidth={1.3} />}
                <text x={x(t)} y={H - 10} textAnchor="middle" className="num fill-ink-3 text-[10.5px]">
                  {Math.abs(t) < 1e-9 ? "0%" : `${t > 0 ? "+" : "−"}${Math.abs(t).toFixed(0)}%`}
                </text>
              </g>
            ))}
            {bubbles.map((b, i) => {
              const dim = hover && hover !== b.id;
              const cy = y(b.day ?? 0);
              return (
                <g
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${b.name}: ${money(b.value, currency, { decimals: 0 })}, ${pct(b.ret)} overall${b.day !== null ? `, ${pct(b.day)} today` : ""}`}
                  onPointerEnter={() => setHover(b.id)}
                  onFocus={() => setHover(b.id)}
                  onBlur={() => setHover(null)}
                  onClick={() => onOpen(b.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(b.id))}
                  className="cursor-pointer outline-none"
                  opacity={dim ? 0.3 : 1}
                  style={{ transition: "opacity .2s" }}
                >
                  <circle
                    cx={x(b.ret)}
                    cy={cy}
                    r={r(b.value)}
                    fill={b.color}
                    fillOpacity={b.day === null ? 0.25 : 0.78}
                    stroke={hover === b.id ? "var(--ink)" : "var(--surface)"}
                    strokeWidth={hover === b.id ? 2 : 1.5}
                    strokeDasharray={b.day === null ? "3 2" : undefined}
                    className="pop-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  />
                </g>
              );
            })}
            {bubbles.map((b) => {
              const l = labels.get(b.id);
              if (!l) return null;
              return (
                <text
                  key={`t${b.id}`}
                  x={l.x}
                  y={l.y}
                  textAnchor={l.anchor}
                  className={`pointer-events-none text-[11px] font-semibold ${l.inside ? "fill-white" : "fill-ink-2"}`}
                  opacity={hover && hover !== b.id ? 0.3 : 1}
                  stroke={l.inside ? undefined : "var(--surface)"}
                  strokeWidth={l.inside ? undefined : 3}
                  paintOrder="stroke"
                >
                  {b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}
                </text>
              );
            })}
          </svg>
        )}
        {h && W > 0 && (
          <div
            className="pointer-events-none absolute z-20 w-[220px] rounded-xl px-3 py-2 text-[12px] text-white shadow-pop"
            style={{
              background: "var(--tip)",
              left: Math.max(0, Math.min(x(h.ret) + (x(h.ret) > W / 2 ? -232 : r(h.value) + 10), W - 220)),
              top: Math.max(0, Math.min(y(h.day ?? 0) - 30, H - 96)),
            }}
          >
            <p className="text-[10.5px] font-medium text-white/60">{h.name}</p>
            <p className="num text-[14px] font-bold">{money(h.value, currency, { decimals: 0 })}</p>
            <p className={`num text-[11.5px] font-semibold ${h.ret >= 0 ? "text-[#5fdc9a]" : "text-[#ff8a92]"}`}>{pct(h.ret)} since you bought</p>
            <p className="num text-[11.5px] text-white/75">{h.day === null ? "No daily price" : `${pct(h.day)} today`}</p>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {classes.map((c) => (
            <span key={c} className="flex items-center gap-1 text-ink-3">
              <span className="size-2 rounded-full" style={{ background: CLASS_META[c].color }} />
              {CLASS_META[c].label}
            </span>
          ))}
        </div>
        <span className="text-ink-3">
          across: return · up: today · size: value
        </span>
      </div>
    </Card>
  );
}

function niceTicks(lo: number, hi: number, count: number) {
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}

/** Label inside big bubbles; beside smaller ones where there's room. Small, crowded ones rely on hover. */
function placeLabels(bubbles: Bubble[], x: (v: number) => number, y: (v: number) => number, r: (v: number) => number, bounds: { l: number; r: number }) {
  const out = new Map<string, { x: number; y: number; anchor: "start" | "end" | "middle"; inside: boolean }>();
  const boxes: { l: number; r: number; t: number; b: number }[] = [];
  const hit = (a: { l: number; r: number; t: number; b: number }) => boxes.some((o) => a.l < o.r && a.r > o.l && a.t < o.b && a.b > o.t);
  for (const b of bubbles) {
    const cx = x(b.ret);
    const cy = y(b.day ?? 0);
    const rr = r(b.value);
    const text = b.label.length > 14 ? 14 : b.label.length;
    const w = text * 6.2;
    if (rr * 2 >= w + 8) {
      boxes.push({ l: cx - w / 2, r: cx + w / 2, t: cy - 7, b: cy + 6 });
      out.set(b.id, { x: cx, y: cy + 4, anchor: "middle", inside: true });
      continue;
    }
    const options = [
      { x: cx + rr + 5, y: cy + 4, anchor: "start" as const, box: { l: cx + rr + 4, r: cx + rr + 6 + w, t: cy - 7, b: cy + 6 } },
      { x: cx - rr - 5, y: cy + 4, anchor: "end" as const, box: { l: cx - rr - 6 - w, r: cx - rr - 4, t: cy - 7, b: cy + 6 } },
      { x: cx, y: cy - rr - 5, anchor: "middle" as const, box: { l: cx - w / 2, r: cx + w / 2, t: cy - rr - 16, b: cy - rr - 3 } },
    ];
    const pick = options.find((o) => !hit(o.box) && o.box.l >= bounds.l && o.box.r <= bounds.r);
    if (!pick) continue;
    boxes.push(pick.box);
    out.set(b.id, { x: pick.x, y: pick.y, anchor: pick.anchor, inside: false });
  }
  return out;
}
