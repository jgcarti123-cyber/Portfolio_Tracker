"use client";

import { useMemo, useState } from "react";
import { CASH_COLOR, type CashBalances } from "@/lib/cash";
import { compact, money, pct } from "@/lib/format";
import { shortName } from "@/lib/insights";
import { convert, dayPct, type Position } from "@/lib/portfolio";
import { CLASS_META, CLASS_ORDER, type AssetClass, type Currency } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { useSize } from "./insights/kit";
import { GlowBar, Inspector, ItemRow, LENS_H, LensGrid, PanelButton, PanelHead, Pill, Pills, Section, Stat, Stats } from "./lens-kit";
import { BigMoney } from "./NetWorthChart";
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
  /** Today's move, % (null without a daily price or when its market hasn't traded today). */
  day: number | null;
  /** Its market hasn't traded today. */
  closed: boolean;
  pos?: Position;
}

const orbitIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <circle cx="8" cy="8" r="2" />
    <ellipse cx="8" cy="8" rx="6.5" ry="3.2" transform="rotate(-25 8 8)" />
  </svg>
);

const signed = (v: number, c: Currency) => `${v >= 0 ? "+" : "−"}${compact(Math.abs(v), c)}`;

/**
 * Your holdings as an orbit: each asset type is a ring, each holding a glowing body sized by
 * value with a halo for today's move. Rings turn slowly; hovering pauses them. The panel on
 * the right reads out whatever you hover or the asset type you pick.
 */
