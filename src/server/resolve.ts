/**
 * Turns what a statement says (ISIN, ticker, scheme name, coin symbol) into the
 * price-feed symbol Folio uses. Reference lists are public and cached; the
 * request carries identifiers only, never quantities.
 *   funds  -> AMFI NAVAll.txt   (ISIN -> scheme code)
 *   stocks -> NSE EQUITY_L.csv  (ISIN -> NSE symbol), Yahoo search as fallback
 *   crypto -> CoinGecko search  (symbol -> coin id, highest market cap wins)
 */
import type { AssetClass, Currency } from "@/lib/types";

export interface ResolveQuery {
  cls: AssetClass;
  isin?: string;
  ticker?: string;
  name?: string;
  /** Price per unit implied by the statement (value / quantity), used to tell similar funds apart. */
  nav?: number;
}

export interface Resolved {
  symbol: string;
  ticker: string;
  name: string;
  currency: Currency;
}

const HOUR = 3_600_000;
type Fund = Resolved & { words: string; nav: number };
let amfi: { at: number; byIsin: Map<string, Resolved>; list: Fund[] } | null = null;
let nse: { at: number; byIsin: Map<string, Resolved>; bySymbol: Map<string, Resolved> } | null = null;
const memo = new Map<string, Resolved | null>();

async function text(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; Folio)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}

/** Abbreviations distributors use in scheme names: "ICICI Pru Large Cap Reg-G". */
const EXPAND: Record<string, string> = {
  pru: "prudential",
  reg: "regular",
  dir: "direct",
  g: "growth",
  gr: "growth",
  gw: "growth",
  idcw: "idcw",
  div: "idcw",
  dividend: "idcw",
  mf: "",
  "&": "",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9&()]+/g, " ")
    .split(" ")
    .map((w) => EXPAND[w] ?? w)
    .join(" ")
    .replace(/\(.*?\)/g, " ") // "(erstwhile Bluechip Fund)" and similar notes
    .replace(/\b(fund|scheme|plan|option|the|of|and|mutual)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function loadAmfi() {
  if (amfi && Date.now() - amfi.at < 12 * HOUR) return amfi;
  const raw = await text("https://www.amfiindia.com/spages/NAVAll.txt");
  const byIsin = new Map<string, Resolved>();
  const list: Fund[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cols = line.split(";");
    if (cols.length < 6 || !/^\d+$/.test(cols[0])) continue;
    const [code, isinA, isinB, scheme, plan, option] = cols;
    // Newer files split plan and option into their own columns; join them back so Direct and Regular differ.
    const name =
      cols.length >= 8
        ? [scheme, plan, option].map((x) => x?.trim()).filter((x) => x && x !== "-").join(" - ")
        : scheme.trim();
    const r = { symbol: code, ticker: code, name, currency: "INR" as const };
    for (const isin of [isinA, isinB]) if (/^IN[A-Z0-9]{10}$/.test(isin?.trim())) byIsin.set(isin.trim(), r);
    list.push({ ...r, words: norm(r.name), nav: Number(cols[cols.length >= 8 ? 6 : 4]) });
  }
  amfi = { at: Date.now(), byIsin, list };
  return amfi;
}

async function loadNse() {
  if (nse && Date.now() - nse.at < 24 * HOUR) return nse;
  const raw = await text("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv");
  const byIsin = new Map<string, Resolved>();
  const bySymbol = new Map<string, Resolved>();
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const cols = line.split(",");
    if (cols.length < 7) continue;
    const symbol = cols[0].trim();
    const r = { symbol: `${symbol}.NS`, ticker: symbol, name: cols[1].trim(), currency: "INR" as const };
    byIsin.set(cols[6].trim(), r);
    bySymbol.set(symbol, r);
  }
  nse = { at: Date.now(), byIsin, bySymbol };
  return nse;
}

/**
 * Best fund for a free-text scheme name. Word overlap shortlists candidates; when the
 * statement implies a NAV, the candidate whose published NAV agrees wins, which tells
 * apart near-identical names like "Large Cap" and "Large & Mid Cap".
 */
