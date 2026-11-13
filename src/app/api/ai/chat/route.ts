import { chatJson, LlmError, rateLimit, type Message } from "@/server/llm";
import { bad } from "@/server/validate";

/**
 * The portfolio assistant. Gets the person's portfolio (every figure pre-computed by
 * Folio) plus the recent conversation, and replies in plain language. When the person
 * describes a trade they made, or asks a what-if, it returns a structured action and
 * Folio works out the numbers and shows a card — the model never does the arithmetic,
 * and nothing is saved until the person confirms.
 *
 * Size matters: hosted free tiers cap input tokens per minute (Groq: 7,000), so the
 * portfolio is sent as a compact table rather than JSON, old trades and messages are
 * trimmed, and the instructions are kept short.
 */

const SYSTEM = `You are Folio, a warm, sharp assistant in a personal portfolio tracker (mostly Indian users). PORTFOLIO below has this person's totals, holdings (ids h1, h2…; listed biggest first), today's moves, history and trades. You're on their side.

Answering:
- Use PORTFOLIO numbers exactly; they're pre-computed, in the display currency unless a row's ccy says otherwise. Never invent figures. If something isn't there, say so.
- Don't do new arithmetic. For calculations (averages after a trade, sale proceeds, price moves, units needed to reach a target average) return a "whatif" action; the app calculates it.
- "Biggest" = first in HOLDINGS. What rose/fell today = the UP TODAY / DOWN TODAY lines only.
- Be concise and friendly: 1–5 short sentences or bullets, **bold** key numbers, ₹/$ correct. Refer to holdings by name, never id.
- Not a SEBI-registered adviser: never recommend buying/selling/holding anything specific or predict prices. For "should I…?" give the facts (weight, return, how long held, Indian tax basics: equity STCG under 1 year vs LTCG, crypto flat 30%), say it's their call, offer a what-if. You can't place broker orders.

Actions (at most one):
- "trade": they say they HAVE bought/sold. trade = only what they said: type buy|sell, quantity, quantityRule all|half|fraction (+fraction 0-1), keep (units kept, "all but 2"), pricePerUnit, priceRule market|avg|close, total (5k=5000, 1L=100000), totalCurrency INR|USD, date YYYY-MM-DD from today (null=today), time HH:MM, broker (one of the listed brokers). holdingId = matching id, or null with newHolding {query, assetType in_stock|us_stock|mf|crypto} if not held. Never compute "everything" yourself. Reply e.g. "Got it — check it and confirm:". If ambiguous which holding, ask instead.
- "whatif": hypotheticals. One of: (a) holdingId + trade ("what if I buy 5 more at 1100", "if I sold half"); (b) priceChangePct + scope {holdingIds or assetType, or null = whole portfolio} ("what if crypto falls 20%"); (c) holdingId + targetAvgPrice (+ optional trade.pricePerUnit) for "how much should I buy to get my average below X" — the app works out the units. Reply with a short lead-in.

Also 2–3 short follow-up questions in their voice.

JSON only: {"reply":"...","action":null|{"type":"trade","holdingId":"h1"|null,"newHolding":null|{"query":"","assetType":""},"trade":{...}}|{"type":"whatif","holdingId":"h1"|null,"trade":{...}|null,"priceChangePct":null,"targetAvgPrice":null,"scope":null|{"holdingIds":[],"assetType":null}},"suggestions":["..."]}`;

const TYPES = ["in_stock", "us_stock", "mf", "crypto"] as const;
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
const pos = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : null);

/* ------------------------------------------------------------------------ */
/* Compact portfolio text                                                     */
/* ------------------------------------------------------------------------ */

type Rec = Record<string, unknown>;
const n = (v: unknown, digits = 2) => (typeof v === "number" && isFinite(v) ? String(Number(v.toFixed(digits))) : "-");
const units = (v: unknown) => (typeof v === "number" && isFinite(v) ? String(Number(v.toPrecision(7))) : "-");
const short = (v: unknown, max = 72) => str(v, 200).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, max);
const list = (rows: unknown, f: (r: Rec) => string, max = 40) => (Array.isArray(rows) ? (rows as Rec[]).slice(0, max).map(f).join("; ") : "") || "none";
const TYPE_SHORT: Record<string, string> = { "Indian stock": "IN stock", "US stock": "US stock", "Mutual fund": "MF", Crypto: "Crypto" };

