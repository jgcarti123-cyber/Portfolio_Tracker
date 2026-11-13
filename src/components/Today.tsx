"use client";

import { useState } from "react";
import { money, pct, signed } from "@/lib/format";
import type { Mover, Today } from "@/lib/today";
import { CLASS_META, type AssetClass, type Currency } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Delta, Disclosure, Segmented } from "./ui";

type By = "amount" | "pct";
type Tab = "all" | AssetClass;
const tone = (n: number) => (n > 0.005 ? "text-up" : n < -0.005 ? "text-down" : "text-ink-2");
const LIMIT = 6;

const TrendIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 11.5 6 7.5l2.5 2.5L14 4.5M10 4.5h4v4" />
  </svg>
);

/** One holding's move. Losers sit left with bars growing toward the centre; gainers mirror them on the right. */
function Row({ m, side, max, by, currency, onOpen, delay }: { m: Mover; side: "down" | "up"; max: number; by: By; currency: Currency; onOpen: (id: string) => void; delay: number }) {
  const metric = by === "amount" ? m.amount : m.pct;
  const w = max > 0 ? Math.max(4, (Math.abs(metric) / max) * 100) : 0;
  const right = side === "up";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(m.position.asset.id)}
        className={`item-in group flex h-[58px] w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:bg-sunken ${right ? "sm:flex-row-reverse sm:text-right" : ""}`}
        style={{ animationDelay: `${delay}ms` }}
        title={`${m.position.asset.name}: ${signed(m.amount, currency)} today (${pct(m.pct)} price)`}
      >
        <AssetBadge position={m.position} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{m.position.asset.name}</span>
          <span className="num block truncate text-[11px] text-ink-3">
            {by === "amount" ? `${pct(m.pct)} price` : signed(m.amount, currency)} · {CLASS_META[m.position.asset.cls].short}
          </span>
        </span>
        <span className={`num shrink-0 text-[13px] font-bold ${tone(metric)}`}>{by === "amount" ? signed(m.amount, currency) : pct(m.pct)}</span>
        {/* bar box: fills toward the centre line */}
        <span className={`flex h-2 w-[22%] shrink-0 ${right ? "justify-start" : "justify-end"}`} aria-hidden>
          <span
            className={`h-full ${right ? "grow-from-left rounded-r-full bg-up" : "grow-from-right rounded-l-full bg-down"} transition-[filter] group-hover:brightness-110`}
            style={{ width: `${w}%`, animationDelay: `${delay}ms` }}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * Exactly what moved today, as a mirror: what pulled net worth down on the left, what
 * pulled it up on the right, biggest first. Tabs narrow it to one market, each with its
 * trading status. Folds down to a one-line summary.
 */
