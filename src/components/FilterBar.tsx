"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { activeCount, NO_FILTER, SHOW_LABEL, type Filter, type Show } from "@/lib/filters";
import { money } from "@/lib/format";
import type { Position } from "@/lib/portfolio";
import { CLASS_META, CLASS_ORDER, type Account, type AssetClass, type Currency } from "@/lib/types";
import { Icon, Segmented } from "./ui";

function Chip({ on, onClick, color, count, children }: { on: boolean; onClick: () => void; color?: string; count?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`press inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-3 pr-2.5 text-[13px] font-semibold ring-1 transition-[background-color,color,box-shadow] duration-200 ${
        on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:bg-sunken hover:text-ink"
      }`}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
      {count !== undefined && (
        <span className={`num rounded-full px-1.5 text-[11px] leading-[18px] ${on ? "bg-canvas/15 text-canvas" : "bg-sunken text-ink-3"}`}>{count}</span>
      )}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const sym = (c: Currency) => (c === "INR" ? "₹" : "$");
const short = (v: number, c: Currency) => `${sym(c)}${v >= 1000 ? `${v / 1000}K` : v}`;

const FilterIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
  </svg>
);

/** Top-bar button that opens every filter in one panel. Filters apply to the whole dashboard. */
export function FilterButton({
  filter,
  onChange,
  all,
  shown,
  accounts,
  currency,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  all: Position[];
  shown: number;
  accounts: Account[];
  currency: Currency;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Filter>) => onChange({ ...filter, ...patch });
  const n = activeCount(filter);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // "/" opens filters and focuses search, like most dashboards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const classes = CLASS_ORDER.map((cls) => ({ cls, count: all.filter((p) => p.asset.cls === cls).length })).filter((c) => c.count);
  const brokers = accounts.map((a) => ({ ...a, count: all.filter((p) => (p.byAccount[a.id] ?? 0) > 0).length })).filter((a) => a.count);
  const presets = currency === "INR" ? [100, 1000, 10000] : [1, 10, 100];

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={n ? `Filters, ${n} on` : "Filters"}
        onClick={() => setOpen(!open)}
        className={`press inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold ring-1 transition-colors max-sm:w-10 max-sm:justify-center max-sm:px-0 ${
          n || open ? "bg-accent-soft text-accent ring-accent/30" : "bg-surface text-ink ring-line hover:bg-sunken"
        }`}
      >
        {FilterIcon}
        <span className="hidden sm:inline">Filter</span>
        {n > 0 && (
          <span className="num grid size-[18px] place-items-center rounded-full bg-accent text-[11px] text-white max-sm:absolute max-sm:-right-1 max-sm:-top-1">{n}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filters"
          className="pop-in fixed inset-x-3 top-[68px] z-50 max-h-[calc(100dvh-84px)] origin-top overflow-y-auto rounded-[24px] border border-line bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[400px] sm:origin-top-right"
        >
          <div className="space-y-5 p-5">
            <label className="field-wrap flex h-11 items-center gap-2 rounded-2xl bg-sunken px-3.5 ring-1 ring-line transition-shadow">
              <span className="text-ink-3">{Icon.search}</span>
              <input
                autoFocus
                value={filter.search}
                onChange={(e) => set({ search: e.target.value })}
                placeholder="Search name or ticker"
                aria-label="Search holdings"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
              />
            </label>

            <Group title="Asset type">
              {classes.map(({ cls, count }) => (
                <Chip key={cls} on={filter.classes.includes(cls)} onClick={() => set({ classes: toggle<AssetClass>(filter.classes, cls) })} color={CLASS_META[cls].color} count={count}>
                  {CLASS_META[cls].label}
                </Chip>
              ))}
            </Group>

            {brokers.length > 1 && (
              <Group title="Broker">
                {brokers.map((b) => (
                  <Chip key={b.id} on={filter.accounts.includes(b.id)} onClick={() => set({ accounts: toggle(filter.accounts, b.id) })} count={b.count}>
                    {b.name}
                  </Chip>
                ))}
              </Group>
            )}

            <Group title="Show">
              {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
                <Chip key={s} on={filter.show === s} onClick={() => set({ show: s })}>
                  {SHOW_LABEL[s]}
                </Chip>
              ))}
            </Group>

            <Group title="Priced in">
              <Segmented
                options={[
                  { value: "all", label: "Any currency" },
                  { value: "INR", label: "₹ Rupees" },
                  { value: "USD", label: "$ Dollars" },
                ]}
                value={filter.priced}
                onChange={(v) => set({ priced: v })}
                label="Priced in"
                size="sm"
              />
            </Group>

            <Group title="Hide small holdings">
              <Chip on={filter.minValue === 0} onClick={() => (set({ minValue: 0 }), setCustom(""))}>
                Show all
              </Chip>
              {presets.map((v) => (
                <Chip key={v} on={filter.minValue === v} onClick={() => (set({ minValue: v }), setCustom(""))}>
                  Under {short(v, currency)}
                </Chip>
              ))}
              <label className="field-wrap flex h-9 w-[104px] items-center gap-1 rounded-full bg-surface px-3 ring-1 ring-line">
                <span className="text-[13px] text-ink-3">{sym(currency)}</span>
                <input
                  inputMode="decimal"
                  value={custom}
                  placeholder="Custom"
                  aria-label="Hide holdings worth less than"
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    setCustom(raw);
                    set({ minValue: Number(raw) || 0 });
                  }}
                  className="num w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
                />
              </label>
            </Group>
          </div>

          <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-3.5 backdrop-blur">
            <button
              type="button"
              onClick={() => (onChange(NO_FILTER), setCustom(""))}
              disabled={!n}
              className="text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-40"
            >
              Clear all
            </button>
            <button type="button" onClick={() => setOpen(false)} className="press h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white">
              Show {shown} {shown === 1 ? "holding" : "holdings"}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-ink-3">{title}</legend>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </fieldset>
  );
}

