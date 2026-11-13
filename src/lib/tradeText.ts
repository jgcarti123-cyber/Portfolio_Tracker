/** What a typed trade description says, before Folio works out the numbers. */
export interface ParsedTrade {
  type: "buy" | "sell" | null;
  quantity: number | null;
  quantityRule: "all" | "half" | "fraction" | null;
  fraction: number | null;
  /** Units they say they kept ("sold all but 2"). */
  keep: number | null;
  pricePerUnit: number | null;
  priceRule: "market" | "avg" | "close" | null;
  total: number | null;
  totalCurrency: "INR" | "USD" | null;
  /** YYYY-MM-DD, or null for today. */
  date: string | null;
  time: string | null;
  broker: string | null;
  /** For a buy: whether they said it was paid from their cash, or with new money. */
  paidFrom?: "cash" | "new" | null;
  understood: string;
  unclear: string | null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "5k" → 5000, "1.2L" → 120000, "2,500" → 2500. */
function amount(raw: string, suffix = "") {
  const n = Number(raw.replace(/,/g, ""));
  const s = suffix.toLowerCase();
  return n * (s === "k" ? 1e3 : s === "l" || s.startsWith("lakh") || s.startsWith("lac") ? 1e5 : s.startsWith("cr") ? 1e7 : s === "m" ? 1e6 : 1);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A small on-device reader for the common phrasings, used when AI is off or busy.
 * Handles: bought/sold, all/everything/half, "10 shares", "at 1196", "for ₹5k",
 * today/yesterday/"3 days ago"/"12 Nov", and broker names.
 */
export function parseTradeLocally(text: string, brokers: string[], now = new Date()): ParsedTrade {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const out: ParsedTrade = {
    type: null,
    quantity: null,
    quantityRule: null,
    fraction: null,
    keep: null,
    pricePerUnit: null,
    priceRule: null,
    total: null,
    totalCurrency: null,
    date: null,
    time: null,
    broker: null,
    understood: "",
    unclear: null,
  };

  if (/\b(sold|sell|exit(ed)?|redeem(ed)?|withdr[ae]w|booked|bech(a|i|e|diya|di)?|bika|nikal(a|e|diya)?)\b/.test(t)) out.type = "sell";
  else if (/\b(bought|buy|added|add|invested|invest|purchased?|sip|put in|kharid(a|i|e|liya|li)?|liya|liye|dale|daale)\b/.test(t)) out.type = "buy";

  if (/\b(from|using|with|out of)\s+(my\s+|the\s+)?(spare\s+|idle\s+)?(cash|balance|wallet)\b/.test(t)) out.paidFrom = "cash";
  else if (/\b(new|fresh|extra)\s+(money|funds|cash)\b|\bfrom (my )?(bank|salary)\b/.test(t)) out.paidFrom = "new";

  if (/\b(all|everything|entire|whole|fully|complete(ly)?|sab|saare|sare|poora|pura)\b/.test(t)) out.quantityRule = "all";
  else if (/\bhalf\b/.test(t)) out.quantityRule = "half";
  else if (/\b(a )?quarter\b/.test(t)) (out.quantityRule = "fraction"), (out.fraction = 0.25);
  else {
    const p = t.match(/\b(\d{1,3})\s?%\s?(of )?(it|them|my|the|units|shares|holding)?/);
    if (p && out.type === "sell") (out.quantityRule = "fraction"), (out.fraction = Number(p[1]) / 100);
  }

  // "all but 2", "everything except 1", "kept 3".
  const keep = t.match(/\b(?:except|but|other than|keep(?:ing)?|kept|leaving|left)\s+(\d+(?:\.\d+)?)\b/);
  if (keep && out.type !== "buy") (out.keep = Number(keep[1])), (out.quantityRule = "all"), (out.quantity = null);

  // Price per unit: "at 1196", "@ $182.5", "at ₹1,196 each".
  const at = t.match(/(?:\bat\b|@)\s*(?:rs\.?|₹|\$|inr|usd)?\s*([\d,]+(?:\.\d+)?)/);
  if (at) out.pricePerUnit = amount(at[1]);
  if (/\b(at )?(market|current|today'?s) price\b/.test(t)) out.priceRule = "market";
  else if (/\bat (my )?(avg|average|cost)\b/.test(t)) out.priceRule = "avg";
  else if (/\bclos(e|ing)( price)?\b/.test(t)) out.priceRule = "close";

  // Total: "for ₹5,000", "worth 5k", "invested 2000", "₹10k".
  const tot =
    t.match(/()\b([\d,]+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|cr|crores?|m)\b/) ??
    t.match(/\b(?:for|worth|of|invested|paid|got|received|total)\s*(rs\.?|₹|\$|inr|usd)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|cr|crores?|m)?\b/) ??
    t.match(/(₹|\$|rs\.?)\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|cr|crores?|m)?\b/);
  if (tot && !(at && tot[2] === at[1] && tot.index! > at.index!)) {
    out.total = amount(tot[2], tot[3]);
    if (tot[1]) out.totalCurrency = /\$|usd/.test(tot[1]) ? "USD" : "INR";
  }

  // Count: "10 shares", "2.5 units", "0.01 btc", or a bare number next to bought/sold.
  const q = t.match(/\b([\d,]+(?:\.\d+)?)\s*(shares?|units?|coins?|qty|stocks?|nos?|[a-z]{2,6}\b(?= (at|@|for|on|yesterday|today)))/);
  if (q && !out.quantityRule) out.quantity = amount(q[1]);
  else if (!out.quantityRule && !out.quantity) {
    const bare = t.match(/\b(?:bought|sold|buy|sell|added)\s+([\d,]+(?:\.\d+)?)\b(?!\s*(k|l|%|days?|weeks?|months?|lakhs?|lacs?|cr))/);
    if (bare && Number(bare[1].replace(/,/g, "")) !== out.total) out.quantity = amount(bare[1]);
  }

  // Date.
  const d = new Date(now);
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const wd = t.match(/\b(last |on |this )?(sun|mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?)(day)?\b/);
  if (/\bday before yesterday\b/.test(t)) d.setDate(d.getDate() - 2), (out.date = ymd(d));
  else if (/\b(yesterday|kal)\b/.test(t)) d.setDate(d.getDate() - 1), (out.date = ymd(d));
  else if (/\bparso\b/.test(t)) d.setDate(d.getDate() - 2), (out.date = ymd(d));
  else if (wd) {
    // The most recent such day before today ("last friday" on a Friday = a week ago).
    const target = WEEKDAYS.findIndex((w) => w.startsWith(wd[2].slice(0, 3)));
    let back = (d.getDay() - target + 7) % 7;
    if (back === 0) back = 7;
    d.setDate(d.getDate() - back);
    out.date = ymd(d);
  }
  else {
    const ago = t.match(/\b(\d{1,3}) (day|week|month)s? ago\b/);
    if (ago) {
      const n = Number(ago[1]);
      if (ago[2] === "day") d.setDate(d.getDate() - n);
      else if (ago[2] === "week") d.setDate(d.getDate() - 7 * n);
      else d.setMonth(d.getMonth() - n);
      out.date = ymd(d);
    } else {
      const m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/);
      if (m) {
        const day = Number(m[1] ?? m[4]);
        const mon = MONTHS.indexOf((m[2] ?? m[3]).slice(0, 3));
        const guess = new Date(now.getFullYear(), mon, day);
        if (guess > now) guess.setFullYear(guess.getFullYear() - 1);
        out.date = ymd(guess);
      }
    }
  }

  const squashed = t.replace(/\s/g, "");
  const b = brokers.find((name) => t.includes(` ${name.toLowerCase()}`) || squashed.includes(name.toLowerCase().replace(/\s/g, "")));
  if (b) out.broker = b;

  const parts = [
    out.type === "sell" ? "Sell" : out.type === "buy" ? "Buy" : "Trade",
    out.quantityRule === "all" ? "everything" : out.quantityRule === "half" ? "half" : out.fraction ? `${Math.round(out.fraction * 100)}%` : out.quantity ? `${out.quantity}` : "",
    out.pricePerUnit ? `at ${out.pricePerUnit}` : out.priceRule === "market" ? "at today's price" : out.priceRule === "avg" ? "at your average cost" : "",
    out.total ? `for ${out.totalCurrency === "USD" ? "$" : "₹"}${out.total.toLocaleString("en-IN")}` : "",
    out.date ? `on ${out.date}` : "",
    out.broker ? `on ${out.broker}` : "",
  ].filter(Boolean);
  out.understood = parts.length > 1 ? parts.join(" ") + "." : "";
  if (!out.type && !out.quantity && !out.total && !out.quantityRule) out.unclear = "I couldn't tell what you traded. Try something like “sold all yesterday” or “bought 10 at 1,196”.";
  return out;
}

/* ------------------------------------------------------------------------ */
/* From what was said to a complete trade                                     */
/* ------------------------------------------------------------------------ */

/** heldOn / firstDateWith for TradeContext, from one asset's trades (dates in the viewer's timezone). */
export function heldHistory(txns: { accountId: string; type: "buy" | "sell"; qty: number; ts: number }[]) {
  const sorted = [...txns].sort((a, b) => a.ts - b.ts);
  const local = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const heldOn = (date: string, accountId: string) => {
    let q = 0;
    for (const t of sorted) {
      if (t.accountId !== accountId || local(t.ts) > date) continue;
      q = t.type === "buy" ? q + t.qty : Math.max(0, q - t.qty);
    }
    return q;
  };
  const firstDateWith = (accountId: string, units: number) => {
    let q = 0;
    for (const t of sorted) {
      if (t.accountId !== accountId) continue;
      q = t.type === "buy" ? q + t.qty : Math.max(0, q - t.qty);
      if (q >= units * (1 - 1e-7) - 1e-9) return local(t.ts);
    }
    return null;
  };
  return { heldOn, firstDateWith };
}

export interface TradeContext {
  /** YYYY-MM-DD in the viewer's timezone. */
  today: string;
  accounts: { id: string; name: string }[];
  /** Units held per account id. */
  heldBy: Record<string, number>;
  /** The broker currently picked in the form. */
  currentAccountId: string;
  livePrice: number | null;
  /** Average cost per unit of what's held, 0 if nothing. */
  avg: number;
  /** Closing price on a day (YYYY-MM-DD), if known. */
  closeOn: (date: string) => number | null;
  /** Units held at an account by the end of a day, per Folio's records (for back-dated sales). */
  heldOn?: (date: string, accountId: string) => number;
  /** First day on which Folio's records show at least this many units at the account. */
  firstDateWith?: (accountId: string, units: number) => string | null;
}

export type PriceFrom = "you" | "live" | "close" | "avg" | "total";

export interface ResolvedTrade {
  type: "buy" | "sell" | null;
  /** One leg per broker; usually one. "Sold everything" with units at two brokers gives two. */
  legs: { accountId: string; qty: number | null }[];
  price: number | null;
  priceFrom: PriceFrom | null;
  /** Total typed by the person, in totalCurrency (null = asset currency). */
  total: number | null;
  totalCurrency: "INR" | "USD" | null;
  date: string;
  time: string | null;
  /** What still has to be answered before saving. */
  missing: ("type" | "quantity" | "price")[];
  /** Problems that block saving as stated (e.g. selling more than held). */
  problems: string[];
  /** For a sale dated before Folio's record of the purchase: the earliest date it can be recorded. */
  earliestDate?: string;
}

const fmt = (n: number) => Number(n.toFixed(6)).toLocaleString("en-IN", { maximumFractionDigits: 6 });

/**
 * Works out the exact trade from what was said, using the holding's real numbers:
 * "everything" becomes the units actually held (at every broker, if no broker was named),
 * a past date without a price uses that day's close, a total plus a price gives the units.
 * Pure, so it can be tested against many phrasings.
 */
export function resolveTrade(r: ParsedTrade, c: TradeContext, assetCurrency: "INR" | "USD", usdInr: number | null): ResolvedTrade {
  const held = (id: string) => c.heldBy[id] ?? 0;
  const holding = c.accounts.filter((a) => held(a.id) > 1e-9);
  const totalHeld = holding.reduce((s, a) => s + held(a.id), 0);
  const rule = r.quantityRule;
  const factor = rule === "all" ? 1 : rule === "half" ? 0.5 : rule === "fraction" && r.fraction ? r.fraction : null;

  // Bought or sold. "Everything/half" only makes sense for a sale.
  const type: ResolvedTrade["type"] = r.type ?? (factor !== null ? "sell" : null);

  const named = r.broker ? c.accounts.find((a) => a.name.toLowerCase() === r.broker!.toLowerCase()) : undefined;
  const date = r.date && r.date <= c.today ? r.date : c.today;
  const out: ResolvedTrade = {
    type,
    legs: [],
    price: null,
    priceFrom: null,
    total: r.total,
    totalCurrency: r.totalCurrency,
    date,
    time: r.time,
    missing: [],
    problems: [],
  };
  if (!type) out.missing.push("type");

  // Price per unit.
  const totalInAsset =
    r.total === null ? null : !r.totalCurrency || r.totalCurrency === assetCurrency ? r.total : usdInr ? (assetCurrency === "USD" ? r.total / usdInr : r.total * usdInr) : null;
  if (r.pricePerUnit) (out.price = r.pricePerUnit), (out.priceFrom = "you");
  else if (r.quantity && totalInAsset) (out.price = totalInAsset / r.quantity), (out.priceFrom = "total");
  else if (r.priceRule === "avg" && c.avg > 0) (out.price = c.avg), (out.priceFrom = "avg");
  else if (r.priceRule === "market" || (date === c.today && r.priceRule !== "close")) {
    if (date !== c.today && r.priceRule === "market") {
      const close = c.closeOn(date);
      if (close) (out.price = close), (out.priceFrom = "close");
    } else if (c.livePrice) (out.price = c.livePrice), (out.priceFrom = "live");
  } else {
    const close = c.closeOn(date);
    if (close) (out.price = close), (out.priceFrom = "close");
    else if (date === c.today && c.livePrice) (out.price = c.livePrice), (out.priceFrom = "live");
  }

  // Units, and which broker(s).
  if (type === "sell" && r.keep !== null && r.keep >= 0) {
    // "Sold all but N": what's held, less what they kept (at the named broker, or the one holding it).
    const acc = named ?? (holding.length === 1 ? holding[0] : c.accounts.find((a) => a.id === c.currentAccountId));
    const base = named || holding.length === 1 ? held(acc!.id) : totalHeld;
    out.legs = [{ accountId: acc?.id ?? c.currentAccountId, qty: Math.max(0, base - r.keep) }];
    if (base - r.keep <= 0) out.problems.push(`You hold ${fmt(base)}, so keeping ${fmt(r.keep)} leaves nothing to sell.`);
  } else if (type === "sell" && factor !== null) {
    if (named) out.legs = [{ accountId: named.id, qty: held(named.id) * factor }];
    else if (holding.length) out.legs = holding.map((a) => ({ accountId: a.id, qty: held(a.id) * factor }));
    else out.legs = [{ accountId: c.currentAccountId, qty: 0 }];
    if (!totalHeld) out.problems.push("You don't hold any of this, so there's nothing to sell.");
  } else {
    let qty = r.quantity;
    if (!qty && totalInAsset && out.price) qty = totalInAsset / out.price;
    let accountId = named?.id ?? c.currentAccountId;
    if (type === "sell" && !named && held(accountId) <= 1e-9 && holding.length) accountId = holding[0].id;
    out.legs = [{ accountId, qty: qty ?? null }];
    if (type === "sell" && qty) {
      const here = held(accountId);
      const name = c.accounts.find((a) => a.id === accountId)?.name ?? "this broker";
      if (qty > here * (1 + 1e-7) + 1e-9) {
        out.problems.push(
          here > 0
            ? `You hold ${fmt(here)} on ${name}, not ${fmt(qty)}.`
            : totalHeld > 0
              ? `You don't hold any on ${name}. You hold ${fmt(totalHeld)} in total.`
              : "You don't hold any of this, so there's nothing to sell.",
        );
      }
    }
  }
  // A sale dated before Folio's record of buying the units wouldn't count (trades replay in date order).
  if (type === "sell" && !out.problems.length && c.heldOn && c.firstDateWith) {
    for (const l of out.legs) {
      if (!(l.qty! > 0)) continue;
      const then = c.heldOn(date, l.accountId);
      if (l.qty! > then * (1 + 1e-7) + 1e-9) {
        const first = c.firstDateWith(l.accountId, l.qty!);
        const name = c.accounts.find((a) => a.id === l.accountId)?.name ?? "this broker";
        if (first && first > date) {
          out.earliestDate = first;
          const nice = (d: string) => new Date(`${d}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          out.problems.push(`Folio's records only show these ${name} units from ${nice(first)} (when they were added), so a sale on ${nice(date)} wouldn't count.`);
        }
        break;
      }
    }
  }
  if (!out.legs.some((l) => (l.qty ?? 0) > 0) && !out.problems.length) out.missing.push("quantity");
  if (!out.price && !(out.legs.some((l) => l.qty) && totalInAsset)) out.missing.push("price");
  return out;
}

/** Money added to or taken out of cash, read on this device ("added 10k to my Groww wallet"). */
export interface ParsedCash {
  direction: "add" | "withdraw";
  amount: number;
  currency: "INR" | "USD";
  date: string | null;
  note: string | null;
}

/**
 * Reads a cash deposit or withdrawal from a sentence, or null when it isn't clearly one.
 * Used when the AI answers without an action; questions and what-ifs are never read as one.
 */
export function parseCashLocally(text: string, brokers: string[] = [], now = new Date()): ParsedCash | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  if (/\?|\b(what if|if i|should|how much|how many|can i|would)\b/.test(t)) return null;
  if (!/\b(cash|wallet|balance|funds?|money)\b/.test(t)) return null;
  // A sale or purchase is a trade, not cash.
  if (/\b(sold|sell|bought|buy|shares?|units?|coins?)\b/.test(t)) return null;
  const direction = /\b(withdr[ae]w[na]?|withdrawing|took out|take out|taken out|pulled out|removed?|moved out|transferred out|nikal)/.test(t)
    ? "withdraw"
    : /\b(add(ed)?|put|deposit(ed)?|transferred|moved|topped up|top up|loaded|credited|dale|daale)\b/.test(t)
      ? "add"
      : null;
  if (!direction) return null;
  const m = t.match(/(₹|\$|rs\.?|inr|usd)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|cr|crores?|m)?\b\s*(rupees|rs|inr|dollars|usd|bucks)?/);
  if (!m) return null;
  const amt = amount(m[2], m[3] ?? "");
  if (!(amt > 0)) return null;
  const cur = /\$|usd|dollar|bucks/.test(`${m[1] ?? ""} ${m[4] ?? ""}`) || /\b(usd|dollars?)\b/.test(t) ? "USD" : "INR";
  const d = new Date(now);
  let date: string | null = null;
  if (/\bday before yesterday\b/.test(t)) d.setDate(d.getDate() - 2), (date = ymd(d));
  else if (/\b(yesterday|kal)\b/.test(t)) d.setDate(d.getDate() - 1), (date = ymd(d));
  const broker = brokers.find((b) => t.includes(b.toLowerCase()) || t.includes(b.toLowerCase().replace(/money$/, " money")));
  return { direction, amount: amt, currency: cur, date, note: broker ? `${broker} wallet` : null };
}
