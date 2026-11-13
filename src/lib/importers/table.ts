/** Reads a CSV or Excel file into rows of text cells, entirely in the browser. */
export interface Table {
  sheet: string;
  rows: string[][];
}

export async function readTables(file: File): Promise<Table[]> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    // SheetJS reads both the modern .xlsx and the older binary .xls (INDmoney uses the latter).
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    return wb.SheetNames.map((sheet) => ({ sheet, rows: sheetRows(XLSX, wb.Sheets[sheet]) }));
  }
  return [{ sheet: file.name, rows: parseCsv(await file.text()) }];
}

/** One sheet as trimmed text cells, blank rows dropped. Shared with the test harness. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sheetRows(XLSX: any, ws: unknown): string[][] {
  return (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][])
    .map((row) => row.map((c) => (c == null ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c !== ""));
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas, semicolons or tabs. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": firstLine.split(",").length, ";": firstLine.split(";").length, "\t": firstLine.split("\t").length };
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** "₹1,23,456.78", "(1,200)", "-₹50", "12.5%", "1.2e-7" -> number. Empty or junk -> NaN. */
export function num(s: string | undefined): number {
  if (s == null) return NaN;
  const t = s.replace(/[₹$,\s%]|INR|USDT|USD|Rs\.?/gi, "");
  if (!t || /^[-–—]+$/.test(t) || /^(na|n\/a|nil)$/i.test(t)) return NaN;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[()]/g, ""));
  return neg ? -n : n;
}

export type Field = "name" | "ticker" | "isin" | "qty" | "avg" | "invested" | "price" | "value" | "pnl";

export const FIELD_LABEL: Record<Field, string> = {
  name: "Name",
  ticker: "Symbol / ticker",
  isin: "ISIN",
  qty: "Quantity",
  avg: "Average price",
  invested: "Invested amount",
  price: "Current price",
  value: "Current value",
  pnl: "Profit / loss",
};

const HINTS: Record<Field, RegExp> = {
  isin: /\bisin\b/i,
  ticker: /\b(symbol|ticker|trading ?symbol|scrip|script|coin|instrument|asset|stock code|token|stk)\b/i,
  name: /\b(name|company|scheme|stock|security|instrument|fund|description|asset|particulars)\b/i,
  qty: /\b(qty|qnty|qnt|quantity|units|shares|balance|holdings?|position|volume|no\.? of|nos?\.?)(\b|$)/i,
  avg: /\b(avg|average|b\/avg|buy price|cost price|purchase price|purchase rate|buy rate|cost rate|unit cost|cost per|cost\/unit|bought at)\b/i,
  invested: /\b(invested|investment|inv\.? amt|cost value|value at cost|buy value|purchase value|total cost|tot\.? cost|amount|cost basis|book value)\b/i,
  price: /\b(ltp|cmp|last (traded )?price|last|current price|market price|closing price|nav|price|rate|rt)\b/i,
  value: /\b(current|market value|market val|mkt\.? val(ue)?|mkt\.? amount|market amount|tot\.? mkt|present value|closing value|valuation|value|worth)\b|\bcur\.?\s*val/i,
  pnl: /\b(p&l|p\/l|pnl|profit|gain|unreali[sz]ed)\b/i,
};

/** Per-unit words vs total words: "Current Price" is per unit, "Current Value" is a total. */
const PER_UNIT = /\b(price|rate|nav|ltp|cmp|avg|average)\b/i;
const TOTAL_WORD = /\b(value|val|amount|amt|worth|investment|invested|total)\b/i;
const COST_WORD = /\b(cost|invest|invested|purchase|buy|b\/avg)\b/i;

/** Columns that never hold an amount for these fields. */
const NOT_AMOUNT = /class|type|category|days|since|date|xirr|%|return|dividend|change|chg|weight|allocation|exchange|sector/i;
/** Columns about the person or account, never the holding itself. */
const PERSONAL = /\b(portfolio name|client|investor|holder|nominee|account|pan|mobile|phone|e-?mail|folio|broker name|arn|ucc|dp id)\b/i;

