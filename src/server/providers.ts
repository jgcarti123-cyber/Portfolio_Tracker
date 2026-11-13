/**
 * Price providers. The server only ever sees instrument symbols — never
 * quantities, accounts or anything that identifies a user.
 *   stocks  -> Yahoo Finance (unofficial)
 *   crypto  -> CoinGecko
 *   funds   -> mfapi.in (AMFI NAVs)
 *   USD/INR -> Frankfurter (ECB reference rates)
 */
import type { AssetClass, Candle, Currency, Quote, Range, SearchHit } from "@/lib/types";

const store = new Map<string, { at: number; value: unknown }>();

/** Cache with a TTL; if a refresh fails, serve the stale value rather than nothing. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  try {
    const value = await load();
    store.set(key, { at: Date.now(), value });
    if (store.size > 2000) store.delete(store.keys().next().value as string);
    return value;
  } catch (err) {
    if (hit) return hit.value as T;
    throw err;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

const MIN = 60_000;
export const SYMBOL_RE = /^[A-Za-z0-9.\-=^&_]{1,48}$/;

/* ----------------------------- Yahoo (stocks) ----------------------------- */

interface YahooChart {
  chart: {
    result?: {
      meta: { regularMarketPrice: number; chartPreviousClose?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[];
      };
    }[];
  };
}

const YAHOO_RANGE: Record<Range, [string, string]> = {
  "1D": ["1d", "5m"],
  "1W": ["5d", "30m"],
  "1M": ["1mo", "1d"],
  "3M": ["3mo", "1d"],
  "1Y": ["1y", "1d"],
  "5Y": ["5y", "1wk"],
};

async function yahooChart(symbol: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const json = await getJson<YahooChart>(url);
  const r = json.chart.result?.[0];
  if (!r) throw new Error("No data for " + symbol);
  return r;
}

async function yahooQuote(symbol: string): Promise<Quote> {
  return cached(`yq:${symbol}`, MIN, async () => {
    const r = await yahooChart(symbol, "1d", "1d");
    return {
      price: r.meta.regularMarketPrice,
      prevClose: r.meta.chartPreviousClose ?? null,
      ts: (r.meta.regularMarketTime ?? Date.now() / 1000) * 1000,
    };
  });
}

async function yahooHistory(symbol: string, range: Range): Promise<Candle[]> {
  const [r, i] = YAHOO_RANGE[range];
  return cached(`yh:${symbol}:${range}`, range === "1D" ? 2 * MIN : 15 * MIN, async () => {
    const res = await yahooChart(symbol, r, i);
    const q = res.indicators.quote[0];
    const out: Candle[] = [];
    (res.timestamp ?? []).forEach((t, k) => {
      const [o, h, l, c] = [q.open[k], q.high[k], q.low[k], q.close[k]];
      if (o != null && h != null && l != null && c != null) out.push({ t, o, h, l, c });
    });
    return out;
  });
}

interface YahooSearch {
  quotes: { symbol: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }[];
}

async function yahooSearch(q: string, cls: "in_stock" | "us_stock"): Promise<SearchHit[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`;
  const json = await cached(`ys:${q.toLowerCase()}`, 30 * MIN, () => getJson<YahooSearch>(url));
  return json.quotes
    .filter((x) => x.quoteType === "EQUITY" || x.quoteType === "ETF")
    .filter((x) =>
      cls === "in_stock" ? /\.(NS|BO)$/.test(x.symbol) : !x.symbol.includes("."),
    )
    .map((x) => ({
      cls,
      symbol: x.symbol,
      ticker: x.symbol.replace(/\.(NS|BO)$/, ""),
      name: x.longname ?? x.shortname ?? x.symbol,
      currency: cls === "in_stock" ? ("INR" as const) : ("USD" as const),
      exchange: x.exchDisp,
    }));
}

/* --------------------------- CoinGecko (crypto) --------------------------- */

const CG = "https://api.coingecko.com/api/v3";

async function cgQuotes(ids: string[]): Promise<Record<string, Record<string, number>>> {
  const sorted = [...new Set(ids)].sort();
  return cached(`cq:${sorted.join(",")}`, MIN, () =>
    getJson(
      `${CG}/simple/price?ids=${encodeURIComponent(sorted.join(","))}&vs_currencies=usd,inr&include_24hr_change=true&include_last_updated_at=true`,
    ),
  );
}

async function cgHistory(id: string, cur: Currency, range: Range, daily: boolean): Promise<Candle[]> {
  const vs = cur.toLowerCase();
  if (daily) {
    return cached(`cd:${id}:${vs}`, 30 * MIN, async () => {
      const j = await getJson<{ prices: [number, number][] }>(
        `${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=365&interval=daily`,
      );
      return j.prices.map(([ms, c]) => ({ t: Math.floor(ms / 1000), o: c, h: c, l: c, c }));
    });
  }
  const days = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365, "5Y": 365 }[range];
  return cached(`ch:${id}:${vs}:${days}`, 10 * MIN, async () => {
    const j = await getJson<[number, number, number, number, number][]>(
      `${CG}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=${vs}&days=${days}`,
    );
    return j.map(([ms, o, h, l, c]) => ({ t: Math.floor(ms / 1000), o, h, l, c }));
  });
}

async function cgSearch(q: string): Promise<SearchHit[]> {
  const j = await cached(`cs:${q.toLowerCase()}`, 30 * MIN, () =>
    getJson<{ coins: { id: string; name: string; symbol: string }[] }>(
      `${CG}/search?query=${encodeURIComponent(q)}`,
    ),
  );
  return j.coins.slice(0, 12).map((c) => ({
    cls: "crypto" as const,
    symbol: c.id,
    ticker: c.symbol.toUpperCase(),
    name: c.name,
    currency: "USD" as const,
  }));
}

/* ----------------------------- mfapi.in (funds) ---------------------------- */

interface MfHistory {
  meta: { scheme_name: string };
  data: { date: string; nav: string }[];
}

/** NAV history, oldest first. */
async function mfSeries(code: string): Promise<Candle[]> {
  return cached(`mf:${code}`, 60 * MIN, async () => {
    const j = await getJson<MfHistory>(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`);
    return j.data
      .map((d) => {
        const [dd, mm, yyyy] = d.date.split("-").map(Number);
        const c = Number(d.nav);
        return { t: Date.UTC(yyyy, mm - 1, dd) / 1000, o: c, h: c, l: c, c };
      })
      .filter((c) => isFinite(c.c) && c.c > 0)
      .reverse();
  });
}

