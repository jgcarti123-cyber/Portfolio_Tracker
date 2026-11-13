import { parseDate } from "./presets";
import { num, type Field } from "./table";

export type Cols = Partial<Record<Field, number>>;

/** One holding as the file states it, amounts in the file's own currency. */
export interface FileHolding {
  key: number;
  name: string;
  ticker: string;
  isin: string;
  qty: number;
  /** Total cost of the units held. */
  cost: number;
  value: number;
  ts: number;
}

// Totals and summary lines. Careful: "NET" is also a ticker (Cloudflare), so only "Net Total"-style lines count.
const TOTAL = /^(grand |sub |portfolio )?total\b|^net (total|value|worth|amount|holding)s?\b|^overall( total)?\b/i;

/**
 * Reads holdings out of the rows under the header using the chosen columns.
 * Fills gaps from what's there: cost from qty × avg, value from qty × price, cost from
 * value − profit. Drops totals and footer lines; merges repeats of one holding
 * (one fund in two folios). Pure, so the test harness runs the same code as the app.
 */
export function extractHoldings(body: string[][], cols: Cols, dateCol?: number): FileHolding[] {
  const cell = (r: string[], f: Field) => (cols[f] === undefined ? "" : (r[cols[f]!] ?? "").trim());
  const merged = new Map<string, FileHolding>();
  body.forEach((r, key) => {
    const name = cell(r, "name");
    const ticker = cell(r, "ticker");
    const isin = cell(r, "isin").toUpperCase();
    const id = isin || ticker || name;
    if (!id || TOTAL.test(name || ticker) || TOTAL.test(r.find((c) => c) ?? "")) return;
    // Footnotes and disclaimers: a long sentence with no numbers anywhere in the row.
    if (!r.some((c) => c && !isNaN(num(c)))) return;

    const qty = num(cell(r, "qty"));
    const avg = num(cell(r, "avg"));
    const invested = num(cell(r, "invested"));
    const price = num(cell(r, "price"));
    let value = num(cell(r, "value"));
    const pnl = num(cell(r, "pnl"));

    let cost = qty > 0 && avg > 0 ? qty * avg : invested;
    if (!(value > 0) && qty > 0 && price > 0) value = qty * price;
    if (!(cost > 0) && value > 0 && isFinite(pnl)) cost = value - pnl;
    if (!(value > 0) && cost > 0 && isFinite(pnl)) value = cost + pnl;

    const ts = dateCol !== undefined ? parseDate(r[dateCol] ?? "") : NaN;
    const prev = merged.get(id.toLowerCase());
    const add = (a: number | undefined, b: number) => {
      const x = (a !== undefined && isFinite(a) ? a : 0) + (isFinite(b) ? b : 0);
      return x || NaN;
    };
    merged.set(id.toLowerCase(), {
      key: prev?.key ?? key,
      name: prev?.name || name,
      ticker: prev?.ticker || ticker,
      isin: prev?.isin || isin,
      qty: add(prev?.qty, qty),
      cost: add(prev?.cost, cost),
      value: add(prev?.value, value),
      ts: Math.min(prev?.ts ?? Infinity, isFinite(ts) ? ts : Infinity),
    });
  });
  return [...merged.values()];
}

export interface MappingCheck {
  /** 0–1: share of arithmetic checks that hold (qty × avg = cost, qty × price = value, value − cost = P&L). */
  consistency: number;
  checks: number;
  /** Every row has a quantity, cost and value. */
  complete: number;
  problems: string[];
}

const close = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= Math.max(Math.abs(b) * tol, 0.011);

/**
 * Tests a column choice against the numbers themselves. A wrong choice almost never
 * survives: units × average price won't equal the invested column, and so on.
 */