const usableFor = (f: Field, h: string) => {
  if (!h || PERSONAL.test(h) || !HINTS[f].test(h)) return false;
  if (f === "pnl") return !/%|day|net chg|^realised|^realized/i.test(h);
  if (f === "name" || f === "ticker" || f === "isin") return !/class|type|category|sector|exchange/i.test(h);
  if (NOT_AMOUNT.test(h) || HINTS.pnl.test(h)) return false;
  // A per-unit column is never a total, and the other way round.
  if (f === "value") return !(PER_UNIT.test(h) && !TOTAL_WORD.test(h)) && !COST_WORD.test(h);
  if (f === "price") return !TOTAL_WORD.test(h) && !COST_WORD.test(h);
  if (f === "avg") return !(TOTAL_WORD.test(h) && !PER_UNIT.test(h));
  if (f === "invested") return !(PER_UNIT.test(h) && !TOTAL_WORD.test(h)) && !/market|mkt|current/i.test(h);
  if (f === "qty") return (!TOTAL_WORD.test(h) || /units|shares|qty|quantity/i.test(h)) && !/\b(sr|s|serial|sl)\.?\s*no\b|^#$|^no\.?$/i.test(h);
  return true;
};

const isNumberCell = (c: string) => c !== "" && !isNaN(num(c));

/**
 * Finds the header row by scoring how much each row looks like one: cells that name a known
 * field, followed by rows of numbers. Title lines, account details and summary blocks score low.
 * When the row above also holds labels (a two-row header), the two are joined.
 */
export function readHeader(rows: string[][]): { index: number; labels: string[] } {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length - 1, 60); i++) {
    const cells = rows[i];
    const text = cells.filter((c) => c && isNaN(num(c)));
    if (text.length < 2) continue;
    const fields = new Set<Field>();
    for (const c of cells) for (const f of Object.keys(HINTS) as Field[]) if (usableFor(f, c)) fields.add(f);
    const below = rows.slice(i + 1, i + 4);
    const numericBelow = below.length ? below.reduce((a, r) => a + r.filter(isNumberCell).length, 0) / below.length : 0;
    const score = fields.size * 2 + Math.min(numericBelow, 4) + (text.length >= 3 ? 1 : 0);
    if (fields.size >= 2 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best < 0) {
    best = rows.findIndex((r) => r.filter((c) => /[a-z]/i.test(c) && isNaN(num(c))).length >= 3);
    if (best < 0) best = 0;
  }
  let labels = [...(rows[best] ?? [])];
  const above = rows[best - 1];
  const aboveText = above?.filter((c) => c) ?? [];
  const firstFilled = above ? above.findIndex((c) => c) : -1;
  const looksLikeGroups =
    !!above &&
    aboveText.length >= 2 &&
    aboveText.length < labels.filter((c) => c).length &&
    firstFilled > 0 && // group headings sit over the amount columns, not in column A like "Client ID | AB1234"
    above.every((c) => !c || (isNaN(num(c)) && isNaN(Date.parse(c)) && !/\d{4,}/.test(c)));
  if (looksLikeGroups) {
    // Two-row header: "Holding | | Value" over "Qty | Avg | Current" -> "Holding Qty", ...
    let group = "";
    labels = labels.map((l, k) => {
      if (above[k]) group = above[k];
      if (!l) return above[k] ?? "";
      return group && !l.toLowerCase().includes(group.toLowerCase()) ? `${group} ${l}` : l;
    });
  }
  return { index: best, labels };
}

/** Kept for callers that only need the row number. */
export const findHeader = (rows: string[][]) => readHeader(rows).index;

/** Name columns ranked: the most specific label wins over a bare "Name". */
const NAME_RANK = [/security|scheme|instrument|stock name|company/i, /stock|fund|description|asset|particulars/i, /name/i];
const TICKER_RANK = [/symbol|ticker|scrip/i, /code|coin|token|instrument|asset/i];