export function HoldingsOrbit({
  positions,
  currency,
  usdInr,
  onOpen,
  cash,
  onCash,
  bare = false,
}: {
  positions: Position[];
  currency: Currency;
  usdInr: number;
  onOpen: (id: string) => void;
  /** Cash balances; shown as the innermost ring. */
  cash?: CashBalances;
  onCash?: () => void;
  bare?: boolean;
}) {
  const [ref, box] = useSize<HTMLDivElement>();
  // hover: a body under the pointer (the panel reads it out). peek: a row in the panel
  // under the pointer (only highlighted in the orbit, so the panel doesn't swap under you).
  const [hover, setHover] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
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
          day: dayPct(p),
          closed: p.closedToday,
          pos: p,
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
              closed: false,
            })),
        )
        .sort((a, b) => b.value - a.value),
    [positions, currency, usdInr, cash],
  );
  const total = bodies.reduce((s, b) => s + b.value, 0);
  const moved = (list: Body[]) => list.reduce((s, b) => s + (b.day !== null ? (b.value * b.day) / (100 + b.day) : 0), 0);
  const rings = (["cash", ...CLASS_ORDER] as Ring[])
    .map((cls) => {
      const list = bodies.filter((b) => b.cls === cls);
      return { cls, list, value: list.reduce((s, b) => s + b.value, 0), moved: moved(list) };
    })
    .filter((r) => r.list.length);

  if (!bodies.length) return null;
  const open = (b: Body) => (b.cls === "cash" ? onCash?.() : onOpen(b.id));
  const toggle = (cls: Ring | null) => setFocus((f) => (cls === null || f === cls ? null : cls));

  const S = Math.max(260, Math.min(box.w || LENS_H, LENS_H - 20));
  const C = S / 2;
  const R = S / 2 - 24;
  const inner = R * 0.34;
  const gap = rings.length > 1 ? (R - inner) / (rings.length - 1) : 0;
  const maxV = bodies[0].value;
  const size = (v: number) => 4 + 13 * Math.sqrt(v / maxV);
  const h = bodies.find((b) => b.id === hover) ?? null;
  const fr = rings.find((r) => r.cls === focus) ?? null;
  const lit = hover ?? peek;
  const paused = !!lit || !!focus;
  const holdings = bodies.filter((b) => b.cls !== "cash");
  const centre = fr ?? null;

  return (
    <Card className="flex h-full flex-col p-5 sm:p-6" bare={bare}>
      {!bare && <CardHead icon={orbitIcon} title="Holdings orbit" color="var(--cat-4)" />}

      <div className={bare ? "" : "mt-4"}>
        <Pills label="Asset type">
          <Pill on={!focus} onClick={() => toggle(null)} label="All" figure={compact(total, currency)} />
          {rings.map((ring) => (
            <Pill key={ring.cls} on={focus === ring.cls} onClick={() => toggle(ring.cls)} label={meta(ring.cls).label} dot={meta(ring.cls).color} figure={`${Math.round((ring.value / total) * 100)}%`} />
          ))}
        </Pills>
      </div>

      <LensGrid>
        <div ref={ref} className="relative flex min-w-0 items-center justify-center xl:h-[500px]" onPointerLeave={() => setHover(null)}>
          <div className="relative" style={{ width: S, height: S }}>
            <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="orbit absolute inset-0 overflow-visible" data-paused={paused} role="img" aria-label="Your holdings as rings by asset type">
              <defs>
                <radialGradient id="orbit-core" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.26} />
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
                  <g key={ring.cls} opacity={dim ? 0.16 : 1} style={{ transition: "opacity .3s" }}>
                    <circle cx={C} cy={C} r={r} fill="none" stroke={color} strokeOpacity={focus === ring.cls ? 0.7 : 0.28} strokeWidth={focus === ring.cls ? 1.5 : 1} />
                    {/* A wide invisible stroke makes the ring easy to click */}
                    <circle cx={C} cy={C} r={r} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onClick={() => toggle(ring.cls)} />
                    <g className="orbit-ring" style={{ transformOrigin: `${C}px ${C}px`, animationDuration: `${90 + i * 45}s`, animationDirection: i % 2 ? "reverse" : "normal" }}>
                      {ring.list.map((b, k) => {
                        const ang = (k / ring.list.length) * Math.PI * 2 + i * 0.9;
                        const bx = C + r * Math.cos(ang);
                        const by = C + r * Math.sin(ang);
                        const rr = size(b.value);
                        const on = lit === b.id;
                        const halo = b.day === null ? null : b.day >= 0 ? "var(--up)" : "var(--down)";
                        return (
                          <g
                            key={b.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${b.name}: ${money(b.value, currency, { decimals: 0 })}, ${pct(b.ret)} overall`}
                            className="cursor-pointer outline-none"
                            opacity={lit && !on ? 0.45 : 1}
                            style={{ transition: "opacity .2s" }}
                            onPointerEnter={() => setHover(b.id)}
                            onFocus={() => setHover(b.id)}
                            onBlur={() => setHover(null)}
                            onClick={(e) => (e.stopPropagation(), open(b))}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(b))}
                          >
                            {halo && <circle cx={bx} cy={by} r={rr + 4 + Math.min(6, Math.abs(b.day ?? 0))} fill={halo} opacity={on ? 0.35 : 0.14} />}
                            {on && <circle cx={bx} cy={by} r={rr * 1.25 + 4} fill="none" stroke="var(--ink)" strokeOpacity={0.7} strokeWidth={1.2} />}
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
            {/* Centre: the total, or the asset type you picked */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 w-[44%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div key={centre?.cls ?? "all"} className="fade-in">
                <p className="label truncate text-[9.5px] text-ink-3">{centre ? meta(centre.cls).label : rings.some((r) => r.cls === "cash") ? "Holdings + cash" : "Holdings"}</p>
                <p className="num mt-1.5 text-[26px] font-light leading-none tracking-[-0.03em]">{compact(centre?.value ?? total, currency)}</p>
                <p className="num mt-1.5 text-[11px] text-ink-3">{centre ? `${Math.round((centre.value / total) * 100)}% of everything` : `${holdings.length} holdings · ${rings.filter((r) => r.cls !== "cash").length} types`}</p>
              </div>
            </div>
          </div>
        </div>

        <Inspector>
          {h ? (
            <BodyDetail key={h.id} b={h} total={total} currency={currency} onOpen={() => open(h)} />
          ) : fr ? (
            <div key={fr.cls} className="item-in flex min-h-0 flex-1 flex-col">
              <PanelHead label={meta(fr.cls).label} dot={meta(fr.cls).color}>
                {fr.cls === "cash" && onCash && <PanelButton onClick={onCash}>Add or withdraw</PanelButton>}
              </PanelHead>
              <p className="mt-3 text-[40px] text-white">
                <BigMoney value={fr.value} currency={currency} />
              </p>
              <Stats>
                <Stat label="Share" value={`${Math.round((fr.value / total) * 100)}%`} />
                <Stat label={fr.cls === "cash" ? "Balances" : "Holdings"} value={fr.list.length} />
                <Stat label="Today" value={fr.cls === "cash" ? "–" : signed(fr.moved, currency)} tone={fr.cls === "cash" ? 0 : fr.moved} />
              </Stats>
              <Section title="Largest first" grow>
                <div className="-mx-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                  {fr.list.map((b) => (
                    <ItemRow
                      key={b.id}
                      badge={<BodyBadge b={b} size={22} />}
                      label={b.label}
                      sub={`${compact(b.value, currency)} · ${Math.round((b.value / fr.value) * 100)}%`}
                      value={b.cls === "cash" ? "" : pct(b.ret)}
                      tone={b.cls === "cash" ? 0 : b.ret}
                      active={peek === b.id}
                      onHover={(on) => setPeek(on ? b.id : null)}
                      onClick={() => open(b)}
                    />
                  ))}
                </div>
              </Section>
            </div>
          ) : (
            <div className="item-in flex min-h-0 flex-1 flex-col">
              <PanelHead label={rings.some((r) => r.cls === "cash") ? "Holdings + cash" : "Holdings"} />
              <p className="mt-3 text-[40px] text-white">
                <BigMoney value={total} currency={currency} />
              </p>
              <p className={`num mt-2 text-[13px] font-semibold ${moved(bodies) >= 0 ? "text-up" : "text-down"}`}>
                {signed(moved(bodies), currency)} <span className="label ml-1 text-[9.5px] text-white/45">today</span>
              </p>
              <Stats>
                <Stat label="Holdings" value={holdings.length} />
                <Stat label="Types" value={rings.filter((r) => r.cls !== "cash").length} />
                <Stat label="Cash" value={`${Math.round(((rings.find((r) => r.cls === "cash")?.value ?? 0) / total) * 100)}%`} />
              </Stats>
              <Section title="Allocation">
                <ul className="-mx-2">
                  {rings.map((ring) => {
                    const share = ring.value / total;
                    return (
                      <li key={ring.cls}>
                        <button type="button" onClick={() => toggle(ring.cls)} className="press w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
                          <span className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-white/90">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="size-[7px] shrink-0 rounded-full" style={{ background: meta(ring.cls).color, boxShadow: `0 0 8px ${meta(ring.cls).color}` }} />
                              <span className="truncate">{meta(ring.cls).label}</span>
                            </span>
                            <span className="num flex shrink-0 items-baseline gap-2">
                              <span className="text-[11px] font-normal text-white/45">{compact(ring.value, currency)}</span>
                              <span className="w-9 text-right">{Math.round(share * 100)}%</span>
                            </span>
                          </span>
                          <GlowBar share={share} color={meta(ring.cls).color} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </div>
          )}
        </Inspector>
      </LensGrid>
    </Card>
  );
}

function BodyBadge({ b, size = 30 }: { b: Body; size?: number }) {
  if (b.pos) return <AssetBadge position={b.pos} size={size} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-white/[0.06] text-[11px] font-bold text-white/60 ring-1 ring-white/10" style={{ width: size, height: size }}>
      {b.id.endsWith("USD") ? "$" : "₹"}
    </span>
  );
}

function BodyDetail({ b, total, currency, onOpen }: { b: Body; total: number; currency: Currency; onOpen: () => void }) {
  const isCash = b.cls === "cash";
  return (
    <div className="item-in flex flex-1 flex-col">
      <PanelHead label={meta(b.cls).label} dot={meta(b.cls).color}>
        <PanelButton onClick={onOpen}>{isCash ? "Add or withdraw" : "Open"}</PanelButton>
      </PanelHead>
      <div className="mt-4 flex items-center gap-3">
        <BodyBadge b={b} size={36} />
        <p className="min-w-0 truncate text-[14px] font-semibold text-white/90">{b.name}</p>
      </div>
      <p className="mt-3 text-[40px] text-white">
        <BigMoney value={b.value} currency={currency} />
      </p>
      {!isCash && (
        <p className={`num mt-2 text-[13px] font-semibold ${b.ret >= 0 ? "text-up" : "text-down"}`}>
          {pct(b.ret)} <span className="label ml-1 text-[9.5px] text-white/45">since you bought</span>
        </p>
      )}
      <Stats>
        <Stat label="Share" value={`${((b.value / total) * 100).toFixed(1)}%`} />
        <Stat label="Overall" value={isCash ? "–" : pct(b.ret)} tone={isCash ? 0 : b.ret} />
        <Stat label="Today" value={b.day === null ? "–" : pct(b.day)} tone={b.day ?? 0} sub={b.closed ? "Market closed" : b.day === null && !isCash ? "No daily price" : undefined} />
      </Stats>
      <Section title="Share of everything">
        <GlowBar share={b.value / total} color={meta(b.cls).color} />
      </Section>
    </div>
  );
}
