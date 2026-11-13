"use client";

import { useMemo, useState } from "react";
import { compact, money } from "@/lib/format";
import type { FlowLink, FlowNode } from "@/lib/insights";
import { CLASS_ORDER, type Currency } from "@/lib/types";
import { Finding, TipNote, TipTitle, TipValue, useSize } from "./kit";

interface Placed extends FlowNode {
  x: number;
  y: number;
  h: number;
}
interface PlacedLink extends FlowLink {
  sy: number;
  ty: number;
  t: number;
  x0: number;
  x1: number;
}

const NODE_W = 12;
const GAP = 10;
/** Room above and below for two-line labels. */
const PADY = 18;
/** Smallest drawn node, so tiny amounts still get a readable label. */
const MIN_H = 12;
const short = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

/**
 * Where your money went: brokers (and market gains) → asset types → holdings (and market
 * losses). Widths are money, so every rupee in matches a rupee out.
 */
export function MoneyMap({ flows, currency }: { flows: { nodes: FlowNode[]; links: FlowLink[]; gain: number; loss: number }; currency: Currency }) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ node?: string; link?: number } | null>(null);
  const W = Math.max(620, box.w);
  const H = Math.max(260, Math.min(460, 34 * Math.max(...[0, 1, 2].map((c) => flows.nodes.filter((n) => n.col === c).length)) + 40));
  const labelL = 128;
  const labelR = 168;

  const { nodes, links } = useMemo(() => layout(flows.nodes, flows.links, W, H, labelL, labelR), [flows, W, H]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const brokers = nodes.filter((n) => n.kind === "broker").sort((a, b) => b.value - a.value);
  const classes = nodes.filter((n) => n.kind === "class").sort((a, b) => b.value - a.value);
  const putIn = nodes.filter((n) => n.col === 0 && n.kind !== "gain").reduce((s, n) => s + n.value, 0);
  const active = (l: PlacedLink, i: number) => !hover || hover.link === i || (hover.node !== undefined && (l.from === hover.node || l.to === hover.node));
  const hl = hover?.link !== undefined ? links[hover.link] : null;
  const hn = hover?.node ? byId.get(hover.node) : null;

  return (
    <div>
      <Finding>
        {brokers[0] && (
          <>
            <b>{brokers[0].label}</b> holds <b>{Math.round((brokers[0].value / Math.max(1, putIn)) * 100)}%</b> of what you put in
            {classes[0] && (
              <>
                , and most of your money went into <b>{classes[0].label.toLowerCase()}</b>
              </>
            )}
            .{" "}
          </>
        )}
        Markets have added <b>{money(flows.gain, currency, { decimals: 0 })}</b>
        {flows.loss > 0 && (
          <>
            {" "}
            and taken away <b>{money(flows.loss, currency, { decimals: 0 })}</b>
          </>
        )}{" "}
        so far.
      </Finding>

      <div className="mt-4 overflow-x-auto">
        <div ref={ref} className="relative min-w-[620px]" style={{ height: H }} onPointerLeave={() => setHover(null)}>
          {box.w > 0 && (
            <svg width={W} height={H} className="absolute inset-0 block">
              <defs>
                {links.map((l, i) => (
                  <linearGradient key={i} id={`mm-${i}`} gradientUnits="userSpaceOnUse" x1={l.x0} x2={l.x1} y1={0} y2={0}>
                    <stop offset="0%" stopColor={byId.get(l.from)!.color} />
                    <stop offset="100%" stopColor={byId.get(l.to)!.color} />
                  </linearGradient>
                ))}
              </defs>
              {links.map((l, i) => {
                const mid = (l.x0 + l.x1) / 2;
                const d = `M${l.x0},${l.sy}C${mid},${l.sy} ${mid},${l.ty} ${l.x1},${l.ty}L${l.x1},${l.ty + l.t}C${mid},${l.ty + l.t} ${mid},${l.sy + l.t} ${l.x0},${l.sy + l.t}Z`;
                const on = active(l, i);
                return (
                  <path
                    key={i}
                    d={d}
                    fill={`url(#mm-${i})`}
                    opacity={on ? (hover ? 0.62 : 0.34) : 0.08}
                    style={{ transition: "opacity .2s" }}
                    className="fade-in"
                    onPointerEnter={() => setHover({ link: i })}
                    onPointerDown={() => setHover({ link: i })}
                  />
                );
              })}
              {nodes.map((n) => {
                const on = !hover || hover.node === n.id || (hl && (hl.from === n.id || hl.to === n.id)) || (hover.node && links.some((l) => (l.from === hover.node && l.to === n.id) || (l.to === hover.node && l.from === n.id)));
                return (
                  <g key={n.id} onPointerEnter={() => setHover({ node: n.id })} onPointerDown={() => setHover({ node: n.id })} opacity={on ? 1 : 0.35} style={{ transition: "opacity .2s" }}>
                    <rect x={n.x} y={n.y} width={NODE_W} height={Math.max(2, n.h)} rx={3} fill={n.color} />
                    <rect x={n.col === 0 ? 0 : n.col === 2 ? n.x : n.x - 4} y={n.y - 3} width={n.col === 1 ? NODE_W + 8 : n.col === 0 ? n.x + NODE_W : W - n.x} height={Math.max(14, n.h + 6)} fill="transparent" />
                    <NodeLabel n={n} currency={currency} />
                  </g>
                );
              })}
            </svg>
          )}
          {(hl || hn) && (
            <div className="pointer-events-none absolute left-1/2 top-0 w-[230px] -translate-x-1/2 rounded-xl px-3 py-2 text-[12px] text-white shadow-pop" style={{ background: "var(--tip)" }}>
              {hl ? (
                <>
                  <TipTitle>
                    {byId.get(hl.from)!.label} → {byId.get(hl.to)!.label}
                  </TipTitle>
                  <TipValue tone={hl.kind === "gain" ? 1 : hl.kind === "loss" ? -1 : 0}>{money(hl.value, currency, { decimals: 0 })}</TipValue>
                  <TipNote>
                    {hl.kind === "cost" ? "What you put in (at today's exchange rate)" : hl.kind === "gain" ? "Market gain on these holdings" : hl.kind === "loss" ? "Market loss on these holdings" : "What it's worth now"}
                  </TipNote>
                </>
              ) : hn ? (
                <>
                  <TipTitle>{hn.label}</TipTitle>
                  <TipValue tone={hn.kind === "gain" ? 1 : hn.kind === "loss" ? -1 : 0}>{money(hn.value, currency, { decimals: 0 })}</TipValue>
                  <TipNote>
                    {hn.kind === "broker" ? "Put in through this broker" : hn.kind === "class" ? "Flows through this asset type" : hn.kind === "holding" ? "Worth now" : hn.kind === "gain" ? "Added by the market" : hn.kind === "loss" ? "Lost to the market" : "Cash you hold"}
                  </TipNote>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] font-semibold text-ink-3">
        <span>Where it came from</span>
        <span>What it&apos;s in</span>
        <span>What it&apos;s worth now</span>
      </div>
    </div>
  );
}

function NodeLabel({ n, currency }: { n: Placed; currency: Currency }) {
  const cy = n.y + n.h / 2;
  const small = n.h < 22;
  if (n.col === 0)
    return (
      <text x={n.x - 8} y={cy + (small ? 4 : -1)} textAnchor="end" className="text-[11.5px]">
        <tspan className="fill-ink font-semibold">{short(n.label, 16)}</tspan>
        {small ? (
          <tspan className="num fill-ink-3" dx={5}>
            {compact(n.value, currency)}
          </tspan>
        ) : (
          <tspan x={n.x - 8} dy={14} className="num fill-ink-3 text-[11px]">
            {compact(n.value, currency)}
          </tspan>
        )}
      </text>
    );
  if (n.col === 2)
    return (
      <text x={n.x + NODE_W + 8} y={cy + (small ? 4 : -1)} className="text-[11.5px]">
        <tspan className="fill-ink font-semibold">{short(n.label)}</tspan>
        {small ? (
          <tspan className="num fill-ink-3" dx={5}>
            {compact(n.value, currency)}
          </tspan>
        ) : (
          <tspan x={n.x + NODE_W + 8} dy={14} className="num fill-ink-3 text-[11px]">
            {compact(n.value, currency)}
          </tspan>
        )}
      </text>
    );
  return (
    <text x={n.x + NODE_W + 7} y={cy + 4} className="text-[11.5px] font-semibold" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
      <tspan className="fill-ink">{n.label}</tspan>
    </text>
  );
}

function layout(rawNodes: FlowNode[], rawLinks: FlowLink[], W: number, H: number, labelL: number, labelR: number) {
  const clsRank = (id: string) => {
    const c = id.replace(/^c:/, "");
    const i = CLASS_ORDER.indexOf(c as (typeof CLASS_ORDER)[number]);
    return i < 0 ? 99 : i;
  };
  // Order within columns: brokers by size, gains last; types in their usual order; holdings by type then size, losses last.
  const holdingClass = new Map<string, number>();
  for (const l of rawLinks) if (l.to.startsWith("h:")) holdingClass.set(l.to, Math.min(holdingClass.get(l.to) ?? 99, clsRank(l.from)));
  const rank = (n: FlowNode) =>
    n.col === 0
      ? n.kind === "gain"
        ? 1e12
        : n.kind === "cash"
          ? 1e11
          : -n.value
      : n.col === 1
        ? clsRank(n.id) * 1e12
        : n.kind === "loss"
          ? 1e15
          : n.kind === "cash"
            ? 1e14
            : n.id === "h:others"
              ? 1e13
              : (holdingClass.get(n.id) ?? 99) * 1e12 - n.value;
  const cols = [0, 1, 2].map((c) => rawNodes.filter((n) => n.col === c).sort((a, b) => rank(a) - rank(b)));
  const inner = H - PADY * 2;
  // Scale so the fullest column fits, leaving room for small nodes drawn at the minimum height.
  const fit = (list: FlowNode[], k: number) => list.reduce((s, n) => s + Math.max(MIN_H, n.value * k), 0) + GAP * (list.length - 1);
  let k = Math.min(...cols.map((list) => (inner - GAP * (list.length - 1)) / Math.max(1, list.reduce((s, n) => s + n.value, 0))));
  for (let i = 0; i < 6 && Math.max(...cols.map((l) => fit(l, k))) > inner; i++) k *= inner / Math.max(...cols.map((l) => fit(l, k)));
  const xs = [labelL, (labelL + W - labelR - NODE_W) / 2, W - labelR - NODE_W];
  const placed = new Map<string, Placed>();
  cols.forEach((list, c) => {
    const total = fit(list, k);
    let y = PADY + (inner - total) / 2;
    for (const n of list) {
      const h = Math.max(MIN_H, n.value * k);
      placed.set(n.id, { ...n, x: xs[c], y, h });
      y += h + GAP;
    }
  });
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const links = [...rawLinks]
    .sort((a, b) => placed.get(a.from)!.y - placed.get(b.from)!.y || placed.get(a.to)!.y - placed.get(b.to)!.y)
    .map((l) => ({ l, t: l.value * k }));
  // Stack outgoing links by target position and incoming links by source position.
  const out: PlacedLink[] = [];
  const bySource = [...links].sort((a, b) => placed.get(a.l.to)!.y - placed.get(b.l.to)!.y);
  const sy = new Map<FlowLink, number>();
  const span = (id: string, dir: "out" | "in") => links.filter((x) => (dir === "out" ? x.l.from : x.l.to) === id).reduce((s, x) => s + x.t, 0);
  for (const { l, t } of bySource) {
    const f = placed.get(l.from)!;
    const o = outOff.get(l.from) ?? (f.h - span(l.from, "out")) / 2;
    sy.set(l, f.y + o);
    outOff.set(l.from, o + t);
  }
  const byTarget = [...links].sort((a, b) => placed.get(a.l.from)!.y - placed.get(b.l.from)!.y);
  for (const { l, t } of byTarget) {
    const to = placed.get(l.to)!;
    const o = inOff.get(l.to) ?? (to.h - span(l.to, "in")) / 2;
    out.push({ ...l, sy: sy.get(l)!, ty: to.y + o, t, x0: placed.get(l.from)!.x + NODE_W, x1: to.x });
    inOff.set(l.to, o + t);
  }
  return { nodes: [...placed.values()], links: out };
}