function matchFundName(name: string, list: Fund[], nav?: number) {
  const want = norm(name).split(" ").filter((w) => w.length > 1);
  if (!want.length) return null;
  const scored = list
    .map((f) => {
      const have = new Set(f.words.split(" "));
      let hits = 0;
      for (const w of want) if (have.has(w)) hits++;
      return { f, score: hits / Math.max(want.length, have.size) };
    })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score);
  if (nav && nav > 0) {
    const agreeing = scored.find((x) => x.f.nav > 0 && Math.abs(x.f.nav - nav) / nav < 0.03);
    if (agreeing) return agreeing.f;
  }
  return scored[0] && scored[0].score >= 0.6 ? scored[0].f : null;
}

async function yahoo(q: string, cls: AssetClass): Promise<Resolved | null> {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
    { signal: AbortSignal.timeout(10_000), cache: "no-store" },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { quotes: { symbol: string; longname?: string; shortname?: string; quoteType?: string }[] };
  const hit = j.quotes.find(
    (x) =>
      (x.quoteType === "EQUITY" || x.quoteType === "ETF") &&
      (cls === "in_stock" ? /\.(NS|BO)$/.test(x.symbol) : !x.symbol.includes(".")),
  );
  if (!hit) return null;
  return {
    symbol: hit.symbol,
    ticker: hit.symbol.replace(/\.(NS|BO)$/, ""),
    name: hit.longname ?? hit.shortname ?? hit.symbol,
    currency: cls === "in_stock" ? "INR" : "USD",
  };
}

async function coin(symbol: string, name?: string): Promise<Resolved | null> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`,
    { signal: AbortSignal.timeout(10_000), cache: "no-store" },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { coins: { id: string; name: string; symbol: string; market_cap_rank: number | null }[] };
  const exact = j.coins
    .filter((c) => c.symbol.toLowerCase() === symbol.toLowerCase())
    .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
  const hit = exact[0] ?? (name ? j.coins.find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined);
  if (!hit) return null;
  return { symbol: hit.id, ticker: hit.symbol.toUpperCase(), name: hit.name, currency: "USD" };
}

async function resolveOne(q: ResolveQuery): Promise<Resolved | null> {
  const isin = q.isin?.trim().toUpperCase();
  const ticker = q.ticker?.trim().toUpperCase();
  if (q.cls === "mf") {
    const db = await loadAmfi();
    if (isin && db.byIsin.has(isin)) return db.byIsin.get(isin)!;
    const hit = q.name ? matchFundName(q.name, db.list, q.nav) : null;
    return hit && { symbol: hit.symbol, ticker: hit.ticker, name: hit.name, currency: hit.currency };
  }
  if (q.cls === "in_stock") {
    const db = await loadNse().catch(() => null);
    if (db && isin && db.byIsin.has(isin)) return db.byIsin.get(isin)!;
    if (db && ticker && db.bySymbol.has(ticker.replace(/\.(NS|BO)$/, ""))) return db.bySymbol.get(ticker.replace(/\.(NS|BO)$/, ""))!;
    return (isin && (await yahoo(isin, q.cls))) || (q.name ? await yahoo(q.name, q.cls) : null);
  }
  if (q.cls === "us_stock") {
    return (ticker && (await yahoo(ticker, q.cls))) || (q.name ? await yahoo(q.name, q.cls) : null);
  }
  return ticker ? coin(ticker.replace(/(INR|USDT|USD)$/, "") || ticker, q.name) : null;
}

export async function resolve(items: ResolveQuery[]): Promise<(Resolved | null)[]> {
  return Promise.all(
    items.map(async (q) => {
      const key = JSON.stringify([q.cls, q.isin, q.ticker, q.name, q.nav && Math.round(q.nav * 100)]);
      if (memo.has(key)) return memo.get(key)!;
      const r = await resolveOne(q).catch(() => null);
      memo.set(key, r);
      if (memo.size > 5000) memo.delete(memo.keys().next().value as string);
      return r;
    }),
  );
}
