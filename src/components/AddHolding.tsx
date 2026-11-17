"use client";

import { useEffect, useMemo, useState } from "react";
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
import { CASH_COLOR } from "@/lib/cash";
import { ScreenshotIcon } from "./ScreenshotImport";
import { Delta, Icon, Modal, MoneyInput, Segmented } from "./ui";

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

/** The sheet's primary action: the off-white pill from the masthead. */
function Cta({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`press cta-white streak-host relative inline-flex items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold tracking-[-0.005em] disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      <span className="streak-clip" aria-hidden />
      {children}
    </button>
  );
}

const CASH_TILE = { short: "Cash", hint: "Rupees or dollars", color: CASH_COLOR, glyph: Icon.wallet };

type Kind = AssetClass | "cash";

export function AddHolding({
  onClose,
  onSaved,
  onScreenshot,
  startWith,
}: {
  onClose: () => void;
  onSaved?: (message: string) => void;
  /** Opens the screenshot importer instead (closing this sheet). */
  onScreenshot?: () => void;
  /** Opens straight on a type, e.g. "cash" from the dashboard. */
  startWith?: Kind;
}) {
  return <Wizard onClose={onClose} onSaved={onSaved} onScreenshot={onScreenshot} startWith={startWith} />;
}

/* ------------------------------------------------------------------------ */
/* New holding: what -> where -> how much                                     */
/* ------------------------------------------------------------------------ */

function Wizard({
  onClose,
  onSaved,
  onScreenshot,
  startWith = "in_stock",
}: {
  onClose: () => void;
  onSaved?: (m: string) => void;
  onScreenshot?: () => void;
  startWith?: Kind;
}) {
  const { data, addAccount, upsertAsset, updateAsset, addTxn } = useStore();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  const [kind, setKind] = useState<Kind>(startWith);
  const cls: AssetClass = kind === "cash" ? "in_stock" : kind;
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
    if (kind === "cash" || picked || byHand || query.trim().length < 2) {
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
  }, [query, cls, kind, picked, byHand]);

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
    addTxn({ assetId: asset.id, accountId: account.id, type: "buy", qty: derived.qty, price: derived.avg, ts, opening: true, via: "added by hand" });
    onSaved?.(`${picked.name} added`);
    onClose();
  }

  const cash = kind === "cash";
  const titles: [string, string][] = cash
    ? [["Set aside", "some cash."]]
    : [
        ["What do", "you own?"],
        ["Where do", "you hold it?"],
        ["How much", "is it worth?"],
      ];
  const total = titles.length;
  const [lead, tail] = titles[Math.min(step, total - 1)];

  return (
    <Modal
      title={cash ? "Add cash" : "Add a holding"}
      tone="dark"
      width={600}
      onClose={onClose}
      header={
        <div className="flex min-w-0 items-center gap-3.5">
          {step > 0 && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => go(step - 1)}
              className="press pill grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink"
            >
              {Icon.back}
            </button>
          )}
          <div className="min-w-0">
            <p className="label flex items-center gap-2 text-ink-3">
              <span className="size-[5px] rounded-full bg-up shadow-[0_0_8px_var(--up)]" aria-hidden />
              {cash ? "Cash · One step" : `Step ${String(step + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`}
            </p>
            <h2 key={`${kind}-${step}`} className="rise-in mt-2 truncate font-display text-[34px] font-normal leading-[1] tracking-[-0.01em] sm:text-[40px]">
              {lead} <span className="italic text-ink-3">{tail}</span>
            </h2>
          </div>
        </div>
      }
    >
      <div className="mb-6 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="rail h-[2px] flex-1 overflow-hidden rounded-full">
            <span
              className="block h-full rounded-full transition-transform duration-700 ease-out-quint"
              style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transformOrigin: "left" }}
            />
          </span>
        ))}
      </div>

      {picked && step > 0 && (
        <div className="readout mb-5 flex items-center gap-3 rounded-2xl p-3">
          <ClassGlyph cls={picked.cls} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{picked.name}</p>
            <p className="num text-xs text-ink-2">
              {CLASS_META[picked.cls].short}
              {live.status === "ready" && live.price !== null && (
                <> · {fmtPrice(live.price, picked.currency)} now</>
              )}
              {live.status === "loading" && <> · fetching price…</>}
            </p>
          </div>
          {live.status === "ready" && (
            <span className="label flex items-center gap-1.5 text-[9.5px] text-up">
              <span className="size-[5px] animate-pulse rounded-full bg-up" aria-hidden /> Live
            </span>
          )}
        </div>
      )}

      <div key={step} className={dir === "fwd" ? "step-fwd" : "step-back"}>
        {/* ------------------------------ Step 1 ------------------------------ */}
        {step === 0 && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="What to add" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[...CLASS_ORDER, "cash" as const].map((c, i) => {
                const on = c === kind;
                const meta = c === "cash" ? CASH_TILE : CLASS_META[c];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    style={{ "--tile": meta.color, animationDelay: `${i * 45}ms` } as React.CSSProperties}
                    onClick={() => {
                      setKind(c);
                      setQuery("");
                      setHits(null);
                      setByHand(false);
                      setError("");
                      if (c !== "cash") setHandCur(c === "us_stock" || c === "crypto" ? "USD" : "INR");
                    }}
                    className={`tile item-in press flex flex-col items-start gap-3 rounded-[18px] p-3 text-left ${c === "cash" ? "max-sm:col-span-2 max-sm:flex-row max-sm:items-center" : ""}`}
                  >
                    {c === "cash" ? (
                      <span
                        aria-hidden
                        className="grid size-[34px] shrink-0 place-items-center rounded-[13px]"
                        style={{ color: CASH_COLOR, background: `color-mix(in srgb, ${CASH_COLOR} 14%, transparent)` }}
                      >
                        {CASH_TILE.glyph}
                      </span>
                    ) : (
                      <ClassGlyph cls={c} size={34} />
                    )}
                    <span>
                      <span className="block text-[13px] font-semibold leading-tight">{meta.short}</span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-ink-3">{meta.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {cash ? (
              <CashForm onSaved={onSaved} onClose={onClose} />
            ) : byHand ? (
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
                  <button type="button" className="font-semibold text-ink underline decoration-white/25 underline-offset-4 hover:decoration-white" onClick={() => setByHand(false)}>
                    Search instead
                  </button>
                </p>
                <Cta
                  className="h-12 w-full"
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
                </Cta>
              </div>
            ) : (
              <>
                <div className="field-wrap flex h-14 items-center gap-3 rounded-2xl border px-4 text-ink-3 transition-shadow">
                  {Icon.search}
                  <input
                    autoFocus
                    aria-label={`Search ${CLASS_META[cls].label}`}
                    className="w-full min-w-0 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
                    placeholder={
                      cls === "mf" ? "Search a fund" : cls === "crypto" ? "Search a coin" : "Search a company or ticker"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {searching && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/10 border-t-white/80" />}
                </div>

                {query.trim().length < 2 ? (
                  <div className="flex flex-wrap gap-2">
                    {CLASS_META[cls].popular.map((name, i) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setQuery(name)}
                        style={{ animationDelay: `${i * 35}ms` }}
                        className="item-in press pill rounded-full px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:text-ink"
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
                          className="press group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-white/[0.05]"
                        >
                          <ClassGlyph cls={h.cls} size={38} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{h.name}</span>
                            <span className="text-xs text-ink-3">
                              {h.cls === "mf" ? "Mutual fund" : h.ticker}
                              {h.exchange && ` · ${h.exchange}`}
                            </span>
                          </span>
                          <span className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <span className="rotate-180">{Icon.back}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {hits?.length === 0 && !searching && (
                      <li className="readout rounded-2xl p-4 text-sm text-ink-2">
                        Nothing matched “{query.trim()}”. Check the spelling, or add it by hand.
                      </li>
                    )}
                    {searchError && <li className="readout rounded-2xl p-4 text-sm text-ink-2">{searchError}</li>}
                  </ul>
                )}

                <p className="text-xs text-ink-3">
                  Not listed anywhere?{" "}
                  <button type="button" className="font-semibold text-ink underline decoration-white/25 underline-offset-4 hover:decoration-white" onClick={() => setByHand(true)}>
                    Add it by hand
                  </button>
                </p>

                {onScreenshot && (
                  <>
                    <div className="flex items-center gap-3 pt-1" aria-hidden>
                      <span className="h-px flex-1 bg-line" />
                      <span className="label text-[9.5px] text-ink-3">Or bring everything at once</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                    <button
                      type="button"
                      onClick={onScreenshot}
                      className="press pill streak-host group relative flex w-full items-center gap-3.5 rounded-[20px] p-3.5 text-left"
                    >
                      <span className="streak-clip" aria-hidden />
                      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-white/[0.06] text-ink ring-1 ring-white/10">
                        {ScreenshotIcon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[14.5px] font-semibold">Upload screenshots</span>
                          <span className="ai-tag label rounded-full px-2 py-[3px] text-[9px] text-ink-2">AI</span>
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">
                          Snap your broker&apos;s holdings screen. You check every row before it&apos;s added.
                        </span>
                      </span>
                      <span className="rotate-180 text-ink-3 transition-transform group-hover:-translate-x-0.5 group-hover:text-ink">{Icon.back}</span>
                    </button>
                  </>
                )}
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
                    style={{ "--tile": "#9db8ff", animationDelay: `${i * 40}ms` } as React.CSSProperties}
                    onClick={() => {
                      setAddingAccount(false);
                      setAccountId(a.id);
                      go(2);
                    }}
                    className="tile item-in press flex h-16 items-center justify-between gap-2 rounded-[18px] px-4 text-left text-[15px] font-semibold"
                  >
                    <span className="truncate">{a.name}</span>
                    {on && <span className="text-ink">{Icon.check}</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setAddingAccount(true)}
                className="press flex h-16 items-center gap-2 rounded-[18px] border border-dashed border-white/15 px-4 text-[15px] font-medium text-ink-2 transition-colors hover:border-white/30 hover:text-ink"
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
                <Cta type="submit" className="h-12 shrink-0" disabled={!newAccount.trim()}>
                  Next
                </Cta>
              </form>
            )}
          </div>
        )}

        {/* ------------------------------ Step 3 ------------------------------ */}
        {step === 2 && picked && (
          <form onSubmit={save} className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="invested" className="label text-ink-3">
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
                <label htmlFor="units" className="label mb-2 block text-ink-3">
                  {CLASS_META[picked.cls].unit} you hold
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
                <label htmlFor="worth" className="label mb-2 block text-ink-3">
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
                <dl className="readout num grid grid-cols-3 divide-x divide-white/[0.07] rounded-2xl text-center">
                  <div className="px-2 py-3">
                    <dt className="label text-[9.5px] text-ink-3">{noFeed ? "Held as" : "You hold"}</dt>
                    <dd className="mt-1 truncate text-sm font-semibold">
                      {derived ? (noFeed ? "1 lot" : `${fmtQty(derived.qty)}`) : "–"}
                    </dd>
                  </div>
                  <div className="px-2 py-3">
                    <dt className="label text-[9.5px] text-ink-3">Avg. cost</dt>
                    <dd className="mt-1 truncate text-sm font-semibold">
                      {derived ? fmtPrice(derived.avg, currency) : "–"}
                    </dd>
                  </div>
                  <div className="px-2 py-3">
                    <dt className="label text-[9.5px] text-ink-3">Return</dt>
                    <dd className="mt-1 flex justify-center">
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
                <label htmlFor="since" className="label mb-2 block text-ink-3">
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
                className="text-[13px] font-medium text-ink-2 underline decoration-white/25 underline-offset-4 hover:text-ink hover:decoration-white"
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

            <Cta type="submit" className="h-[52px] w-full text-[15px]">
              Save holding
              {gain !== null && nWorth > 0 && <span className="num opacity-60">· {money(Number(worth), entryCur)}</span>}
            </Cta>
          </form>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */
/* Cash: one step, money in                                                   */
/* ------------------------------------------------------------------------ */

type Day = "today" | "yesterday" | "pick";
const clock = () => Date.now();

function CashForm({ onSaved, onClose }: { onSaved?: (m: string) => void; onClose: () => void }) {
  const { addCash } = useStore();
  const [cur, setCur] = useState<Currency>("INR");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState<Day>("today");
  const [when, setWhen] = useState(() => toLocalInput(clock()));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0) || !isFinite(n)) return setError("Enter an amount.");
    const now = clock();
    const ts = day === "today" ? now : day === "yesterday" ? now - 86_400_000 : new Date(when).getTime();
    if (!isFinite(ts) || ts > now + 60_000) return setError("That date is in the future.");
    addCash({ currency: cur, amount: n, ts, kind: "added", note: note.trim() || undefined });
    onSaved?.(`Added ${money(n, cur)} cash`);
    onClose();
  }

  const chip = (on: boolean) =>
    `press inline-flex h-8 items-center rounded-full px-3.5 text-xs font-medium transition-colors ${on ? "bg-white text-[#0b0c0f]" : "pill text-ink-2 hover:text-ink"}`;

  return (
    <form onSubmit={save} className="item-in space-y-4 pt-1">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="cash-amount" className="label text-ink-3">
            Amount
          </label>
          <Segmented
            options={[
              { value: "INR", label: "₹ INR" },
              { value: "USD", label: "$ USD" },
            ]}
            value={cur}
            onChange={setCur}
            label="Cash currency"
            size="sm"
          />
        </div>
        <MoneyInput id="cash-amount" autoFocus value={amount} onChange={setAmount} currency={cur} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1 text-ink-3">When</span>
        <button type="button" className={chip(day === "today")} onClick={() => setDay("today")}>
          Today
        </button>
        <button type="button" className={chip(day === "yesterday")} onClick={() => setDay("yesterday")}>
          Yesterday
        </button>
        <button type="button" className={chip(day === "pick")} onClick={() => setDay("pick")}>
          Pick a date
        </button>
      </div>
      {day === "pick" && (
        <input
          type="datetime-local"
          aria-label="Date and time"
          className="field num item-in"
          max={toLocalInput(clock())}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      )}

      <input className="field" aria-label="Note" placeholder="Note, optional (e.g. Savings account, Groww wallet)" value={note} onChange={(e) => setNote(e.target.value)} />

      <p className="text-xs leading-relaxed text-ink-3">
        Cash counts towards your net worth, never as a gain or loss. Money from a sale lands here on its own.
      </p>

      {error && (
        <p role="alert" className="text-[13px] font-semibold text-down">
          {error}
        </p>
      )}

      <Cta type="submit" className="h-[52px] w-full text-[15px]">
        Add cash
        {Number(amount) > 0 && <span className="num opacity-60">· {money(Number(amount), cur)}</span>}
      </Cta>
    </form>
  );
}
