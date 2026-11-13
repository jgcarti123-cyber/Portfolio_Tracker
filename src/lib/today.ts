import { convert, type Position } from "./portfolio";
import type { Market } from "./prices";
import { CLASS_ORDER, type AssetClass, type Currency } from "./types";

export interface Mover {
  position: Position;
  /** Today's move in the display currency. */
  amount: number;
  /** Today's price change, %. */
  pct: number;
}

export interface MarketState {
  /** Short status, e.g. "Live", "Closed at 3:30 PM", "NAV of 11 Nov". */
  label: string;
  live: boolean;
  /** What the change covers, for the tooltip. */
  detail: string;
}

export interface ClassMoves {
  cls: AssetClass;
  total: number;
  movers: Mover[];
  state: MarketState;
}

export interface Today {
  /** Holdings' moves plus the currency effect: the headline number. */
  total: number;
  /** Net worth at yesterday's close, for the headline %. */
  base: number;
  up: { count: number; amount: number };
  down: { count: number; amount: number };
  flat: number;
  movers: Mover[];
  byClass: ClassMoves[];
  /** Holdings with no daily price (price you entered, or no feed). */
  noDaily: Position[];
  /** Change from the dollar–rupee rate moving, in the display currency. 0 when the rate hasn't moved today. */
  fx: { amount: number; from: number; to: number } | null;
  /** Dollar–rupee rate used for the conversion. */
  rate: number;
}

const MARKETS: Partial<Record<AssetClass, { tz: string; open: [number, number]; close: [number, number]; name: string }>> = {
  in_stock: { tz: "Asia/Kolkata", open: [9, 15], close: [15, 30], name: "NSE" },
  us_stock: { tz: "America/New_York", open: [9, 30], close: [16, 0], name: "NYSE/Nasdaq" },
};

/** Calendar date, weekday and minutes since midnight of a moment, in a market's own timezone. */
function zoned(ts: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const shortDay = (ts: number, tz?: string) =>
  new Date(ts).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
const localTime = (ts: number) => new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Whether a market is trading now and which session today's change covers. */
export function marketState(cls: AssetClass, positions: Position[], now = Date.now()): MarketState {
  const latest = Math.max(0, ...positions.filter((p) => p.priceSource === "live" && p.priceTs).map((p) => p.priceTs!));
  if (cls === "crypto") return { label: "Last 24 hours", live: true, detail: "Crypto trades all day; the change is over the last 24 hours." };
  if (cls === "mf") {
    return latest
      ? { label: `NAV of ${shortDay(latest).replace(/^\w+, /, "")}`, live: false, detail: "Funds publish one price (NAV) a day, usually late in the evening. The change is from the NAV before it." }
      : { label: "No NAV yet", live: false, detail: "No fund price has loaded yet." };
  }
  const m = MARKETS[cls]!;
  const t = zoned(now, m.tz);
  const weekday = !["Sat", "Sun"].includes(t.weekday);
  const openMin = m.open[0] * 60 + m.open[1];
  const closeMin = m.close[0] * 60 + m.close[1];
  const fresh = latest && now - latest < 20 * 60_000;
  if (weekday && t.minutes >= openMin && t.minutes < closeMin && fresh) {
    return { label: "Live", live: true, detail: `${m.name} is open. The change is from yesterday's close to the latest price.` };
  }
  if (!latest) return { label: "Closed", live: false, detail: `${m.name} is closed.` };
  const session = zoned(latest, m.tz).ymd;
  if (session === t.ymd) {
    // Closing time shown in the viewer's own clock.
    return { label: `Closed at ${localTime(latest)}`, live: false, detail: `${m.name} has closed for the day. The change is today's full session.` };
  }
  return {
    label: `Closed · ${shortDay(latest, m.tz).split(",")[0]} session`,
    live: false,
    detail: `${m.name} is closed. The change shown is from its last session, ${shortDay(latest, m.tz)}.`,
  };
}

/**
 * Exactly what moved today. Each holding's move is price − previous close, times units held.
 * Dollar holdings shown in rupees (or the reverse) also move with the exchange rate, which
 * is counted separately so the parts add up to the headline.
 */
export function todayMoves(
  positions: Position[],
  display: Currency,
  market: Pick<Market, "usdInr" | "fxSeries">,
  now = Date.now(),
): Today {
  const fxNow = market.usdInr;
  const movers: Mover[] = [];
  const noDaily: Position[] = [];
  let base = 0;
  for (const p of positions) {
    const valueNow = p.value ?? p.cost;
    if (p.dayChange === null || p.price === null || !p.prevClose) {
      noDaily.push(p);
      base += convert(valueNow, p.asset.currency, display, fxNow);
      continue;
    }
    movers.push({
      position: p,
      amount: convert(p.dayChange, p.asset.currency, display, fxNow),
      pct: ((p.price - p.prevClose) / p.prevClose) * 100,
    });
  }

  // Currency effect, only when today's reference rate has actually been published.
  let fx: Today["fx"] = null;
  const last = market.fxSeries.at(-1);
  const prev = market.fxSeries.at(-2);
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const foreign = positions.filter((p) => p.asset.currency !== display && p.price !== null);
  if (last && prev && last.t * 1000 >= startOfDay && Math.abs(last.c - fxNow) < 1e-6 && foreign.length) {
    let amount = 0;
    for (const p of foreign) {
      const yesterday = (p.value ?? 0) - (p.dayChange ?? 0); // in the asset's currency
      amount += convert(yesterday, p.asset.currency, display, fxNow) - convert(yesterday, p.asset.currency, display, prev.c);
    }
    if (Math.abs(amount) > 0.005) fx = { amount, from: prev.c, to: fxNow };
  }

  for (const m of movers) base += convert((m.position.value ?? 0) - (m.position.dayChange ?? 0), m.position.asset.currency, display, fxNow);
  if (fx) base -= fx.amount;

  movers.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const ups = movers.filter((m) => m.amount > 0.005);
  const downs = movers.filter((m) => m.amount < -0.005);
  const sum = (l: Mover[]) => l.reduce((a, m) => a + m.amount, 0);
  const holdingsTotal = sum(movers);

  const byClass = CLASS_ORDER.map((cls) => {
    const list = movers.filter((m) => m.position.asset.cls === cls);
    return {
      cls,
      total: sum(list),
      movers: list,
      state: marketState(cls, positions.filter((p) => p.asset.cls === cls), now),
    };
  }).filter((c) => c.movers.length);

  return {
    total: holdingsTotal + (fx?.amount ?? 0),
    base,
    up: { count: ups.length, amount: sum(ups) },
    down: { count: downs.length, amount: sum(downs) },
    flat: movers.length - ups.length - downs.length,
    movers,
    byClass,
    noDaily,
    fx,
    rate: fxNow,
  };
}
