import { chatJson, LlmError, rateLimit } from "@/server/llm";
import { bad } from "@/server/validate";

const FIELDS = ["name", "ticker", "isin", "qty", "avg", "invested", "price", "value", "pnl", "date"] as const;
const CLASSES = ["in_stock", "us_stock", "mf", "crypto"] as const;

interface Reply {
  assetClass?: string;
  currency?: string;
  columns?: Record<string, number | null>;
  confidence?: number;
  notes?: string;
}

const SYSTEM = `You map the columns of an investment holdings spreadsheet (Indian or US brokers, mutual fund platforms and distributors, crypto exchanges) to standard fields. Accuracy matters more than anything: a wrong column puts wrong money in someone's net worth.

You get the header labels and sample rows, plus a per-column summary. Use zero-based column indexes, or null when the field is absent. Never use the same column for two fields.

Fields:
- name: the security, scheme, fund or coin NAME. Never the investor's, client's or portfolio's name.
- ticker: exchange symbol or coin code (e.g. RELIANCE, AAPL, BTC). Null if the only identifier is a long name.
- isin: 12-character ISIN code column.
- qty: the TOTAL number of shares/units/coins currently held. If there are several quantity columns (Free/Locked/Total, Available/Pledged/Long-term, T1), choose the total or the one that is available+settled — prefer a column literally called Total; otherwise the first plain quantity/available column.
- avg: average buy price PER UNIT (cost per share/unit/NAV at purchase). Its values are close to the current price per unit, not to the current value.
- invested: TOTAL cost of the holding (buy value, investment, amount invested, value at cost, cost basis, book value, total cost). "Cost basis" and "book value" are ALWAYS totals, never per-unit.
- price: CURRENT price PER UNIT (LTP, CMP, closing price, current NAV, market rate).
- value: CURRENT TOTAL market value of the holding.
- pnl: UNREALISED profit/loss AMOUNT (not %, not day change, not realised).
- date: purchase / holding-since date.
Check your choice with arithmetic on the sample rows: qty × avg ≈ invested, qty × price ≈ value, value − invested ≈ pnl. If a mapping fails these checks, pick a different column.
Ignore percentage columns, day/net change, XIRR, weights, sector, exchange, folio and account columns for the amount fields.

assetClass: in_stock (Indian shares/ETFs on NSE/BSE), us_stock, mf (Indian mutual funds), crypto.
currency: INR or USD — the currency of the amount columns ($, USD, USDT → USD; ₹, Rs, INR → INR; Indian stocks and mutual funds without a symbol → INR).

Reply with JSON only:
{"assetClass": "...", "currency": "...", "columns": {"name": n, "ticker": n, "isin": n, "qty": n, "avg": n, "invested": n, "price": n, "value": n, "pnl": n, "date": n}, "confidence": 0-1, "notes": "one short plain-English sentence describing the file, e.g. 'Zerodha holdings of Indian shares with quantity, average cost and last price.'"}`;

const cellText = (v: unknown) => (typeof v === "string" ? v.slice(0, 60) : "");
const isNum = (c: string) => c !== "" && !isNaN(Number(c.replace(/[₹$,\s%()]|INR|USDT|USD|Rs\.?/gi, "")));

export async function POST(req: Request) {
  try {
    rateLimit(req, 30);
    const body = await req.json().catch(() => null);
    const header: string[] = Array.isArray(body?.header) ? body.header.slice(0, 40).map(cellText) : [];
    const rows: string[][] = Array.isArray(body?.rows)
      ? body.rows.slice(0, 8).map((r: unknown) => (Array.isArray(r) ? r.slice(0, 40).map(cellText) : []))
      : [];
    if (header.length < 2) return bad("Send the header row.");

    // A per-column digest helps the model see which columns are numbers, text or codes.
    const digest = header
      .map((h, i) => {
        const vals = rows.map((r) => r[i] ?? "").filter(Boolean);
        const kind = !vals.length ? "empty" : vals.every(isNum) ? "number" : vals.every((v) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v)) ? "ISIN" : "text";
        return `${i}: "${h}" — ${kind}; e.g. ${vals.slice(0, 3).map((v) => JSON.stringify(v)).join(", ") || "—"}`;
      })
      .join("\n");
    const table = [header, ...rows].map((r, i) => `${i === 0 ? "HEADER" : `ROW ${i}`}: ${JSON.stringify(r)}`).join("\n");

    const reply = await chatJson<Reply>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Columns:\n${digest}\n\nTable:\n${table}` },
      ],
      900,
    );

    // Trust nothing: keep only valid fields pointing at distinct real columns.
    const columns: Record<string, number> = {};
    const used = new Set<number>();
    for (const f of FIELDS) {
      const i = reply.columns?.[f];
      if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < header.length && !used.has(i)) {
        columns[f] = i;
        used.add(i);
      }
    }
    return Response.json({
      assetClass: CLASSES.includes(reply.assetClass as (typeof CLASSES)[number]) ? reply.assetClass : null,
      currency: reply.currency === "USD" ? "USD" : reply.currency === "INR" ? "INR" : null,
      columns,
      confidence: typeof reply.confidence === "number" ? Math.max(0, Math.min(1, reply.confidence)) : null,
      notes: typeof reply.notes === "string" ? reply.notes.slice(0, 200) : "",
    });
  } catch (e) {
    if (e instanceof LlmError) return bad(e.message, e.status);
    return bad("The AI couldn't read this sheet.", 502);
  }
}
