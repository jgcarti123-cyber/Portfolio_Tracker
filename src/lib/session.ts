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
 * both cases price − previous close is an old move and must not count as today.
 */
export function tradedToday(cls: AssetClass, priceTs: number | null, now = Date.now()) {
  const tz = MARKET_TZ[cls];
  if (!tz) return true;
  if (!priceTs) return false;
  return zoned(priceTs, tz).ymd === zoned(now, tz).ymd;
}
