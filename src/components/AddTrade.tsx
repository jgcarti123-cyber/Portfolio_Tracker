"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAi } from "@/lib/ai";
import { money, pct, price as fmtPrice, qty as fmtQty, signed, toLocalInput } from "@/lib/format";
import { closeAt } from "@/lib/networth";
import { convert, replay } from "@/lib/portfolio";
import { fetchHistory } from "@/lib/prices";
import { cashBalances } from "@/lib/cash";
import { useStore } from "@/lib/store";
import { heldHistory, parseTradeLocally, resolveTrade, type ParsedTrade, type PriceFrom, type ResolvedTrade } from "@/lib/tradeText";
import { CLASS_META, type Asset, type Candle, type Currency } from "@/lib/types";
import { ClassGlyph, useLivePrice } from "./AddHolding";
import { Button, Modal, Segmented } from "./ui";

type Field = "qty" | "price" | "total";
type Day = "today" | "yesterday" | "pick";
type Leg = { accountId: string; qty: number };
const FIELDS: Field[] = ["qty", "price", "total"];
const DAY = 86_400_000;
/** Read the clock in event handlers (kept out of render). */
const clock = () => Date.now();

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
/** Equal within rounding of the typed quantity. */
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-7);
const tidy = (n: number, places: number) => (isFinite(n) && n > 0 ? String(Number(n.toFixed(places))) : "");

const EXAMPLES = ["sold everything yesterday", "bought 10 at 1,180 on Groww", "sold half at market price", "invested 5k on 3 Nov"];
const PRICE_NOTE: Record<PriceFrom, string> = {
  you: "the price you gave",
  total: "worked out from your total",
  live: "today's price",
  close: "closing price that day",
  avg: "your average cost",
};

/**
 * Record a buy or sell of something already held. Describe it in a sentence (read by
 * AI, or on this device when AI is off) and confirm the trade Folio works out — or fill
 * any two of quantity, price and total. Nothing is saved until the person confirms.
 */