async function mfSearch(q: string): Promise<SearchHit[]> {
  const j = await cached(`ms:${q.toLowerCase()}`, 60 * MIN, () =>
    getJson<{ schemeCode: number; schemeName: string }[]>(
      `https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`,
    ),
  );
  return j.slice(0, 25).map((s) => ({
    cls: "mf" as const,
    symbol: String(s.schemeCode),
    ticker: String(s.schemeCode),
    name: s.schemeName,
    currency: "INR" as const,
  }));
}

/* --------------------------------- public --------------------------------- */

export interface Instrument {
  cls: AssetClass;
  symbol: string;
  currency: Currency;
}

export async function search(q: string, cls: AssetClass): Promise<SearchHit[]> {
  if (cls === "crypto") return cgSearch(q);
  if (cls === "mf") return mfSearch(q);
  return yahooSearch(q, cls);
}

export async function quotes(items: Instrument[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const key = (i: Instrument) => `${i.cls}:${i.symbol}:${i.currency}`;

  const coins = items.filter((i) => i.cls === "crypto");
  const jobs: Promise<void>[] = [];

  if (coins.length) {
    jobs.push(
      cgQuotes(coins.map((c) => c.symbol)).then((data) => {
        for (const c of coins) {
          const row = data[c.symbol];
          const vs = c.currency.toLowerCase();
          if (!row?.[vs]) continue;
          const change = row[`${vs}_24h_change`];
          out[key(c)] = {
            price: row[vs],
            prevClose: typeof change === "number" ? row[vs] / (1 + change / 100) : null,
            ts: (row.last_updated_at ?? Date.now() / 1000) * 1000,
          };
        }
      }),
    );
  }

  for (const i of items) {
    if (i.cls === "crypto") continue;
    jobs.push(
      (async () => {
        if (i.cls === "mf") {
          const s = await mfSeries(i.symbol);
          const last = s.at(-1);
          if (last) out[key(i)] = { price: last.c, prevClose: s.at(-2)?.c ?? null, ts: last.t * 1000 };
        } else {
          out[key(i)] = await yahooQuote(i.symbol);
        }
      })(),
    );
  }

  // One failed instrument must not sink the rest.
  await Promise.allSettled(jobs);
  return out;
}

const RANGE_DAYS: Record<Range, number> = { "1D": 7, "1W": 14, "1M": 31, "3M": 92, "1Y": 366, "5Y": 1827 };

export async function history(i: Instrument, range: Range, daily: boolean): Promise<Candle[]> {
  if (i.cls === "crypto") return cgHistory(i.symbol, i.currency, range, daily);
  if (i.cls === "mf") {
    const s = await mfSeries(i.symbol);
    const from = Date.now() / 1000 - RANGE_DAYS[daily ? "1Y" : range] * 86400;
    return s.filter((c) => c.t >= from);
  }
  return yahooHistory(i.symbol, daily ? "1Y" : range);
}

export async function fx(): Promise<{ rate: number; series: { t: number; c: number }[] }> {
  return cached("fx", 60 * MIN, async () => {
    const start = new Date(Date.now() - 370 * 86400_000).toISOString().slice(0, 10);
    const j = await getJson<{ rates: Record<string, { INR: number }> }>(
      `https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=INR`,
    );
    const series = Object.entries(j.rates)
      .map(([d, r]) => ({ t: Date.parse(d) / 1000, c: r.INR }))
      .sort((a, b) => a.t - b.t);
    if (!series.length) throw new Error("No FX data");
    return { rate: series[series.length - 1].c, series };
  });
}