/** Turns the structured portfolio into a dense, readable table (about a third of the JSON's tokens). */
function compact(c: Rec, maxTrades: number) {
  const t = (c.totals ?? {}) as Rec;
  const h = (c.history ?? {}) as Rec;
  const hi = (h.highest ?? null) as Rec | null;
  const holdings = Array.isArray(c.holdings) ? (c.holdings as Rec[]) : [];
  const trades = Array.isArray(c.trades) ? (c.trades as Rec[]) : [];
  const lines = [
    `Today ${c.today} (${c.weekday}). Display currency ${c.displayCurrency}. $1 = ₹${n(c.usdInr)}. Brokers: ${(Array.isArray(c.brokers) ? c.brokers : []).join(", ")}.`,
    `TOTALS net worth ${n(t.netWorth, 0)} | invested ${n(t.invested, 0)} | return ${n(t.returnAmount, 0)} (${n(t.returnPct)}%) | today ${n(t.todayChange)} (${n(t.todayPct)}%), ${t.holdingsUpToday} up, ${t.holdingsDownToday} down | currency effect today ${n(t.currencyEffectToday)}`,
    `HISTORY tracked since ${h.trackedSince ?? "-"} | 7 days ago ${n(h.netWorth7DaysAgo, 0)} | 30 days ago ${n(h.netWorth30DaysAgo, 0)} | highest ${hi ? `${n(hi.value, 0)} on ${hi.date}` : "-"}`,
    `BY TYPE ${list(c.byType, (r) => `${r.name} ${n(r.value, 0)} (${n(r.weightPct, 1)}%)`)}`,
    `BY BROKER ${list(c.byBroker, (r) => `${r.name} ${n(r.value, 0)} (${n(r.weightPct, 1)}%)`)}`,
    `DOWN TODAY ${list(c.downToday, (r) => `${short(r.name, 32)} ${n(r.change)} (${n(r.pricePct)}%)`, 12)}`,
    `UP TODAY ${list(c.upToday, (r) => `${short(r.name, 32)} +${n(r.change)} (+${n(r.pricePct)}%)`, 12)}`,
    `MARKETS ${list(c.markets, (r) => `${r.market} ${n(r.todayChange)} [${r.status}]`)}`,
    `HOLDINGS biggest first. id|name|type|ccy|units|avg cost|price|invested|value|return|return%|weight%|today|brokers|first bought|realised`,
    ...holdings.map((r) =>
      [
        r.id,
        short(r.name),
        TYPE_SHORT[str(r.type, 20)] ?? r.type,
        r.pricedIn,
        units(r.units),
        n(r.avgCostPerUnit, 4),
        r.pricePerUnit == null ? "-" : n(r.pricePerUnit, 4),
        n(r.invested, 0),
        n(r.value, 0),
        n(r.returnAmount, 0),
        n(r.returnPct),
        n(r.weightPct, 1),
        r.todayChange == null ? "-" : n(r.todayChange),
        Object.entries((r.unitsByBroker ?? {}) as Rec)
          .map(([b, q]) => `${b} ${units(q)}`)
          .join(", "),
        r.firstBought ?? "-",
        n(r.realisedGain, 0),
      ].join("|"),
    ),
    `SOLD OUT ${list(c.soldOut, (r) => `${short(r.name, 40)} realised ${n(r.realisedGain, 0)}`)}`,
    `NO DAILY PRICE ${(Array.isArray(c.noDailyPrice) ? c.noDailyPrice : []).map((x) => short(x, 32)).join(", ") || "none"}`,
    `TRADES newest first${trades.length > maxTrades ? ` (latest ${maxTrades} of ${trades.length}; first-bought dates are in HOLDINGS)` : ""}. date|id|buy/sell|units|price|ccy|broker`,
    ...trades.slice(0, maxTrades).map((r) => [r.date, r.holding, r.type, units(r.units), n(r.pricePerUnit, 4), r.pricedIn, r.broker].join("|")),
  ];
  return lines.join("\n");
}

function cleanTrade(t: Rec | null | undefined, today: string, brokers: string[]) {
  if (!t || typeof t !== "object") return null;
  const date = typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date <= today ? t.date : null;
  const broker = typeof t.broker === "string" ? (brokers.find((b) => b.toLowerCase() === (t.broker as string).toLowerCase()) ?? null) : null;
  return {
    type: oneOf(t.type, ["buy", "sell"] as const),
    quantity: pos(t.quantity),
    quantityRule: oneOf(t.quantityRule, ["all", "half", "fraction"] as const),
    fraction: typeof t.fraction === "number" && t.fraction > 0 && t.fraction <= 1 ? t.fraction : null,
    keep: typeof t.keep === "number" && t.keep >= 0 ? t.keep : null,
    pricePerUnit: pos(t.pricePerUnit),
    priceRule: oneOf(t.priceRule, ["market", "avg", "close"] as const),
    total: pos(t.total),
    totalCurrency: oneOf(t.totalCurrency, ["INR", "USD"] as const),
    date,
    time: typeof t.time === "string" && /^\d{2}:\d{2}$/.test(t.time) ? t.time : null,
    broker,
    understood: "",
    unclear: null,
  };
}

