"use client";

import type { ReactNode } from "react";
import { day, money } from "@/lib/format";
import type { Scorecard as Data } from "@/lib/insights";
import type { Currency } from "@/lib/types";
import { pctText, shareText } from "./kit";

/** Six numbers that sum up how much you could lose and where the risk sits. */
export function Scorecard({ card, currency }: { card: Data; currency: Currency }) {
  const m = (n: number) => money(Math.abs(n), currency, { decimals: 0 });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        label="Biggest single holding"
        value={card.top ? `${shareText(card.top.money)}` : "–"}
        tag={card.top?.label}
        line={card.top ? `of your money is in ${card.top.label}, and it causes ${shareText(card.top.risk)} of your swings.` : "No holdings with prices yet."}
        tone={card.top && card.top.money >= 0.3 ? -1 : 0}
      />
      <Tile
        label="A bad day (1 in 20)"
        value={card.badDay ? `−${m(card.badDay.amount)}` : "–"}
        line={
          card.badDay
            ? `About 1 day in 20 you'd lose ${pctText(card.badDay.pct)} or more.${card.badDay.nifty !== null ? ` For Nifty 50 it's ${pctText(card.badDay.nifty)}.` : ""}`
            : "Not enough history yet."
        }
        tone={-1}
      />
      <Tile
        label="Worst 30 days"
        value={card.worstMonth ? `−${m(card.worstMonth.amount)}` : "–"}
        line={card.worstMonth ? `${pctText(card.worstMonth.pct)} from ${day(card.worstMonth.from)} to ${day(card.worstMonth.to, true)}, on what you hold now.` : "No 30-day loss in this window."}
        tone={card.worstMonth ? -1 : 0}
      />
      <Tile
        label="Deepest fall from a high"
        value={card.deepest ? pctText(card.deepest.dd) : "None"}
        line={
          card.deepest
            ? card.deepest.recoverDays !== null
              ? `${day(card.deepest.peakTs)} to ${day(card.deepest.troughTs)}; it took ${card.deepest.recoverDays} days to climb back.`
              : `${day(card.deepest.peakTs)} to ${day(card.deepest.troughTs)}; not fully recovered${card.deepest.now < -0.001 ? ` (now ${pctText(card.deepest.now)})` : ""}.`
            : "Your mix hasn't fallen from a high in this window."
        }
        tone={card.deepest ? -1 : 0}
        extra={card.deepest && <Spark values={card.deepest.spark} />}
      />
      <Tile
        label="Exchange-rate exposure"
        value={shareText(card.foreign.share)}
        tag={`in ${card.foreign.word}`}
        line={card.foreign.share > 0 ? `If the rupee ${currency === "INR" ? "strengthens" : "weakens"} 5% against the dollar, you'd lose about ${m(card.foreign.hit)}.` : "Everything you hold is priced in your own currency."}
        tone={0}
      />
      <Tile
        label="Yearly swing"
        value={card.vol ? `±${Math.round(card.vol.you * 100)}%` : "–"}
        line={
          card.vol
            ? card.vol.nifty
              ? `Your value moves about ${(card.vol.you / card.vol.nifty).toFixed(1)}× as much as Nifty 50 (±${Math.round(card.vol.nifty * 100)}%) in a typical year.`
              : "How far your value typically moves up or down in a year."
            : "Not enough history yet."
        }
        tone={card.vol && card.vol.nifty && card.vol.you > card.vol.nifty * 1.5 ? -1 : 0}
      />
    </div>
  );
}

function Tile({ label, value, tag, line, tone, extra }: { label: string; value: string; tag?: string; line: string; tone: number; extra?: ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl bg-sunken/60 p-4 ring-1 ring-line">
      <p className="text-[11.5px] font-semibold text-ink-3">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`num text-[24px] font-extrabold leading-none tracking-[-0.02em] ${tone < 0 ? "text-down" : ""}`}>{value}</span>
        {tag && <span className="truncate text-[12px] font-semibold text-ink-2">{tag}</span>}
      </div>
      {extra}
      <p className="mt-2 text-[12px] leading-snug text-ink-2">{line}</p>
    </div>
  );
}

/** Tiny "below the high" line. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 220;
  const H = 34;
  const lo = Math.min(-0.001, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${((v / lo) * (H - 2) + 1).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[34px] w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`M0,1L${pts.join("L")}L${W},1Z`} fill="var(--down)" opacity={0.18} />
      <path d={`M${pts.join("L")}`} fill="none" stroke="var(--down)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
