"use client";

import type { ReactNode } from "react";
import { sortPositions, type Sort, type SortKey } from "@/lib/filters";
import { money, pct, price, qty } from "@/lib/format";
import { convert, type Position } from "@/lib/portfolio";
import { CLASS_META, type Account, type Candle, type Currency } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Button, Delta, Disclosure, Icon } from "./ui";

/** Column heading that sorts the table; click again to flip the direction. */
function SortHead({
  k,
  sort,
  onSort,
  children,
  className = "",
  align = "right",
}: {
  k: SortKey;
  sort: Sort;
  onSort: (s: Sort) => void;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const on = sort.key === k;
  return (
    <th className={`px-2 pb-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort({ key: k, dir: on ? (sort.dir === "asc" ? "desc" : "asc") : k === "name" ? "asc" : "desc" })}
        className={`inline-flex items-center gap-1 rounded-md transition-colors hover:text-ink ${on ? "font-semibold text-ink" : ""}`}
      >
        {children}
        <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden className={`transition-[opacity,transform] duration-200 ${on ? "opacity-100" : "opacity-30"} ${on && sort.dir === "asc" ? "rotate-180" : ""}`}>
          <path d="M4 9.5 7.5 5h-7z" fill="currentColor" />
          {!on && <path d="M4 .5 7.5 4h-7z" fill="currentColor" />}
        </svg>
      </button>
    </th>
  );
}

export { AssetBadge };

/** Last 30 closes as a small trend line; green or red by direction, with the % beside it in the row. */
function Sparkline({ candles }: { candles: Candle[] | undefined }) {
  const pts = (candles ?? []).slice(-30).map((c) => c.c);
  if (pts.length < 3) return <span className="text-xs text-ink-3">–</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const W = 84;
  const H = 30;
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
  const up = pts[pts.length - 1] >= pts[0];
  const change = ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100;
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={W} height={H} aria-hidden className="overflow-visible">
        <path
          d={d}
          pathLength={1}
          className="draw"
          fill="none"
          stroke={up ? "var(--up)" : "var(--down)"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="num w-14 text-right text-xs text-ink-2">{pct(change)}</span>
    </span>
  );
}

export function Holdings({
  positions,
  accounts,
  closes,
  onOpen,
  sort,
  onSort,
  currency,
  usdInr,
  total,
  onClear,
}: {
  positions: Position[];
  accounts: Account[];
  closes: Record<string, Candle[]>;
  onOpen: (assetId: string) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  currency: Currency;
  usdInr: number;
  /** Holdings before filtering. */
  total: number;
  onClear: () => void;
}) {
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown";
  const rows = sortPositions(positions, sort, currency, usdInr);
  const inDisplay = (p: Position, n: number) => convert(n, p.asset.currency, currency, usdInr);
  const worth = positions.reduce((a, p) => a + inDisplay(p, p.value ?? p.cost), 0);
  const cost = positions.reduce((a, p) => a + inDisplay(p, p.cost), 0);
  const gain = worth - cost;
  const gainPct = cost > 0 ? (gain / cost) * 100 : null;

  return (
    <Disclosure
      id="holdings"
      icon={Icon.list}
      title="Holdings"
      summary={
        <>
          <span className="hidden sm:inline">
            {positions.length < total ? `${positions.length} of ${total}` : positions.length} {total === 1 ? "asset" : "assets"}
          </span>
          <span className="num font-semibold text-ink">{money(worth, currency, { decimals: 0 })}</span>
          {gainPct !== null && <Delta value={gain}>{pct(gainPct)}</Delta>}
        </>
      }
    >
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <SortHead k="name" sort={sort} onSort={onSort} align="left">
                Asset
              </SortHead>
              <th className="hidden px-2 pb-2 text-right font-medium lg:table-cell">Last 30 days</th>
              <SortHead k="today" sort={sort} onSort={onSort}>
                Price · today
              </SortHead>
              <SortHead k="invested" sort={sort} onSort={onSort} className="hidden md:table-cell">
                Invested
              </SortHead>
              <SortHead k="value" sort={sort} onSort={onSort}>
                Value
              </SortHead>
              <SortHead k="return" sort={sort} onSort={onSort}>
                Return
              </SortHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const cur = p.asset.currency;
              const held = Object.entries(p.byAccount)
                .filter(([, q]) => q > 0)
                .map(([id]) => accountName(id));
              const dayPct = p.price && p.prevClose ? ((p.price - p.prevClose) / p.prevClose) * 100 : null;
              return (
                <tr
                  key={p.asset.id}
                  tabIndex={0}
                  onClick={() => onOpen(p.asset.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(p.asset.id)}
                  className="group cursor-pointer [&>td]:border-t [&>td]:border-line [&>td]:py-3 [&>td]:transition-colors"
                  aria-label={`Open ${p.asset.name}`}
                >
                  <td className="rounded-l-2xl px-2 group-hover:bg-sunken">
                    <div className="flex items-center gap-3">
                      <AssetBadge position={p} />
                      <div className="min-w-0">
                        <p className="max-w-[16rem] truncate font-bold">{p.asset.name}</p>
                        <p className="truncate text-xs text-ink-2">
                          {held.join(", ")} · {qty(p.qty)} {CLASS_META[p.asset.cls].unit}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-2 text-right group-hover:bg-sunken lg:table-cell">
                    <Sparkline candles={closes[p.asset.id]} />
                  </td>
                  <td className="num px-2 text-right group-hover:bg-sunken">
                    <p>{p.price !== null ? price(p.price, cur) : "–"}</p>
                    <p className="text-xs text-ink-3">
                      {p.priceSource === "manual"
                        ? "entered by you"
                        : p.priceSource === "last-trade"
                          ? "last trade price"
                          : dayPct !== null
                            ? `${pct(dayPct)} today`
                            : ""}
                    </p>
                  </td>
                  <td className="num hidden px-2 text-right text-ink-2 group-hover:bg-sunken md:table-cell">
                    {money(p.cost, cur)}
                  </td>
                  <td className="num px-2 text-right font-bold group-hover:bg-sunken">
                    {p.value !== null ? money(p.value, cur) : "–"}
                  </td>
                  <td className="num rounded-r-2xl px-2 text-right group-hover:bg-sunken">
                    {p.gain !== null && (
                      <Delta value={p.gain}>{pct(p.cost > 0 ? (p.gain / p.cost) * 100 : 0)}</Delta>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="fade-in grid place-items-center gap-3 py-12 text-center">
            <p className="text-sm text-ink-2">No holdings match these filters.</p>
            <Button variant="ghost" onClick={onClear}>
              Clear all filters
            </Button>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
