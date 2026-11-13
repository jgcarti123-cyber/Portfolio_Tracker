import type { DayValue } from "./networth";
import { cashBalances, cashTotal } from "./cash";
import { convert, type Position, type Totals } from "./portfolio";
import type { Today } from "./today";
import { CLASS_META, type Currency, type VaultData } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Calendar date in the viewer's own timezone (not UTC, which is a day behind late at night in India). */
const day = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Realised gain per asset from sales, using the average-cost method (as the app does). */
export function realisedGains(data: VaultData) {
  const out = new Map<string, number>();
  for (const a of data.assets) {
    let q = 0;
    let cost = 0;
    let gain = 0;
    for (const t of data.txns.filter((x) => x.assetId === a.id).sort((x, y) => x.ts - y.ts)) {
      if (t.type === "buy") (q += t.qty), (cost += t.qty * t.price);
      else {
        const sold = Math.min(t.qty, q);
        const avg = q > 0 ? cost / q : 0;
        gain += sold * (t.price - avg);
        cost -= avg * sold;
        q -= sold;
      }
    }
    if (Math.abs(gain) > 1e-9) out.set(a.id, gain);
  }
  return out;
}

/**
 * Everything the assistant needs to answer questions about this portfolio, with every
 * figure already worked out by Folio, so the model reads numbers instead of computing them.
 * Holdings get short ids (h1, h2…) that the model uses to refer to them in actions.
 */