export function checkMapping(body: string[][], cols: Cols): MappingCheck {
  const cell = (r: string[], f: Field) => (cols[f] === undefined ? NaN : num(r[cols[f]!]));
  let checks = 0;
  let pass = 0;
  const problems = new Set<string>();
  const rows = body.filter((r) => {
    const id = cols.name !== undefined ? r[cols.name] : cols.ticker !== undefined ? r[cols.ticker] : cols.isin !== undefined ? r[cols.isin] : "";
    return id && !TOTAL.test(id) && r.some((c) => c && !isNaN(num(c)));
  });
  for (const r of rows) {
    const qty = cell(r, "qty");
    const avg = cell(r, "avg");
    const inv = cell(r, "invested");
    const price = cell(r, "price");
    const val = cell(r, "value");
    const pnl = cell(r, "pnl");
    if (qty > 0 && avg > 0 && inv > 0) {
      checks++;
      if (close(qty * avg, inv)) pass++;
      else problems.add("Quantity × average price doesn't equal the invested amount");
    }
    if (qty > 0 && price > 0 && val > 0) {
      checks++;
      if (close(qty * price, val)) pass++;
      else problems.add("Quantity × current price doesn't equal the current value");
    }
    if (isFinite(pnl) && val > 0 && (inv > 0 || (qty > 0 && avg > 0))) {
      checks++;
      const cost = inv > 0 ? inv : qty * avg;
      if (close(val - cost, pnl, 0.03)) pass++;
      else problems.add("Current value − invested doesn't equal the profit/loss column");
    }
    if (cols.qty !== undefined && !(qty > 0) && r[cols.qty]) problems.add("Some quantities aren't numbers");
    // Scale checks: a per-unit price can't be hundreds of times today's price, nor a cost hundreds of times the value.
    const unitNow = price > 0 ? price : qty > 0 && val > 0 ? val / qty : NaN;
    if (avg > 0 && unitNow > 0) {
      checks++;
      const ratio = avg / unitNow;
      if (ratio < 1 / 25 || ratio > 25) problems.add("The average price looks like a total, not a price per unit");
      else pass++;
    }
    if (inv > 0 && val > 0) {
      checks++;
      const ratio = inv / val;
      if (ratio < 1 / 25 || ratio > 25) problems.add("Invested and current value are wildly different — one may be the wrong column");
      else pass++;
    }
  }
  // Per-unit test: for a real per-unit column, column ÷ today's unit price stays level across rows.
  // For a total mislabelled as per-unit, that ratio climbs with the quantity held.
  const perUnit = (f: "avg" | "price") => {
    if (cols[f] === undefined || cols.qty === undefined) return;
    const pts = rows
      .map((r) => {
        const q = cell(r, "qty");
        const x = cell(r, f);
        const unit = f === "avg" ? (cell(r, "price") > 0 ? cell(r, "price") : cell(r, "value") / q) : cell(r, "value") / q;
        return q > 0 && x > 0 && unit > 0 ? { lq: Math.log(q), lr: Math.log(x / unit) } : null;
      })
      .filter((p): p is { lq: number; lr: number } => !!p);
    if (pts.length < 3) return;
    const spread = Math.max(...pts.map((p) => p.lq)) - Math.min(...pts.map((p) => p.lq));
    if (spread < Math.log(3)) return; // quantities too similar to tell
    if (f === "price" && cols.value === undefined) return;
    const mq = pts.reduce((a, p) => a + p.lq, 0) / pts.length;
    const mr = pts.reduce((a, p) => a + p.lr, 0) / pts.length;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      sxy += (p.lq - mq) * (p.lr - mr);
      sxx += (p.lq - mq) ** 2;
    }
    const slope = sxx ? sxy / sxx : 0; // ≈1 when the column is quantity × something
    checks++;
    if (slope > 0.6) problems.add(f === "avg" ? "The average price column looks like a total, not a price per unit" : "The current price column looks like a total, not a price per unit");
    else pass++;
  };
  perUnit("avg");
  perUnit("price");

  const held = extractHoldings(rows, cols);
  const complete = held.length ? held.filter((h) => h.qty > 0 && h.cost > 0 && h.value > 0).length / held.length : 0;
  return { consistency: checks ? pass / checks : 1, checks, complete, problems: [...problems] };
}
