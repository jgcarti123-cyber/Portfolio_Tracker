/**
 * Price providers. The server only ever sees instrument symbols — never
 * quantities, accounts or anything that identifies a user.
 *   stocks  -> Yahoo Finance (unofficial)
 *   crypto  -> CoinGecko (search, quotes; history backup), Coinbase Exchange (history)
 *   funds   -> mfapi.in (AMFI NAVs)
 *   USD/INR -> Frankfurter (ECB reference rates)
 *   mood    -> alternative.me (crypto), Tickertape MMI (India), VIX via Yahoo (US)
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

/* ----------------------- Coinbase Exchange (crypto history) ----------------------- */

const CB = "https://api.exchange.coinbase.com";
const CB_HEADERS = { "User-Agent": "Folio/1.0", Accept: "application/json" };

async function cbJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: CB_HEADERS, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} from Coinbase`);
  return (await res.json()) as T;
}

/** Coinbase's USD products by base ticker, with the coin's full name. Refreshed daily. */
async function cbProducts(): Promise<Map<string, string>> {
  return cached("cb:products", 24 * 60 * MIN, async () => {
    const [products, currencies] = await Promise.all([
      cbJson<{ id: string; base_currency: string; quote_currency: string; status: string; trading_disabled?: boolean }[]>(`${CB}/products`),
      cbJson<{ id: string; name: string }[]>(`${CB}/currencies`),
    ]);
    const names = new Map(currencies.map((c) => [c.id, c.name]));
    const out = new Map<string, string>();
    for (const p of products) {
      if (p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled) out.set(p.base_currency, names.get(p.base_currency) ?? p.base_currency);
    }
    return out;
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The Coinbase product for a CoinGecko coin, or null. A ticker alone can be shared by unrelated
 * coins, so the match must be confirmed by name or by today's price agreeing with CoinGecko's.
 */
async function cbProductFor(id: string, ticker?: string): Promise<string | null> {
  return cached(`cb:map:${id}:${ticker ?? ""}`, 6 * 60 * MIN, async () => {
    const products = await cbProducts();
    const base =
      (ticker && products.has(ticker.toUpperCase()) ? ticker.toUpperCase() : null) ??
      [...products.entries()].find(([, name]) => slug(name) === id)?.[0] ??
      null;
    if (!base) return null;
    if (slug(products.get(base)!) === id) return `${base}-USD`;
    // Names differ (e.g. "ripple" / "XRP"): accept only if prices agree within 10%.
    const [cg, cb] = await Promise.all([
      cgQuotes([id]).then((q) => q[id]?.usd ?? null).catch(() => null),
      cbJson<{ price: string }>(`${CB}/products/${base}-USD/ticker`).then((t) => Number(t.price)).catch(() => null),
    ]);
    return cg && cb && Math.abs(cb / cg - 1) < 0.1 ? `${base}-USD` : null;
  });
}

type CbCandle = [number, number, number, number, number, number]; // time, low, high, open, close, volume

/** Candles between two times at one granularity, oldest first. Coinbase returns at most 300 per call. */
async function cbCandles(product: string, granularity: number, from: number, to: number): Promise<Candle[]> {
  const chunk = granularity * 300;
  const windows: [number, number][] = [];
  for (let end = to; end > from; end -= chunk) windows.push([Math.max(from, end - chunk), end]);
  const parts = await Promise.all(
    windows.map(([a, b]) =>
      cbJson<CbCandle[]>(
        `${CB}/products/${product}/candles?granularity=${granularity}&start=${new Date(a * 1000).toISOString()}&end=${new Date(b * 1000).toISOString()}`,
      ),
    ),
  );
  const seen = new Map<number, Candle>();
  for (const part of parts) for (const [t, l, h, o, c] of part) seen.set(t, { t, o, h, l, c });
  return [...seen.values()].sort((a, b) => a.t - b.t);
}

/** Merge daily candles into weeks (for the 5-year view, matching the stocks' weekly bars). */
function weekly(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    const wk = Math.floor(d.t / (7 * 86400));
    const last = out.at(-1);
    if (last && Math.floor(last.t / (7 * 86400)) === wk) {
      last.h = Math.max(last.h, d.h);
      last.l = Math.min(last.l, d.l);
      last.c = d.c;
    } else out.push({ ...d });
  }
  return out;
}

const CB_RANGE: Record<Range, { gran: number; days: number }> = {
  "1D": { gran: 300, days: 1 },
  "1W": { gran: 3600, days: 7 },
  "1M": { gran: 21600, days: 30 },
  "3M": { gran: 86400, days: 92 },
  "1Y": { gran: 86400, days: 366 },
  "5Y": { gran: 86400, days: 1827 },
};

/** USD candles from Coinbase; rupee charts use each candle's day's ECB USD/INR rate. */
async function cbHistory(product: string, cur: Currency, range: Range, daily: boolean): Promise<Candle[]> {
  const r = daily ? "1Y" : range;
  const { gran, days } = CB_RANGE[r];
  const usd = await cached(`cb:h:${product}:${r}`, r === "1D" ? 2 * MIN : r === "1W" ? 10 * MIN : 30 * MIN, async () => {
    const now = Math.floor(Date.now() / 1000);
    const c = await cbCandles(product, gran, now - days * 86400, now);
    if (!c.length) throw new Error("No Coinbase data for " + product);
    return r === "5Y" ? weekly(c) : c;
  });
  const out = daily ? usd.map((c) => ({ t: c.t, o: c.c, h: c.c, l: c.c, c: c.c })) : usd;
  if (cur === "USD") return out;
  const { series } = await fx();
  let k = 0;
  return out.map((c) => {
    while (k + 1 < series.length && series[k + 1].t <= c.t) k++;
    const rate = series[k].c;
    return { t: c.t, o: c.o * rate, h: c.h * rate, l: c.l * rate, c: c.c * rate };
  });
}

/* ----------------------------- mfapi.in (funds) ---------------------------- */

interface MfHistory {
  meta: { scheme_name: string };
  data: { date: string; nav: string }[];
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Every fund's latest NAV straight from AMFI, which publishes each evening's NAVs hours before
 * mfapi.in picks them up. Scheme code -> NAV and its date (UTC midnight, seconds).
 */
async function amfiLatest(): Promise<Map<string, { t: number; c: number }>> {
  return cached("amfi:latest", 20 * MIN, async () => {
    const res = await fetch("https://portal.amfiindia.com/spages/NAVAll.txt", {
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; Folio)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} from AMFI`);
    const out = new Map<string, { t: number; c: number }>();
    for (const line of (await res.text()).split(/\r?\n/)) {
      const cols = line.split(";");
      if (cols.length < 6 || !/^\d+$/.test(cols[0])) continue;
      const c = Number(cols[cols.length - 2]);
      const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(cols[cols.length - 1].trim());
      const mon = m && MONTHS[m[2].toLowerCase()];
      if (!m || mon === undefined || mon === null || !isFinite(c) || c <= 0) continue;
      out.set(cols[0], { t: Date.UTC(Number(m[3]), mon, Number(m[1])) / 1000, c });
    }
    if (out.size < 1000) throw new Error("AMFI file looked incomplete");
    return out;
  });
}

