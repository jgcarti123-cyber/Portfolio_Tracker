"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money, pct, price as fmtPrice, qty as fmtQty, signed, toLocalInput } from "@/lib/format";
import { convert } from "@/lib/portfolio";
import { searchAssets } from "@/lib/prices";
import { useStore } from "@/lib/store";
import {
  CLASS_META,
  CLASS_ORDER,
  quoteKey,
  type Asset,
  type AssetClass,
  type Currency,
  type Quote,
  type SearchHit,
} from "@/lib/types";
import { Button, Delta, Icon, Modal, MoneyInput, Segmented } from "./ui";

type Picked = Omit<Asset, "id">;
type LiveState = {
  status: "idle" | "loading" | "ready" | "missing";
  price: number | null;
  /** USD -> INR rate, for amounts typed in the other currency. */
  fx: number | null;
};

const DEFAULT_ACCOUNT: Record<AssetClass, string> = {
  in_stock: "groww",
  mf: "groww",
  us_stock: "indmoney",
  crypto: "coindcx",
};

/** Live price for the chosen instrument, or "missing" if the feed has nothing. */
export function useLivePrice(picked: Picked | null): LiveState {
  const [state, setState] = useState<LiveState>({ status: "idle", price: null, fx: null });
  useEffect(() => {
    if (!picked) {
      setState({ status: "idle", price: null, fx: null });
      return;
    }
    let alive = true;
    const hasFeed = !!picked.symbol;
    setState((s) => ({ status: hasFeed ? "loading" : "idle", price: null, fx: s.fx }));
    // Asked even without a feed: the response also carries the USD/INR rate.
    fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: hasFeed ? [{ cls: picked.cls, symbol: picked.symbol, currency: picked.currency }] : [],
      }),
    })
      .then((r) => r.json())
      .then((r: { quotes: Record<string, Quote>; usdInr: number | null }) => {
        if (!alive) return;
        const q = hasFeed ? r.quotes[quoteKey(picked)] : undefined;
        setState({
          status: !hasFeed ? "idle" : q ? "ready" : "missing",
          price: q?.price ?? null,
          fx: r.usdInr,
        });
      })
      .catch(
        () => alive && setState((s) => ({ status: hasFeed ? "missing" : "idle", price: null, fx: s.fx })),
      );
    return () => {
      alive = false;
    };
  }, [picked]);
  return state;
}

export function ClassGlyph({ cls, size = 40 }: { cls: AssetClass; size?: number }) {
  const color = CLASS_META[cls].color;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[13px] font-extrabold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {CLASS_META[cls].glyph}
    </span>
  );
}

export function AddHolding({ onClose, onSaved }: { onClose: () => void; onSaved?: (message: string) => void }) {
  return <Wizard onClose={onClose} onSaved={onSaved} />;
}

/* ------------------------------------------------------------------------ */
/* New holding: what -> where -> how much                                     */
/* ------------------------------------------------------------------------ */

