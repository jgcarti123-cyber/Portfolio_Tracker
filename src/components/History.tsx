"use client";

import { useMemo, useState } from "react";
import { money, price as fmtPrice, qty as fmtQty, signed } from "@/lib/format";
import { CASH_COLOR, CASH_LABEL } from "@/lib/cash";
import { convert, isOpening } from "@/lib/portfolio";
import { CLASS_META, type CashEntry, type Currency, type Txn, type VaultData } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Card, Icon, Segmented } from "./ui";

type Kind = "all" | "buy" | "sell" | "cash";
/** One line in the list: a trade, or cash added or taken out by hand. */
type Item = { ts: number; row?: Row; cash?: CashEntry };

interface Row {
  t: Txn;
  opening: boolean;
  /** Realised gain on a sale (average-cost method), in the asset's currency. */
  gain: number | null;
}

/** Every record with its realised gain on sales, replaying each asset in time order. */
function rows(data: VaultData): Row[] {
  const out: Row[] = [];
  const byAsset = new Map<string, Txn[]>();
  for (const t of data.txns) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
  for (const list of byAsset.values()) {
    let q = 0;
    let cost = 0;
    for (const t of [...list].sort((a, b) => a.ts - b.ts)) {
      let gain: number | null = null;
      if (t.type === "buy") (q += t.qty), (cost += t.qty * t.price);
      else {
        const sold = Math.min(t.qty, q);
        const avg = q > 0 ? cost / q : 0;
        gain = sold > 0 ? sold * (t.price - avg) : null;
        cost -= avg * sold;
        q -= sold;
      }
      out.push({ t, opening: isOpening(t, data.txns), gain });
    }
  }
  return out.sort((a, b) => b.t.ts - a.t.ts);
}

