"use client";

import { useMemo, useState } from "react";
import { compact, money } from "@/lib/format";
import { evalWhatIf, type Driver, type Risk, type WhatIfModel } from "@/lib/insights";
import type { Currency } from "@/lib/types";
import { Rich } from "./kit";

/** Plain facts on what limits your spread. Never a recommendation. */
export function Concentration({ drivers, risk }: { drivers: Driver[]; risk: Risk }) {
  const held = risk.byHolding.filter((h) => h.key !== "cash");
  const top3 = [...held].filter((h) => h.key !== "others").slice(0, 3).reduce((s, h) => s + h.money, 0);
  const bigType = [...risk.byClass].filter((c) => c.key !== "cash").sort((a, b) => b.money - a.money)[0];
  return (
    <div className="flex h-full flex-col">
      {drivers.length ? <Facts drivers={drivers} /> : <p className="text-[13px] text-ink-3">Nothing stands out — no single holding or overlap dominates your risk.</p>}
      <div className="mt-auto grid grid-cols-3 gap-2 pt-5">
        <Num label="Holdings" value={String(risk.holdings)} sub={`${risk.bets.toFixed(1)} real bets`} />
        <Num label="Top 3 holdings" value={`${Math.round(top3 * 100)}%`} sub="of your money" />
        {bigType && <Num label="Biggest asset type" value={`${Math.round(bigType.money * 100)}%`} sub={bigType.label} />}
      </div>
    </div>
  );
}

function Num({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-sunken/70 px-3 py-2.5 ring-1 ring-line">
      <p className="truncate text-[10.5px] text-ink-3">{label}</p>
      <p className="num mt-0.5 text-[18px] font-extrabold tracking-[-0.02em]">{value}</p>
      <p className="truncate text-[10.5px] text-ink-3">{sub}</p>
    </div>
  );
}

function Facts({ drivers }: { drivers: Driver[] }) {
  return (
    <ul className="space-y-2.5">
      {drivers.map((d, i) => (
        <li key={i} className="item-in flex gap-3 rounded-xl px-3.5 py-3 ring-1 ring-line" style={{ animationDelay: `${i * 40}ms` }}>
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
        </li>
      ))}
    </ul>
  );
}

/**
 * Try a different mix and see how spread and swing would have looked over the same days.
 * The person moves the sliders; Folio only does the arithmetic.
 */
export function WhatIf({ model, currency }: { model: WhatIfModel; currency: Currency }) {
  const start = useMemo(() => model.items.map((i) => i.value), [model]);
  // Only the sliders the person moved; everything else follows live prices.
  const [moved, setMoved] = useState<Record<string, number>>({});
  const values = useMemo(() => model.items.map((it, i) => moved[it.key] ?? start[i]), [model, moved, start]);
  const total0 = start.reduce((s, v) => s + v, 0);
  const before = useMemo(() => evalWhatIf(model, start), [model, start]);
  const after = useMemo(() => evalWhatIf(model, values), [model, values]);
  const changed = model.items.some((it, i) => moved[it.key] !== undefined && Math.abs(moved[it.key] - start[i]) > 0.5);
  const step = Math.max(1, Math.round(total0 / 400));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="max-h-[440px] space-y-1 overflow-y-auto pr-1">
        {model.items.map((it, i) => {
          const max = it.kind === "extra" ? Math.round(total0 * 0.5) : Math.max(Math.round(it.value * 2), Math.round(total0 * 0.1));
          const share = after.total > 0 ? values[i] / after.total : 0;
          const touched = moved[it.key] !== undefined && Math.abs(moved[it.key] - start[i]) > 0.5;
          return (
            <label key={it.key} className={`block rounded-xl px-3 py-2.5 transition-colors ${touched ? "bg-accent-soft/60" : "hover:bg-sunken/70"}`}>
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
                  <span className="truncate">{it.label}</span>
                  {it.kind === "extra" && <span className="shrink-0 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-3 ring-1 ring-line">test adding</span>}
                </span>
                <span className="num shrink-0 text-ink-2">
                  <b className="font-semibold text-ink">{compact(values[i], currency)}</b> · {Math.round(share * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={max}
                step={step}
                value={Math.min(values[i], max)}
                onChange={(e) => setMoved((m) => ({ ...m, [it.key]: Number(e.target.value) }))}
                className="mt-2 w-full accent-[var(--accent)]"
                aria-label={`${it.label} amount`}
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
        <Metric label="Independent bets" before={before.bets.toFixed(1)} after={after.bets.toFixed(1)} better={after.bets - before.bets} changed={changed} hint="More = better spread" />
        <Metric
          label="Yearly swing"
          before={`±${Math.round(before.vol * 100)}%`}
          after={`±${Math.round(after.vol * 100)}%`}
          better={before.vol - after.vol}
          changed={changed}
          hint="Less = calmer"
        />
        <Metric
          label="A typical day"
          before={`±${money(before.daySd * before.total, currency, { decimals: 0 })}`}
          after={`±${money(after.daySd * after.total, currency, { decimals: 0 })}`}
          better={before.daySd * before.total - after.daySd * after.total}
          changed={changed}
          hint={`On a total of ${compact(after.total, currency)}`}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11.5px] leading-snug text-ink-3">A test on the past year&apos;s real prices — how a different mix would have behaved. Not a recommendation.</p>
          {changed && (
            <button type="button" onClick={() => setMoved({})} className="press shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold text-accent ring-1 ring-line hover:bg-sunken">
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, before, after, better, changed, hint }: { label: string; before: string; after: string; better: number; changed: boolean; hint: string }) {
  const tone = !changed || Math.abs(better) < 1e-6 ? "" : better > 0 ? "text-up" : "text-down";
  return (
    <div className="rounded-2xl bg-sunken/70 px-4 py-3 ring-1 ring-line">
      <p className="text-[11px] text-ink-3">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        {changed && <span className="num text-[14px] font-semibold text-ink-3 line-through decoration-1">{before}</span>}
        {changed && <span className="text-ink-3">→</span>}
        <span className={`num text-[22px] font-extrabold tracking-[-0.02em] ${tone}`}>{changed ? after : before}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>
    </div>
  );
}
