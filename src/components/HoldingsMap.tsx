"use client";

import { useMemo, useState } from "react";
import { compact, money, pct } from "@/lib/format";
import { convert, dayPct, type Position } from "@/lib/portfolio";
import { CLASS_META, CLASS_ORDER, type AssetClass, type Currency } from "@/lib/types";
import { shortName } from "@/lib/insights";
import { AssetBadge } from "./AssetBadge";
import { useSize } from "./insights/kit";
import { Inspector, ItemRow, LensGrid, PanelButton, PanelHead, Pill, Pills, Section, Stat, Stats } from "./lens-kit";
import { BigMoney } from "./NetWorthChart";
import { Card, CardHead } from "./ui";

interface Bubble {
  id: string;
  label: string;
  name: string;
  cls: AssetClass;
  color: string;
  value: number;
  /** Total return since you bought, %. */
  ret: number;
  /** Today's price move, % (null when there's no daily price or its market hasn't traded today). */
  day: number | null;
  /** Its market hasn't traded today. */
  closed: boolean;
  pos: Position;
}

const bubbleIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="5.5" cy="10" r="3" />
    <circle cx="11" cy="5.5" r="2.5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

/**
 * Return axis: 0% in the middle, equal room either side, small returns stretched and big
 * ones squeezed (a signed log), so a few outliers don't crush everything else into a clump.
 */
const sx = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const fmtPct = (t: number) => (t === 0 ? "0%" : `${t > 0 ? "+" : "−"}${Math.abs(t) < 1 ? Math.abs(t).toFixed(1) : Math.abs(t).toFixed(0)}%`);

function quadrant(b: Bubble) {
  const gain = b.ret >= 0 ? "In profit" : "At a loss";
  if (b.closed) return `${gain} · market closed today`;
  if (b.day === null) return `${gain} · no daily price`;
  return `${gain} and ${b.day >= 0 ? "up" : "down"} today`;
}

/**
 * Everything you hold on one map: across = total return, up = today's move, size = what it's
 * worth, colour = asset type. Winners sit top-right, laggards bottom-left. Click to open one.
 */