/** Slim bar under the header listing the filters that are on, each removable. */
export function ActiveFilters({
  filter,
  onChange,
  accounts,
  shown,
  total,
  shownValue,
  currency,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  accounts: Account[];
  shown: number;
  total: number;
  shownValue: number;
  currency: Currency;
}) {
  if (!activeCount(filter)) return null;
  const set = (patch: Partial<Filter>) => onChange({ ...filter, ...patch });
  const pills: { key: string; label: string; color?: string; remove: () => void }[] = [
    ...(filter.search.trim() ? [{ key: "q", label: `“${filter.search.trim()}”`, remove: () => set({ search: "" }) }] : []),
    ...filter.classes.map((c) => ({ key: c, label: CLASS_META[c].label, color: CLASS_META[c].color, remove: () => set({ classes: filter.classes.filter((x) => x !== c) }) })),
    ...filter.accounts.map((id) => ({ key: id, label: accounts.find((a) => a.id === id)?.name ?? "Broker", remove: () => set({ accounts: filter.accounts.filter((x) => x !== id) }) })),
    ...(filter.show !== "all" ? [{ key: "show", label: SHOW_LABEL[filter.show], remove: () => set({ show: "all" as Show }) }] : []),
    ...(filter.priced !== "all" ? [{ key: "cur", label: filter.priced === "INR" ? "Priced in ₹" : "Priced in $", remove: () => set({ priced: "all" as const }) }] : []),
    ...(filter.minValue > 0 ? [{ key: "min", label: `${short(filter.minValue, currency)} and up`, remove: () => set({ minValue: 0 }) }] : []),
  ];
  return (
    <div className="fade-in border-t border-line/70">
      <div className="mx-auto flex max-w-[1180px] items-center gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6">
        <span className="shrink-0 text-xs text-ink-3">
          <b className="num text-ink">{shown}</b> of {total} · <span className="num">{money(shownValue, currency, { decimals: 0 })}</span>
        </span>
        {pills.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={p.remove}
            aria-label={`Remove filter ${p.label}`}
            className="press item-in inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-2.5 pr-2 text-xs font-semibold ring-1 ring-line hover:ring-ink-3/50"
          >
            {p.color && <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />}
            {p.label}
            <svg width="8" height="8" viewBox="0 0 14 14" aria-hidden className="text-ink-3">
              <path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        ))}
        <button type="button" onClick={() => onChange(NO_FILTER)} className="shrink-0 px-1 text-xs font-semibold text-accent hover:underline">
          Clear all
        </button>
      </div>
    </div>
  );
}