/** Rough token estimate for budgeting (numbers and tables run at about 3 characters a token). */
const tokens = (s: string) => Math.ceil(s.length / 3);
const BUDGET = Number(process.env.LLM_INPUT_BUDGET ?? 4500);

export async function POST(req: Request) {
  try {
    rateLimit(req, 40);
    const body = await req.json().catch(() => null);
    const context = body?.context as Rec | undefined;
    if (!context || typeof context !== "object") return bad("Missing portfolio context.");
    let history: Message[] = (Array.isArray(body?.messages) ? body.messages : [])
      .slice(-8)
      .map((m: { role?: string; content?: string }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: str(m.content, 600) }))
      .filter((m: Message) => m.content);
    if (!history.length || history[history.length - 1].role !== "user") return bad("Ask a question.");

    // Fit the request into the provider's per-minute input budget: fewer trades first, then older messages.
    let maxTrades = 30;
    let portfolio = compact(context, maxTrades);
    const size = () => tokens(SYSTEM) + tokens(portfolio) + history.reduce((s, m) => s + tokens(m.content) + 4, 0);
    while (size() > BUDGET && maxTrades > 10) portfolio = compact(context, (maxTrades = Math.floor(maxTrades / 2)));
    while (size() > BUDGET && history.length > 1) history = history.slice(1);
    if (size() > BUDGET * 1.4) return bad("Your portfolio is too large for the AI service's free limit. Try again with fewer holdings filtered, or use a paid AI plan.", 413);

    const reply = await chatJson<Rec>([{ role: "system", content: `${SYSTEM}\n\nPORTFOLIO\n${portfolio}` }, ...history], 900, (text) => ({
      reply: text,
      action: null,
      suggestions: [],
    }));

    const today = typeof context.today === "string" ? context.today : new Date().toISOString().slice(0, 10);
    const brokers: string[] = Array.isArray(context.brokers) ? context.brokers.map((b: unknown) => str(b, 40)) : [];
    const holdingIds = new Set<string>((Array.isArray(context.holdings) ? context.holdings : []).map((h: { id?: string }) => h.id).filter((x): x is string => !!x));
    const hid = (v: unknown) => (typeof v === "string" && holdingIds.has(v) ? v : null);

    const a = reply.action as Rec | null | undefined;
    let action: Rec | null = null;
    if (a && a.type === "trade") {
      const trade = cleanTrade(a.trade as Rec, today, brokers);
      const nh = a.newHolding as Rec | null;
      const newHolding = !hid(a.holdingId) && nh && typeof nh.query === "string" ? { query: str(nh.query, 80), assetType: oneOf(nh.assetType, TYPES) } : null;
      if (trade && (hid(a.holdingId) || newHolding)) action = { type: "trade", holdingId: hid(a.holdingId), newHolding, trade };
    } else if (a && a.type === "whatif") {
      const scope = (a.scope ?? {}) as Rec;
      action = {
        type: "whatif",
        holdingId: hid(a.holdingId),
        trade: cleanTrade(a.trade as Rec, today, brokers),
        priceChangePct: num(a.priceChangePct),
        targetAvgPrice: pos(a.targetAvgPrice),
        scope: {
          holdingIds: Array.isArray(scope.holdingIds) ? scope.holdingIds.map(hid).filter(Boolean) : null,
          assetType: oneOf(scope.assetType, TYPES),
        },
      };
      const usable = action.priceChangePct !== null || (action.holdingId && (action.trade || action.targetAvgPrice));
      if (!usable) action = null;
    }

    return Response.json({
      reply: str(reply.reply, 3000) || "Sorry, I couldn't put that together. Could you rephrase?",
      action,
      suggestions: (Array.isArray(reply.suggestions) ? reply.suggestions : []).map((s: unknown) => str(s, 80)).filter(Boolean).slice(0, 3),
    });
  } catch (e) {
    if (e instanceof LlmError) return bad(e.message, e.status);
    return bad("The assistant couldn't answer right now.", 502);
  }
}
