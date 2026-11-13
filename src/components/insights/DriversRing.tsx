"use client";

import { useState } from "react";
import { compact, money } from "@/lib/format";
import type { Factor } from "@/lib/insights";
import type { Currency } from "@/lib/types";
import { Finding } from "./kit";

const TAU = Math.PI * 2;
const pt = (cx: number, cy: number, r: number, f: number) => [cx + r * Math.cos(f * TAU - Math.PI / 2), cy + r * Math.sin(f * TAU - Math.PI / 2)] as const;
function arc(cx: number, cy: number, r: number, f: number) {
  const g = Math.max(0.003, Math.min(0.999, f));
  const [x0, y0] = pt(cx, cy, r, 0);
  const [x1, y1] = pt(cx, cy, r, g);
  return `M${x0},${y0}A${r},${r} 0 ${g > 0.5 ? 1 : 0} 1 ${x1},${y1}`;
}

/**
 * What drives you: one ring per market. The longer the ring, the more of your daily ups and
 * downs follow that market. Each row says what a 1% fall in it has typically meant for you.
 */
export function DriversRing({ factors, currency }: { factors: Factor[]; currency: Currency }) {
  const [hover, setHover] = useState<string | null>(null);
  const list = factors.slice(0, 5);
  const S = 240;
  const c = S / 2;
  const ringW = 12;
  const outer = S / 2 - 14;
  const lead = list[0];
  const value = Math.max(1, Math.abs(list.reduce((s, f) => s + Math.abs(f.per1), 0)));
  const quiet = [...list].sort((a, b) => Math.abs(a.per1) - Math.abs(b.per1))[0];
  const active = list.find((f) => f.key === hover) ?? lead;
  const m = (n: number) => money(Math.abs(n), currency, { decimals: 0 });

  return (
    <div>
      <Finding>
        <b>{lead.label}</b> drives you most: when {lead.fall.replace(`${lead.label} `, "it ")}, you typically {lead.per1 <= 0 ? "lose" : "gain"} <b>{m(lead.per1)}</b>.
        {quiet && quiet !== lead && Math.abs(quiet.per1) < value * 0.04 && (
          <>
            {" "}
            <b>{quiet.label}</b> barely moves you.
          </>
        )}
      </Finding>
      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0" role="img" aria-label="How much each market drives your portfolio">
          {[0.25, 0.5, 0.75].map((f) => {
            const [x0, y0] = pt(c, c, outer + 7, f);
            const [x1, y1] = pt(c, c, outer + 11, f);
            return <line key={f} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink-3)" strokeOpacity={0.5} />;
          })}
          {list.map((f, i) => {
            const r = outer - i * (ringW + 7);
            const dim = hover && hover !== f.key;
            return (
              <g key={f.key} opacity={dim ? 0.28 : 1} style={{ transition: "opacity .2s" }} onPointerEnter={() => setHover(f.key)} onPointerLeave={() => setHover(null)}>
                <circle cx={c} cy={c} r={r} fill="none" stroke="var(--sunken)" strokeWidth={ringW} />
                <path d={arc(c, c, r, f.r2)} fill="none" stroke={f.color} strokeWidth={ringW} strokeLinecap="round" pathLength={1} className="draw" style={{ animationDelay: `${i * 80}ms` }} />
              </g>
            );
          })}
          <circle cx={c} cy={c} r={outer - list.length * (ringW + 7) + 2} fill="var(--surface)" />
          <text x={c} y={c - 8} textAnchor="middle" className="fill-ink-3 text-[10px] font-semibold">
            {active.label}
          </text>
          <text x={c} y={c + 10} textAnchor="middle" className="num fill-ink text-[16px] font-extrabold">
            {Math.round(active.r2 * 100)}%
          </text>
          <text x={c} y={c + 24} textAnchor="middle" className="fill-ink-3 text-[9.5px]">
            of your moves
          </text>
        </svg>
        <ul className="w-full min-w-0 space-y-2">
          {list.map((f) => (
            <li
              key={f.key}
              className={`rounded-xl px-3 py-2 ring-1 ring-line transition-opacity ${hover && hover !== f.key ? "opacity-40" : ""}`}
              onPointerEnter={() => setHover(f.key)}
              onPointerLeave={() => setHover(null)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
                  <span className="truncate">{f.label}</span>
                </span>
                <span className={`num shrink-0 text-[13px] font-bold ${f.per1 < 0 ? "text-down" : f.per1 > 0 ? "text-up" : ""}`}>
                  {f.per1 < 0 ? "−" : f.per1 > 0 ? "+" : ""}
                  {compact(Math.abs(f.per1), currency).replace("-", "")}
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink-3">
                When {f.fall} · follows {Math.round(f.r2 * 100)}% of your moves
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
