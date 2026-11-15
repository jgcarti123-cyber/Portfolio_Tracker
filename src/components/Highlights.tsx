"use client";

import type { ReactNode } from "react";
import { compact, day, money, pct, signed } from "@/lib/format";
import { shortName } from "@/lib/insights";
import type { DayValue } from "@/lib/networth";
import { convert, type Position } from "@/lib/portfolio";
import type { Today } from "@/lib/today";
import { CLASS_META, type Candle, type Currency } from "@/lib/types";
import { Card, IconTile } from "./ui";

const DAY = 86_400_000;

const ico = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/**
 * Highlights in three panels: where your biggest holdings sit in their 1-year range, what
 * moved your money this month, and your streaks and records. All from real prices.
 */
export function Highlights({
  series,
  positions,
  today,
  currency,
  usdInr,
  closes,
  onOpen,
  bare = false,
}: {
  series: DayValue[];
  positions: Position[];
  today: Today;
  currency: Currency;
  usdInr: number;
  closes: Record<string, Candle[]>;
  onOpen: (id: string) => void;
  bare?: boolean;
}) {
  const inDisplay = (p: Position, n: number) => convert(n, p.asset.currency, currency, usdInr);
  // "Now" is the latest point of the net-worth history (built from the current time), so render stays pure.
  const now = series.at(-1)?.ts ?? 0;

  /* ── 1-year range of the biggest holdings ── */
  const ranges = positions
    .filter((p) => p.price !== null && (closes[p.asset.id]?.length ?? 0) > 60)
    .map((p) => {
      const c = closes[p.asset.id];
      const hi = Math.max(p.price!, ...c.map((x) => (x.h > 0 ? x.h : x.c)));
      const lo = Math.min(p.price!, ...c.map((x) => (x.l > 0 ? x.l : x.c)));
      return { p, hi, lo, at: hi > lo ? (p.price! - lo) / (hi - lo) : 0.5, offHigh: p.price! / hi - 1, offLow: p.price! / lo - 1, value: inDisplay(p, p.value ?? p.cost) };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  /* ── This month: price moves on what you hold now ── */
  const month = positions
    .filter((p) => p.price !== null && closes[p.asset.id]?.length)
    .map((p) => {
      const c = closes[p.asset.id];
      const target = (now - 30 * DAY) / 1000;
      const then = [...c].reverse().find((x) => x.t <= target)?.c ?? c[0].c;
      return { p, amount: inDisplay(p, p.qty * (p.price! - then)) };
    })
    .sort((a, b) => b.amount - a.amount);
  const lift = month[0] && month[0].amount > 0 ? month[0] : null;
  const drag = month.length && month[month.length - 1].amount < 0 ? month[month.length - 1] : null;
  const ranked = positions
    .filter((p) => p.gain !== null && p.cost > 0 && p.priceSource !== "last-trade")
    .map((p) => ({ p, r: (p.gain! / p.cost) * 100 }))
    .sort((a, b) => b.r - a.r);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;

  /* ── Streaks and records ── */
  const peak = series.reduce<DayValue | null>((b, d) => (!b || d.value > b.value ? d : b), null);
  const nowValue = series.at(-1)?.value ?? 0;
  const offPeak = peak && peak.value > 0 ? nowValue / peak.value - 1 : 0;
  const moves = series.map((d, i) => ({ ts: d.ts, move: i === series.length - 1 ? today.total : d.move })).filter((d) => Math.abs(d.move) > 0.5);
  let streak = 0;
  const dir = Math.sign(moves.at(-1)?.move ?? 0);
  for (let i = moves.length - 1; i >= 0 && Math.sign(moves[i].move) === dir && dir !== 0; i--) streak++;
  const thisMonth = moves.filter((d) => d.ts >= now - 30 * DAY);
  const bestDay = thisMonth.length ? thisMonth.reduce((a, b) => (b.move > a.move ? b : a)) : null;
  const worstDay = thisMonth.length ? thisMonth.reduce((a, b) => (b.move < a.move ? b : a)) : null;

  return (
    <Card className="p-5 sm:p-6" bare={bare}>
      <header className={`flex items-center gap-2.5 ${bare ? "hidden" : ""}`}>
        <IconTile color="var(--cat-2)">{ico("M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z")}</IconTile>
        <h2 className="label text-[11.5px] text-ink">Highlights</h2>
      </header>

      <div className={`${bare ? "" : "mt-5"} grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-line`}>
        {/* 1-year ranges */}
        <Panel title="Where they sit in their 1-year range" first>
          {ranges.length ? (
            ranges.map(({ p, at, offHigh, offLow, hi, lo }) => {
              const flag = offHigh > -0.03 ? { text: offHigh >= -0.0005 ? "At its 1-year high" : `${pct(offHigh * 100)} from its high`, tone: "up" } : offLow < 0.05 ? { text: `${pct(offLow * 100)} above its low`, tone: "down" } : null;
              return (
                <button key={p.asset.id} type="button" onClick={() => onOpen(p.asset.id)} className="press group w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-sunken/70">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{shortName(p.asset)}</span>
                    <span className={`num shrink-0 text-[11.5px] font-semibold ${flag ? (flag.tone === "up" ? "text-up" : "text-down") : "text-ink-3"}`}>{flag ? flag.text : `${Math.round(at * 100)}% of range`}</span>
                  </span>
                  <span className="relative mt-2 block h-[5px] rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--down)_35%,transparent),color-mix(in_srgb,var(--up)_35%,transparent))]">
                    <span
                      className="absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition-transform group-hover:scale-125"
                      style={{ left: `${at * 100}%`, background: CLASS_META[p.asset.cls].color, boxShadow: `0 0 8px ${CLASS_META[p.asset.cls].color}` }}
                    />
                  </span>
                  <span className="num mt-1 flex justify-between text-[10.5px] text-ink-3">
                    <span>{compact(lo, p.asset.currency)}</span>
                    <span>{compact(hi, p.asset.currency)}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <Empty>Needs holdings with a year of prices.</Empty>
          )}
        </Panel>

        {/* This month's story */}
        <Panel title="This month's story">
          <Fact
            label="Added the most"
            name={lift ? shortName(lift.p.asset) : "Nothing rose yet"}
            value={lift ? signed(lift.amount, currency) : ""}
            tone={1}
            note="price move on what you hold"
            onClick={lift ? () => onOpen(lift.p.asset.id) : undefined}
          />
          <Fact
            label="Cost you the most"
            name={drag ? shortName(drag.p.asset) : "Nothing fell"}
            value={drag ? signed(drag.amount, currency) : ""}
            tone={-1}
            note="price move on what you hold"
            onClick={drag ? () => onOpen(drag.p.asset.id) : undefined}
          />
          <Fact label="Best since you bought" name={best ? shortName(best.p.asset) : "Needs a live price"} value={best ? pct(best.r) : ""} tone={best ? best.r : 0} note={best ? signed(inDisplay(best.p, best.p.gain!), currency) : ""} onClick={best ? () => onOpen(best.p.asset.id) : undefined} />
          <Fact label="Worst since you bought" name={worst ? shortName(worst.p.asset) : "Needs two holdings"} value={worst ? pct(worst.r) : ""} tone={worst ? worst.r : 0} note={worst ? signed(inDisplay(worst.p, worst.p.gain!), currency) : ""} onClick={worst ? () => onOpen(worst.p.asset.id) : undefined} />
        </Panel>

        {/* Streaks and records */}
        <Panel title="Streaks & records">
          <div className="rounded-xl px-2 py-2">
            <p className="label text-[9.5px] text-ink-3">Highest net worth</p>
            <p className="num mt-1 text-[24px] font-light leading-none tracking-[-0.03em]">{peak ? money(peak.value, currency, { decimals: 0 }) : "–"}</p>
            <p className="num mt-1.5 text-[11.5px] text-ink-3">
              {peak ? (offPeak > -0.0005 ? "That's today — a new high" : `${day(peak.ts, true)} · you're ${pct(offPeak * 100)} from it`) : ""}
            </p>
            {peak && (
              <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-sunken">
                <span className="seg-grow block h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, 1 + offPeak)) * 100}%` }} />
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 px-2 pt-2">
            <Mini label="Streak" value={streak ? `${streak} ${dir > 0 ? "up" : "down"}` : "–"} tone={dir} sub={streak ? `day${streak === 1 ? "" : "s"} in a row` : ""} />
            <Mini label="Best" value={bestDay && bestDay.move > 0 ? compact(bestDay.move, currency) : "–"} tone={1} sub={bestDay && bestDay.move > 0 ? `day · ${day(bestDay.ts)}` : "day this month"} />
            <Mini label="Worst" value={worstDay && worstDay.move < 0 ? compact(Math.abs(worstDay.move), currency) : "–"} tone={-1} sub={worstDay && worstDay.move < 0 ? `day · ${day(worstDay.ts)}` : "day this month"} />
          </div>
        </Panel>
      </div>
    </Card>
  );
}

function Panel({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={`min-w-0 ${first ? "lg:pr-5" : "lg:px-5"} last:lg:pr-0`}>
      <p className="label mb-2 px-2 text-[10px] text-ink-3">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Fact({ label, name, value, note, tone, onClick }: { label: string; name: string; value: string; note: string; tone: number; onClick?: () => void }) {
  const inner = (
    <>
      <span className="min-w-0">
        <span className="block text-[11px] text-ink-3">{label}</span>
        <span className="block truncate text-[13.5px] font-semibold">{name}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`num block text-[14px] font-semibold ${tone > 0 ? "text-up" : tone < 0 ? "text-down" : ""}`}>{value}</span>
        <span className="num block text-[10.5px] text-ink-3">{note}</span>
      </span>
    </>
  );
  const cls = "flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`press ${cls} transition-colors hover:bg-sunken/70`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-sunken/60 px-2.5 py-2 ring-1 ring-line">
      <p className="label truncate text-[9px] text-ink-3">{label}</p>
      <p className={`num mt-1 truncate text-[15px] font-semibold ${value === "–" ? "" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : ""}`}>{value}</p>
      <p className="num truncate text-[10px] text-ink-3">{sub}</p>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-[12.5px] text-ink-3">{children}</p>;
}