export function HoldingsMap({ positions, currency, usdInr, onOpen, bare = false }: { positions: Position[]; currency: Currency; usdInr: number; onOpen: (id: string) => void; bare?: boolean }) {
  const [ref, box] = useSize<HTMLDivElement>();
  // hover: a bubble under the pointer (the panel reads it out). peek: a row in the panel
  // under the pointer (only highlighted on the map, so the panel doesn't swap under you).
  const [hover, setHover] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [focus, setFocus] = useState<AssetClass | null>(null);
  const bubbles = useMemo<Bubble[]>(
    () =>
      positions
        .filter((p) => p.qty > 0)
        .map((p) => ({
          id: p.asset.id,
          label: shortName(p.asset),
          name: p.asset.name,
          cls: p.asset.cls,
          color: CLASS_META[p.asset.cls].color,
          value: convert(p.value ?? p.cost, p.asset.currency, currency, usdInr),
          ret: p.cost > 0 && p.gain !== null ? (p.gain / p.cost) * 100 : 0,
          day: dayPct(p),
          closed: p.closedToday,
          pos: p,
        }))
        .sort((a, b) => b.value - a.value),
    [positions, currency, usdInr],
  );
  if (!bubbles.length) return null;

  const W = box.w;
  const H = Math.max(280, box.h);
  const M = { l: 44, r: 2, t: 1, b: 26 };
  const plotW = Math.max(10, W - M.l - M.r);
  const plotH = H - M.t - M.b;
  const maxV = bubbles[0].value;
  const rMax = Math.max(14, Math.min(28, plotW / 18));
  // Keep the largest bubble inside the frame at the extremes, symmetric on every side.
  const pad = rMax + 6;
  const maxRet = Math.max(2, ...bubbles.map((b) => Math.abs(b.ret))) * 1.1;
  const D = sx(maxRet);
  const x = (v: number) => M.l + pad + ((sx(v) / D + 1) / 2) * (plotW - 2 * pad);
  const yM = Math.max(0.5, ...bubbles.map((b) => Math.abs(b.day ?? 0))) * 1.1;
  const y = (v: number) => M.t + pad + ((yM - v) / (2 * yM)) * (plotH - 2 * pad);
  const r = (v: number) => Math.max(5, rMax * Math.sqrt(v / maxV));

  // Ticks outward from 0, mirrored, keeping only those with room between them.
  const xTicks = [0];
  let lastPx = 0;
  for (const s of STEPS) {
    if (s > maxRet) break;
    const px = x(s) - x(0);
    if (px - lastPx < 46) continue;
    xTicks.push(s, -s);
    lastPx = px;
  }
  const yTicks = niceTicks(-yM, yM, 4);

  const inView = (b: Bubble) => !focus || b.cls === focus;
  const shown = bubbles.filter(inView);
  const priced = shown.filter((b) => b.day !== null);
  const up = priced.filter((b) => (b.day ?? 0) > 0).length;
  const winners = shown.filter((b) => b.ret > 0).length;
  const shownValue = shown.reduce((s, b) => s + b.value, 0);
  const total = bubbles.reduce((s, b) => s + b.value, 0);
  const byRet = [...shown].sort((a, b) => b.ret - a.ret);
  const n = Math.min(3, Math.floor(byRet.length / 2) || 1);
  const best = byRet.slice(0, n);
  const worst = byRet.length > 1 ? byRet.slice(-n).reverse() : [];

  const h = bubbles.find((b) => b.id === hover) ?? null;
  const lit = hover ?? peek;
  const labels = W > 0 ? placeLabels(shown, x, y, r, { l: M.l, r: M.l + plotW }) : new Map<string, LabelSpot>();
  const classes = CLASS_ORDER.filter((c) => bubbles.some((b) => b.cls === c));
  const x0 = x(0);
  const y0 = y(0);

  return (
    <Card className="flex h-full flex-col p-5" bare={bare}>
      {!bare && <CardHead icon={bubbleIcon} title="Your holdings" color="var(--cat-2)" />}

      <div className={bare ? "" : "mt-4"}>
        <Pills label="Asset type">
          <Pill on={!focus} onClick={() => setFocus(null)} label="All" figure={bubbles.length} />
          {classes.map((c) => (
            <Pill key={c} on={focus === c} onClick={() => setFocus((f) => (f === c ? null : c))} label={CLASS_META[c].label} dot={CLASS_META[c].color} figure={bubbles.filter((b) => b.cls === c).length} />
          ))}
        </Pills>
      </div>

      <LensGrid>
        <div className="flex min-w-0 flex-col">
          <div ref={ref} className="relative h-[340px] min-w-0 xl:h-[472px]" onPointerLeave={() => setHover(null)}>
            {W > 0 && (
              <svg width={W} height={H} className="absolute inset-0 block overflow-visible" role="img" aria-label="Holdings by return since you bought and today's move">
                <defs>
                  <radialGradient id="map-shine" cx="35%" cy="30%" r="70%">
                    <stop offset="0%" stopColor="white" stopOpacity={0.35} />
                    <stop offset="60%" stopColor="white" stopOpacity={0} />
                  </radialGradient>
                </defs>
                {/* Four equal quadrants; the two that agree (profit & up, loss & down) are tinted */}
                <rect x={x0} y={M.t} width={M.l + plotW - x0} height={y0 - M.t} fill="var(--up)" opacity={0.05} />
                <rect x={M.l} y={y0} width={x0 - M.l} height={M.t + plotH - y0} fill="var(--down)" opacity={0.05} />
                <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="none" stroke="var(--line)" rx={10} />
                {(
                  [
                    ["In profit · up today", M.l + plotW - 10, M.t + 18, "end"],
                    ["At a loss · up today", M.l + 10, M.t + 18, "start"],
                    ["At a loss · down today", M.l + 10, M.t + plotH - 10, "start"],
                    ["In profit · down today", M.l + plotW - 10, M.t + plotH - 10, "end"],
                  ] as const
                ).map(([t, tx, ty, a]) => {
                  // Step aside for any holding sitting in that corner.
                  const w = t.length * 7;
                  const l = a === "end" ? tx - w : tx;
                  const covered = shown.some((b) => {
                    const cx = x(b.ret);
                    const cy = y(b.day ?? 0);
                    const rr = r(b.value) + 3;
                    return cx + rr > l && cx - rr < l + w && cy + rr > ty - 10 && cy - rr < ty + 2;
                  });
                  return covered ? null : (
                    <text key={t} x={tx} y={ty} textAnchor={a} className="label pointer-events-none fill-ink-3 text-[8.5px]" opacity={0.55}>
                      {t}
                    </text>
                  );
                })}
                {yTicks.map((t) => (
                  <g key={`y${t}`}>
                    {t !== 0 && <line x1={M.l} x2={M.l + plotW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" />}
                    <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="num fill-ink-3 text-[10.5px]">
                      {fmtPct(t)}
                    </text>
                  </g>
                ))}
                {xTicks.map((t) => (
                  <g key={`x${t}`}>
                    {t !== 0 && <line x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + plotH} stroke="var(--line)" strokeDasharray="2 5" />}
                    <text x={x(t)} y={H - 8} textAnchor="middle" className="num fill-ink-3 text-[10.5px]">
                      {fmtPct(t)}
                    </text>
                  </g>
                ))}
                {/* The zero cross */}
                <line x1={M.l} x2={M.l + plotW} y1={y0} y2={y0} stroke="var(--ink-3)" strokeOpacity={0.45} />
                <line x1={x0} x2={x0} y1={M.t} y2={M.t + plotH} stroke="var(--ink-3)" strokeOpacity={0.45} />

                {bubbles.map((b, i) => {
                  const on = lit === b.id;
                  const dim = !inView(b) ? 0.1 : lit && !on ? 0.3 : 1;
                  const cx = x(b.ret);
                  const cy = y(b.day ?? 0);
                  const rr = r(b.value);
                  return (
                    <g
                      key={b.id}
                      role="button"
                      tabIndex={inView(b) ? 0 : -1}
                      aria-label={`${b.name}: ${money(b.value, currency, { decimals: 0 })}, ${pct(b.ret)} overall${b.day !== null ? `, ${pct(b.day)} today` : ""}`}
                      onPointerEnter={() => inView(b) && setHover(b.id)}
                      onFocus={() => setHover(b.id)}
                      onBlur={() => setHover(null)}
                      onClick={() => inView(b) && onOpen(b.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(b.id))}
                      className={inView(b) ? "cursor-pointer outline-none" : "pointer-events-none"}
                      opacity={dim}
                      style={{ transition: "opacity .25s" }}
                    >
                      <g className="pop-in" style={{ animationDelay: `${i * 30}ms`, transformOrigin: `${cx}px ${cy}px` }}>
                        {on && <circle cx={cx} cy={cy} r={rr + 5} fill="none" stroke="var(--ink)" strokeOpacity={0.7} strokeWidth={1.2} />}
                        <circle cx={cx} cy={cy} r={rr} fill={b.color} fillOpacity={b.closed ? 0.5 : b.day === null ? 0.3 : 0.88} stroke="var(--surface)" strokeWidth={1.5} strokeDasharray={b.day === null && !b.closed ? "3 2" : undefined} />
                        {b.day !== null && <circle cx={cx} cy={cy} r={rr} fill="url(#map-shine)" />}
                      </g>
                    </g>
                  );
                })}
                {shown.map((b) => {
                  const l = labels.get(b.id);
                  if (!l) return null;
                  return (
                    <text
                      key={`t${b.id}`}
                      x={l.x}
                      y={l.y}
                      textAnchor={l.anchor}
                      className={`pointer-events-none text-[11px] font-semibold ${l.inside ? "fill-white" : "fill-ink-2"}`}
                      opacity={lit && lit !== b.id ? 0.3 : 1}
                      stroke={l.inside ? undefined : "var(--surface)"}
                      strokeWidth={l.inside ? undefined : 3}
                      paintOrder="stroke"
                    >
                      {clip(b.label)}
                    </text>
                  );
                })}
              </svg>
            )}
          </div>
          <p className="mt-2 flex items-center justify-between pl-[44px] pr-0.5text-[10.5px] text-ink-3">
            <span>← At a loss</span>
            <span className="label text-[9px]">Return since you bought · size = value</span>
            <span>In profit →</span>
          </p>
        </div>

        <Inspector>
          {h ? (
            <div key={h.id} className="item-in flex flex-1 flex-col">
              <PanelHead label={CLASS_META[h.cls].label} dot={h.color}>
                <PanelButton onClick={() => onOpen(h.id)}>Open</PanelButton>
              </PanelHead>
              <div className="mt-4 flex items-center gap-3">
                <AssetBadge position={h.pos} size={36} />
                <p className="min-w-0 truncate text-[14px] font-semibold text-white/90">{h.name}</p>
              </div>
              <p className="mt-2.5 text-[36px] text-white">
                <BigMoney value={h.value} currency={currency} />
              </p>
              <p className={`num mt-2 text-[13px] font-semibold ${h.ret >= 0 ? "text-up" : "text-down"}`}>
                {pct(h.ret)} <span className="label ml-1 text-[9.5px] text-white/45">since you bought</span>
              </p>
              <Stats>
                <Stat label="Overall" value={pct(h.ret)} tone={h.ret} />
                <Stat label="Today" value={h.day === null ? "–" : pct(h.day)} tone={h.day ?? 0} sub={h.closed ? "Market closed" : h.day === null ? "No daily price" : undefined} />
                <Stat label="Share" value={`${((h.value / total) * 100).toFixed(1)}%`} />
              </Stats>
              <p className="mt-4 flex items-center gap-2 text-[12px] text-white/60">
                <span className="size-[6px] rounded-full" style={{ background: h.ret >= 0 ? "var(--up)" : "var(--down)", boxShadow: `0 0 8px ${h.ret >= 0 ? "var(--up)" : "var(--down)"}` }} />
                {quadrant(h)}
              </p>
            </div>
          ) : (
            <div key={focus ?? "all"} className="item-in flex min-h-0 flex-1 flex-col">
              <PanelHead label={focus ? CLASS_META[focus].label : "All holdings"} dot={focus ? CLASS_META[focus].color : undefined} />
              <p className="mt-2.5 text-[36px] text-white">
                <BigMoney value={shownValue} currency={currency} />
              </p>
              <Stats>
                <Stat label="Holdings" value={shown.length} />
                <Stat label="Up today" value={priced.length ? `${up}/${priced.length}` : "–"} tone={priced.length ? (up > priced.length / 2 ? 1 : up < priced.length / 2 ? -1 : 0) : 0} />
                <Stat label="In profit" value={`${winners}/${shown.length}`} tone={winners > shown.length / 2 ? 1 : winners < shown.length / 2 ? -1 : 0} />
              </Stats>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Section title="Best since you bought">
                  <div className="-mx-2">
                    {best.map((b) => (
                      <MapRow key={b.id} b={b} currency={currency} active={peek === b.id} setHover={setPeek} onOpen={onOpen} />
                    ))}
                  </div>
                </Section>
                {worst.length > 0 && (
                  <Section title="Worst since you bought">
                    <div className="-mx-2">
                      {worst.map((b) => (
                        <MapRow key={b.id} b={b} currency={currency} active={peek === b.id} setHover={setPeek} onOpen={onOpen} />
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            </div>
          )}
        </Inspector>
      </LensGrid>
    </Card>
  );
}

function MapRow({ b, currency, active, setHover, onOpen }: { b: Bubble; currency: Currency; active: boolean; setHover: (id: string | null) => void; onOpen: (id: string) => void }) {
  return (
    <ItemRow
      badge={<AssetBadge position={b.pos} size={22} />}
      label={b.label}
      sub={`${compact(b.value, currency)}${b.day !== null ? ` · ${pct(b.day)} today` : ""}`}
      value={pct(b.ret)}
      tone={b.ret}
      active={active}
      onHover={(on) => setHover(on ? b.id : null)}
      onClick={() => onOpen(b.id)}
    />
  );
}

const clip = (s: string) => (s.length > 13 ? `${s.slice(0, 12)}…` : s);

function niceTicks(lo: number, hi: number, count: number) {
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}

type LabelSpot = { x: number; y: number; anchor: "start" | "end" | "middle"; inside: boolean };

/** Label inside big bubbles; beside smaller ones where there's room. Crowded ones rely on hover. */
function placeLabels(bubbles: Bubble[], x: (v: number) => number, y: (v: number) => number, r: (v: number) => number, bounds: { l: number; r: number }) {
  const out = new Map<string, LabelSpot>();
  const box = (l: number, r: number, t: number, b: number) => ({ l, r, t, b });
  // Bubbles themselves are obstacles, so a label never sits on another holding.
  const boxes = bubbles.map((b) => {
    const cx = x(b.ret);
    const cy = y(b.day ?? 0);
    const rr = r(b.value);
    return { id: b.id, ...box(cx - rr, cx + rr, cy - rr, cy + rr) };
  });
  const hit = (a: ReturnType<typeof box>, self: string) => boxes.some((o) => o.id !== self && a.l < o.r && a.r > o.l && a.t < o.b && a.b > o.t);
  for (const b of bubbles) {
    const cx = x(b.ret);
    const cy = y(b.day ?? 0);
    const rr = r(b.value);
    const w = clip(b.label).length * 6.3;
    if (rr * 2 >= w + 8) {
      out.set(b.id, { x: cx, y: cy + 4, anchor: "middle", inside: true });
      continue;
    }
    const options = [
      { x: cx + rr + 5, y: cy + 4, anchor: "start" as const, box: box(cx + rr + 4, cx + rr + 6 + w, cy - 7, cy + 6) },
      { x: cx - rr - 5, y: cy + 4, anchor: "end" as const, box: box(cx - rr - 6 - w, cx - rr - 4, cy - 7, cy + 6) },
      { x: cx, y: cy - rr - 5, anchor: "middle" as const, box: box(cx - w / 2, cx + w / 2, cy - rr - 16, cy - rr - 3) },
      { x: cx, y: cy + rr + 13, anchor: "middle" as const, box: box(cx - w / 2, cx + w / 2, cy + rr + 2, cy + rr + 15) },
    ];
    const pick = options.find((o) => !hit(o.box, b.id) && o.box.l >= bounds.l && o.box.r <= bounds.r);
    if (!pick) continue;
    boxes.push({ id: `${b.id}:label`, ...pick.box });
    out.set(b.id, { x: pick.x, y: pick.y, anchor: pick.anchor, inside: false });
  }
  return out;
}
