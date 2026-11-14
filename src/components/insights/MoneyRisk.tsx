"use client";

import { useMemo, useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import type { Risk, RiskItem } from "@/lib/insights";
import type { Currency } from "@/lib/types";
import { Segmented } from "../ui";
import { Finding, Tip, TipNote, TipTitle, TipValue, shareText, useSize } from "./kit";

type Group = "class" | "holding";

/** What "swings" means, in plain words. Shown wherever Money vs risk appears. */
export const SWING_EXPLAINER = (
  <>
    A <b>swing</b> is the day-to-day up and down of your total value. The left column shows where your money is; the right shows which part causes those ups and downs. A slice that
    widens to the right carries more risk than its size suggests.
  </>
);

/**
 * Where your money sits vs where your swings come from: two stacked columns joined by
 * ribbons, so a slice that's small in money but big in swings visibly fans out.
 */
export function MoneyRisk({ risk, currency, compact = false, bare = false }: { risk: Risk; currency: Currency; compact?: boolean; bare?: boolean }) {
  const [group, setGroup] = useState<Group>("class");
  const [hover, setHover] = useState<string | null>(null);
  const [ref, box] = useSize<HTMLDivElement>();
  const items = useMemo(() => {
    const list = group === "class" ? risk.byClass : risk.byHolding;
    return [...list].sort((a, b) => (a.key === "cash" ? 1 : b.key === "cash" ? -1 : b.money - a.money));
  }, [risk, group]);

  const W = box.w;
  const H = compact ? 200 : 240;
  const labelW = Math.min(150, Math.max(92, W * 0.32));
  const barW = 14;
  const rightW = 44;
  const xL = labelW;
  const xR = W - rightW - barW;
  const gap = 3;
  const usable = H - gap * (items.length - 1);
  const layout = (key: "money" | "risk") => {
    let yy = 0;
    return items.map((it) => {
      const h = Math.max(1.5, Math.max(0, it[key]) * usable);
      const seg = { y: yy, h };
      yy += h + gap;
      return seg;
    });
  };
  const L = layout("money");
  const R = layout("risk");

  const lead = [...items].filter((i) => i.key !== "cash").sort((a, b) => b.risk - b.money - (a.risk - a.money))[0];
  let finding: ReactNode = null;
  if (lead && lead.risk - lead.money > 0.08)
    finding = (
      <>
        <b>{lead.label}</b> is <b>{shareText(lead.money)}</b> of your money but causes <b>{shareText(lead.risk)}</b> of your swings.
      </>
    );
  else if (lead) finding = <>Your swings are spread roughly in line with your money — no single slice dominates.</>;
  const hovered = items.find((i) => i.key === hover) ?? null;
  const hi = hovered ? items.indexOf(hovered) : -1;

  return (
    <div>
      <div className={`flex flex-wrap items-start gap-3 ${bare ? "justify-end" : "justify-between"}`}>
        {!bare && <Finding className={compact ? "max-w-[340px] text-[14px]" : "max-w-[520px]"}>{finding}</Finding>}
        <Segmented
          options={[
            { value: "class", label: "Asset type" },
            { value: "holding", label: "Holding" },
          ]}
          value={group}
          onChange={setGroup}
          label="Group by"
          size="sm"
        />
      </div>

      <div className="mt-4 flex justify-between text-[11px] font-semibold text-ink-3" style={{ paddingLeft: Math.max(0, labelW - 30) }}>
        <span>Your money</span>
        <span>Your swings</span>
      </div>
      <div ref={ref} className="relative mt-1.5" style={{ height: H }} onPointerLeave={() => setHover(null)}>
        {W > 0 && (
          <svg width={W} height={H} className="absolute inset-0 block overflow-visible">
            <defs>
              {items.map((it) => (
                <linearGradient key={it.key} id={`mr-${it.key}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={it.color} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={it.color} stopOpacity={0.42} />
                </linearGradient>
              ))}
            </defs>
            {items.map((it, i) => {
              const a = L[i];
              const b = R[i];
              const x0 = xL + barW;
              const x1 = xR;
              const mid = (x0 + x1) / 2;
              const d = `M${x0},${a.y}C${mid},${a.y} ${mid},${b.y} ${x1},${b.y}L${x1},${b.y + b.h}C${mid},${b.y + b.h} ${mid},${a.y + a.h} ${x0},${a.y + a.h}Z`;
              const dim = hover && hover !== it.key;
              return (
                <g key={it.key} onPointerEnter={() => setHover(it.key)} onPointerDown={() => setHover(it.key)}>
                  <path d={d} fill={`url(#mr-${it.key})`} opacity={dim ? 0.25 : 1} style={{ transition: "opacity .2s" }} className="fade-in" />
                  <rect x={xL} y={a.y} width={barW} height={a.h} rx={3} fill={it.color} opacity={dim ? 0.35 : 1} style={{ transition: "opacity .2s" }} />
                  <rect x={xR} y={b.y} width={barW} height={b.h} rx={3} fill={it.color} opacity={dim ? 0.35 : 1} style={{ transition: "opacity .2s" }} />
                  <rect x={0} y={a.y} width={xL + barW} height={Math.max(a.h, 14)} fill="transparent" />
                </g>
              );
            })}
          </svg>
        )}
        {W > 0 &&
          items.map((it, i) => {
            const a = L[i];
            return a.h >= 13 || hover === it.key ? (
              <div
                key={`l${it.key}`}
                className={`pointer-events-none absolute flex items-center justify-end gap-1.5 pr-2 text-right text-[11.5px] leading-none transition-opacity ${hover && hover !== it.key ? "opacity-40" : ""}`}
                style={{ left: 0, width: labelW, top: a.y + a.h / 2 - 6 }}
              >
                <span className="truncate text-ink-2">{it.label}</span>
                <b className="num font-semibold text-ink">{shareText(it.money)}</b>
              </div>
            ) : null;
          })}
        {W > 0 &&
          items.map((it, i) => {
            const b = R[i];
            return b.h >= 12 || hover === it.key ? (
              <div
                key={`r${it.key}`}
                className={`num pointer-events-none absolute pl-2 text-[11.5px] font-semibold leading-none transition-opacity ${hover && hover !== it.key ? "opacity-40" : ""}`}
                style={{ left: xR + barW, top: b.y + b.h / 2 - 6 }}
              >
                {it.risk < 0 ? "<0%" : shareText(it.risk)}
              </div>
            ) : null;
          })}
        {hovered && (
          <Tip x={W / 2 - 40} y={(L[hi].y + R[hi].y) / 2} box={{ w: W, h: H }} width={230}>
            <RiskTip it={hovered} currency={currency} />
          </Tip>
        )}
      </div>

      {!bare && <Bets risk={risk} currency={currency} compact={compact} />}
    </div>
  );
}

function RiskTip({ it, currency }: { it: RiskItem; currency: Currency }) {
  return (
    <>
      <TipTitle>{it.label}</TipTitle>
      <TipValue>{money(it.value, currency, { decimals: 0 })}</TipValue>
      <TipNote>
        {shareText(it.money)} of your money · {it.risk < 0 ? "steadies the rest" : `causes ${shareText(it.risk)} of your swings`}
      </TipNote>
      {it.vol > 0 && <TipNote>On its own it moves about {Math.round(it.vol * 100)}% up or down in a typical year</TipNote>}
      {it.key === "cash" && <TipNote>Cash doesn&apos;t swing, so it calms the total</TipNote>}
    </>
  );
}

/** "Behaves like N independent bets", drawn as dots, with the typical daily swing. */
function Bets({ risk, currency, compact }: { risk: Risk; currency: Currency; compact: boolean }) {
  const n = Math.max(1, risk.holdings);
  const shown = Math.min(n, 12);
  const daySwing = risk.dailySd * risk.value;
  return (
    <div className={`mt-4 grid gap-4 border-t border-line pt-4 ${compact ? "grid-cols-2" : "sm:grid-cols-2"}`}>
      <div>
        <p className="text-[11px] text-ink-3">Independent bets</p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          <b className="num text-[17px] font-bold text-ink">{risk.bets.toFixed(1)}</b> of {n}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
          {Array.from({ length: shown }, (_, i) => {
            const fill = Math.max(0, Math.min(1, (risk.bets / n) * shown - i));
            return (
              <span key={i} className="relative size-2.5 overflow-hidden rounded-full bg-sunken ring-1 ring-line">
                <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${fill * 100}%` }} />
              </span>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">Holdings that move together count as one bet.</p>
      </div>
      <div>
        <p className="text-[11px] text-ink-3">A typical day</p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          <b className="num text-[17px] font-bold text-ink">±{(risk.dailySd * 100).toFixed(2)}%</b>
        </p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">About {money(daySwing, currency, { decimals: 0 })} up or down on an ordinary day.</p>
      </div>
    </div>
  );
}

const word = (v: number) =>
  v >= 0.7 ? "move almost in lockstep" : v >= 0.4 ? "usually move together" : v >= 0.15 ? "move together a little" : v > -0.15 ? "move independently" : "tend to move in opposite directions";
const verdict = (v: number) =>
  v >= 0.7 ? "Holding both adds little spread." : v >= 0.4 ? "Some overlap." : v > -0.15 ? "Good for spreading risk." : "One tends to cushion the other.";

/** Which holdings move together: a lower-triangle map of correlations with a plain readout. */
export function Correlations({ risk, compact = false }: { risk: Risk; compact?: boolean }) {
  const { labels, full, colors, m } = risk.corr;
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [ref, box] = useSize<HTMLDivElement>();
  const n = labels.length;
  if (n < 2) return null;
  const pairs: { i: number; j: number; v: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) pairs.push({ i, j, v: m[i][j] });
  const most = pairs.reduce((a, b) => (b.v > a.v ? b : a));
  const least = pairs.reduce((a, b) => (Math.abs(b.v) < Math.abs(a.v) ? b : a));
  const labelW = 108;
  const fitCell = box.w > 0 ? Math.floor((box.w - labelW - 8) / (n - 1)) : 40;
  const cell = Math.max(30, Math.min(n <= 3 ? 88 : n <= 5 ? 76 : 62, fitCell));
  const h = hover ? pairs.find((p) => p.i === hover[0] && p.j === hover[1]) : null;
  const shownPair = h ?? null;

  return (
    <div className="flex h-full flex-col">
      <Finding className={compact ? "text-[14px]" : ""}>
        <b>{full[most.i]}</b> and <b>{full[most.j]}</b> {word(most.v)} ({most.v.toFixed(2)}).
        {least !== most && Math.abs(least.v) < 0.2 && (
          <>
            {" "}
            <b>{full[least.i]}</b> and <b>{full[least.j]}</b> move independently ({least.v.toFixed(2)}), which spreads your risk.
          </>
        )}
      </Finding>
      <div ref={ref} className="mt-4 flex flex-1 items-center justify-center">
        <div className="relative w-fit" onPointerLeave={() => setHover(null)}>
          <svg width={labelW + cell * (n - 1) + 4} height={cell * (n - 1) + 74} className="block max-w-full">
            {pairs.map(({ i, j, v }) => {
              const x = labelW + j * cell;
              const yy = (i - 1) * cell;
              const on = hover && hover[0] === i && hover[1] === j;
              const lit = hover && (hover[0] === i || hover[1] === j || hover[0] === j || hover[1] === i);
              const col = v >= 0 ? "var(--cat-1)" : "var(--cat-2)";
              return (
                <g key={`${i}-${j}`} onPointerEnter={() => setHover([i, j])} onPointerDown={() => setHover([i, j])} opacity={hover && !lit ? 0.45 : 1} style={{ transition: "opacity .15s" }}>
                  <rect x={x + 1.5} y={yy + 1.5} width={cell - 3} height={cell - 3} rx={8} fill="var(--sunken)" />
                  <rect
                    x={x + 1.5}
                    y={yy + 1.5}
                    width={cell - 3}
                    height={cell - 3}
                    rx={8}
                    fill={col}
                    fillOpacity={Math.min(0.92, Math.abs(v) * 0.95 + 0.04)}
                    stroke={on ? "var(--ink)" : "none"}
                    strokeWidth={2}
                    className="fade-in"
                  />
                  <text x={x + cell / 2} y={yy + cell / 2 + 4} textAnchor="middle" className={`num ${cell > 46 ? "text-[12px]" : "text-[10.5px]"} font-semibold ${Math.abs(v) > 0.5 ? "fill-white" : "fill-ink-2"}`}>
                    {v.toFixed(2).replace("0.", ".").replace("-.", "−.")}
                  </text>
                </g>
              );
            })}
            {labels.slice(1).map((l, k) => (
              <text key={`r${k}`} x={labelW - 8} y={k * cell + cell / 2 + 4} textAnchor="end" className={`text-[11px] ${hover && (hover[0] === k + 1 || hover[1] === k + 1) ? "fill-ink font-semibold" : "fill-ink-2"}`}>
                {l}
              </text>
            ))}
            {labels.slice(0, -1).map((l, k) => (
              <g key={`c${k}`} transform={`translate(${labelW + k * cell + cell / 2},${(n - 1) * cell + 12}) rotate(-38)`}>
                <circle cx={4} cy={-3} r={2.5} fill={colors[k]} />
                <text x={-2} y={0} textAnchor="end" className={`text-[11px] ${hover && (hover[0] === k || hover[1] === k) ? "fill-ink font-semibold" : "fill-ink-2"}`}>
                  {l}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      {/* Readout: explains the square under the cursor, or how to read the map. Never clipped. */}
      <div className="mt-3 min-h-[52px] rounded-xl bg-sunken/70 px-3.5 py-2.5 text-[12.5px] leading-snug ring-1 ring-line">
        {shownPair ? (
          <p className="text-ink-2">
            <b className="font-semibold text-ink">{full[shownPair.i]}</b> and <b className="font-semibold text-ink">{full[shownPair.j]}</b>: <b className="num font-bold text-ink">{shownPair.v.toFixed(2)}</b> — they{" "}
            {word(shownPair.v)}. {verdict(shownPair.v)}
          </p>
        ) : (
          <p className="text-ink-3">
            Each square compares two holdings&apos; daily moves over the past year. <b className="font-semibold text-ink-2">1</b> = they rise and fall together, <b className="font-semibold text-ink-2">0</b> = unrelated,{" "}
            <b className="font-semibold text-ink-2">−1</b> = opposite. Dark blue means you&apos;re doubling up; pale squares spread your risk.
          </p>
        )}
      </div>
    </div>
  );
}
