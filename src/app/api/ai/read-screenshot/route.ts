import { chatJson, LlmError, rateLimit } from "@/server/llm";
import { bad } from "@/server/validate";

/**
 * Reads holdings from one screenshot of a broker or exchange app. The browser blacks out
 * anything the person marked as private before the image is sent, and nothing is stored.
 * Only numbers visible in the picture are returned; missing ones stay null (the browser works
 * out what it safely can and asks the person to confirm every row).
 */

const CLASSES = ["in_stock", "us_stock", "mf", "crypto"] as const;
type Cls = (typeof CLASSES)[number];
const MAX_IMAGE = 2_500_000; // characters of base64 (about 1.8 MB)

const SYSTEM = `You read screenshots of investment apps (Indian brokers like Groww, Zerodha, Upstox, INDmoney; US brokers; mutual fund apps; crypto exchanges like CoinDCX, Binance, WazirX) and list the HOLDINGS shown. Accuracy matters more than anything: a wrong number puts wrong money in someone's net worth.

Rules:
- One entry per holding row visible in the picture. Skip totals, summaries, headers, ads, watchlists, orders and anything cut off so badly you can't read its name.
- Report only numbers you can actually see for that row. Never calculate, estimate or guess a number; use null when it isn't shown.
- Read digits exactly as shown, including decimals. Remove currency symbols and thousands separators (₹1,23,456.70 → 123456.7).
- Brackets do NOT mean negative here. Many apps show two amounts per row, one under the other or with the second in brackets, and say which is which in a column header or toggle such as "Current (Invested)", "Current / Invested", "Invested (Current)", "Value (Cost)" or "LTP (Avg)". Use that header: in "Current (Invested)" the main amount is value and the bracketed amount is invested. Read BOTH amounts for every row; don't drop the second one.
- If two amounts are stacked under each other without a header, the larger, bolder one is usually the current value and the smaller one below it is often the invested amount or the profit/loss. Only fill invested if the screen makes clear it's the invested/cost figure (a header, label, or the same layout as a labelled row); a profit/loss figure (often green/red, with +/− or %) is never invested.
- Black rectangles are areas the user hid on purpose; ignore them.
- Fields per holding:
  name: the stock, fund, ETF or coin name as written.
  ticker: exchange symbol or coin code if shown (RELIANCE, AAPL, BTC), else null.
  qty: number of shares/units/coins held ("Qty", "Shares", "Units", "Holding", "Balance").
  avg: average buy price PER UNIT ("Avg", "Avg. price", "Buy avg", "Avg cost").
  invested: TOTAL amount invested in that holding ("Invested", "Buy value", "Cost", or the bracketed amount under a "Current (Invested)" header).
  price: current price PER UNIT ("LTP", "Market price", "Current NAV", "Price").
  value: CURRENT TOTAL value of that holding ("Current", "Current value", "Market value", "Value").
  assetClass: in_stock (Indian shares/ETFs), us_stock (US-listed shares/ETFs), mf (Indian mutual funds), crypto.
  currency: INR or USD, the currency the AMOUNTS on screen are in (₹ → INR, $ → USD).
- broker: the app or exchange name if it's clearly visible (logo or title), else null.

Reply with JSON only:
{"broker": "..."|null, "holdings": [{"name": "...", "ticker": "..."|null, "qty": n|null, "avg": n|null, "invested": n|null, "price": n|null, "value": n|null, "assetClass": "...", "currency": "INR"|"USD"}], "note": "one short sentence on what the screenshot shows"}`;

interface Raw {
  broker?: unknown;
  note?: unknown;
  holdings?: unknown;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[₹$,()\s]/g, "")) : NaN;
  return isFinite(n) ? n : null;
};
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: Request) {
  try {
    rateLimit(req, 25);
    const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
    const image = body?.image;
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return bad("Send one screenshot as an image.");
    if (image.length > MAX_IMAGE) return bad("That screenshot is too large. Try a smaller one.", 413);

    const reply = await chatJson<Raw>(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "List every holding in this screenshot as JSON. Check the column headers first so each amount goes in the right field, and read every amount shown for each row." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      3000,
    );

    // Trust nothing: keep only well-formed rows with a name.
    const rows = (Array.isArray(reply.holdings) ? reply.holdings : []).slice(0, 80).flatMap((h) => {
      const o = (h ?? {}) as Record<string, unknown>;
      const name = str(o.name, 120);
      if (!name) return [];
      const cls = CLASSES.includes(o.assetClass as Cls) ? (o.assetClass as Cls) : null;
      const currency = o.currency === "USD" || o.currency === "INR" ? o.currency : null;
      const pos = (v: unknown) => {
        const n = num(v);
        return n !== null && n > 0 ? n : null;
      };
      return [{ name, ticker: str(o.ticker, 24), qty: pos(o.qty), avg: pos(o.avg), invested: pos(Math.abs(num(o.invested) ?? 0)) /* a cost is never negative, even if shown in brackets */, price: pos(o.price), value: pos(o.value), assetClass: cls, currency }];
    });
    return Response.json({ broker: str(reply.broker, 40), note: str(reply.note, 200), holdings: rows });
  } catch (err) {
    if (err instanceof LlmError) return bad(err.message, err.status);
    return bad("Couldn't read that screenshot.", 502);
  }
}
