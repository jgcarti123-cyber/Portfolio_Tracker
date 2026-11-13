/**
 * "Tell Folio what you did" accuracy test. Each sentence goes through the AI reader (via
 * the running dev server) and the on-device reader, then the same resolver the app uses,
 * and the resulting trade is compared with the right answer.
 *
 *   npx tsx scripts/eval-trade.ts [--server http://localhost:3001] [--no-ai] [--only=text]
 */
import { parseTradeLocally, resolveTrade, type ParsedTrade, type TradeContext } from "../src/lib/tradeText";

const args = process.argv.slice(2);
const server = args[args.indexOf("--server") + 1]?.startsWith("http") ? args[args.indexOf("--server") + 1] : "http://localhost:3001";
const useAi = !args.includes("--no-ai");
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

const TODAY = "2026-11-13"; // a Friday
const NOW = new Date(`${TODAY}T10:00:00`);
const ACCOUNTS = [
  { id: "groww", name: "Groww" },
  { id: "indmoney", name: "INDmoney" },
  { id: "coindcx", name: "CoinDCX" },
  { id: "phantom", name: "phantom" },
  { id: "scripbox", name: "Scripbox" },
];
const CLOSES: Record<string, number> = { "2026-11-12": 1202, "2026-11-10": 1180, "2026-11-09": 1175, "2026-11-06": 1150, "2026-11-03": 1100 };
const US_CLOSES: Record<string, number> = { "2026-11-12": 178 };

interface Holding {
  name: string;
  ticker: string;
  kind: string;
  unit: string;
  currency: "INR" | "USD";
  heldBy: Record<string, number>;
  current: string;
  live: number;
  avg: number;
  closes: Record<string, number>;
}
const COCHIN: Holding = { name: "Cochin Shipyard Limited", ticker: "COCHINSHIP", kind: "Indian stock", unit: "shares", currency: "INR", heldBy: { groww: 5 }, current: "groww", live: 1196, avg: 1465, closes: CLOSES };
const TWO: Holding = { ...COCHIN, heldBy: { groww: 5, indmoney: 3 } };
const NVDA: Holding = { name: "NVIDIA Corporation", ticker: "NVDA", kind: "US stock", unit: "shares", currency: "USD", heldBy: { indmoney: 0.5 }, current: "indmoney", live: 180, avg: 150, closes: US_CLOSES };
const USD_INR = 88;