const dayKey = (ts: number) => new Date(ts).toDateString();
function dayLabel(ts: number, now: number) {
  const d = new Date(ts).toDateString();
  if (d === new Date(now).toDateString()) return "Today";
  if (d === new Date(now - 86_400_000).toDateString()) return "Yesterday";
  return new Date(ts).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Every buy and sell across all holdings, newest first and grouped by day, with
 * filters, the realised gain on each sale, and holdings added to Folio shown quietly.
 */
export function History({
  data,
  currency,
  usdInr,
  onOpen,
}: {
  data: VaultData;
  currency: Currency;
  usdInr: number;
  onOpen: (assetId: string) => void;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [broker, setBroker] = useState<string | null>(null);
  const [showAdded, setShowAdded] = useState(true);
  const [limit, setLimit] = useState(60);
  const [now] = useState(() => Date.now());

  const all = useMemo(() => rows(data), [data]);
  const asset = (id: string) => data.assets.find((a) => a.id === id);
  const accName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "Other";
  const disp = (t: Txn, n: number) => convert(n, asset(t.assetId)?.currency ?? currency, currency, usdInr);

  // Cash a trade moved, shown on that trade's line.
  const cashOf = useMemo(() => new Map((data.cash ?? []).filter((e) => e.txnId).map((e) => [e.txnId!, e])), [data.cash]);
  const s = q.trim().toLowerCase();
  const cashItems: Item[] =
    kind === "buy" || kind === "sell" || broker
      ? []
      : (data.cash ?? [])
          .filter((e) => (e.kind === "added" || e.kind === "withdrawn") && (!s || (e.note ?? "").toLowerCase().includes(s) || "cash".includes(s)))
          .map((e) => ({ ts: e.ts, cash: e }));

  const shownTrades = all.filter((r) => {
    if (kind === "cash") return false;
    if (!showAdded && r.opening) return false;
    if (kind !== "all" && (r.opening || r.t.type !== kind)) return false;
    if (broker && r.t.accountId !== broker) return false;
    if (s) {
      const a = asset(r.t.assetId);
      if (![a?.name, a?.ticker].some((x) => x?.toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const shown: Item[] = [...shownTrades.map((r) => ({ ts: r.t.ts, row: r })), ...cashItems].sort((a, b) => b.ts - a.ts);

  // Summary over the real trades in view (opening entries aren't money moving that day).
  const trades = shownTrades.filter((r) => !r.opening);
  const cashNet = cashItems.reduce((sum, i) => sum + convert(i.cash!.amount, i.cash!.currency, currency, usdInr), 0);
  const bought = trades.filter((r) => r.t.type === "buy").reduce((s, r) => s + disp(r.t, r.t.qty * r.t.price), 0);
  const sold = trades.filter((r) => r.t.type === "sell").reduce((s, r) => s + disp(r.t, r.t.qty * r.t.price), 0);
  const realised = trades.reduce((s, r) => s + (r.gain !== null ? disp(r.t, r.gain) : 0), 0);

  const groups: { key: string; ts: number; items: Item[] }[] = [];
  for (const it of shown.slice(0, limit)) {
    const k = dayKey(it.ts);
    const g = groups.at(-1);
    if (g && g.key === k) g.items.push(it);
    else groups.push({ key: k, ts: it.ts, items: [it] });
  }
  const brokers = data.accounts.filter((a) => data.txns.some((t) => t.accountId === a.id));

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight">History</h1>
            <p className="mt-1 text-[13px] text-ink-2">Every buy and sell across your brokers, newest first.</p>
          </div>
          <dl className={`num grid gap-5 text-right text-[13px] ${cashItems.length ? "grid-cols-4" : "grid-cols-3"}`}>
            <div>
              <dt className="text-[11px] text-ink-3">Bought</dt>
              <dd className="font-bold">{money(bought, currency, { decimals: 0 })}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">Sold</dt>
              <dd className="font-bold">{money(sold, currency, { decimals: 0 })}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">Realised gain</dt>
              <dd className={`font-bold ${realised > 0 ? "text-up" : realised < 0 ? "text-down" : ""}`}>{signed(realised, currency)}</dd>
            </div>
            {cashItems.length > 0 && (
              <div>
                <dt className="text-[11px] text-ink-3">Cash added</dt>
                <dd className="font-bold">{signed(cashNet, currency)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Segmented
            options={[
              { value: "all", label: "All" },
              { value: "buy", label: "Bought" },
              { value: "sell", label: "Sold" },
              { value: "cash", label: "Cash" },
            ]}
            value={kind}
            onChange={setKind}
            label="Show"
            size="sm"
          />
          <label className="field-wrap flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-full bg-surface px-3 ring-1 ring-line sm:max-w-[260px]">
            <span className="text-ink-3">{Icon.search}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a holding" aria-label="Search history" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3" />
          </label>
          {brokers.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {brokers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={broker === b.id}
                  onClick={() => setBroker(broker === b.id ? null : b.id)}
                  className={`press h-9 rounded-full px-3 text-[13px] font-semibold ring-1 transition-colors ${broker === b.id ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={showAdded} onChange={(e) => setShowAdded(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Show holdings added to Folio
          </label>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card className="grid place-items-center px-6 py-16 text-center">
          <p className="text-[15px] font-semibold">Nothing here yet</p>
          <p className="mt-1 max-w-[380px] text-sm text-ink-2">When you record a buy or sell — from a holding&apos;s page or by telling Ask Folio — it shows up here.</p>
        </Card>
      ) : (
        <Card className="p-2 sm:p-3">
          {groups.map((g) => {
            const net = g.items.reduce((sum, it) => {
              if (it.cash) return sum + convert(it.cash.amount, it.cash.currency, currency, usdInr);
              const r = it.row!;
              return r.opening ? sum : sum + (r.t.type === "sell" ? 1 : -1) * disp(r.t, r.t.qty * r.t.price);
            }, 0);
            return (
              <section key={g.key} className="py-1">
                <header className="sticky top-[64px] z-10 flex items-center justify-between rounded-xl bg-surface/90 px-3 py-2 backdrop-blur">
                  <h2 className="text-[13px] font-bold">{dayLabel(g.ts, now)}</h2>
                  {Math.abs(net) > 0.005 && (
                    <span className="num text-xs text-ink-3">
                      {net > 0 ? "Money in " : "Money out "}
                      <b className="text-ink-2">{money(Math.abs(net), currency, { decimals: 0 })}</b>
                    </span>
                  )}
                </header>
                <ul>
                  {g.items.map((it, i) => {
                    if (it.cash) return <CashLine key={it.cash.id} e={it.cash} i={i} currency={currency} usdInr={usdInr} />;
                    const r = it.row!;
                    const a = asset(r.t.assetId);
                    const moved = cashOf.get(r.t.id);
                    if (!a) return null;
                    const cur = a.currency;
                    const total = r.t.qty * r.t.price;
                    const unit = CLASS_META[a.cls].unit;
                    const sell = r.t.type === "sell";
                    return (
                      <li key={r.t.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(a.id)}
                          className={`item-in group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sunken ${r.opening ? "opacity-75" : ""}`}
                          style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                        >
                          <span className="relative">
                            <AssetBadge position={{ asset: a }} size={36} ring={false} />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full text-[9px] font-extrabold ring-2 ring-surface ${
                                r.opening ? "bg-sunken text-ink-3" : sell ? "bg-ink text-canvas" : "bg-accent text-white"
                              }`}
                              aria-hidden
                            >
                              {r.opening ? "+" : sell ? "S" : "B"}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">
                              {r.opening ? "Added" : sell ? "Sold" : "Bought"} <span className="num">{fmtQty(r.t.qty)}</span> {unit} · {a.name}
                            </span>
                            <span className="num block truncate text-xs text-ink-3">
                              {r.opening ? `avg ${fmtPrice(r.t.price, cur)}` : `at ${fmtPrice(r.t.price, cur)}`} · {accName(r.t.accountId)}
                              {r.opening ? ` · ${r.t.via ? `from ${r.t.via}` : "added to Folio"}` : ` · ${new Date(r.t.ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`}
                              {r.t.via === "Ask Folio" && " · via Ask Folio"}
                              {moved && ` · ${money(Math.abs(moved.amount), moved.currency)} ${moved.amount > 0 ? "to" : "from"} cash`}
                            </span>
                          </span>
                          <span className="num shrink-0 text-right">
                            <span className={`block text-[14px] font-bold ${r.opening ? "text-ink-2" : ""}`}>
                              {r.opening ? "" : sell ? "+" : "−"}
                              {money(total, cur)}
                            </span>
                            {r.gain !== null ? (
                              <span className={`block text-xs font-semibold ${r.gain >= 0 ? "text-up" : "text-down"}`}>{signed(r.gain, cur)} gain</span>
                            ) : cur !== currency ? (
                              <span className="block text-xs text-ink-3">{money(convert(total, cur, currency, usdInr), currency)}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {shown.length > limit && (
            <div className="flex justify-center p-3">
              <button type="button" onClick={() => setLimit(limit + 60)} className="press rounded-full bg-sunken px-4 py-2 text-xs font-semibold text-ink-2 hover:text-ink">
                Show older ({shown.length - limit} more)
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function CashLine({ e, i, currency, usdInr }: { e: CashEntry; i: number; currency: Currency; usdInr: number }) {
  const add = e.amount > 0;
  return (
    <li>
      <div className="item-in flex w-full items-center gap-3 rounded-2xl px-3 py-2.5" style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-white" style={{ background: CASH_COLOR }} aria-hidden>
          {Icon.wallet}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{e.note || CASH_LABEL[e.kind]}</span>
          <span className="num block truncate text-xs text-ink-3">
            {e.note ? `${CASH_LABEL[e.kind]} · ` : ""}
            {new Date(e.ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            {e.via ? ` · via ${e.via}` : ""}
          </span>
        </span>
        <span className="num shrink-0 text-right">
          <span className={`block text-[14px] font-bold ${add ? "text-up" : ""}`}>
            {add ? "+" : "−"}
            {money(Math.abs(e.amount), e.currency)}
          </span>
          {e.currency !== currency && <span className="block text-xs text-ink-3">{money(convert(Math.abs(e.amount), e.currency, currency, usdInr), currency)}</span>}
        </span>
      </div>
    </li>
  );
}