/** NAV history, oldest first, with tonight's NAV from AMFI added if mfapi.in hasn't caught up. */
async function mfSeries(code: string): Promise<Candle[]> {
  const [series, latest] = await Promise.all([mfapiSeries(code), amfiLatest().catch(() => null)]);
  const l = latest?.get(code);
  const last = series.at(-1);
  if (!l || (last && l.t <= last.t)) return series;
  return [...series, { t: l.t, o: l.c, h: l.c, l: l.c, c: l.c }];
}

async function mfapiSeries(code: string): Promise<Candle[]> {
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
  /** Exchange ticker (e.g. "BTC"), used to find a coin on Coinbase. */
  ticker?: string;
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
  if (i.cls === "crypto") {
    // Coinbase first (no key, generous limits, finer bars); CoinGecko for coins it doesn't list.
    const product = await cbProductFor(i.symbol, i.ticker).catch(() => null);
    if (product) {
      try {
        return await cbHistory(product, i.currency, range, daily);
      } catch {
        /* fall through to CoinGecko */
      }
    }
    return cgHistory(i.symbol, i.currency, range, daily);
  }
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

/* ----------------------------- Market mood ----------------------------- */

/** One market's mood reading: a 0–100 index (or VIX level), its band, and earlier readings to compare. */
export interface MoodReading {
  key: "crypto" | "india" | "us";
  /** Index name as published. */
  source: string;
  value: number;
  /** Published label for 0–100 indices; for VIX, the conventional band. */
  label: string;
  /** "index" = 0–100, higher is greed; "vix" = volatility level, higher is fear. */
  scale: "index" | "vix";
  /** 0 = deepest fear, 1 = most greed. For indices, value / 100; for VIX, the share of the past year's closes above today's (how much calmer today is). */
  position: number;
  weekAgo: number | null;
  monthAgo: number | null;
  asOf: number;
  /** Up to 30 recent daily readings, oldest first (when the source provides them). */
  history: { t: number; v: number }[];
}

/** VIX label from where today's level sits in its own past year (pos = share of the year's closes that were higher). */
const vixLabel = (pos: number) => (pos < 0.2 ? "Very nervous" : pos < 0.4 ? "Nervous" : pos <= 0.6 ? "Typical" : pos <= 0.8 ? "Calm" : "Very calm");
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function cryptoMood(): Promise<MoodReading> {
  const j = await getJson<{ data: { value: string; value_classification: string; timestamp: string }[] }>("https://api.alternative.me/fng/?limit=31");
  const d = j.data;
  if (!d?.length) throw new Error("No crypto mood");
  return {
    key: "crypto",
    source: "Crypto Fear & Greed Index (alternative.me)",
    value: Number(d[0].value),
    label: d[0].value_classification.replace(/^(\w)(.*)$/, (_, a: string, b: string) => a + b.toLowerCase()),
    scale: "index",
    position: Number(d[0].value) / 100,
    weekAgo: d[7] ? Number(d[7].value) : null,
    monthAgo: d[30] ? Number(d[30].value) : null,
    asOf: Number(d[0].timestamp) * 1000,
    history: d
      .slice(0, 30)
      .map((x) => ({ t: Number(x.timestamp) * 1000, v: Number(x.value) }))
      .reverse(),
  };
}

async function indiaMood(): Promise<MoodReading> {
  const res = await fetch("https://api.tickertape.in/mmi/now", { headers: { "user-agent": BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} from tickertape`);
  const j = (await res.json()) as { data: { date: string; indicator: number; lastWeek?: { indicator: number }; lastMonth?: { indicator: number } } };
  const d = j.data;
  return {
    key: "india",
    source: "Market Mood Index (Tickertape)",
    value: Math.round(d.indicator * 10) / 10,
    // Tickertape's own zones: under 30 extreme fear, 30–50 fear, 50–70 greed, above 70 extreme greed.
    label: d.indicator < 30 ? "Extreme fear" : d.indicator < 50 ? "Fear" : d.indicator < 70 ? "Greed" : "Extreme greed",
    scale: "index",
    position: Math.max(0, Math.min(1, d.indicator / 100)),
    weekAgo: d.lastWeek ? Math.round(d.lastWeek.indicator * 10) / 10 : null,
    monthAgo: d.lastMonth ? Math.round(d.lastMonth.indicator * 10) / 10 : null,
    asOf: Date.parse(d.date),
    history: [],
  };
}

async function usMood(): Promise<MoodReading> {
  // A year of daily closes: today's VIX is ranked against them, so "calm" means calm for this market lately.
  const c = await yahooHistory("^VIX", "1Y");
  if (c.length < 60) throw new Error("No VIX");
  const last = c[c.length - 1];
  const at = (days: number) => {
    const target = last.t - days * 86400;
    const hit = [...c].reverse().find((x) => x.t <= target);
    return hit ? Math.round(hit.c * 10) / 10 : null;
  };
  const position = c.filter((x) => x.c > last.c).length / c.length;
  return {
    key: "us",
    source: "CBOE Volatility Index (VIX)",
    value: Math.round(last.c * 10) / 10,
    label: vixLabel(position),
    scale: "vix",
    position,
    weekAgo: at(7),
    monthAgo: at(30),
    asOf: last.t * 1000,
    history: c.slice(-30).map((x) => ({ t: x.t * 1000, v: Math.round(x.c * 10) / 10 })),
  };
}

/** Mood for each market; a market whose source fails is simply missing (never guessed). */
export async function mood(): Promise<{ readings: MoodReading[]; missing: MoodReading["key"][] }> {
  // Each source is cached on its own, so one slow or failing source doesn't refetch the others,
  // and a failed refresh falls back to that source's last good reading.
  return cached("mood", 5 * MIN, async () => {
    const keys = ["crypto", "india", "us"] as const;
    const results = await Promise.allSettled([cached("mood:crypto", 30 * MIN, cryptoMood), cached("mood:india", 15 * MIN, indiaMood), cached("mood:us", 15 * MIN, usMood)]);
    const readings: MoodReading[] = [];
    const missing: MoodReading["key"][] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? readings.push(r.value) : missing.push(keys[i])));
    if (!readings.length) throw new Error("No mood sources answered");
    return { readings, missing };
  });
}

/**
 * The NAV an app would have shown on a given day: the latest published NAV for today, and for
 * an earlier day the last NAV published before it (apps show the previous day's NAV until the
 * new one comes out at night). `day` is YYYY-MM-DD.
 */
export async function navOn(code: string, day: string): Promise<{ nav: number; date: string } | null> {
  const s = await mfSeries(code);
  if (!s.length) return null;
  const todayIst = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  const before = Date.UTC(y, m - 1, d) / 1000;
  const c = day >= todayIst ? s[s.length - 1] : [...s].reverse().find((x) => x.t < before);
  return c ? { nav: c.c, date: new Date(c.t * 1000).toISOString().slice(0, 10) } : null;
}
