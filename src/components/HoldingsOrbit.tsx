"use client";

import { useMemo, useState } from "react";
import { CASH_COLOR, type CashBalances } from "@/lib/cash";
import { compact, money, pct } from "@/lib/format";
import { shortName } from "@/lib/insights";
import { convert, type Position } from "@/lib/portfolio";
import { CLASS_META, CLASS_ORDER, type AssetClass, type Currency } from "@/lib/types";
import { useSize } from "./insights/kit";
import { Card, CardHead } from "./ui";

type Ring = AssetClass | "cash";
const meta = (cls: Ring) => (cls === "cash" ? { label: "Cash", short: "Cash", color: CASH_COLOR } : CLASS_META[cls]);

interface Body {
  id: string;
  label: string;
  name: string;
  cls: Ring;
  value: number;
  /** Return since bought, %. */
  ret: number;
  /** Today's move, % (null without a daily price). */
  day: number | null;
}

const orbitIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <circle cx="8" cy="8" r="2" />
    <ellipse cx="8" cy="8" rx="6.5" ry="3.2" transform="rotate(-25 8 8)" />
  </svg>
);

/**
 * Your holdings as an orbit: each asset type is a ring, each holding a glowing body sized by
 * value with a halo for today's move. Rings turn slowly; hover pauses and reads a body out,
 * click a ring to focus its asset type, click a body to open the holding.
 */