export function TodayMovers({ today, currency, onOpen }: { today: Today; currency: Currency; onOpen: (id: string) => void }) {
  const [by, setBy] = useState<By>("amount");
  const [tab, setTab] = useState<Tab>("all");
  const [all, setAll] = useState(false);

  const group = tab === "all" ? null : today.byClass.find((g) => g.cls === tab);
  const movers = group ? group.movers : today.movers;
  const metric = (m: Mover) => (by === "amount" ? m.amount : m.pct);
  const downs = movers.filter((m) => m.amount < -0.005).sort((a, b) => metric(a) - metric(b));
  const ups = movers.filter((m) => m.amount > 0.005).sort((a, b) => metric(b) - metric(a));
  const flat = movers.length - downs.length - ups.length;
  const sum = (l: Mover[]) => l.reduce((a, m) => a + m.amount, 0);
  const downSum = sum(downs);
  const upSum = sum(ups);
  const total = group ? group.total : today.total;
  const max = Math.max(0, ...movers.map((m) => Math.abs(metric(m))));
  const rows = all ? Math.max(downs.length, ups.length) : LIMIT;
  const lead = today.movers[0];

  const summary = (
    <>
      <span className="whitespace-nowrap">
        <Delta value={today.total}>
          {signed(today.total, currency)}
          <span className="hidden sm:inline"> today</span>
        </Delta>
      </span>
      <span className="hidden items-center gap-2 md:flex">
        <span className="text-down">{today.down.count} down</span>
        <span className="flex h-1.5 w-16 gap-[2px] overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className="bg-down" style={{ flexGrow: Math.abs(today.down.amount), flexBasis: 0 }} />
          <span className="bg-up" style={{ flexGrow: today.up.amount, flexBasis: 0 }} />
        </span>
        <span className="text-up">{today.up.count} up</span>
      </span>
    </>
  );

  return (
    <Disclosure id="movers" icon={TrendIcon} color={today.total < 0 ? "var(--down)" : "var(--up)"} title="Today's movers" summary={summary}>
      {/* Market tabs, each with its subtotal and trading status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Market">
          {[{ cls: "all" as Tab, total: today.total, live: false, label: "All markets" }, ...today.byClass.map((g) => ({ cls: g.cls as Tab, total: g.total, live: g.state.live, label: CLASS_META[g.cls].label }))].map((t) => {
            const on = tab === t.cls;
            return (
              <button
                key={t.cls}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => (setTab(t.cls), setAll(false))}
                className={`press inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
              >
                {t.cls !== "all" && (
                  <span className="relative flex size-2" aria-hidden>
                    {t.live && <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: CLASS_META[t.cls as AssetClass].color }} />}
                    <span className="relative size-2 rounded-full" style={{ background: CLASS_META[t.cls as AssetClass].color }} />
                  </span>
                )}
                {t.label}
                <span className={`num text-xs ${on ? "" : tone(t.total)}`}>{signed(t.total, currency)}</span>
              </button>
            );
          })}
        </div>
        <Segmented
          options={[
            { value: "amount", label: currency === "INR" ? "₹ moved" : "$ moved" },
            { value: "pct", label: "% moved" },
          ]}
          value={by}
          onChange={setBy}
          label="Rank by"
          size="sm"
        />
      </div>

      <p className="mt-4 text-[14px] leading-snug text-ink-2">
        {group ? (
          <>
            <b className="text-ink">{CLASS_META[group.cls].label}</b> are <b className={tone(total)}>{total >= 0 ? "up" : "down"} {money(Math.abs(total), currency)}</b>.{" "}
            <span className="text-ink-3">
              {group.state.label} — {group.state.detail}
            </span>
          </>
        ) : (
          <>
            Net worth is <b className={tone(total)}>{total >= 0 ? "up" : "down"} {money(Math.abs(total), currency)}</b> today
            {lead && (
              <>
                {" "}
                — the biggest single move is <b className="text-ink">{lead.position.asset.name}</b>{" "}
                <span className={`num font-semibold ${tone(lead.amount)}`}>({signed(lead.amount, currency)})</span>
              </>
            )}
            .
          </>
        )}
      </p>

      {/* Down vs up, mirrored around the centre */}
      <div className="mt-5 grid grid-cols-2 items-end gap-6 text-[13px]">
        <div>
          <p className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <span className="whitespace-nowrap font-semibold text-down">▼ Pulling down</span>
            <span className="num font-bold text-down">{signed(downSum, currency)}</span>
          </p>
          <div className="mt-2 flex h-2.5 justify-end overflow-hidden rounded-l-full bg-down-soft" aria-hidden>
            <span className="grow-from-right h-full rounded-l-full bg-down" style={{ width: `${(Math.abs(downSum) / Math.max(Math.abs(downSum), upSum, 1e-9)) * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            {downs.length} {downs.length === 1 ? "holding" : "holdings"}
          </p>
        </div>
        <div>
          <p className="flex flex-col-reverse items-end gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <span className="num font-bold text-up">{signed(upSum, currency)}</span>
            <span className="whitespace-nowrap font-semibold text-up">Pulling up ▲</span>
          </p>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-r-full bg-up-soft" aria-hidden>
            <span className="grow-from-left h-full rounded-r-full bg-up" style={{ width: `${(upSum / Math.max(Math.abs(downSum), upSum, 1e-9)) * 100}%` }} />
          </div>
          <p className="mt-1 text-right text-[11px] text-ink-3">
            {ups.length} {ups.length === 1 ? "holding" : "holdings"}
            {flat > 0 ? ` · ${flat} unchanged` : ""}
          </p>
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <span className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-line sm:block" aria-hidden />
        <ul key={`d-${tab}-${by}`} aria-label="Pulling down">
          {downs.slice(0, rows).map((m, i) => (
            <Row key={m.position.asset.id} m={m} side="down" max={max} by={by} currency={currency} onOpen={onOpen} delay={i * 30} />
          ))}
          {!downs.length && <li className="grid h-[58px] place-items-center text-[13px] text-ink-3">Nothing down {group ? "here " : ""}today</li>}
        </ul>
        <ul key={`u-${tab}-${by}`} aria-label="Pulling up">
          {ups.slice(0, rows).map((m, i) => (
            <Row key={m.position.asset.id} m={m} side="up" max={max} by={by} currency={currency} onOpen={onOpen} delay={i * 30} />
          ))}
          {!ups.length && <li className="grid h-[58px] place-items-center text-[13px] text-ink-3">Nothing up {group ? "here " : ""}today</li>}
        </ul>
      </div>
      {Math.max(downs.length, ups.length) > LIMIT && (
        <div className="mt-2 flex justify-center">
          <button type="button" onClick={() => setAll(!all)} className="press rounded-full bg-sunken px-4 py-1.5 text-xs font-semibold text-ink-2 hover:text-ink">
            {all ? "Show fewer" : `Show all ${downs.length + ups.length}`}
          </button>
        </div>
      )}

      {today.fx && tab === "all" && (
        <section className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-sunken/70 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold">Dollar–rupee rate</h3>
            <p className="text-xs text-ink-2">
              $1 moved from ₹{today.fx.from.toFixed(2)} to ₹{today.fx.to.toFixed(2)}, which changes what your {currency === "INR" ? "dollar" : "rupee"} holdings are worth in{" "}
              {currency === "INR" ? "rupees" : "dollars"}.
            </p>
          </div>
          <span className={`num shrink-0 text-[13px] font-bold ${tone(today.fx.amount)}`}>{signed(today.fx.amount, currency)}</span>
        </section>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink-3">
        Each move is units held × (latest price − previous close), at $1 = ₹{today.rate.toFixed(2)}. Together they add up to{" "}
        <span className="num font-semibold text-ink-2">{signed(today.total, currency)}</span>. The ring around each logo is your total return on it.
        {today.noDaily.length > 0 && (
          <>
            {" "}
            Not counted (no daily price):{" "}
            {today.noDaily
              .slice(0, 4)
              .map((p) => p.asset.name)
              .join(", ")}
            {today.noDaily.length > 4 ? ` and ${today.noDaily.length - 4} more` : ""}.
          </>
        )}
      </p>
    </Disclosure>
  );
}