interface Want {
  type?: "buy" | "sell" | null;
  qty?: number | null;
  price?: number | null;
  date?: string;
  legs?: Record<string, number>;
  missing?: string[];
  problem?: boolean;
}
const CASES: [string, Holding, Want][] = [
  // Selling everything, many ways of saying it
  ["sold everything yesterday", COCHIN, { type: "sell", qty: 5, price: 1202, date: "2026-11-12", legs: { groww: 5 } }],
  ["i sold all my shares", COCHIN, { type: "sell", qty: 5, price: 1196, date: TODAY }],
  ["i sold everything of this stock", COCHIN, { type: "sell", qty: 5, price: 1196 }],
  ["exited completely", COCHIN, { type: "sell", qty: 5 }],
  ["booked profit on all of it", COCHIN, { type: "sell", qty: 5 }],
  ["redeemed everything", COCHIN, { type: "sell", qty: 5 }],
  ["sold all my cochin shares", COCHIN, { type: "sell", qty: 5 }],
  ["sold it all at 1250", COCHIN, { type: "sell", qty: 5, price: 1250 }],
  ["sold everything at my average price", COCHIN, { type: "sell", qty: 5, price: 1465 }],
  ["sold all at market price yesterday", COCHIN, { type: "sell", qty: 5, price: 1202, date: "2026-11-12" }],
  ["sold everything on 3 nov", COCHIN, { type: "sell", qty: 5, price: 1100, date: "2026-11-03" }],
  ["sold all on monday", COCHIN, { type: "sell", qty: 5, price: 1175, date: "2026-11-09" }],
  ["sold everything last friday", COCHIN, { type: "sell", qty: 5, price: 1150, date: "2026-11-06" }],
  ["maine sab bech diya kal", COCHIN, { type: "sell", qty: 5, price: 1202, date: "2026-11-12" }],
  // Parts
  ["sold half", COCHIN, { type: "sell", qty: 2.5, price: 1196 }],
  ["sold a quarter of my shares", COCHIN, { type: "sell", qty: 1.25 }],
  ["sold 40%", COCHIN, { type: "sell", qty: 2 }],
  ["sold everything except 1 share", COCHIN, { type: "sell", qty: 4 }],
  ["sold all but 2", COCHIN, { type: "sell", qty: 3 }],
  // Exact sales
  ["sold 2 shares at 1210 on groww", COCHIN, { type: "sell", qty: 2, price: 1210, legs: { groww: 2 } }],
  ["sold 2", COCHIN, { type: "sell", qty: 2, price: 1196 }],
  ["sold 3 for ₹3,600", COCHIN, { type: "sell", qty: 3, price: 1200 }],
  ["sold 10 shares", COCHIN, { type: "sell", qty: 10, problem: true }],
  // Buys
  ["bought 5 more", COCHIN, { type: "buy", qty: 5, price: 1196 }],
  ["bought 3 at 1180 yesterday", COCHIN, { type: "buy", qty: 3, price: 1180, date: "2026-11-12" }],
  ["bought 2 on indmoney", COCHIN, { type: "buy", qty: 2, legs: { indmoney: 2 } }],
  ["Bought 1 share @ 1,234.50 on 12th Nov", COCHIN, { type: "buy", qty: 1, price: 1234.5, date: "2026-11-12" }],
  ["invested 10000 today", COCHIN, { type: "buy", qty: 10000 / 1196, price: 1196, date: TODAY }],
  ["put in 5k last friday", COCHIN, { type: "buy", qty: 5000 / 1150, price: 1150, date: "2026-11-06" }],
  ["bought for ₹6,000 at 1200", COCHIN, { type: "buy", qty: 5, price: 1200 }],
  ["bought 4 shares for 4800", COCHIN, { type: "buy", qty: 4, price: 1200 }],
  ["added 2 units via SIP", COCHIN, { type: "buy", qty: 2 }],
  ["bought 1 lakh worth 3 days ago", COCHIN, { type: "buy", qty: 100000 / 1180, price: 1180, date: "2026-11-10" }],
  // Not enough said: ask only for what's missing
  ["sold 3 days ago", COCHIN, { type: "sell", date: "2026-11-10", missing: ["quantity"] }],
  ["bought", COCHIN, { type: "buy", missing: ["quantity"] }],
  ["what is the price", COCHIN, { missing: ["type", "quantity"] }],
  // Two brokers
  ["sold everything", TWO, { type: "sell", qty: 8, legs: { groww: 5, indmoney: 3 } }],
  ["sold everything on indmoney", TWO, { type: "sell", qty: 3, legs: { indmoney: 3 } }],
  ["sold half", TWO, { type: "sell", qty: 4, legs: { groww: 2.5, indmoney: 1.5 } }],
  ["sold 4 on groww", TWO, { type: "sell", qty: 4, legs: { groww: 4 } }],
  ["sold 4 on ind money", TWO, { type: "sell", qty: 4, problem: true }],
  // A dollar holding
  ["sold all", NVDA, { type: "sell", qty: 0.5, price: 180, legs: { indmoney: 0.5 } }],
  ["bought for $100", NVDA, { type: "buy", qty: 100 / 180, price: 180 }],
  ["invested ₹10,000", NVDA, { type: "buy", qty: 10000 / USD_INR / 180, price: 180 }],
  ["bought 0.2 at $175 yesterday", NVDA, { type: "buy", qty: 0.2, price: 175, date: "2026-11-12" }],
];

