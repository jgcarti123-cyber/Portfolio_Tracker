"use client";

import { useState } from "react";
import { compact, money, pct, signed } from "@/lib/format";
import { MOOD_FOR, moodColor, moodPosition, type MoodReading } from "@/lib/mood";
import { convert } from "@/lib/portfolio";
import type { Mover, Today } from "@/lib/today";
import { CLASS_META, type AssetClass, type Currency } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Card, IconTile } from "./ui";

type Step = { key: string; label: string; sub: string; amount: number; mover?: Mover; cls?: AssetClass; kind: "holding" | "more" | "fx" };

const SHOW = 8;

/**
 * Today as a waterfall: from yesterday's close, each holding's move in turn (biggest first),
 * to where you are now. Market chips filter it live and carry that market's mood.
 */
export function MoversWaterfall({ today, currency, moods, onOpen }: { today: Today; currency: Currency; moods: MoodReading[]; onOpen: (id: string) => void }) {
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const movers = cls === "all" ? today.movers : today.movers.filter((m) => m.position.asset.cls === cls);
  if (!today.movers.length) return null;
  const yesterdayOf = (m: Mover) => convert((m.position.value ?? 0) - (m.position.dayChange ?? 0), m.position.asset.currency, currency, today.rate);
  const start = cls === "all" ? today.base : movers.reduce((s, m) => s + yesterdayOf(m), 0);
  const moved = movers.reduce((s, m) => s + m.amount, 0) + (cls === "all" ? (today.fx?.amount ?? 0) : 0);
  const end = start + moved;

  const sorted = [...movers].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const shown = all ? sorted : sorted.slice(0, SHOW);
  const rest = all ? [] : sorted.slice(SHOW);
  const steps: Step[] = shown.map((m) => ({
    key: m.position.asset.id,
    label: m.position.asset.name,
    sub: `${pct(m.pct)} · ${CLASS_META[m.position.asset.cls].short}`,
    amount: m.amount,
    mover: m,
    cls: m.position.asset.cls,
    kind: "holding",
  }));
  if (rest.length) steps.push({ key: "more", label: `${rest.length} more holding${rest.length === 1 ? "" : "s"}`, sub: "smaller moves, together", amount: rest.reduce((s, m) => s + m.amount, 0), kind: "more" });
  if (cls === "all" && today.fx) steps.push({ key: "fx", label: "Dollar–rupee rate", sub: `$1 = ₹${today.fx.from.toFixed(2)} → ₹${today.fx.to.toFixed(2)}`, amount: today.fx.amount, kind: "fx" });

  // Zoomed axis around the levels the steps travel through.
  const spans = steps.map((_, i) => {
    const a = start + steps.slice(0, i).reduce((sum, x) => sum + x.amount, 0);
    return { a, b: a + steps[i].amount };
  });
  const levels = [start, end, ...spans.flatMap((s) => [s.a, s.b])];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const pad = Math.max((hi - lo) * 0.08, 1);
  const L = lo - pad;
  const H = hi + pad;
  const at = (v: number) => ((v - L) / (H - L)) * 100;
  const mood = (c?: AssetClass) => (c ? moods.find((r) => r.key === MOOD_FOR[c]) : undefined);
  const downs = movers.filter((m) => m.amount < -0.005).length;
  const ups = movers.filter((m) => m.amount > 0.005).length;
  const pctMoved = start > 0 ? (moved / start) * 100 : 0;

  return (
    <Card className="p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconTile color="var(--cat-5)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M2 4h5M5 8h6M9 12h5" />
            </svg>
          </IconTile>
          <h2 className="label text-[11.5px] text-ink">Today&apos;s movers</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[12px] text-ink-3">
            <span className="text-down">{downs} down</span> · <span className="text-up">{ups} up</span>
          </span>
          <span className={`num rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${moved < 0 ? "bg-down-soft text-down" : moved > 0 ? "bg-up-soft text-up" : "bg-sunken text-ink-2"}`}>
            {signed(moved, currency)} · {pct(pctMoved)}
          </span>
        </div>
      </header>

      {/* Market chips, each with its mood */}
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Market">
        <Chip on={cls === "all"} onClick={() => setCls("all")} label="All markets" amount={today.total} currency={currency} />
        {today.byClass.map((c) => {
          const r = mood(c.cls);
          return <Chip key={c.cls} on={cls === c.cls} onClick={() => setCls(c.cls)} label={CLASS_META[c.cls].label} amount={c.total} currency={currency} dot={CLASS_META[c.cls].color} mood={r} />;
        })}
      </div>

      {/* The waterfall */}
      <div className="mt-5" onPointerLeave={() => setHover(null)}>
        <Row label="Yesterday's close" sub={cls === "all" ? "Everything you hold" : CLASS_META[cls].label} value={money(start, currency, { decimals: 0 })} edge>
          <span className="absolute inset-y-0 w-[2px] rounded-full bg-ink-3/70" style={{ left: `calc(${at(start)}% - 1px)` }} />
        </Row>
        {steps.map((s, i) => {
          const { a, b } = spans[i];
          const left = Math.min(at(a), at(b));
          const width = Math.max(0.6, Math.abs(at(b) - at(a)));
          const up = s.amount >= 0;
          const r = mood(s.cls);
          const lit = hover === s.key;
          return (
            <Row
              key={s.key}
              badge={s.mover ? <AssetBadge position={s.mover.position} size={30} /> : <span className="grid size-[30px] place-items-center rounded-full bg-sunken text-[11px] font-bold text-ink-3 ring-1 ring-line">{s.kind === "fx" ? "₹$" : "+"}</span>}
              label={s.label}
              sub={
                lit && r ? (
                  <span>
                    {s.sub} · <span style={{ color: moodColor(moodPosition(r)) }}>{r.label} ({r.value})</span>
                  </span>
                ) : (
                  s.sub
                )
              }
              value={signed(s.amount, currency)}
              tone={s.amount}
              lit={lit}
              dim={hover !== null && !lit}
              onHover={() => setHover(s.key)}
              onClick={s.mover ? () => onOpen(s.key) : s.kind === "more" ? () => setAll(true) : undefined}
              delay={i}
            >
              <span className="absolute inset-y-0 border-l border-dashed border-ink-3/30" style={{ left: `${at(a)}%` }} />
              <span
                className="bar-grow absolute inset-y-[3px] rounded-[5px]"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: up ? "linear-gradient(90deg, color-mix(in srgb, var(--up) 55%, transparent), var(--up))" : "linear-gradient(270deg, color-mix(in srgb, var(--down) 55%, transparent), var(--down))",
                  boxShadow: lit ? `0 0 14px ${up ? "var(--up)" : "var(--down)"}` : undefined,
                  transformOrigin: up ? "left" : "right",
                  animationDelay: `${i * 35}ms`,
                }}
              />
            </Row>
          );
        })}
        <Row label="Now" sub={`${signed(moved, currency)} since yesterday's close`} value={money(end, currency, { decimals: 0 })} edge strong>
          <span className="absolute inset-y-0 w-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" style={{ left: `calc(${at(end)}% - 1px)` }} />
        </Row>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Each step is units held × (latest price − previous close){today.fx ? `, at $1 = ₹${today.rate.toFixed(2)}` : ""}. Hover a holding for its market&apos;s mood; click to open it.
        </p>
        {sorted.length > SHOW && (
          <button type="button" onClick={() => setAll((v) => !v)} className="press rounded-full px-3 py-1.5 text-[12px] font-semibold text-accent ring-1 ring-line hover:bg-sunken">
            {all ? "Show fewer" : `Show all ${sorted.length}`}
          </button>
        )}
      </div>
    </Card>
  );
}