export function AddTrade({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved?: (m: string) => void }) {
  const { data, addTxn, updateAsset } = useStore();
  const ai = useAi();
  const live = useLivePrice(asset);
  const cur = asset.currency;
  const unit = CLASS_META[asset.cls].unit;

  const txns = useMemo(() => data.txns.filter((t) => t.assetId === asset.id), [data.txns, asset.id]);
  const held = useMemo(() => replay(txns), [txns]);
  const history = useMemo(() => heldHistory(txns), [txns]);
  const avg = held.qty > 0 ? held.cost / held.qty : 0;
  const lastAccount = [...txns].sort((a, b) => b.ts - a.ts)[0]?.accountId;

  const [type, setType] = useState<"buy" | "sell">("buy");
  const [accountId, setAccountId] = useState(lastAccount ?? data.accounts[0]?.id ?? "");
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [vals, setVals] = useState<Record<Field, string>>({ qty: "", price: "", total: "" });
  const [pair, setPair] = useState<Field[]>(["price"]);
  const [entryCur, setEntryCur] = useState<Currency>(cur);
  const [opened] = useState(() => Date.now());
  const [day, setDay] = useState<Day>("today");
  const [when, setWhen] = useState(() => toLocalInput(opened));
  const [priceFrom, setPriceFrom] = useState<PriceFrom>("live");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [lastRead, setLastRead] = useState("");
  const [typeChosen, setTypeChosen] = useState(false);
  /** For a buy when there's cash: was it paid from cash or with new money? Always asked. */
  const [funding, setFunding] = useState<"cash" | "new" | null>(null);
  const [reading, setReading] = useState<{ state: "idle" | "busy" | "done"; by?: "ai" | "device"; note?: string; unclear?: string | null; resolved?: ResolvedTrade }>({ state: "idle" });
  const closesRef = useRef<Promise<Candle[]> | null>(null);
  const [closes, setCloses] = useState<Candle[]>([]);
  const fieldsRef = useRef<HTMLDivElement>(null);

  // Daily closes, so a past date can use that day's price. Kept as a promise so reading can wait for it.
  useEffect(() => {
    if (!asset.symbol) return;
    const p = fetchHistory(asset, "1Y", true).catch(() => [] as Candle[]);
    closesRef.current = p;
    p.then(setCloses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);

  const fx = live.fx ?? 0;
  const fxMissing = entryCur !== cur && !fx;
  const toAsset = (n: number) => (entryCur === cur ? n : convert(n, entryCur, cur, fx || 1));
  const fromAsset = (n: number) => (entryCur === cur ? n : convert(n, cur, entryCur, fx || 1));

  // Today's live price stands in until the person types a price.
  const priceVal = vals.price || (day === "today" && priceFrom === "live" && live.price ? String(Number(live.price.toPrecision(8))) : "");

  // Any two of the three; the third is worked out.
  const derived = FIELDS.find((f) => !pair.includes(f)) ?? "total";
  let q = Number(vals.qty);
  let p = Number(priceVal);
  let tot = toAsset(Number(vals.total));
  if (derived === "total") tot = q * p;
  else if (derived === "qty") q = p > 0 ? tot / p : NaN;
  else p = q > 0 ? tot / q : NaN;
  const shown: Record<Field, string> = {
    qty: derived === "qty" ? tidy(q, 6) : vals.qty,
    price: derived === "price" ? tidy(p, 4) : priceVal,
    total: derived === "total" ? tidy(fromAsset(tot), 2) : vals.total,
  };

  const closeOnTs = (t: number) => (closes.length ? closeAt(closes, new Date(t).setHours(23, 59, 59, 999)) : null);
  const ts = new Date(when).getTime();
  const heldAt = (id: string) => held.byAccount[id] ?? 0;

  function edit(f: Field, v: string) {
    if (f === "price") setPriceFrom("you");
    if (f === "qty") setLegs(null);
    setVals((s) => ({ ...s, [f]: clean(v) }));
    setPair((pr) => [f, ...pr.filter((x) => x !== f)].slice(0, 2) as Field[]);
    setError("");
  }
  function setPrice(v: number | null, from: PriceFrom) {
    if (!v) return;
    setVals((s) => ({ ...s, price: String(Number(v.toPrecision(8))) }));
    setPair((pr) => (pr.includes("price") ? pr : (["price", ...pr].slice(0, 2) as Field[])));
    setPriceFrom(from);
  }
  function setQty(v: number) {
    setLegs(null);
    setVals((s) => ({ ...s, qty: tidy(v, 8) }));
    setPair((pr) => ["qty", ...pr.filter((x) => x !== "qty")].slice(0, 2) as Field[]);
  }
  const marketTime = asset.cls === "in_stock" ? "15:30" : "12:00";
  function pickDay(d: Day) {
    setDay(d);
    let next = toLocalInput(clock());
    if (d === "yesterday") next = `${ymd(new Date(clock() - DAY))}T${marketTime}`;
    if (d === "pick") next = when;
    setWhen(next);
    if (priceFrom === "live" || priceFrom === "close") {
      if (d === "today") setPrice(live.price, "live");
      else setPrice(closeOnTs(new Date(next).getTime()), "close");
    }
  }

  /** Put a worked-out trade into the form, so the card and the boxes always agree. */
  function apply(res: ResolvedTrade) {
    if (res.type) setType(res.type);
    const good = res.legs.filter((l) => (l.qty ?? 0) > 0) as Leg[];
    if (good.length > 1) setLegs(good);
    else setLegs(null);
    if (res.legs[0]) setAccountId(res.legs[0].accountId);

    const today = ymd(new Date(clock()));
    const yest = ymd(new Date(clock() - DAY));
    setDay(res.date === today ? "today" : res.date === yest ? "yesterday" : "pick");
    setWhen(res.date === today ? toLocalInput(clock()) : `${res.date}T${res.time ?? marketTime}`);

    const qty = res.legs.reduce((s, l) => s + (l.qty ?? 0), 0);
    if (res.totalCurrency) setEntryCur(res.totalCurrency);
    setVals({
      qty: qty > 0 ? tidy(qty, 8) : "",
      price: res.price ? String(Number(res.price.toPrecision(8))) : "",
      total: res.total && !(qty > 0 && res.price) ? String(res.total) : "",
    });
    if (qty > 0 && res.price) setPair(["qty", "price"]);
    else if (res.total && res.price) setPair(["total", "price"]);
    else if (qty > 0 && res.total) setPair(["qty", "total"]);
    else setPair(qty > 0 ? ["qty", "price"] : ["price"]);
    setPriceFrom(res.priceFrom ?? "live");
    setError("");
  }

  async function read() {
    const said = text.trim();
    if (!said) return;
    setLastRead(said);
    setReading({ state: "busy" });
    const accounts = data.accounts.map((a) => ({ id: a.id, name: a.name }));
    const brokerNames = accounts.map((a) => a.name);
    let r: ParsedTrade | null = null;
    let by: "ai" | "device" = "device";
    let note = "";
    if (ai.status?.enabled && (await ai.ensureConsent({ quiet: true }))) {
      try {
        const res = await fetch("/api/ai/parse-trade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: said,
            context: {
              holding: asset.name,
              ticker: asset.ticker,
              kind: CLASS_META[asset.cls].short,
              unit,
              pricedIn: cur,
              priceNow: live.price,
              averageCost: avg || null,
              unitsHeld: held.qty,
              heldByBroker: Object.fromEntries(accounts.filter((a) => heldAt(a.id) > 0).map((a) => [a.name, heldAt(a.id)])),
              brokers: brokerNames,
              today: ymd(new Date(clock())),
              weekday: new Date(clock()).toLocaleDateString("en-US", { weekday: "long" }),
            },
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        r = json as ParsedTrade;
        by = "ai";
      } catch (err) {
        note = `AI wasn't available (${(err as Error).message || "no answer"}), so Folio read it on this device.`;
      }
    }
    if (!r) r = parseTradeLocally(said, brokerNames, new Date(clock()));
    // A past date needs that day's close; wait for the price history if it's still loading.
    const candles = closesRef.current ? await closesRef.current : [];
    const resolved = resolveTrade(
      r,
      {
        today: ymd(new Date(clock())),
        accounts,
        heldBy: held.byAccount,
        currentAccountId: accountId,
        livePrice: live.price,
        avg,
        closeOn: (d) => (candles.length ? closeAt(candles, new Date(`${d}T23:59:59`).getTime()) : null),
        heldOn: history.heldOn,
        firstDateWith: history.firstDateWith,
      },
      cur,
      live.fx,
    );
    apply(resolved);
    if (r.paidFrom) setFunding(r.paidFrom);
    setReading({ state: "done", by, note, unclear: r.unclear && resolved.missing.length ? r.unclear : null, resolved });
  }

  const account = data.accounts.find((a) => a.id === accountId);
  const heldHere = heldAt(accountId);
  const valid = q > 0 && p > 0 && isFinite(q) && isFinite(p);
  const activeLegs: Leg[] = legs ?? (valid ? [{ accountId, qty: q }] : []);
  const legProblem = type === "sell" ? activeLegs.find((l) => l.qty > heldAt(l.accountId) && !near(l.qty, heldAt(l.accountId))) : undefined;
  const newAvg = type === "buy" && valid ? (held.cost + q * p) / (held.qty + q) : null;
  const realised = type === "sell" && valid && avg ? q * (p - avg) : null;
  const closesAll = type === "sell" && valid && activeLegs.every((l) => near(l.qty, heldAt(l.accountId))) && near(q, held.qty);
  const pending = text.trim() !== "" && text.trim() !== lastRead;
  const cashHere = cashBalances(data)[cur];
  const askFunding = type === "buy" && cashHere > 0;
  const fromCash = askFunding && funding === "cash" ? Math.min(cashHere, valid ? q * p : 0) : 0;

  function problemFor(l: Leg) {
    const h = heldAt(l.accountId);
    const name = data.accounts.find((a) => a.id === l.accountId)?.name ?? "this broker";
    return h > 0 ? `You hold ${fmtQty(h)} ${unit} on ${name}, so you can't sell ${fmtQty(l.qty)}.` : `You don't hold any on ${name}. Pick the broker where you hold it.`;
  }

  function commit() {
    if (fxMissing) return setError("The exchange rate hasn't loaded yet. Try again in a moment.");
    if (!(q > 0) || !isFinite(q)) return setError(`Enter how many ${unit}, or the total and price.`);
    if (!(p > 0) || !isFinite(p)) return setError("Enter the price per unit, or the total.");
    if (!isFinite(ts) || ts > clock() + 60_000) return setError("That date is in the future.");
    if (legProblem) return setError(problemFor(legProblem));
    if (askFunding && !funding) return setError("Say whether you paid from your cash or with new money.");
    if (type === "sell") {
      // Trades replay in date order: a sale before Folio's record of the purchase wouldn't count.
      const d = ymd(new Date(ts));
      for (const l of activeLegs) {
        if (l.qty > history.heldOn(d, l.accountId) * (1 + 1e-7) + 1e-9) {
          const first = history.firstDateWith(l.accountId, l.qty);
          return setError(
            first
              ? `Folio's records only show these units from ${new Date(`${first}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} (when they were added). Pick that date or later.`
              : problemFor(l),
          );
        }
      }
    }
    if (!asset.symbol) updateAsset(asset.id, { manualPrice: { price: p, ts } });
    for (const l of activeLegs) {
      // Selling (almost exactly) everything closes the position, without leaving rounding dust.
      const units = type === "sell" && near(l.qty, heldAt(l.accountId)) ? heldAt(l.accountId) : l.qty;
      addTxn({ assetId: asset.id, accountId: l.accountId, type, qty: units, price: p, ts, opening: false }, { fromCash: askFunding && funding === "cash" });
    }
    onSaved?.(type === "buy" ? "Purchase added" : "Sale added");
    onClose();
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    // A sentence that hasn't been read yet is read first, then shown for confirmation.
    if (pending) return void read();
    commit();
  }

  const sym = (c: Currency) => (c === "INR" ? "₹" : "$");
  const chip = (on: boolean) =>
    `press inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`;
  const fieldCls = (f: Field) => `field num text-[17px] font-bold transition-colors ${derived === f ? "bg-sunken/70 text-ink-2" : ""}`;
  const whenLabel = new Date(ts).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const brokerLabel = activeLegs.length > 1 ? activeLegs.map((l) => `${data.accounts.find((a) => a.id === l.accountId)?.name} ${fmtQty(l.qty)}`).join(" + ") : (account?.name ?? "");

  const showCard = reading.state === "done" && !pending;
  const missing = showCard ? [...(reading.resolved?.missing ?? [])].filter((m) => (m === "quantity" ? !(q > 0) : m === "price" ? !(p > 0) : m === "type" ? !reading.resolved?.type && !typeChosen : true)) : [];
  const fundingChips = (
    <>
      <button type="button" className={chip(funding === "cash")} onClick={() => (setFunding("cash"), setError(""))}>
        From my cash ({money(cashHere, cur)})
      </button>
      <button type="button" className={chip(funding === "new")} onClick={() => (setFunding("new"), setError(""))}>
        New money
      </button>
    </>
  );
  const fundingNote =
    funding === "cash" && valid
      ? fromCash < q * p
        ? `${money(fromCash, cur)} comes out of cash (all of it); the other ${money(q * p - fromCash, cur)} counts as new money.`
        : `${money(fromCash, cur)} comes out of cash, leaving ${money(cashHere - fromCash, cur)}.`
      : null;

  return (
    <Modal title="Add a trade" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-2xl bg-sunken p-3 ring-1 ring-line">
          <ClassGlyph cls={asset.cls} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{asset.name}</p>
            <p className="num text-xs text-ink-2">
              {live.price !== null ? `${fmtPrice(live.price, cur)} now` : CLASS_META[asset.cls].short}
              {held.qty > 0 && ` · you hold ${fmtQty(held.qty)} ${unit}`}
            </p>
          </div>
        </div>

        {/* Describe it in your own words */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void read();
          }}
        >
          <label htmlFor="say" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent" aria-hidden>
              <path d="M8 1.5l1.3 3.6L13 6.5l-3.7 1.4L8 11.5 6.7 7.9 3 6.5l3.7-1.4zM12.5 10l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.6-.6 1.6-.6z" />
            </svg>
            Tell Folio what you did
            <span className="font-normal text-ink-3">— or fill the boxes below</span>
          </label>
          <div className={`field-wrap flex items-center gap-2 rounded-2xl border bg-surface p-1.5 pl-4 transition-shadow ${reading.state === "busy" ? "border-accent shadow-[0_0_0_4px_var(--accent-soft)]" : "border-line"}`}>
            <input
              id="say"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`e.g. “${EXAMPLES[0]}”`}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!text.trim() || reading.state === "busy"}
              aria-label="Read what I typed"
              className="press grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"
            >
              {reading.state === "busy" ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              )}
            </button>
          </div>
          {reading.state === "idle" && !text && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full bg-sunken px-2.5 py-1 text-[11px] text-ink-2 hover:text-ink">
                  {ex}
                </button>
              ))}
            </div>
          )}
          {reading.state === "busy" && <p className="mt-2 text-xs text-ink-3">Working out the trade…</p>}
        </form>

        {/* What Folio understood, ready to confirm */}
        {showCard && (
          <section className="pop-in overflow-hidden rounded-[22px] ring-1 ring-accent/40" aria-live="polite">
            <div className="bg-accent-soft px-4 py-3.5">
              <p className="text-[11px] font-semibold text-accent">Here&apos;s what I understood</p>
              {reading.unclear && missing.length ? (
                <p className="mt-1 text-[15px] font-bold leading-snug">{reading.unclear}</p>
              ) : (
                <p className="num mt-1 text-[17px] font-extrabold leading-snug">
                  {type === "sell" ? "Sold" : "Bought"}{" "}
                  {valid ? (
                    <>
                      {closesAll ? "all " : ""}
                      {fmtQty(q)} {unit}
                    </>
                  ) : (
                    unit
                  )}{" "}
                  of {asset.name}
                </p>
              )}
            </div>
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-3 bg-surface px-4 py-3.5 text-[13px]">
              <Fact label="Price each" value={p > 0 ? fmtPrice(p, cur) : "—"} sub={p > 0 ? PRICE_NOTE[priceFrom] : "needed"} />
              <Fact label={type === "sell" ? "Total received" : "Total paid"} value={valid ? money(q * p, cur) : "—"} />
              <Fact label="When" value={whenLabel} sub={day === "today" ? "today" : day === "yesterday" ? "yesterday" : ""} />
              <Fact label={activeLegs.length > 1 ? "Brokers" : "Broker"} value={brokerLabel} />
            </dl>
            {(realised !== null || newAvg !== null) && valid && !legProblem && (
              <p className="num border-t border-line bg-surface px-4 py-2.5 text-xs text-ink-2">
                {type === "sell" && realised !== null ? (
                  <>
                    Gain on these: <b className={realised >= 0 ? "text-up" : "text-down"}>{signed(realised, cur)}</b> ({pct((p / avg - 1) * 100)}).
                    {closesAll ? " This closes your position." : ` You'll have ${fmtQty(held.qty - q)} ${unit} left.`}
                  </>
                ) : (
                  newAvg !== null && held.qty > 0 && (
                    <>
                      Your average cost goes from {fmtPrice(avg, cur)} to <b className="text-ink">{fmtPrice(newAvg, cur)}</b>.
                    </>
                  )
                )}
              </p>
            )}

            {type === "sell" && valid && !legProblem && (
              <p className="num border-t border-line bg-surface px-4 py-2.5 text-xs text-ink-2">
                <b className="text-ink">{money(q * p, cur)}</b> goes into your cash.
              </p>
            )}
            {askFunding && (
              <div className="border-t border-line bg-surface px-4 py-3.5">
                <Ask q="Where did the money come from?">{fundingChips}</Ask>
                {fundingNote && <p className="num mt-1.5 text-[11px] text-ink-3">{fundingNote}</p>}
              </div>
            )}

            {/* Only what's genuinely missing is asked */}
            {(missing.length > 0 || legProblem) && (
              <div className="space-y-2.5 border-t border-line bg-surface px-4 py-3.5">
                {legProblem && <p className="text-[13px] font-semibold text-down">{problemFor(legProblem)}</p>}
                {missing.includes("type") && (
                  <Ask q="Did you buy or sell?">
                    <button type="button" className={chip(false)} onClick={() => (setType("buy"), setTypeChosen(true))}>
                      I bought
                    </button>
                    <button type="button" className={chip(false)} onClick={() => (setType("sell"), setTypeChosen(true))}>
                      I sold
                    </button>
                  </Ask>
                )}
                {missing.includes("quantity") && (
                  <Ask q={`How many ${unit}?`}>
                    {type === "sell" && held.qty > 0 && (
                      <>
                        <button type="button" className={chip(false)} onClick={() => setQty(heldHere || held.qty)}>
                          All {fmtQty(heldHere || held.qty)}
                        </button>
                        <button type="button" className={chip(false)} onClick={() => setQty((heldHere || held.qty) / 2)}>
                          Half
                        </button>
                      </>
                    )}
                    <button type="button" className={chip(false)} onClick={() => fieldsRef.current?.querySelector<HTMLInputElement>("#t-qty")?.focus()}>
                      Type it
                    </button>
                  </Ask>
                )}
                {missing.includes("price") && (
                  <Ask q="At what price?">
                    {live.price !== null && (
                      <button type="button" className={chip(false)} onClick={() => setPrice(live.price, "live")}>
                        Today&apos;s {fmtPrice(live.price, cur)}
                      </button>
                    )}
                    {avg > 0 && (
                      <button type="button" className={chip(false)} onClick={() => setPrice(avg, "avg")}>
                        My average {fmtPrice(avg, cur)}
                      </button>
                    )}
                    <button type="button" className={chip(false)} onClick={() => fieldsRef.current?.querySelector<HTMLInputElement>("#t-price")?.focus()}>
                      Type it
                    </button>
                  </Ask>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
              <Button onClick={commit} disabled={!valid || !!legProblem || missing.length > 0 || (askFunding && !funding)} className="flex-1">
                Confirm and save
              </Button>
              <Button variant="quiet" onClick={() => fieldsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Change details
              </Button>
            </div>
            <p className="bg-surface px-4 pb-3 text-[11px] text-ink-3">
              {reading.by === "ai" ? `Read by ${ai.status?.model ?? "AI"}; Folio worked out the numbers from your holding.` : reading.note || "Read on this device."}
            </p>
          </section>
        )}

        <form onSubmit={save} className="space-y-5">
          <div ref={fieldsRef} className="scroll-mt-4">
            <Segmented
              options={[
                { value: "buy", label: "Bought" },
                { value: "sell", label: "Sold" },
              ]}
              value={type}
              onChange={(t) => (setType(t), setTypeChosen(true), setError(""))}
              label="Trade type"
            />
          </div>

          {/* Any two of three */}
          <div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1.2fr]">
              <div>
                <label htmlFor="t-qty" className="mb-1.5 block text-[13px] font-semibold capitalize">
                  {unit}
                </label>
                <input id="t-qty" className={fieldCls("qty")} inputMode="decimal" placeholder="0" value={shown.qty} onChange={(e) => edit("qty", e.target.value)} />
              </div>
              <span className="pb-3 text-ink-3" aria-hidden>
                ×
              </span>
              <div>
                <label htmlFor="t-price" className="mb-1.5 block text-[13px] font-semibold">
                  Price each ({sym(cur)})
                </label>
                <input id="t-price" className={fieldCls("price")} inputMode="decimal" placeholder="0.00" value={shown.price} onChange={(e) => edit("price", e.target.value)} />
              </div>
              <span className="hidden pb-3 text-ink-3 sm:block" aria-hidden>
                =
              </span>
              <div className="col-span-3 sm:col-span-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="t-total" className="text-[13px] font-semibold">
                    {type === "buy" ? "Total paid" : "Total received"}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = entryCur === "INR" ? "USD" : "INR";
                      if (vals.total && fx) setVals((s) => ({ ...s, total: tidy(convert(Number(s.total), entryCur, next, fx), 2) }));
                      setEntryCur(next);
                    }}
                    className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
                    aria-label={`Total is in ${entryCur}. Switch currency`}
                  >
                    {sym(entryCur)} {entryCur} ⇄
                  </button>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[17px] font-bold text-ink-3">{sym(entryCur)}</span>
                  <input id="t-total" className={fieldCls("total")} style={{ paddingLeft: 34 }} inputMode="decimal" placeholder="0" value={shown.total} onChange={(e) => edit("total", e.target.value)} />
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-3">
              Fill any two — Folio works out the {derived === "qty" ? unit : derived === "price" ? "price" : "total"} (the shaded box).
              {entryCur !== cur && fx ? ` Converted at $1 = ₹${fx.toFixed(2)}.` : ""}
            </p>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {type === "sell" && heldHere > 0 && (
                <>
                  <button type="button" className={chip(valid && near(q, heldHere))} onClick={() => setQty(heldHere)}>
                    All {fmtQty(heldHere)}
                  </button>
                  <button type="button" className={chip(valid && near(q, heldHere / 2))} onClick={() => setQty(heldHere / 2)}>
                    Half
                  </button>
                  <button type="button" className={chip(valid && near(q, heldHere / 4))} onClick={() => setQty(heldHere / 4)}>
                    Quarter
                  </button>
                  <span className="mx-0.5 w-px self-stretch bg-line" aria-hidden />
                </>
              )}
              {live.price !== null && (
                <button type="button" className={chip(priceFrom === "live")} onClick={() => setPrice(live.price, "live")}>
                  Today&apos;s price
                </button>
              )}
              {day !== "today" && closeOnTs(ts) && (
                <button type="button" className={chip(priceFrom === "close")} onClick={() => setPrice(closeOnTs(ts), "close")}>
                  Close that day {fmtPrice(closeOnTs(ts)!, cur)}
                </button>
              )}
              {avg > 0 && (
                <button type="button" className={chip(priceFrom === "avg")} onClick={() => setPrice(avg, "avg")}>
                  My average {fmtPrice(avg, cur)}
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-semibold">When</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={chip(day === "today")} onClick={() => pickDay("today")}>
                Today
              </button>
              <button type="button" className={chip(day === "yesterday")} onClick={() => pickDay("yesterday")}>
                Yesterday
              </button>
              <button type="button" className={chip(day === "pick")} onClick={() => pickDay("pick")}>
                Pick a date
              </button>
              {day === "pick" && (
                <input
                  type="datetime-local"
                  aria-label="Date and time of the trade"
                  className="field num item-in h-9 w-auto py-0 text-[13px]"
                  max={toLocalInput(opened + 12 * 3600_000)}
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    if (priceFrom === "close" || priceFrom === "live") setPrice(closeOnTs(new Date(e.target.value).getTime()), "close");
                  }}
                />
              )}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-semibold">Held with</p>
            <div role="radiogroup" aria-label="Broker or exchange" className="flex flex-wrap gap-1.5">
              {data.accounts.map((a) => {
                const on = legs ? legs.some((l) => l.accountId === a.id) : a.id === accountId;
                const h = heldAt(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => (setAccountId(a.id), setLegs(null), setError(""))}
                    className={`press inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold ${on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:text-ink"}`}
                  >
                    {a.name}
                    {h > 0 && <span className="num text-[11px] font-medium text-ink-3">{fmtQty(h)}</span>}
                  </button>
                );
              })}
            </div>
            {legs && <p className="mt-1.5 text-[11px] text-ink-3">Selling at each broker where you hold it. Tap one broker to sell only there.</p>}
          </div>

          {askFunding && !showCard && (
            <div>
              <p className="mb-1.5 text-[13px] font-semibold">Paid from</p>
              <div className="flex flex-wrap gap-1.5">{fundingChips}</div>
              {fundingNote && <p className="num mt-1.5 text-[11px] text-ink-3">{fundingNote}</p>}
            </div>
          )}
          {type === "sell" && !showCard && valid && (
            <p className="num text-[12px] text-ink-3">The {money(q * p, cur)} you receive goes into your cash.</p>
          )}

          {error && (
            <p role="alert" className="text-[13px] font-semibold text-down">
              {error}
            </p>
          )}

          <Button type="submit" variant={showCard ? "ghost" : "primary"} className="h-[52px] w-full text-[15px]" disabled={reading.state === "busy"}>
            {pending ? "Read what I typed" : type === "buy" ? "Save purchase" : "Save sale"}
            {!pending && valid ? ` of ${fmtQty(q)} ${unit}` : ""}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="truncate font-bold">{value}</dd>
      {sub && <dd className="truncate text-[11px] text-ink-3">{sub}</dd>}
    </div>
  );
}

function Ask({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold">{q}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
