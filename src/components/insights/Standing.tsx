"use client";

import { useState } from "react";
import type { StandPoint } from "@/lib/insights";
import type { ReactNode } from "react";
import { Tip, TipNote, TipTitle, TipValue, useSize } from "./kit";

/** One sentence: how many real bets you have, and which reference portfolio you resemble. */
export function standingFinding(points: StandPoint[], holdings: number): ReactNode {
  const you = points.find((p) => p.you);
  if (!you) return null;
  const refs = points.filter((p) => !p.you);
  const twin = refs.length ? refs.reduce((a, b) => (Math.abs(b.bets - you.bets) < Math.abs(a.bets - you.bets) ? b : a)) : null;
  const ratio = twin && twin.vol > 0 ? you.vol / twin.vol : null;
  return (
    <>
      Your {holdings} holding{holdings === 1 ? "" : "s"} behave like <b>{you.bets.toFixed(1)}</b> independent bet{you.bets < 1.05 ? "" : "s"}
      {twin && (
        <>
          {" "}
          — about as spread as owning <b>{twin.label}</b>
          {twin.parts > 1 ? " in equal parts" : ""}
          {ratio && ratio > 1.15 ? (
            <>
              , but with <b>{ratio.toFixed(1)}×</b> its swings
            </>
          ) : ratio && ratio < 0.87 ? (
            <>
              , with only <b>{Math.round(ratio * 100)}%</b> of its swings
            </>
          ) : null}
        </>
      )}
      .
    </>
  );
}

/**
 * Where you sit: independent bets (up) against yearly swing (across), next to real index
 * portfolios over the same days. Up and to the left is better spread and calmer.
 */
export function StandingChart({ points }: { points: StandPoint[] }) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const you = points.find((p) => p.you)!;
  const refs = points.filter((p) => !p.you);
  const W = box.w;
  const H = 270;
  const left = 34;
  const bottom = 30;
  const top = 14;
  const right = 12;
  const plotW = Math.max(10, W - left - right);
  const plotH = H - top - bottom;
  const maxVol = Math.max(0.1, ...points.map((p) => p.vol)) * 1.12;
  const maxBets = Math.max(4, Math.ceil(Math.max(...points.map((p) => p.bets)) + 0.4));
  const x = (v: number) => left + (v / maxVol) * plotW;
  const y = (b: number) => top + ((maxBets - b) / (maxBets - 0.5)) * plotH;
  const volTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1].filter((t) => t <= maxVol);
  const h = points.find((p) => p.key === hover) ?? null;
  const placed = W > 0 ? placeLabels(refs, you, x, y, { x0: left, x1: left + plotW, y0: top, y1: top + plotH }) : new Map<string, Label>();

  return (
    <div>
      <div ref={ref} className="relative" style={{ height: H }} onPointerLeave={() => setHover(null)}>
        {W > 0 && (
          <svg width={W} height={H} className="absolute inset-0 block overflow-visible">
            <defs>
              <linearGradient id="st-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--up)" stopOpacity={0.09} />
                <stop offset="55%" stopColor="var(--up)" stopOpacity={0} />
                <stop offset="100%" stopColor="var(--down)" stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <rect x={left} y={top} width={plotW} height={plotH} rx={12} fill="url(#st-bg)" />
            {Array.from({ length: maxBets }, (_, i) => i + 1).map((b) => (
              <g key={b}>
                <line x1={left} x2={left + plotW} y1={y(b)} y2={y(b)} stroke="var(--line)" strokeDasharray="2 5" />
                <text x={left - 8} y={y(b) + 4} textAnchor="end" className="num fill-ink-3 text-[10.5px]">
                  {b}
                </text>
              </g>
            ))}
            {volTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="num fill-ink-3 text-[10.5px]">
                {Math.round(t * 100)}%
              </text>
            ))}
            {refs.map((p) => {
              const spot = placed.get(p.key)!;
              return (
                <g key={p.key} onPointerEnter={() => setHover(p.key)} onPointerDown={() => setHover(p.key)} opacity={hover && hover !== p.key ? 0.4 : 1} style={{ transition: "opacity .2s" }}>
                  <circle cx={x(p.vol)} cy={y(p.bets)} r={p.parts > 1 ? 5 : 4.5} fill="var(--surface)" stroke="var(--ink-3)" strokeWidth={1.6} />
                  <text x={spot.x} y={spot.y} textAnchor={spot.anchor} className="fill-ink-2 text-[10.5px]">
                    {p.label}
                  </text>
                </g>
              );
            })}
            <g onPointerEnter={() => setHover("you")} onPointerDown={() => setHover("you")}>
              <circle cx={x(you.vol)} cy={y(you.bets)} r={16} fill="var(--accent)" opacity={0.14} className="pop-in" />
              <circle cx={x(you.vol)} cy={y(you.bets)} r={8} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} className="pop-in" />
              <text x={x(you.vol)} y={y(you.bets) - 20} textAnchor="middle" className="fill-ink text-[12px] font-bold">
                You
              </text>
            </g>
          </svg>
        )}
        {h && W > 0 && (
          <Tip x={x(h.vol)} y={y(h.bets)} box={{ w: W, h: H }} width={210}>
            <TipTitle>{h.you ? "Your portfolio" : `${h.label}${h.parts > 1 ? " (equal parts)" : ""}`}</TipTitle>
            <TipValue>{h.bets.toFixed(1)} independent bets</TipValue>
            <TipNote>Moves about {Math.round(h.vol * 100)}% up or down in a typical year</TipNote>
          </Tip>
        )}
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
        <span>↑ independent bets · yearly swing →</span>
        <span>
          <span className="font-semibold text-up">↖ spread out, calmer</span> · <span className="font-semibold text-down">↘ concentrated, jumpier</span>
        </span>
      </div>
    </div>
  );
}