const close = (a: number | null | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= Math.max(Math.abs(b) * tol, 1e-6);

function ctxFor(h: Holding): TradeContext {
  return {
    today: TODAY,
    accounts: ACCOUNTS,
    heldBy: h.heldBy,
    currentAccountId: h.current,
    livePrice: h.live,
    avg: h.avg,
    closeOn: (d) => h.closes[d] ?? null,
  };
}

async function askAi(text: string, h: Holding): Promise<ParsedTrade> {
  const res = await fetch(`${server}/api/ai/parse-trade`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      context: {
        holding: h.name,
        ticker: h.ticker,
        kind: h.kind,
        unit: h.unit,
        pricedIn: h.currency,
        priceNow: h.live,
        averageCost: h.avg,
        unitsHeld: Object.values(h.heldBy).reduce((a, b) => a + b, 0),
        heldByBroker: Object.fromEntries(Object.entries(h.heldBy).map(([id, q]) => [ACCOUNTS.find((a) => a.id === id)!.name, q])),
        brokers: ACCOUNTS.map((a) => a.name),
        today: TODAY,
        weekday: "Friday",
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.status);
  return json;
}

function check(r: ParsedTrade, h: Holding, w: Want) {
  const res = resolveTrade(r, ctxFor(h), h.currency, USD_INR);
  const qty = res.legs.reduce((s, l) => s + (l.qty ?? 0), 0);
  const bad: string[] = [];
  if (w.type !== undefined && res.type !== w.type) bad.push(`type ${res.type}≠${w.type}`);
  if (w.qty != null && !close(qty, w.qty, 0.002)) bad.push(`qty ${+qty.toFixed(4)}≠${+w.qty.toFixed(4)}`);
  if (w.price != null && !close(res.price, w.price, 0.002)) bad.push(`price ${res.price}≠${w.price}`);
  if (w.date && res.date !== w.date) bad.push(`date ${res.date}≠${w.date}`);
  if (w.legs) {
    const got = Object.fromEntries(res.legs.filter((l) => (l.qty ?? 0) > 0).map((l) => [l.accountId, l.qty!]));
    const ok = Object.keys(w.legs).length === Object.keys(got).length && Object.entries(w.legs).every(([k, v]) => close(got[k], v, 0.002));
    if (!ok) bad.push(`brokers ${JSON.stringify(got)}≠${JSON.stringify(w.legs)}`);
  }
  if (w.missing) for (const m of w.missing) if (!res.missing.includes(m as never)) bad.push(`should ask for ${m}`);
  if (w.problem && !res.problems.length) bad.push("should flag a problem");
  if (!w.problem && res.problems.length) bad.push(`unexpected problem: ${res.problems[0]}`);
  if (!w.missing && res.missing.length) bad.push(`asks for ${res.missing.join(", ")}`);
  return { ok: !bad.length, bad, res };
}

async function main() {
  const tally = { ai: 0, device: 0, n: 0 };
  for (const [text, h, w] of CASES) {
    if (only && !text.includes(only)) continue;
    tally.n++;
    const local = check(parseTradeLocally(text, ACCOUNTS.map((a) => a.name), NOW), h, w);
    if (local.ok) tally.device++;
    let aiLine = "";
    if (useAi) {
      await new Promise((r) => setTimeout(r, Number(process.env.AI_GAP_MS ?? 2200)));
      try {
        const a = check(await askAi(text, h), h, w);
        if (a.ok) tally.ai++;
        aiLine = a.ok ? "PASS" : `FAIL ${a.bad.join("; ")}`;
      } catch (e) {
        aiLine = `ERROR ${(e as Error).message}`;
      }
    }
    console.log(`${JSON.stringify(text).padEnd(44)} ${h.ticker.padEnd(10)} AI ${aiLine.padEnd(6)}  device ${local.ok ? "PASS" : `FAIL ${local.bad.join("; ")}`}`);
  }
  console.log(`\nAI + Folio's resolver : ${tally.ai}/${tally.n}`);
  console.log(`On-device reader      : ${tally.device}/${tally.n}`);
}
main();
