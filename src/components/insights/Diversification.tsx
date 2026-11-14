"use client";

import { useState, type ReactNode } from "react";
import type { Driver, Risk, StandPoint } from "@/lib/insights";
import type { Currency } from "@/lib/types";
import { Finding, Rich } from "./kit";
import { Correlations, MoneyRisk } from "./MoneyRisk";
import { StandingChart, standingFinding } from "./Standing";

const AMFI_URL = "https://www.amfiindia.com/uploads/AMFI_Investor_Trends_July2026_f90f3da83e.pdf";
/** How individual investors split their mutual-fund money, July 2026 (AMFI Investor Trends). */
const AMFI_SPLIT = [
  { label: "Equity funds", value: 65, color: "var(--cat-1)" },
  { label: "Hybrid", value: 17.1, color: "var(--cat-3)" },
  { label: "Index, gold & overseas", value: 9.5, color: "#c9a43b" },
  { label: "Debt", value: 7.2, color: "var(--cat-2)" },
  { label: "Solution-oriented", value: 1.1, color: "var(--ink-3)" },
];

/**
 * Diversification in one card: how many real bets you have next to real index portfolios,
 * where your swings come from, the three facts that matter, and which holdings overlap.
 */
export function Diversification({ risk, points, drivers, currency }: { risk: Risk; points: StandPoint[]; drivers: Driver[]; currency: Currency }) {
  const [pairs, setPairs] = useState(false);
  const rank = { warn: 0, good: 1, info: 2 } as const;
  const top = [...drivers].sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 3);

  return (
    <div>
      <Finding className="text-[16px]">{standingFinding(points, risk.holdings)}</Finding>

      <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-8">
        <Panel title="You vs real index portfolios" hint="Up = more independent bets. Right = bigger swings. Up and to the left is better spread and calmer.">
          {points.length > 1 ? <StandingChart points={points} /> : <p className="text-[13px] text-ink-3">Index prices are still loading.</p>}
        </Panel>
        <Panel title="Your money vs your swings" hint="Left: where your money is. Right: what causes your day-to-day ups and downs. A slice that widens is riskier than its size.">
          <MoneyRisk risk={risk} currency={currency} bare />
        </Panel>
      </div>

      {top.length > 0 && (
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {top.map((d, i) => (
            <div key={i} className="item-in flex gap-3 rounded-2xl bg-sunken/60 p-3.5 ring-1 ring-line" style={{ animationDelay: `${i * 50}ms` }}>
              <span
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                  d.tone === "warn" ? "bg-down-soft text-down" : d.tone === "good" ? "bg-up-soft text-up" : "bg-accent-soft text-accent"
                }`}
                aria-hidden
              >
                {d.tone === "warn" ? "!" : d.tone === "good" ? "✓" : "i"}
              </span>
              <p className="text-[13px] leading-snug text-ink-2">
                <Rich text={d.text} />
              </p>
            </div>
          ))}
        </div>
      )}

      {risk.corr.labels.length >= 2 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setPairs((v) => !v)}
            aria-expanded={pairs}
            className="press flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left ring-1 ring-line hover:bg-sunken/60"
          >
            <span>
              <span className="block text-[13.5px] font-semibold">Which holdings move together</span>
              <span className="block text-[12px] text-ink-3">Every pair of your biggest holdings, compared over the past year</span>
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`shrink-0 transition-transform duration-300 ${pairs ? "rotate-180" : ""}`}>
              <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {pairs && (
            <div className="item-in mt-4 lg:mx-auto lg:max-w-[680px]">
              <Correlations risk={risk} />
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-sunken/60 px-4 py-3.5 ring-1 ring-line">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">For comparison:</b> Indian individual investors keep <b className="font-semibold text-ink">65%</b> of their mutual-fund money in equity funds, 17% in
          hybrid, 9.5% in index, gold and overseas funds and 7% in debt (
          <a href={AMFI_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
            AMFI Investor Trends, July 2026
          </a>
          ).
        </p>
        <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="AMFI July 2026 split of individual investors' mutual-fund money">
          {AMFI_SPLIT.map((s) => (
            <span key={s.label} className="h-full border-r-2 border-surface last:border-r-0" style={{ width: `${s.value}%`, background: s.color }} title={`${s.label} ${s.value}%`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {AMFI_SPLIT.slice(0, 4).map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label} {s.value}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="text-[13.5px] font-semibold">{title}</p>
      <p className="mb-3 mt-0.5 text-[12px] leading-snug text-ink-3">{hint}</p>
      <div className="flex-1">{children}</div>
    </div>
  );
}