interface Label {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

/** Puts each dot's label where it doesn't collide with other labels, dots or the plot edge. */
function placeLabels(
  refs: StandPoint[],
  you: StandPoint,
  x: (v: number) => number,
  y: (b: number) => number,
  plot: { x0: number; x1: number; y0: number; y1: number },
) {
  const out = new Map<string, Label>();
  const boxes: { l: number; r: number; t: number; b: number }[] = [{ l: x(you.vol) - 20, r: x(you.vol) + 20, t: y(you.bets) - 32, b: y(you.bets) + 18 }];
  for (const p of refs) boxes.push({ l: x(p.vol) - 6, r: x(p.vol) + 6, t: y(p.bets) - 6, b: y(p.bets) + 6 });
  const hit = (a: { l: number; r: number; t: number; b: number }) => boxes.some((o) => a.l < o.r && a.r > o.l && a.t < o.b && a.b > o.t);
  for (const p of refs) {
    const cx = x(p.vol);
    const cy = y(p.bets);
    const w = p.label.length * 5.7;
    const options: (Label & { box: { l: number; r: number; t: number; b: number } })[] = [
      { x: cx + 9, y: cy + 4, anchor: "start", box: { l: cx + 8, r: cx + 10 + w, t: cy - 7, b: cy + 6 } },
      { x: cx - 9, y: cy + 4, anchor: "end", box: { l: cx - 10 - w, r: cx - 8, t: cy - 7, b: cy + 6 } },
      { x: cx, y: cy - 10, anchor: "middle", box: { l: cx - w / 2, r: cx + w / 2, t: cy - 21, b: cy - 7 } },
      { x: cx, y: cy + 19, anchor: "middle", box: { l: cx - w / 2, r: cx + w / 2, t: cy + 8, b: cy + 22 } },
      { x: cx + 9, y: cy - 9, anchor: "start", box: { l: cx + 8, r: cx + 10 + w, t: cy - 20, b: cy - 6 } },
      { x: cx - 9, y: cy + 17, anchor: "end", box: { l: cx - 10 - w, r: cx - 8, t: cy + 6, b: cy + 20 } },
    ];
    const inside = (b: { l: number; r: number; t: number; b: number }) => b.l >= plot.x0 - 30 && b.r <= plot.x1 + 4 && b.t >= plot.y0 - 12 && b.b <= plot.y1 + 14;
    const pick = options.find((o) => inside(o.box) && !hit(o.box)) ?? options.find((o) => inside(o.box)) ?? options[0];
    boxes.push(pick.box);
    out.set(p.key, { x: pick.x, y: pick.y, anchor: pick.anchor });
  }
  return out;
}
