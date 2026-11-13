"use client";

import { useState } from "react";
import { day } from "@/lib/format";
import type { Behaviour, BenchId, Moves } from "@/lib/insights";
import { Segmented } from "../ui";
import { Finding, Stat, pctText, useSize } from "./kit";

const pct0 = (f: number) => `${Math.round(f * 100)}%`;

/** Each day as a dot: the market's move across, yours up, with your typical response line. */
export function VsMarket({ data }: { data: Behaviour }) {
  const [key, setKey] = useState<BenchId>(data.markets[0]?.key ?? "nifty");
  const [ref, box] = useSize<HTMLDivElement>();
  const mk = data.markets.find((x) => x.key === key) ?? data.markets[0];
  const W = box.w;
  const H = 250;
  const pad = 30;
  const size = Math.max(10, Math.min(W, H) - pad);
  // Scale to the typical range; the rare extreme day is pinned to the edge.
  const mags = mk.pairs.flatMap(([a, b]) => [Math.abs(a), Math.abs(b)]).sort((x, y) => x - y);
  const lim = Math.max(0.01, (mags[Math.floor(mags.length * 0.98)] ?? 0.01) * 1.25);
  const clip = (v: number) => Math.max(-lim, Math.min(lim, v));
  const ox = W / 2;
  const oy = H / 2 - 6;
  const sx = (v: number) => ox + (v / lim) * (size / 2);
  const sy = (v: number) => oy - (v / lim) * (size / 2);
  const slope = mk.beta;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Finding className="max-w-[440px]">
          For every 1% {mk.label} moves, you typically move <b>{mk.beta.toFixed(2)}%</b>.
          {mk.capUp !== null && mk.capDown !== null && (
            <>
              {" "}
              You&apos;ve caught <b>{pct0(Math.max(0, mk.capUp))}</b> of its rises and <b>{pct0(Math.max(0, mk.capDown))}</b> of its falls.
            </>
          )}
        </Finding>
        <Segmented options={data.markets.map((x) => ({ value: x.key, label: x.label }))} value={mk.key} onChange={setKey} label="Market" size="sm" />
      </div>
      <div ref={ref} className="relative mt-3" style={{ height: H }}>
        {W > 0 && (
          <svg width={W} height={H} className="absolute inset-0 block">
            <rect x={ox - size / 2} y={oy - size / 2} width={size / 2} height={size / 2} fill="var(--up)" opacity={0.04} rx={10} />
            <rect x={ox} y={oy} width={size / 2} height={size / 2} fill="var(--down)" opacity={0.04} rx={10} />
            <line x1={ox - size / 2} x2={ox + size / 2} y1={oy} y2={oy} stroke="var(--line)" />
            <line x1={ox} x2={ox} y1={oy - size / 2} y2={oy + size / 2} stroke="var(--line)" />
            {/* Moving exactly with the market */}
            <line x1={sx(-lim)} y1={sy(-lim)} x2={sx(lim)} y2={sy(lim)} stroke="var(--ink-3)" strokeDasharray="3 4" strokeOpacity={0.7} />
            {mk.pairs.map(([a, b], i) => (
              <circle key={i} cx={sx(clip(a))} cy={sy(clip(b))} r={2.6} fill={mk.color} fillOpacity={0.42} />
            ))}
            {/* Your typical response */}
            <line
              x1={sx(-lim)}
              y1={sy(Math.max(-lim, Math.min(lim, -lim * slope)))}
              x2={sx(lim)}
              y2={sy(Math.max(-lim, Math.min(lim, lim * slope)))}
              stroke="var(--ink)"
              strokeWidth={2}
              strokeLinecap="round"
              pathLength={1}
              className="draw"
            />
            <text x={ox + size / 2 - 4} y={oy - 6} textAnchor="end" className="fill-ink-3 text-[10px]">
              {mk.label} up →
            </text>
            <text x={ox + 6} y={oy - size / 2 + 10} className="fill-ink-3 text-[10px]">
              ↑ you up
            </text>
            <text x={ox - size / 2 + 4} y={oy + size / 2 - 6} className="num fill-ink-3 text-[10px]">
              {pctText(-lim, 0)}
            </text>
            <text x={ox + size / 2 - 4} y={oy + size / 2 - 6} textAnchor="end" className="num fill-ink-3 text-[10px]">
              {pctText(lim, 0)}
            </text>
          </svg>
        )}
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-ink" /> your typical response
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t border-dashed border-ink-3" /> moving exactly with {mk.label}
        </span>
      </div>
    </div>
  );
}

/** How your mix did on each market's 10 worst days, plus how steady it is. */
export function MarketFalls({ data, moves }: { data: Behaviour; moves: Moves }) {
  const lim = Math.max(0.005, ...data.markets.flatMap((m) => [Math.abs(m.worstMkt), Math.abs(m.worstYou)]));
  const best = [...data.markets].sort((a, b) => a.worstYou / a.worstMkt - b.worstYou / b.worstMkt)[0];
  const worst = [...data.markets].sort((a, b) => a.worstYou - b.worstYou)[0];

  return (
    <div>
      <Finding>
        On {best.label}&apos;s 10 worst days you {best.worstYou < 0 ? "lost" : "gained"} <b>{Math.abs(best.worstYou * 100).toFixed(1)}%</b> on average, against its <b>{Math.abs(best.worstMkt * 100).toFixed(1)}%</b> fall.
        {worst && worst !== best && worst.worstYou < 0 && (
          <>
            {" "}
            <b>{worst.label}</b>&apos;s bad days hit you hardest (<b>{Math.abs(worst.worstYou * 100).toFixed(1)}%</b> average loss).
          </>
        )}
      </Finding>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {data.markets.map((m) => (
          <div key={m.key} className="rounded-2xl bg-sunken/60 p-4 ring-1 ring-line">
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <span className="size-2.5 rounded-full" style={{ background: m.color }} />
              {m.label}&apos;s {m.n} worst days
            </p>
            <Bar label={m.label} value={m.worstMkt} lim={lim} color={m.color} />
            <Bar label="You" value={m.worstYou} lim={lim} color="var(--ink)" />
            <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">
              {m.capDown !== null && m.capUp !== null ? (
                <>
                  Over the year you caught <b className="font-semibold text-ink-2">{pct0(Math.max(0, m.capUp))}</b> of its rises and{" "}
                  <b className="font-semibold text-ink-2">{pct0(Math.max(0, m.capDown))}</b> of its falls.
                </>
              ) : (
                "Not enough days to measure rises and falls."
              )}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label="Days you finished up" value={pct0(data.upShare)} sub="of days that moved" />
        <Stat label="Longest winning run" value={`${data.streakUp} days`} />
        <Stat label="Longest losing run" value={`${data.streakDown} days`} />
        {moves.ok && moves.worst ? <Stat label="Worst single day" value={pctText(moves.worst.r, 2)} sub={day(moves.worst.ts, true)} tone={-1} /> : <span />}
      </div>
    </div>
  );
}

function Bar({ label, value, lim, color }: { label: string; value: number; lim: number; color: string }) {
  const w = Math.min(100, (Math.abs(value) / lim) * 100);
  return (
    <div className="mt-2.5">
      <div className="flex justify-between text-[11.5px]">
        <span className="text-ink-2">{label}</span>
        <span className={`num font-bold ${value < 0 ? "text-down" : "text-up"}`}>{pctText(value, 2)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface ring-1 ring-line">
        <div className="seg-grow h-full rounded-full" style={{ width: `${w}%`, background: color, opacity: label === "You" ? 0.85 : 1 }} />
      </div>
    </div>
  );
}