function Chip({ on, onClick, label, amount, currency, dot, mood }: { on: boolean; onClick: () => void; label: string; amount: number; currency: Currency; dot?: string; mood?: MoodReading }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`press flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {label}
      <span className={`num ${on ? "" : amount < 0 ? "text-down" : amount > 0 ? "text-up" : ""}`}>{compact(amount, currency)}</span>
      {mood && (
        <span className="num flex items-center gap-1 border-l pl-2 text-[11px] font-medium opacity-80" style={{ borderColor: "currentColor" }} title={`${mood.source}: ${mood.label}`}>
          <span className="size-1.5 rounded-full" style={{ background: moodColor(moodPosition(mood)) }} />
          {mood.value}
        </span>
      )}
    </button>
  );
}

function Row({
  badge,
  label,
  sub,
  value,
  tone,
  edge,
  strong,
  lit,
  dim,
  onHover,
  onClick,
  delay = 0,
  children,
}: {
  badge?: React.ReactNode;
  label: string;
  sub: React.ReactNode;
  value: string;
  tone?: number;
  edge?: boolean;
  strong?: boolean;
  lit?: boolean;
  dim?: boolean;
  onHover?: () => void;
  onClick?: () => void;
  delay?: number;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {badge ?? <span className="size-[30px] shrink-0" />}
        <span className="min-w-0">
          <span className={`block truncate text-[13px] ${edge ? "label text-[10.5px] text-ink-2" : "font-semibold"}`}>{label}</span>
          <span className="num block truncate text-[11px] text-ink-3">{sub}</span>
        </span>
      </span>
      <span className="relative hidden h-7 sm:block">{children}</span>
      <span className={`num text-right ${strong ? "text-[16px] font-semibold" : edge ? "text-[13px] font-semibold text-ink-2" : `text-[13.5px] font-semibold ${tone !== undefined && tone < 0 ? "text-down" : tone !== undefined && tone > 0 ? "text-up" : ""}`}`}>{value}</span>
    </>
  );
  const cls = `item-in grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-2 py-1.5 text-left transition-[background-color,opacity] sm:grid-cols-[minmax(150px,240px)_minmax(0,1fr)_96px] ${lit ? "bg-sunken" : ""} ${dim ? "opacity-55" : ""} ${edge ? "border-y border-line/70" : ""}`;
  return onClick ? (
    <button type="button" className={`press ${cls}`} style={{ animationDelay: `${delay * 30}ms` }} onPointerEnter={onHover} onFocus={onHover} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={{ animationDelay: `${delay * 30}ms` }} onPointerEnter={onHover}>
      {body}
    </div>
  );
}