export function HoldingsOrbit({
  positions,
  currency,
  usdInr,
  onOpen,
  cash,
  onCash,
}: {
  positions: Position[];
  currency: Currency;
  usdInr: number;
  onOpen: (id: string) => void;
  /** Cash balances; shown as the innermost ring. */
  cash?: CashBalances;
  onCash?: () => void;
}) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<Ring | null>(null);

  const bodies = useMemo<Body[]>(
    () =>
      positions
        .filter((p) => p.qty > 0)
        .map((p): Body => ({
          id: p.asset.id,
          label: shortName(p.asset),
          name: p.asset.name,
          cls: p.asset.cls,
          value: convert(p.value ?? p.cost, p.asset.currency, currency, usdInr),
          ret: p.cost > 0 && p.gain !== null ? (p.gain / p.cost) * 100 : 0,
          day: p.price !== null && p.prevClose ? (p.price / p.prevClose - 1) * 100 : null,
        }))
        .concat(
          (["INR", "USD"] as const)
            .filter((c) => (cash?.[c] ?? 0) > 0)
            .map((c) => ({
              id: `cash:${c}`,
              label: c === "INR" ? "Rupee cash" : "Dollar cash",
              name: c === "INR" ? "Cash in rupees" : "Cash in dollars",
              cls: "cash" as const,
              value: convert(cash![c], c, currency, usdInr),
              ret: 0,
              day: null,
            })),
        )
        .sort((a, b) => b.value - a.value),
    [positions, currency, usdInr, cash],
  );
  const total = bodies.reduce((s, b) => s + b.value, 0);
  const rings = (["cash", ...CLASS_ORDER] as Ring[]).map((cls) => {
    const list = bodies.filter((b) => b.cls === cls);
    const value = list.reduce((s, b) => s + b.value, 0);
    const moved = list.reduce((s, b) => s + (b.day !== null ? (b.value * b.day) / (100 + b.day) : 0), 0);
    return { cls, list, value, moved };
  }).filter((r) => r.list.length);

  if (!bodies.length) return null;
  const open = (b: Body) => (b.cls === "cash" ? onCash?.() : onOpen(b.id));

  const S = Math.max(240, Math.min(box.w || 360, 420));
  const C = S / 2;
  const R = S / 2 - 22;
  const inner = R * 0.36;
  const gap = rings.length > 1 ? (R - inner) / (rings.length - 1) : 0;
  const maxV = bodies[0].value;
  const size = (v: number) => 4 + 13 * Math.sqrt(v / maxV);
  const h = bodies.find((b) => b.id === hover) ?? null;
  const fr = rings.find((r) => r.cls === focus) ?? null;
  const paused = !!hover || !!focus;

  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <CardHead icon={orbitIcon} title="Holdings orbit" color="var(--cat-4)">
        <span className="label text-[10px] text-ink-3">
          {bodies.filter((b) => b.cls !== "cash").length} holdings · {rings.filter((r) => r.cls !== "cash").length} types
        </span>
      </CardHead>

      <div className="mt-4 grid flex-1 items-center gap-5 md:grid-cols-[minmax(0,1fr)_190px]">
        <div ref={ref} className="relative mx-auto w-full max-w-[420px]" style={{ height: S }} onPointerLeave={() => setHover(null)}>
          <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="orbit absolute left-1/2 top-0 -translate-x-1/2 overflow-visible" data-paused={paused} role="img" aria-label="Your holdings as rings by asset type">
            <defs>
              <radialGradient id="orbit-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                <stop offset="70%" stopColor="var(--accent)" stopOpacity={0.04} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </radialGradient>
              <filter id="orbit-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle cx={C} cy={C} r={inner * 0.95} fill="url(#orbit-core)" />
            {rings.map((ring, i) => {
              const r = inner + i * gap;
              const dim = focus && focus !== ring.cls;
              const color = meta(ring.cls).color;
              return (
                <g key={ring.cls} opacity={dim ? 0.18 : 1} style={{ transition: "opacity .3s" }}>
                  {/* The ring itself; a wide invisible stroke makes it easy to click */}
                  <circle cx={C} cy={C} r={r} fill="none" stroke={color} strokeOpacity={focus === ring.cls ? 0.75 : 0.34} strokeWidth={focus === ring.cls ? 1.5 : 1} strokeDasharray={i % 2 ? "2 5" : undefined} />
                  <circle
                    cx={C}
                    cy={C}
                    r={r}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    onClick={() => setFocus((f) => (f === ring.cls ? null : ring.cls))}
                  />
                  <g className="orbit-ring" style={{ transformOrigin: `${C}px ${C}px`, animationDuration: `${90 + i * 45}s`, animationDirection: i % 2 ? "reverse" : "normal" }}>
                    {ring.list.map((b, k) => {
                      const ang = (k / ring.list.length) * Math.PI * 2 + i * 0.9;
                      const bx = C + r * Math.cos(ang);
                      const by = C + r * Math.sin(ang);
                      const rr = size(b.value);
                      const on = hover === b.id;
                      const halo = b.day === null ? null : b.day >= 0 ? "var(--up)" : "var(--down)";
                      return (
                        <g
                          key={b.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${b.name}: ${money(b.value, currency, { decimals: 0 })}, ${pct(b.ret)} overall`}
                          className="cursor-pointer outline-none"
                          onPointerEnter={() => setHover(b.id)}
                          onFocus={() => setHover(b.id)}
                          onBlur={() => setHover(null)}
                          onClick={(e) => (e.stopPropagation(), open(b))}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(b))}
                        >
                          {halo && <circle cx={bx} cy={by} r={rr + 4 + Math.min(6, Math.abs(b.day ?? 0))} fill={halo} opacity={on ? 0.35 : 0.16} />}
                          <circle cx={bx} cy={by} r={on ? rr * 1.25 : rr} fill={color} filter="url(#orbit-glow)" style={{ transition: "r .25s" }} />
                          <circle cx={bx - rr * 0.3} cy={by - rr * 0.3} r={Math.max(1, rr * 0.28)} fill="white" opacity={0.35} />
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })}
          </svg>
          {/* Centre readout */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 w-[46%] -translate-x-1/2 -translate-y-1/2 text-center">
            {h ? (
              <div key={h.id} className="fade-in">
                <p className="label truncate text-[9.5px] text-ink-3">{meta(h.cls).short}</p>
                <p className="mt-1 truncate text-[13px] font-semibold">{h.label}</p>
                <p className="num mt-1 text-[20px] font-light tracking-[-0.03em]">{compact(h.value, currency)}</p>
                <p className="num mt-0.5 text-[11px] text-ink-3">{Math.round((h.value / total) * 100)}% of everything</p>
                {h.cls === "cash" ? (
                  <p className="mt-1 text-[11px] font-semibold text-accent">Click to add or withdraw</p>
                ) : (
                  <p className={`num mt-1 text-[11.5px] font-semibold ${h.ret >= 0 ? "text-up" : "text-down"}`}>{pct(h.ret)} overall</p>
                )}
                {h.day !== null && <p className={`num text-[11px] ${h.day >= 0 ? "text-up" : "text-down"}`}>{pct(h.day)} today</p>}
              </div>
            ) : fr ? (
              <div key={fr.cls} className="fade-in">
                <p className="label text-[9.5px] text-ink-3">{meta(fr.cls).label}</p>
                <p className="num mt-1.5 text-[24px] font-light tracking-[-0.03em]">{compact(fr.value, currency)}</p>
                <p className="num mt-0.5 text-[11px] text-ink-3">
                  {Math.round((fr.value / total) * 100)}% · {fr.list.length} holding{fr.list.length === 1 ? "" : "s"}
                </p>
                <p className={`num mt-1 text-[11.5px] font-semibold ${fr.moved >= 0 ? "text-up" : "text-down"}`}>
                  {fr.moved >= 0 ? "+" : "−"}
                  {compact(Math.abs(fr.moved), currency)} today
                </p>
              </div>
            ) : (
              <div className="fade-in">
                <p className="label text-[9.5px] text-ink-3">{rings.some((r) => r.cls === "cash") ? "Holdings + cash" : "Holdings"}</p>
                <p className="num mt-1.5 text-[26px] font-light tracking-[-0.03em]">{compact(total, currency)}</p>
                <p className="mt-1 text-[11px] text-ink-3">Hover a body · click a ring</p>
              </div>
            )}
          </div>
        </div>

        {/* Legend: one row per ring, synced with the orbit */}
        <ul className="space-y-1.5">
          {rings.map((ring) => {
            const share = ring.value / total;
            const on = focus === ring.cls;
            return (
              <li key={ring.cls}>
                <button
                  type="button"
                  onClick={() => setFocus((f) => (f === ring.cls ? null : ring.cls))}
                  aria-pressed={on}
                  className={`press w-full rounded-xl px-3 py-2.5 text-left transition-colors ${on ? "bg-sunken ring-1 ring-line" : "hover:bg-sunken/70"} ${focus && !on ? "opacity-45" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: meta(ring.cls).color, boxShadow: `0 0 8px ${meta(ring.cls).color}` }} />
                      <span className="truncate">{meta(ring.cls).label}</span>
                    </span>
                    <span className="num shrink-0 text-[12.5px] font-semibold">{Math.round(share * 100)}%</span>
                  </span>
                  <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-sunken">
                    <span className="seg-grow block h-full rounded-full" style={{ width: `${share * 100}%`, background: meta(ring.cls).color }} />
                  </span>
                  <span className="num mt-1 block text-[11px] text-ink-3">
                    {compact(ring.value, currency)} ·{" "}
                    {ring.cls === "cash" ? (
                      <span
                        role="link"
                        tabIndex={0}
                        className="font-semibold text-accent hover:underline"
                        onClick={(e) => (e.stopPropagation(), onCash?.())}
                        onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onCash?.())}
                      >
                        Add or withdraw
                      </span>
                    ) : (
                      <>
                        {ring.list.length} holding{ring.list.length === 1 ? "" : "s"}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
