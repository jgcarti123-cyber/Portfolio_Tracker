import type { AssetClass } from "./types";

/** Each market's own clock: a price's "day" is its date in this timezone. */
export const MARKET_TZ: Record<AssetClass, string | null> = {
  in_stock: "Asia/Kolkata",
  us_stock: "America/New_York",
  // A fund's NAV is for an Indian business day (stored as that date at UTC midnight).
  mf: "Asia/Kolkata",
  // Crypto never closes; its change is always the last 24 hours.
  crypto: null,
};

/** Calendar date, weekday and minutes since midnight of a moment, in a timezone. */
export function zoned(ts: number, tz: string) {
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

/**
 * Whether a live price belongs to today's session in its own market. A stock's latest price
 * on a Sunday is Friday's close, and a fund's latest NAV on a Monday morning is Friday's; in
 * both cases price − previous close is an old move and must not count as today (a fund's
 * NAV counts until the next market open; see navCountsUntil).
 */
export function tradedToday(cls: AssetClass, priceTs: number | null, now = Date.now()) {
  const tz = MARKET_TZ[cls];
  if (!tz) return true;
  if (!priceTs) return false;
  if (cls === "mf") return now < navCountsUntil(priceTs);
  return zoned(priceTs, tz).ymd === zoned(now, tz).ymd;
}

/**
 * A fund's NAV comes out late in the evening, so its move counts as today's from then until
 * Indian markets open on the next weekday (9:15 am IST), when a new day's prices take over.
 * `navTs` is the NAV's date at UTC midnight.
 */
export function navCountsUntil(navTs: number) {
  const d = new Date(navTs);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() + (9 * 60 + 15 - 330) * 60_000; // 9:15 IST = 3:45 UTC
}
