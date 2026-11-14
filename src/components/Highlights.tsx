"use client";

import type { ReactNode } from "react";
import { day, money, pct, signed } from "@/lib/format";
import type { DayValue } from "@/lib/networth";
import { convert, type Position } from "@/lib/portfolio";
import type { Today } from "@/lib/today";
import type { Candle, Currency } from "@/lib/types";
import { Card, IconTile } from "./ui";

/** 30-day trend in a tiny space, coloured by direction. */
function Spark({ candles, up }: { candles?: Candle[]; up: boolean }) {
  const pts = (candles ?? []).slice(-30).map((c) => c.c);
  if (pts.length < 3) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const W = 56;
  const H = 22;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`).join("");
  const id = `hl-${up ? "u" : "d"}`;
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0.22" />
          <stop offset="100%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
      <path d={d} pathLength={1} className="draw" fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({
  icon,
  color,
  label,
  title,
  right,
  sub,
  aside,
  onClick,
  children,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  title: string;
  right: ReactNode;
  sub: ReactNode;
  aside?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const inner = (
    <>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[11px]"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-ink-3">{label}</span>
        <span className="block truncate text-[14px] font-bold leading-snug">{title}</span>
        {children}
      </span>
      {aside}
      <span className="shrink-0 text-right">
        <span className="num block text-[13px] font-bold">{right}</span>
        <span className="num block text-[11px] text-ink-3">{sub}</span>
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`press ${cls} transition-colors hover:bg-sunken`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const ico = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** Peak, best and worst holding, and today's biggest mover, as a compact list for the side rail. */
export function Highlights({
  series,
  positions,
  today,
  currency,
  usdInr,
  closes,
  onOpen,
}: {
  series: DayValue[];
  positions: Position[];
  today: Today;
  currency: Currency;
  usdInr: number;
  closes: Record<string, Candle[]>;
  onOpen: (id: string) => void;
}) {
  const peak = series.reduce<DayValue | null>((best, d) => (!best || d.value > best.value ? d : best), null);
  const now = series.at(-1)?.value ?? 0;
  const ofPeak = peak && peak.value > 0 ? Math.min(1, now / peak.value) : 1;
  const atPeak = ofPeak > 0.9995;

  const ranked = positions
    .filter((p) => p.gain !== null && p.cost > 0 && p.priceSource !== "last-trade")
    .map((p) => ({ p, r: (p.gain! / p.cost) * 100 }))
    .sort((a, b) => b.r - a.r);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const mover = today.movers[0];
  const inDisplay = (p: Position, n: number) => convert(n, p.asset.currency, currency, usdInr);

  return (
    <Card className="h-full p-5 sm:p-6">
      <header className="flex items-center gap-2.5">
        <IconTile color="var(--cat-2)">{ico("M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z")}</IconTile>
        <h2 className="label text-[11.5px] text-ink">Highlights</h2>
      </header>

      <div className="-mx-2.5 mt-3 divide-y divide-line">
        <Row
          icon={ico("M2 13.5h12M3.5 11 7 6.5l2.5 2.5L13 4")}
          color="var(--accent)"
          label="Highest net worth"
          title={peak ? money(peak.value, currency, { decimals: 0 }) : "–"}
          right={atPeak ? "Today" : day(peak!.ts)}
          sub={atPeak ? "new high" : `${pct((ofPeak - 1) * 100)} now`}
        >
          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span className="seg-grow block h-full rounded-full bg-accent" style={{ width: `${ofPeak * 100}%` }} />
          </span>
        </Row>
        <Row
          icon={ico("M4 12 12 4M6 4h6v6")}
          color="var(--up)"
          label="Best performer"
          title={best?.p.asset.name ?? "Needs a live price"}
          aside={best && <Spark candles={closes[best.p.asset.id]} up />}
          right={best ? <span className={best.r >= 0 ? "text-up" : "text-down"}>{pct(best.r)}</span> : ""}
          sub={best ? signed(inDisplay(best.p, best.p.gain!), currency) : ""}
          onClick={best ? () => onOpen(best.p.asset.id) : undefined}
        />
        <Row
          icon={ico("M4 4l8 8M12 6v6H6")}
          color="var(--down)"
          label="Worst performer"
          title={worst?.p.asset.name ?? "Needs two holdings"}
          aside={worst && <Spark candles={closes[worst.p.asset.id]} up={false} />}
          right={worst ? <span className={worst.r >= 0 ? "text-up" : "text-down"}>{pct(worst.r)}</span> : ""}
          sub={worst ? signed(inDisplay(worst.p, worst.p.gain!), currency) : ""}
          onClick={worst ? () => onOpen(worst.p.asset.id) : undefined}
        />
        <Row
          icon={ico("M9 1.8 3.5 9h4l-1 5.2L12.5 7h-4z")}
          color="var(--cat-2)"
          label="Biggest move today"
          title={mover?.position.asset.name ?? "No price changes yet"}
          right={mover ? <span className={mover.amount >= 0 ? "text-up" : "text-down"}>{signed(mover.amount, currency)}</span> : ""}
          sub={mover ? pct(mover.pct) : ""}
          onClick={mover ? () => onOpen(mover.position.asset.id) : undefined}
        />
      </div>
    </Card>
  );
}
