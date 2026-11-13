import { chatJson, LlmError, rateLimit } from "@/server/llm";
import { bad } from "@/server/validate";

/**
 * Turns a sentence like "sold everything yesterday on Groww" into structured trade
 * fields. The model only extracts what the person said; Folio itself works out
 * amounts such as "everything" or "half" from the units actually held, so no
 * arithmetic is left to the model. Nothing is saved: the app fills its form and
 * the person confirms.
 */

const SYSTEM = `You read one short message in which a person describes a trade they made in ONE specific holding, and extract the details. The holding, today's date, their brokers and how much they hold are given as context.

Rules:
- Extract only what the message says or clearly implies. Never invent numbers. If something isn't stated, use null.
- type: "buy" for bought/added/invested/purchased/SIP; "sell" for sold/exited/redeemed/booked profit/withdrew. null if unclear.
- quantity: number of shares/units/coins if stated as a count.
- quantityRule: "all" when they sold everything/all/entire/whole/fully exited; "half" for half; "fraction" with fraction (0-1) for other parts like "a quarter" or "30%"; otherwise null. Do NOT compute the number yourself.
- keep: number of units they say they KEPT or did not sell ("sold all but 2", "everything except 1 share", "kept 3") — then set quantityRule "all" and quantity null. Otherwise null.
- pricePerUnit: price per share/unit/coin if stated (e.g. "at 1196", "@ $182.5").
- priceRule: "market" for "at market"/"current price"/"today's price"; "avg" for "at my average/cost"; "close" for "at the closing price" or when a past date is given without a price; null otherwise.
- total: total money paid or received if stated (e.g. "for ₹10,000", "worth 5k", "invested 2000"). Expand k/K = thousand, L/lakh = 100000, cr/crore = 10000000.
- totalCurrency: "INR" or "USD" for the total, from symbols or words; null if not stated.
- date: YYYY-MM-DD resolved against today's date ("yesterday", "last Friday", "on 3rd Nov", "2 days ago"). null if not mentioned (means today).
- time: HH:MM 24-hour only if stated.
- broker: exactly one of the given broker names if mentioned (match loosely, e.g. "ind money" → "INDmoney"); otherwise null.
- understood: one short plain-English sentence restating the trade, e.g. "Sell all your units on Groww at today's price."
- missing: list of what is still needed to save, from ["type","quantity","price","date"] — "quantity" is satisfied by quantity, quantityRule or total; "price" by pricePerUnit, priceRule, or total together with quantity.
- unclear: a short question if the message is ambiguous or about a different holding, else null.

Reply with JSON only:
{"type":null,"quantity":null,"quantityRule":null,"fraction":null,"keep":null,"pricePerUnit":null,"priceRule":null,"total":null,"totalCurrency":null,"date":null,"time":null,"broker":null,"understood":"","missing":[],"unclear":null}`;

const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : null);

export async function POST(req: Request) {
  try {
    rateLimit(req, 40);
    const body = await req.json().catch(() => null);
    const text = str(body?.text, 300).trim();
    if (text.length < 2) return bad("Type what you bought or sold.");
    const c = body?.context ?? {};
    const brokers: string[] = (Array.isArray(c.brokers) ? c.brokers : []).map((b: unknown) => str(b, 40)).filter(Boolean).slice(0, 20);
    const context = {
      holding: str(c.holding, 120),
      ticker: str(c.ticker, 30),
      kind: str(c.kind, 30),
      unit: str(c.unit, 12),
      pricedIn: c.pricedIn === "USD" ? "USD" : "INR",
      priceNow: num(c.priceNow),
      averageCost: num(c.averageCost),
      unitsHeld: typeof c.unitsHeld === "number" ? c.unitsHeld : 0,
      heldByBroker: typeof c.heldByBroker === "object" && c.heldByBroker ? c.heldByBroker : {},
      brokers,
      today: /^\d{4}-\d{2}-\d{2}$/.test(c.today) ? c.today : new Date().toISOString().slice(0, 10),
      weekday: str(c.weekday, 12),
    };

    const r = await chatJson<Record<string, unknown>>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Context: ${JSON.stringify(context)}\n\nMessage: ${JSON.stringify(text)}` },
      ],
      500,
    );

    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= context.today ? r.date : null;
    const broker = typeof r.broker === "string" ? (brokers.find((b) => b.toLowerCase() === (r.broker as string).toLowerCase()) ?? null) : null;
    const fraction = typeof r.fraction === "number" && r.fraction > 0 && r.fraction <= 1 ? r.fraction : null;
    return Response.json({
      type: oneOf(r.type, ["buy", "sell"] as const),
      quantity: num(r.quantity),
      quantityRule: oneOf(r.quantityRule, ["all", "half", "fraction"] as const),
      fraction,
      keep: typeof r.keep === "number" && isFinite(r.keep) && r.keep >= 0 ? r.keep : null,
      pricePerUnit: num(r.pricePerUnit),
      priceRule: oneOf(r.priceRule, ["market", "avg", "close"] as const),
      total: num(r.total),
      totalCurrency: oneOf(r.totalCurrency, ["INR", "USD"] as const),
      date,
      time: typeof r.time === "string" && /^\d{2}:\d{2}$/.test(r.time) ? r.time : null,
      broker,
      understood: str(r.understood, 200),
      unclear: typeof r.unclear === "string" && r.unclear.trim() ? str(r.unclear, 200) : null,
    });
  } catch (e) {
    if (e instanceof LlmError) return bad(e.message, e.status);
    return bad("The AI couldn't read that.", 502);
  }
}