export function buildContext({
  data,
  positions,
  totals,
  today,
  series,
  currency,
  usdInr,
}: {
  data: VaultData;
  positions: Position[];
  totals: Totals;
  today: Today;
  series: DayValue[];
  currency: Currency;
  usdInr: number;
}) {
  const disp = (n: number, p: Position) => r2(convert(n, p.asset.currency, currency, usdInr));
  const acc = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "Other";
  const ids = new Map<string, string>();
  data.assets.forEach((a, i) => ids.set(a.id, `h${i + 1}`));
  const realised = realisedGains(data);
  const moveOf = new Map(today.movers.map((m) => [m.position.asset.id, m]));

  const holdings = positions.map((p) => {
    const value = p.value ?? p.cost;
    const first = data.txns.filter((t) => t.assetId === p.asset.id).sort((a, b) => a.ts - b.ts)[0];
    const m = moveOf.get(p.asset.id);
    return {
      id: ids.get(p.asset.id),
      name: p.asset.name,
      ticker: p.asset.ticker,
      type: CLASS_META[p.asset.cls].short,
      pricedIn: p.asset.currency,
      units: r2(p.qty * 1e4) / 1e4,
      unitsByBroker: Object.fromEntries(Object.entries(p.byAccount).filter(([, q]) => q > 0).map(([id, q]) => [acc(id), r2(q * 1e4) / 1e4])),
      avgCostPerUnit: r2(p.avgPrice),
      pricePerUnit: p.price !== null ? r2(p.price) : null,
      priceSource: p.priceSource,
      invested: disp(p.cost, p),
      value: disp(value, p),
      returnAmount: disp(value - p.cost, p),
      returnPct: p.cost > 0 ? r2(((value - p.cost) / p.cost) * 100) : null,
      weightPct: totals.value > 0 ? r2((convert(value, p.asset.currency, currency, usdInr) / totals.value) * 100) : 0,
      todayChange: m ? r2(m.amount) : null,
      todayPricePct: m ? r2(m.pct) : null,
      realisedGain: realised.has(p.asset.id) ? disp(realised.get(p.asset.id)!, p) : 0,
      firstBought: first ? day(first.ts) : null,
    };
  });

  // Biggest first, with an explicit rank, so "largest holding" never needs comparing by eye.
  holdings.sort((a, b) => b.value - a.value);
  const ranked = holdings.map((h, i) => ({ rankByValue: i + 1, ...h }));

  // Things sold out of entirely still matter for "what did I make on X?".
  const closed = data.assets
    .filter((a) => !positions.some((p) => p.asset.id === a.id) && realised.has(a.id))
    .map((a) => ({ id: ids.get(a.id), name: a.name, realisedGain: r2(convert(realised.get(a.id)!, a.currency, currency, usdInr)) }));

  const group = (key: (p: Position) => string[]) => {
    const m = new Map<string, number>();
    for (const p of positions) {
      const v = convert(p.value ?? p.cost, p.asset.currency, currency, usdInr);
      const keys = key(p);
      for (const k of keys) m.set(k, (m.get(k) ?? 0) + v / keys.length);
    }
    return [...m.entries()].map(([k, v]) => ({ name: k, value: r2(v), weightPct: totals.value > 0 ? r2((v / totals.value) * 100) : 0 })).sort((a, b) => b.value - a.value);
  };
  const byBroker = (() => {
    const m = new Map<string, number>();
    for (const p of positions) {
      const v = convert(p.value ?? p.cost, p.asset.currency, currency, usdInr);
      for (const [id, q] of Object.entries(p.byAccount)) if (q > 0 && p.qty > 0) m.set(acc(id), (m.get(acc(id)) ?? 0) + (v * q) / p.qty);
    }
    return [...m.entries()].map(([name, v]) => ({ name, value: r2(v), weightPct: totals.value > 0 ? r2((v / totals.value) * 100) : 0 })).sort((a, b) => b.value - a.value);
  })();

  const at = (daysAgo: number) => series[Math.max(0, series.length - 1 - daysAgo)]?.value;
  const peak = series.reduce<DayValue | null>((b, d) => (!b || d.value > b.value ? d : b), null);

  return {
    today: day(Date.now()),
    weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
    displayCurrency: currency,
    usdInr: r2(usdInr),
    brokers: data.accounts.map((a) => a.name),
    totals: {
      netWorth: r2(totals.value),
      invested: r2(totals.cost),
      returnAmount: r2(totals.gain),
      returnPct: totals.cost > 0 ? r2((totals.gain / totals.cost) * 100) : 0,
      todayChange: r2(today.total),
      todayPct: today.base > 0 ? r2((today.total / today.base) * 100) : 0,
      holdingsUpToday: today.up.count,
      holdingsDownToday: today.down.count,
      currencyEffectToday: today.fx ? r2(today.fx.amount) : 0,
    },
    history: {
      trackedSince: series[0] ? day(series[0].ts) : null,
      netWorth7DaysAgo: at(7) !== undefined ? r2(at(7)!) : null,
      netWorth30DaysAgo: at(30) !== undefined ? r2(at(30)!) : null,
      highest: peak ? { value: r2(peak.value), date: day(peak.ts) } : null,
    },
    cash: (() => {
      const b = cashBalances(data);
      return {
        INR: r2(b.INR),
        USD: r2(b.USD),
        total: r2(cashTotal(b, currency, usdInr)),
        recent: [...(data.cash ?? [])]
          .sort((x, y) => y.ts - x.ts)
          .slice(0, 8)
          .map((e) => ({ date: day(e.ts), kind: e.kind, amount: r2(e.amount), ccy: e.currency })),
      };
    })(),
    byType: group((p) => [CLASS_META[p.asset.cls].label]),
    byBroker,
    // Explicit lists so the model never has to read signs to know what rose or fell.
    downToday: today.movers.filter((m) => m.amount < -0.005).sort((a, b) => a.amount - b.amount).map((m) => ({ name: m.position.asset.name, change: r2(m.amount), pricePct: r2(m.pct) })),
    upToday: today.movers.filter((m) => m.amount > 0.005).sort((a, b) => b.amount - a.amount).map((m) => ({ name: m.position.asset.name, change: r2(m.amount), pricePct: r2(m.pct) })),
    markets: today.byClass.map((g) => ({ market: CLASS_META[g.cls].label, todayChange: r2(g.total), status: g.state.label })),
    holdings: ranked,
    soldOut: closed,
    noDailyPrice: today.noDaily.map((p) => p.asset.name),
    trades: data.txns
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 300)
      .map((t) => {
        const a = data.assets.find((x) => x.id === t.assetId);
        return { date: day(t.ts), holding: ids.get(t.assetId), name: a?.name, type: t.type, units: r2(t.qty * 1e4) / 1e4, pricePerUnit: r2(t.price), pricedIn: a?.currency, broker: acc(t.accountId) };
      }),
  };
}

/** Maps the short ids in the context back to asset ids. */
export function holdingIdMap(data: VaultData) {
  return new Map(data.assets.map((a, i) => [`h${i + 1}`, a.id]));
}