export function guessColumns(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  const take = (f: Field, ranks: RegExp[] = [/./]) => {
    for (const rank of ranks) {
      const idx = header.findIndex((h, i) => !taken.has(i) && usableFor(f, h) && rank.test(h));
      if (idx >= 0) {
        out[f] = idx;
        taken.add(idx);
        return;
      }
    }
  };
  // Most specific first, so "Avg price" isn't claimed as a current price, nor "Buy value" as value.
  take("isin");
  take("avg");
  take("invested");
  take("pnl");
  take("qty");
  take("value", [/market value|current value|present value|closing value|cur\.?\s*val|mkt|valuation|worth/i, /value|current/i]);
  take("price", [/ltp|cmp|last|current|market|mkt|closing|nav/i, /price|rate/i]);
  // Crypto exchanges call the coin count "Amount" when a separate column holds what was invested.
  if (out.qty === undefined && out.invested !== undefined && /^amount$/i.test(header[out.invested].trim())) {
    const other = header.findIndex((h, i) => i !== out.invested && !taken.has(i) && usableFor("invested", h));
    if (other >= 0) {
      out.qty = out.invested;
      out.invested = other;
      taken.add(other);
    }
  }
  // Exchange balance sheets: Free / Locked / Total -> the total is what you hold.
  if (out.qty === undefined) {
    const total = header.findIndex((h, i) => !taken.has(i) && /^total( balance| qty| quantity)?$/i.test(h.trim()));
    const free = header.findIndex((h) => /^(free|available)$/i.test(h.trim()));
    if (total >= 0 && free >= 0) out.qty = total;
    else if (free >= 0) out.qty = free;
    if (out.qty !== undefined) taken.add(out.qty);
  }
  // A plain "Rate" beside a market rate is the buy rate.
  if (out.avg === undefined) {
    const plain = header.findIndex((h, i) => !taken.has(i) && /^(rate|price|cost)$/i.test(h.trim()));
    if (plain >= 0 && out.price !== undefined && out.price !== plain) {
      out.avg = plain;
      taken.add(plain);
    }
  }
  take("ticker", TICKER_RANK);
  take("name", NAME_RANK);
  // A lone "Instrument"/"Asset" column is the name, not a ticker.
  if (out.ticker !== undefined && out.name === undefined && !/symbol|ticker|scrip|coin/i.test(header[out.ticker])) {
    out.name = out.ticker;
    delete out.ticker;
  }
  return out;
}

/** "Mutual Fund" in a Product / Asset type column, or a scheme column, means a fund statement. */
export function inferClass(header: string[], body: string[][]): "mf" | null {
  if (header.some((h) => /scheme/i.test(h))) return "mf";
  const typeCols = header
    .map((h, i) => (/product|asset type|instrument type|category|asset class/i.test(h) ? i : -1))
    .filter((i) => i >= 0);
  for (const i of typeCols) {
    const vals = body.map((r) => (r[i] ?? "").toLowerCase()).filter(Boolean);
    if (vals.length && vals.filter((v) => /mutual fund|\bmf\b/.test(v)).length / vals.length > 0.6) return "mf";
  }
  return null;
}

/** The sheet that looks most like a holdings table: most recognised columns, then most rows. */
export function pickSheet(tables: Table[]): number {
  let best = 0;
  let bestScore = -1;
  tables.forEach((t, i) => {
    const { index, labels } = readHeader(t.rows);
    const rows = t.rows.length - index - 1;
    const score = Object.keys(guessColumns(labels)).length * 100 + Math.min(rows, 99);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/**
 * Second pass using the values themselves, for labels the rules don't know:
 * drops a "quantity" that is really a serial number (1, 2, 3 …), and when no identifier
 * column was found, takes the text column holding a different name on each row.
 */
export function refineColumns(cols: Partial<Record<Field, number>>, header: string[], body: string[][]) {
  const out = { ...cols };
  const rows = body.filter((r) => r.some((c) => c && !isNaN(num(c)))).slice(0, 30);
  const values = (i: number) => rows.map((r) => r[i] ?? "").filter((c) => c !== "");

  if (out.qty !== undefined) {
    const v = values(out.qty).map(num);
    if (v.length >= 3 && v.every((x, k) => x === k + 1)) delete out.qty;
  }
  const hasId = out.name !== undefined || out.ticker !== undefined || out.isin !== undefined;
  if (!hasId) {
    const used = new Set(Object.values(out));
    let best = -1;
    let bestScore = 0;
    header.forEach((h, i) => {
      if (used.has(i) || PERSONAL.test(h)) return;
      const v = values(i);
      if (v.length < Math.min(2, rows.length)) return;
      const text = v.filter((c) => isNaN(num(c)) && !/^(total|grand total|sub ?total)/i.test(c));
      const distinct = new Set(text.map((c) => c.toLowerCase())).size;
      // Coin codes (BTC), tickers (TCS) and names all qualify; a constant like "INR" or "NSE" does not.
      const score = text.length / v.length + (distinct / Math.max(text.length, 1)) - (distinct <= 1 ? 2 : 0);
      if (text.length / v.length >= 0.8 && score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) {
      const v = values(best);
      const codes = v.filter((c) => /^[A-Z0-9&.\-]{1,15}$/.test(c)).length / v.length > 0.8;
      if (codes) out.ticker = best;
      else out.name = best;
    }
  }
  return out;
}