function Wizard({ onClose, onSaved }: { onClose: () => void; onSaved?: (m: string) => void }) {
  const { data, addAccount, upsertAsset, updateAsset, addTxn } = useStore();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  const [cls, setCls] = useState<AssetClass>("in_stock");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [byHand, setByHand] = useState(false);
  const [handName, setHandName] = useState("");
  const [handCur, setHandCur] = useState<Currency>("INR");

  const [accountId, setAccountId] = useState<string>("");
  const [newAccount, setNewAccount] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);

  const [invested, setInvested] = useState("");
  const [worth, setWorth] = useState("");
  const [units, setUnits] = useState("");
  const [since, setSince] = useState("");
  const [showSince, setShowSince] = useState(false);
  const [entryCur, setEntryCur] = useState<Currency>("INR");
  const [error, setError] = useState("");

  const live = useLivePrice(picked);
  const go = (to: number) => {
    setDir(to > step ? "fwd" : "back");
    setError("");
    setStep(to);
  };

  useEffect(() => {
    if (picked || byHand || query.trim().length < 2) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError("");
      searchAssets(query, cls, ctrl.signal)
        .then(setHits)
        .catch((e) => {
          if (e.name !== "AbortError") setSearchError("Search isn't responding right now.");
        })
        .finally(() => setSearching(false));
    }, 260);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, cls, picked, byHand]);

  function choose(asset: Picked) {
    setPicked(asset);
    setEntryCur(asset.currency);
    const preferred = DEFAULT_ACCOUNT[asset.cls];
    setAccountId(data.accounts.some((a) => a.id === preferred) ? preferred : "");
    go(1);
  }

  const currency = picked?.currency ?? "INR";
  const noFeed = !!picked && !picked.symbol;
  const needUnits = !!picked?.symbol && live.status === "missing";
  // Amounts can be typed in either currency; they're stored in the asset's own.
  const crossCurrency = entryCur !== currency;
  const fxMissing = crossCurrency && !live.fx;
  const toAsset = (raw: string) => (fxMissing ? NaN : convert(Number(raw), entryCur, currency, live.fx ?? 1));
  const nInvested = toAsset(invested);
  const nWorth = toAsset(worth);
  const nUnits = Number(units);

  // Units and average cost fall out of the two amounts and the live price.
  const derived = useMemo(() => {
    if (!picked) return null;
    if (noFeed) return nWorth > 0 ? { qty: 1, avg: nInvested, price: nWorth } : null;
    if (needUnits) return nUnits > 0 ? { qty: nUnits, avg: nInvested / nUnits, price: null } : null;
    if (live.price && nWorth > 0) {
      const q = nWorth / live.price;
      return { qty: q, avg: nInvested / q, price: live.price };
    }
    return null;
  }, [picked, noFeed, needUnits, live.price, nInvested, nWorth, nUnits]);

  const gain = !needUnits && nWorth > 0 && invested !== "" ? nWorth - nInvested : null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    if (fxMissing) return setError("The exchange rate hasn't loaded yet. Try again in a moment.");
    if (invested === "" || nInvested < 0) return setError("Enter how much you put in.");
    if (!needUnits && !(nWorth > 0)) return setError("Enter what it's worth today.");
    if (needUnits && !(nUnits > 0)) return setError("Enter how many units you hold.");
    if (!derived) return setError("Still fetching the live price. Give it a second.");
    const ts = showSince && since ? new Date(since).getTime() : Date.now();
    if (!isFinite(ts) || ts > Date.now() + 60_000) return setError("That date is in the future.");

    const account = data.accounts.find((a) => a.id === accountId) ?? addAccount(newAccount);
    const asset = upsertAsset(picked);
    if (noFeed) updateAsset(asset.id, { manualPrice: { price: nWorth, ts: Date.now() } });
    addTxn({ assetId: asset.id, accountId: account.id, type: "buy", qty: derived.qty, price: derived.avg, ts });
    onSaved?.(`${picked.name} added`);
    onClose();
  }

  const titles = ["What do you own?", "Where do you hold it?", "How much is it?"];

  return (
    <Modal
      title="Add a holding"
      onClose={onClose}
      header={
        <div className="flex min-w-0 items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => go(step - 1)}
              className="press grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink"
            >
              {Icon.back}
            </button>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-3">Step {step + 1} of 3</p>
            <h2 className="truncate text-xl font-extrabold tracking-tight">{titles[step]}</h2>
          </div>
        </div>
      }
    >
      <div className="mb-6 flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-accent transition-transform duration-500 ease-out-quint"
              style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transformOrigin: "left" }}
            />
          </span>
        ))}
      </div>

      {picked && step > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl bg-sunken p-3 ring-1 ring-line">
          <ClassGlyph cls={picked.cls} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{picked.name}</p>
            <p className="num text-xs text-ink-2">
              {CLASS_META[picked.cls].short}
              {live.status === "ready" && live.price !== null && (
                <> · {fmtPrice(live.price, picked.currency)} now</>
              )}
              {live.status === "loading" && <> · fetching price…</>}
            </p>
          </div>
        </div>
      )}

      <div key={step} className={dir === "fwd" ? "step-fwd" : "step-back"}>
        {/* ------------------------------ Step 1 ------------------------------ */}
        {step === 0 && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Asset type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CLASS_ORDER.map((c) => {
                const on = c === cls;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setCls(c);
                      setQuery("");
                      setHits(null);
                      setByHand(false);
                      setHandCur(c === "us_stock" || c === "crypto" ? "USD" : "INR");
                    }}
                    className={`press flex flex-col items-start gap-2.5 rounded-[18px] border p-3 text-left ${
                      on ? "border-accent bg-accent-soft" : "border-line hover:border-ink-3"
                    }`}
                  >
                    <ClassGlyph cls={c} size={34} />
                    <span>
                      <span className="block text-[13px] font-bold leading-tight">{CLASS_META[c].short}</span>
                      <span className="block text-[11px] text-ink-2">{CLASS_META[c].hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {byHand ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="field"
                    aria-label="Name"
                    placeholder="Name it, e.g. Unlisted Acme shares"
                    value={handName}
                    onChange={(e) => setHandName(e.target.value)}
                  />
                  <Segmented
                    options={[
                      { value: "INR", label: "₹" },
                      { value: "USD", label: "$" },
                    ]}
                    value={handCur}
                    onChange={setHandCur}
                    label="Currency"
                  />
                </div>
                <p className="text-xs leading-relaxed text-ink-3">
                  There&apos;s no live price for things added by hand. You tell Folio what it&apos;s worth and
                  update it when that changes.{" "}
                  <button type="button" className="font-semibold text-accent" onClick={() => setByHand(false)}>
                    Search instead
                  </button>
                </p>
                <Button
                  className="h-12 w-full text-sm"
                  disabled={!handName.trim()}
                  onClick={() =>
                    choose({
                      cls,
                      symbol: "",
                      ticker: handName.trim().slice(0, 6).toUpperCase(),
                      name: handName.trim(),
                      currency: handCur,
                    })
                  }
                >
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <div className="field-wrap flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-ink-3 transition-shadow">
                  {Icon.search}
                  <input
                    autoFocus
                    aria-label={`Search ${CLASS_META[cls].label}`}
                    className="w-full min-w-0 bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-3"
                    placeholder={
                      cls === "mf" ? "Search a fund" : cls === "crypto" ? "Search a coin" : "Search a company or ticker"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {searching && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />}
                </div>

                {query.trim().length < 2 ? (
                  <div className="flex flex-wrap gap-2">
                    {CLASS_META[cls].popular.map((name, i) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setQuery(name)}
                        style={{ animationDelay: `${i * 35}ms` }}
                        className="item-in press rounded-full bg-sunken px-3.5 py-2 text-[13px] font-semibold text-ink-2 ring-1 ring-line hover:text-ink"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <ul className="max-h-[268px] space-y-1 overflow-y-auto">
                    {hits?.map((h, i) => (
                      <li key={h.symbol} className="item-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                        <button
                          type="button"
                          onClick={() => choose(h)}
                          className="press group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-sunken"
                        >
                          <ClassGlyph cls={h.cls} size={38} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{h.name}</span>
                            <span className="text-xs text-ink-2">
                              {h.cls === "mf" ? "Mutual fund" : h.ticker}
                              {h.exchange && ` · ${h.exchange}`}
                            </span>
                          </span>
                          <span className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <span className="rotate-180">{Icon.back}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {hits?.length === 0 && !searching && (
                      <li className="rounded-2xl bg-sunken p-4 text-sm text-ink-2">
                        Nothing matched “{query.trim()}”. Check the spelling, or add it by hand.
                      </li>
                    )}
                    {searchError && <li className="rounded-2xl bg-sunken p-4 text-sm text-ink-2">{searchError}</li>}
                  </ul>
                )}

                <p className="text-xs text-ink-3">
                  Not listed anywhere?{" "}
                  <button type="button" className="font-semibold text-accent" onClick={() => setByHand(true)}>
                    Add it by hand
                  </button>
                </p>
              </>
            )}
          </div>
        )}

        {/* ------------------------------ Step 2 ------------------------------ */}
        {step === 1 && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Broker or exchange" className="grid grid-cols-2 gap-2">
              {data.accounts.map((a, i) => {
                const on = a.id === accountId && !addingAccount;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    style={{ animationDelay: `${i * 40}ms` }}
                    onClick={() => {
                      setAddingAccount(false);
                      setAccountId(a.id);
                      go(2);
                    }}
                    className={`item-in press flex h-16 items-center justify-between gap-2 rounded-[18px] border px-4 text-left text-[15px] font-bold ${
                      on ? "border-accent bg-accent-soft" : "border-line hover:border-ink-3"
                    }`}
                  >
                    <span className="truncate">{a.name}</span>
                    {on && <span className="text-accent">{Icon.check}</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setAddingAccount(true)}
                className="press flex h-16 items-center gap-2 rounded-[18px] border border-dashed border-ink-3/60 px-4 text-[15px] font-semibold text-ink-2 hover:text-ink"
              >
                {Icon.plus} Another
              </button>
            </div>

            {addingAccount && (
              <form
                className="item-in flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newAccount.trim()) return;
                  setAccountId("");
                  go(2);
                }}
              >
                <input
                  autoFocus
                  className="field"
                  aria-label="Broker or exchange name"
                  placeholder="e.g. Zerodha, Binance, Kuvera"
                  value={newAccount}
                  onChange={(e) => setNewAccount(e.target.value)}
                />
                <Button type="submit" className="h-12 shrink-0 px-5" disabled={!newAccount.trim()}>
                  Next
                </Button>
              </form>
            )}
          </div>
        )}

        {/* ------------------------------ Step 3 ------------------------------ */}
        {step === 2 && picked && (
          <form onSubmit={save} className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="invested" className="text-[13px] font-semibold">
                  You put in
                </label>
                <Segmented
                  options={[
                    { value: "INR", label: "₹ INR" },
                    { value: "USD", label: "$ USD" },
                  ]}
                  value={entryCur}
                  onChange={setEntryCur}
                  label="Currency for these amounts"
                  size="sm"
                />
              </div>
              <MoneyInput id="invested" autoFocus value={invested} onChange={setInvested} currency={entryCur} />
            </div>

            {needUnits ? (
              <div>
                <label htmlFor="units" className="mb-1.5 block text-[13px] font-semibold">
                  {CLASS_META[picked.cls].unit[0].toUpperCase() + CLASS_META[picked.cls].unit.slice(1)} you hold
                </label>
                <input
                  id="units"
                  className="field num"
                  inputMode="decimal"
                  placeholder="0"
                  value={units}
                  onChange={(e) => setUnits(e.target.value.replace(/[^0-9.]/g, ""))}
                />
                <p className="mt-1.5 text-xs text-ink-3">
                  The live price for this one isn&apos;t available right now, so Folio needs the unit count.
                </p>
              </div>
            ) : (
              <div>
                <label htmlFor="worth" className="mb-1.5 block text-[13px] font-semibold">
                  It&apos;s worth today
                </label>
                <MoneyInput id="worth" value={worth} onChange={setWorth} currency={entryCur} />
              </div>
            )}

            <p className="text-xs leading-relaxed text-ink-3">
              Both numbers are on the holdings screen of your broker&apos;s app, usually labelled
              “Invested” and “Current”.
              {crossCurrency && (
                <>
                  {" "}
                  {picked.name} is priced in {currency === "USD" ? "dollars" : "rupees"}, so Folio converts
                  {live.fx ? ` at $1 = ₹${live.fx.toFixed(2)}.` : " once the exchange rate loads."}
                </>
              )}
            </p>

            {/* Live read-back of what those numbers mean. */}
            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out-quint ${
                derived && invested !== "" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0">
                <dl className="num grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-line text-center ring-1 ring-line">
                  <div className="bg-sunken px-2 py-3">
                    <dt className="text-[11px] text-ink-3">{noFeed ? "Held as" : "You hold"}</dt>
                    <dd className="mt-0.5 truncate text-sm font-bold">
                      {derived ? (noFeed ? "1 lot" : `${fmtQty(derived.qty)}`) : "–"}
                    </dd>
                  </div>
                  <div className="bg-sunken px-2 py-3">
                    <dt className="text-[11px] text-ink-3">Avg. cost</dt>
                    <dd className="mt-0.5 truncate text-sm font-bold">
                      {derived ? fmtPrice(derived.avg, currency) : "–"}
                    </dd>
                  </div>
                  <div className="bg-sunken px-2 py-3">
                    <dt className="text-[11px] text-ink-3">Return</dt>
                    <dd className="mt-0.5 flex justify-center">
                      {gain !== null ? (
                        <Delta value={gain}>{nInvested > 0 ? pct((gain / nInvested) * 100) : signed(gain, currency)}</Delta>
                      ) : (
                        "–"
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {showSince ? (
              <div className="item-in">
                <label htmlFor="since" className="mb-1.5 block text-[13px] font-semibold">
                  Held since
                </label>
                <input
                  id="since"
                  type="datetime-local"
                  className="field num"
                  max={toLocalInput(Date.now())}
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-ink-3">
                  Your net worth chart will include this holding from that date.
                </p>
              </div>
            ) : (
              <button
                type="button"
                className="text-[13px] font-semibold text-accent"
                onClick={() => {
                  setSince(toLocalInput(Date.now()));
                  setShowSince(true);
                }}
              >
                Set when you started holding it
              </button>
            )}

            {error && (
              <p role="alert" className="text-[13px] font-semibold text-down">
                {error}
              </p>
            )}

            <Button type="submit" className="h-[52px] w-full text-[15px]">
              Save holding
              {gain !== null && nWorth > 0 && <span className="num opacity-80">· {money(Number(worth), entryCur)}</span>}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
