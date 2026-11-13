"use client";

import { useMemo, useState } from "react";
import { redactSheet, useAi } from "@/lib/ai";
import { money, qty as fmtQty } from "@/lib/format";
import { CLASS_FOR_IMPORT, SOURCES, type Source } from "@/lib/importers/guides";
import { chooseMapping, isUsable } from "@/lib/importers/choose";
import { checkMapping, extractHoldings } from "@/lib/importers/extract";
import { detectPreset, type Preset } from "@/lib/importers/presets";
import {
  FIELD_LABEL,
  guessColumns,
  inferClass,
  pickSheet,
  readHeader,
  readTables,
  refineColumns,
  type Field,
  type Table,
} from "@/lib/importers/table";
import { convert, replay } from "@/lib/portfolio";
import { useStore, type ImportRow } from "@/lib/store";
import { CLASS_META, quoteKey, type Asset, type AssetClass, type Currency, type Quote } from "@/lib/types";
import { Button, Icon, Modal, Segmented } from "./ui";

type Step = "source" | "upload" | "columns" | "review";
type Cols = Partial<Record<Field, number>>;

const CLASS_BY_BROKER: Record<string, AssetClass> = {
  groww: "in_stock",
  indmoney: "us_stock",
  coindcx: "crypto",
};

const FIELDS: Field[] = ["name", "ticker", "isin", "qty", "avg", "invested", "price", "value", "pnl"];

/** How each field reads in the "here's what was read" summary. */
const READ_AS: Record<Field, string> = {
  name: "Names",
  ticker: "Symbols",
  isin: "ISINs",
  qty: "Quantities",
  avg: "Average prices",
  invested: "Invested amounts",
  price: "Current prices",
  value: "Current values",
  pnl: "Profit / loss",
};

interface Resolved {
  symbol: string;
  ticker: string;
  name: string;
  currency: Currency;
}

interface ReviewRow {
  key: number;
  label: string;
  /** How the file itself wrote the holding, shown next to what it matched. */
  source: string;
  match: Resolved | null;
  qty: number;
  avg: number;
  invested: number;
  value: number | null;
  currency: Currency;
  ts: number;
  include: boolean;
  problem?: string;
}

type ReadBy = "preset" | "ai" | "guess" | "manual";

/** Everything the matching step needs, passed explicitly so a recognised file can go straight to review. */
interface Setup {
  table: Table;
  cols: Cols;
  cls: AssetClass;
  fileCur: Currency;
  accountName: string;
  dateCol?: number;
}

const headerOf = (t: Table) => readHeader(t.rows).labels;
const bodyOf = (t: Table) => t.rows.slice(readHeader(t.rows).index + 1);

export function ImportFlow({ onClose, onSaved }: { onClose: () => void; onSaved?: (m: string) => void }) {
  const { data, applyImport } = useStore();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<Source | null>(null);

  const firstClass = CLASS_BY_BROKER[data.accounts[0]?.id ?? ""] ?? "in_stock";
  const [accountName, setAccountName] = useState(data.accounts[0]?.name ?? "");
  const [otherAccount, setOtherAccount] = useState(false);
  const [cls, setCls] = useState<AssetClass>(firstClass);
  const [fileCur, setFileCur] = useState<Currency>(firstClass === "us_stock" ? "USD" : "INR");

  const [fileName, setFileName] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [sheet, setSheet] = useState(0);
  const [cols, setCols] = useState<Cols>({});
  const [preset, setPreset] = useState<Preset | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [resolving, setResolving] = useState(false);
  const [readBy, setReadBy] = useState<ReadBy>("manual");

  const ai = useAi();
  const [aiRead, setAiRead] = useState<{ state: "idle" | "loading" | "done" | "error"; note?: string }>({ state: "idle" });
  const [aiDateCol, setAiDateCol] = useState<number | undefined>(undefined);
  /** What the model chose, so each choice can be marked until the user changes it. */
  const [aiPicked, setAiPicked] = useState<{ fields: Cols; cls?: AssetClass; currency?: Currency } | null>(null);

  /** Asks the model which column is which; the user still checks the result before matching. */
  interface AiReading {
    cols: Cols;
    cls: AssetClass | null;
    currency: Currency | null;
    date?: number;
  }

  /** Asks the model which column is which. Returns null if declined or it failed. */
  async function readWithAi(t: Table): Promise<AiReading | null> {
    if (!(await ai.ensureConsent())) return null;
    setAiRead({ state: "loading" });
    try {
      const res = await fetch("/api/ai/read-sheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(redactSheet(headerOf(t), bodyOf(t))),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The AI couldn't read this sheet.");
      const { date, ...fields } = json.columns as Cols & { date?: number };
      setAiRead({ state: "done", note: json.notes });
      return { cols: fields, cls: json.assetClass, currency: json.currency, date };
    } catch (e) {
      setAiRead({ state: "error", note: e instanceof Error ? e.message : "The AI couldn't read this sheet." });
      return null;
    }
  }

  /** On the column step: put the AI's choices into the fields so the user can compare. */
  async function applyAiToColumns(t: Table) {
    const r = await readWithAi(t);
    if (!r) return;
    if (Object.keys(r.cols).length) setCols(r.cols);
    if (r.cls) setCls(r.cls);
    if (r.currency) setFileCur(r.currency);
    setAiDateCol(r.date);
    setAiPicked({ fields: r.cols, cls: r.cls ?? undefined, currency: r.currency ?? undefined });
  }

  /**
   * Reads an unknown sheet: Folio's own guess, plus the AI's if allowed, each tested
   * against the numbers (qty × price = value and so on). The reading that checks out wins.
   */
  async function readUnknown(t: Table, guess: Cols, guessCls: AssetClass, guessCur: Currency, account: string, withAi: boolean) {
    const reading = withAi ? await readWithAi(t) : null;
    const pick = chooseMapping(bodyOf(t), guess, reading?.cols ?? null);
    const useAi = pick.by === "ai" && reading;
    const nextCls = (useAi && reading.cls) || guessCls;
    const nextCur = (useAi && reading.currency) || guessCur;
    setCols(pick.cols);
    setCls(nextCls);
    setFileCur(nextCur);
    setAiDateCol(useAi ? reading.date : undefined);
    setAiPicked(useAi ? { fields: reading.cols, cls: reading.cls ?? undefined, currency: reading.currency ?? undefined } : null);
    if (!isUsable(pick.cols)) {
      setStep("columns");
      return;
    }
    setReadBy(useAi ? "ai" : "guess");
    await buildReview({ table: t, cols: pick.cols, cls: nextCls, fileCur: nextCur, accountName: account, dateCol: useAi ? reading.date : undefined });
  }

  const table = tables[sheet];
  const header = table ? headerOf(table) : [];
  const body = useMemo(() => (table ? bodyOf(table) : []), [table]);

  function pickBroker(name: string, id?: string) {
    setAccountName(name);
    const guess = id ? CLASS_BY_BROKER[id] : undefined;
    if (guess) {
      setCls(guess);
      setFileCur(guess === "us_stock" ? "USD" : "INR");
    }
  }

  async function onFile(file: File) {
    setError("");
    setReading(true);
    try {
      const all = (await readTables(file)).filter((t) => t.rows.length > 1);
      if (!all.length) throw new Error("That file looks empty. Check it has one row per holding.");
      setTables(all);
      setFileName(file.name);

      // A file Folio knows: set everything from it and go straight to review.
      // Look at every row, since summary blocks above the real header can look like a header too.
      const known = all
        .map((t, i) => {
          const at = t.rows.slice(0, 60).findIndex((r) => detectPreset(r));
          return at >= 0 ? { i, at, p: detectPreset(t.rows[at]) } : null;
        })
        .find((x) => x?.p);
      if (known?.p) {
        const p = known.p;
        all[known.i] = { ...all[known.i], rows: all[known.i].rows.slice(known.at) };
        setTables([...all]);
        const existing = data.accounts.find((a) => a.name.toLowerCase() === p.account.toLowerCase());
        const name = existing?.name ?? p.account;
        setSheet(known.i);
        setPreset(p);
        setCols(p.cols);
        setCls(p.cls);
        setFileCur(p.currency);
        setAccountName(name);
        setOtherAccount(false);
        setReadBy("preset");
        await buildReview({ table: all[known.i], cols: p.cols, cls: p.cls, fileCur: p.currency, accountName: name, dateCol: p.dateCol });
        return;
      }

      // Otherwise: the sheet that looks most like a holdings table, read by rules and (if allowed) AI.
      const best = pickSheet(all);
      const t = all[best];
      setPreset(null);
      setSheet(best);
      const guess = refineColumns(guessColumns(headerOf(t)), headerOf(t), bodyOf(t));
      const inferred = inferClass(headerOf(t), bodyOf(t));
      const guessCls = inferred ?? cls;
      const guessCur: Currency = inferred ? "INR" : fileCur;
      setAiRead({ state: "idle" });
      // An unknown file could be from anywhere: make the user say which broker.
      setAccountName("");
      setOtherAccount(false);
      await readUnknown(t, guess, guessCls, guessCur, "", !!(ai.status?.enabled && ai.consented));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Folio couldn't read that file.");
    } finally {
      setReading(false);
    }
  }

  const hasId = cols.name !== undefined || cols.ticker !== undefined || cols.isin !== undefined;
  const hasAmounts = isUsable(cols);

  async function buildReview(s: Setup) {
    setResolving(true);
    setError("");
    // Same reader the accuracy tests run: totals dropped, gaps filled, repeats merged.
    const parsed = extractHoldings(bodyOf(s.table), s.cols, s.dateCol).map((h) => ({ ...h, invested: h.cost }));

    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: parsed.map((p) => ({
            cls: s.cls,
            isin: p.isin || undefined,
            ticker: p.ticker || undefined,
            name: p.name || undefined,
            // Value per unit lets the server confirm which fund a name refers to.
            nav: s.cls === "mf" && s.fileCur === "INR" && p.qty > 0 && p.value > 0 ? p.value / p.qty : undefined,
          })),
        }),
      }).then((r) => r.json() as Promise<{ results: (Resolved | null)[] }>);
      const matches = res.results;

      const items = matches
        .filter((m): m is Resolved => !!m)
        .map((m) => ({ cls: s.cls, symbol: m.symbol, currency: m.currency }));
      const market = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      }).then((r) => r.json() as Promise<{ quotes: Record<string, Quote>; usdInr: number | null }>);
      const fx = market.usdInr ?? 88;
      const now = Date.now();

      const out: ReviewRow[] = [];
      parsed.forEach((p, i) => {
        const match = matches[i];
        const currency: Currency = match?.currency ?? (s.cls === "us_stock" || s.cls === "crypto" ? "USD" : "INR");
        const c = (n: number) => (isFinite(n) ? convert(n, s.fileCur, currency, fx) : NaN);
        const live = match ? market.quotes[quoteKey({ cls: s.cls, symbol: match.symbol, currency })]?.price : undefined;
        let q = p.qty;
        let cost = c(p.cost);
        let invested = c(p.invested);
        let value = c(p.value);
        let problem: string | undefined;

        if (!(q > 0) && invested > 0 && value > 0) q = live ? value / live : 1;
        if (!(cost > 0)) cost = invested;
        if (!(cost > 0) && q > 0 && value > 0) {
          cost = value;
          problem = "No cost in the file, so it's recorded at today's value.";
        }
        if (!(invested > 0)) invested = cost;
        if (!(value > 0)) value = live && q > 0 ? q * live : NaN;
        const avg = q > 0 ? cost / q : NaN;
        if (!(q > 0) || !(avg > 0)) problem = "Quantity or cost is missing in this row.";

        // Leftover fractions worth less than a cent or a rupee are dropped.
        const worth = isFinite(value) ? value : invested;
        if (isFinite(worth) && worth < (currency === "USD" ? 0.01 : 1)) return;

        const source = p.name || p.ticker || p.isin;
        const label = match?.name ?? source;
        out.push({
          key: p.key,
          label,
          source,
          match,
          qty: q,
          avg,
          invested,
          value: isFinite(value) ? value : null,
          currency,
          ts: isFinite(p.ts) ? Math.min(p.ts, now) : now,
          include: !problem?.startsWith("Quantity"),
          problem,
        });
      });
      setRows(out);
      setStep("review");
    } catch {
      setError("Folio couldn't match the holdings right now. Check your connection and try again.");
      setStep("columns");
    } finally {
      setResolving(false);
    }
  }

  function doImport() {
    const now = Date.now();
    const chosen: ImportRow[] = view
      .filter((r) => r.include && !r.duplicate && r.qty > 0 && r.avg > 0)
      .map((r) => {
        const asset: Omit<Asset, "id"> = r.match
          ? { cls, symbol: r.match.symbol, ticker: r.match.ticker, name: r.match.name, currency: r.currency }
          : {
              cls,
              symbol: "",
              ticker: r.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase(),
              name: r.label,
              currency: r.currency,
              ...(r.value ? { manualPrice: { price: r.value / r.qty, ts: now } } : {}),
            };
        return { asset, qty: r.qty, price: r.avg, ts: r.ts };
      });
    applyImport(accountName, chosen);
    onSaved?.(`${chosen.length} ${chosen.length === 1 ? "holding" : "holdings"} imported from ${accountName}`);
    onClose();
  }

  const aiField = (f: Field) => aiPicked?.fields[f] !== undefined && cols[f] === aiPicked.fields[f];
  const aiClass = !!aiPicked?.cls && aiPicked.cls === cls;
  const aiCur = !!aiPicked?.currency && aiPicked.currency === fileCur;
  const aiTag = (
    <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px align-middle text-[10px] font-bold text-accent ring-1 ring-accent/30">
      AI
    </span>
  );

  const verdict = useMemo(() => (step === "review" && table ? checkMapping(bodyOf(table), cols) : null), [step, table, cols]);
  const heldHere = heldAt(data, accountName);
  const view = rows.map((r) => ({ ...r, duplicate: heldHere(cls, r.match, r.label, r.currency) }));
  const selected = view.filter((r) => r.include && !r.duplicate).length;
  const back: Record<Step, Step | null> = {
    source: null,
    upload: "source",
    columns: "upload",
    review: readBy === "preset" ? "upload" : "columns",
  };
  const titles: Record<Step, string> = {
    source: "Import holdings",
    upload: source?.title ?? "Upload",
    columns: "Check the file",
    review: "Review before adding",
  };

  const brokerPicker = (title: string) => (
            <div>
              <p className="mb-2 text-[13px] font-semibold">{title}</p>
              <div className="flex flex-wrap gap-2">
                {data.accounts.map((a) => {
                  const on = !otherAccount && a.name === accountName;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setOtherAccount(false);
                        if (step === "columns") pickBroker(a.name, a.id);
                        else setAccountName(a.name);
                      }}
                      className={`press rounded-full border px-3.5 py-2 text-[13px] font-semibold ${
                        on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:text-ink"
                      }`}
                    >
                      {a.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={otherAccount}
                  onClick={() => {
                    setOtherAccount(true);
                    setAccountName("");
                  }}
                  className={`press rounded-full border border-dashed px-3.5 py-2 text-[13px] font-semibold ${
                    otherAccount ? "border-accent bg-accent-soft text-ink" : "border-ink-3/60 text-ink-2 hover:text-ink"
                  }`}
                >
                  Another
                </button>
              </div>
              {otherAccount && (
                <input
                  autoFocus
                  className="field item-in mt-2"
                  aria-label="Broker or exchange name"
                  placeholder="e.g. Zerodha, Binance, Kuvera"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              )}
            </div>
  );
  const totals = (() => {
    const chosen = view.filter((r) => r.include && !r.duplicate);
    if (!chosen.length || chosen.some((r) => r.currency !== chosen[0].currency)) return null;
    return {
      currency: chosen[0].currency,
      invested: chosen.reduce((a, r) => a + (r.invested > 0 ? r.invested : 0), 0),
      value: chosen.reduce((a, r) => a + (r.value ?? 0), 0),
    };
  })();

  return (
    <Modal
      title="Import holdings"
      onClose={onClose}
      wide={step === "review" || step === "columns"}
      header={
        <div className="flex min-w-0 items-center gap-3">
          {back[step] && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                setError("");
                setStep(back[step]!);
              }}
              className="press grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink"
            >
              {Icon.back}
            </button>
          )}
          <h2 className="truncate text-xl font-extrabold tracking-tight">{titles[step]}</h2>
        </div>
      }
    >
      <div key={step} className="step-fwd">
        {/* ------------------------------- Source ------------------------------- */}
        {step === "source" && (
          <div className="space-y-2.5">
            <p className="mb-4 text-sm leading-relaxed text-ink-2">
              Files are read in this browser and never uploaded. Only fund and stock identifiers are sent to look up
              live prices.
            </p>
            {SOURCES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => {
                  setSource(s);
                  setStep("upload");
                }}
                className="item-in press group flex w-full items-start gap-3.5 rounded-[20px] border border-line p-4 text-left hover:border-ink-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
                  {Icon.file}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold">{s.title}</span>
                    {!s.ready && (
                      <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-line">
                        Coming soon
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{s.covers}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ------------------------------- Upload ------------------------------- */}
        {step === "upload" && source && (
          <div className="space-y-5">
            <div className="rounded-[20px] bg-sunken p-4 ring-1 ring-line">
              <p className="mb-3 text-[13px] font-bold">How to get this file</p>
              <ol className="space-y-2.5">
                {source.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink-2">
                    <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-bold text-ink ring-1 ring-line">
                      {i + 1}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {source.password && (
                <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
                  <strong className="font-semibold text-ink-2">PDF password:</strong> {source.password}
                </p>
              )}
              {source.recognised && (
                <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
                  <strong className="font-semibold text-ink-2">Read automatically:</strong> {source.recognised}
                </p>
              )}
            </div>

            {!source.ready ? (
              <p className="rounded-[20px] border border-dashed border-line p-5 text-center text-sm leading-relaxed text-ink-2">
                Reading these statements is being added next. You can already request the file so it&apos;s ready —
                or use{" "}
                <button type="button" className="font-semibold text-accent" onClick={() => setSource(SOURCES[2])}>
                  a holdings file
                </button>{" "}
                today.
              </p>
            ) : (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void onFile(f);
                }}
                className={`press flex cursor-pointer flex-col items-center gap-2 rounded-[22px] border-2 border-dashed p-8 text-center ${
                  dragging ? "border-accent bg-accent-soft" : "border-line hover:border-ink-3"
                } ${reading || resolving ? "pointer-events-none" : ""}`}
              >
                <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent">
                  {reading || resolving ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                  ) : (
                    Icon.upload
                  )}
                </span>
                <span className="text-[15px] font-bold">
                  {aiRead.state === "loading"
                    ? "AI is reading your file…"
                    : reading
                      ? "Reading…"
                      : resolving
                        ? "Matching holdings to live prices…"
                        : "Drop the file here, or choose one"}
                </span>
                <span className="text-xs text-ink-3">CSV or Excel (.xlsx, .xls)</span>
                <input
                  type="file"
                  accept={source.accept}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-[13px] font-semibold text-down">
                {error}
              </p>
            )}
          </div>
        )}

        {/* ------------------------------- Columns ------------------------------ */}
        {step === "columns" && table && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-ink-2">
              Folio found {body.length} {body.length === 1 ? "row" : "rows"} in{" "}
              <strong className="text-ink">{fileName}</strong>. Tell it where the file is from and check each field
              points at the right column.
            </p>

            {brokerPicker("Broker or exchange")}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="mb-2 text-[13px] font-semibold">What&apos;s in the file?{aiClass && aiTag}</p>
                <div className="overflow-x-auto">
                  <Segmented
                    options={CLASS_FOR_IMPORT}
                    value={cls}
                    onChange={(c) => {
                      setCls(c);
                      setFileCur(c === "us_stock" ? "USD" : "INR");
                    }}
                    label="Asset type in the file"
                    size="sm"
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold">Amounts are in{aiCur && aiTag}</p>
                <Segmented
                  options={[
                    { value: "INR", label: "₹ INR" },
                    { value: "USD", label: "$ USD" },
                  ]}
                  value={fileCur}
                  onChange={setFileCur}
                  label="Currency of the file's amounts"
                  size="sm"
                />
              </div>
            </div>

            {tables.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">Sheet</span>
                {tables.map((t, i) => (
                  <button
                    key={t.sheet + i}
                    type="button"
                    onClick={() => {
                      setSheet(i);
                      setCols(guessColumns(headerOf(t)));
                    }}
                    className={`press rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      i === sheet ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2"
                    }`}
                  >
                    {t.sheet}
                  </button>
                ))}
              </div>
            )}

            {ai.status?.enabled && (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-3.5 ring-1 ${
                  aiRead.state === "done" ? "bg-accent-soft ring-accent/30" : "bg-sunken ring-line"
                }`}
              >
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">
                  {aiRead.state === "loading" ? (
                    "AI is reading the sheet…"
                  ) : aiRead.state === "done" ? (
                    <>
                      <strong className="text-ink">AI filled in the fields marked AI — check them before continuing.</strong>{" "}
                      {aiRead.note}
                      {aiPicked && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {aiPicked.cls && (
                            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">
                              {CLASS_META[aiPicked.cls].label}
                            </span>
                          )}
                          {aiPicked.currency && (
                            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">
                              Amounts in {aiPicked.currency === "INR" ? "₹" : "$"}
                            </span>
                          )}
                          {FIELDS.filter((f) => aiPicked.fields[f] !== undefined).map((f) => (
                            <span key={f} className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line">
                              {FIELD_LABEL[f]}: <strong className="font-semibold text-ink">{header[aiPicked.fields[f]!] || `Column ${aiPicked.fields[f]! + 1}`}</strong>
                            </span>
                          ))}
                        </span>
                      )}
                    </>
                  ) : aiRead.state === "error" ? (
                    <span className="text-down">{aiRead.note}</span>
                  ) : (
                    "Not sure which column is which? AI can read the headings and a few rows and fill these in for you."
                  )}
                </p>
                {aiRead.state !== "loading" && (
                  <Button variant="ghost" className="h-9 shrink-0 text-xs" onClick={() => table && void applyAiToColumns(table)}>
                    {aiRead.state === "done" ? "Read again" : "Read with AI"}
                  </Button>
                )}
                {aiRead.state === "loading" && (
                  <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
                )}
              </div>
            )}

            <div className="grid gap-x-4 gap-y-3 border-t border-line pt-5 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f} className="block">
                  <span className="mb-1 block text-[13px] font-semibold">
                    {FIELD_LABEL[f]}
                    {aiField(f) && aiTag}
                  </span>
                  <select
                    className={`field h-11 text-sm ${aiField(f) ? "border-accent bg-accent-soft/40" : ""}`}
                    value={cols[f] ?? ""}
                    onChange={(e) =>
                      setCols((c) => ({ ...c, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))
                    }
                  >
                    <option value="">Not in this file</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`} {body[0]?.[i] ? `— e.g. ${body[0][i].slice(0, 28)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {error && (
              <p role="alert" className="text-[13px] font-semibold text-down">
                {error}
              </p>
            )}

            <Button
              className="h-12 w-full text-sm"
              disabled={!hasId || !hasAmounts || !accountName.trim() || resolving}
              onClick={() => {
                setReadBy(aiPicked ? "ai" : "manual");
                void buildReview({
                  table,
                  cols,
                  cls,
                  fileCur,
                  accountName,
                  dateCol: preset?.id && preset.cols === cols ? preset.dateCol : aiDateCol,
                });
              }}
            >
              {resolving ? "Matching holdings to live prices…" : "Match holdings"}
            </Button>
            {(!hasId || !hasAmounts || !accountName.trim()) && (
              <p className="-mt-2 text-center text-xs text-ink-3">
                {!accountName.trim()
                  ? "Name the broker or exchange."
                  : !hasId
                    ? "Pick the column with the name, symbol or ISIN."
                    : "Pick quantity and cost, or invested and current value."}
              </p>
            )}
          </div>
        )}

        {/* ------------------------------- Review ------------------------------- */}
        {step === "review" && (
          <div className="space-y-5">
            {readBy === "preset" && preset ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-up-soft px-3 py-1.5 text-xs font-semibold text-up">
                {Icon.check} Recognised: {preset.title}
              </p>
            ) : (
              <div
                className={`rounded-[20px] p-4 ring-1 ${
                  readBy === "ai" ? "bg-accent-soft ring-accent/30" : "bg-sunken ring-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {readBy === "ai" ? "Here's what AI read from your file" : "Here's what Folio read from your file"}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                      {readBy === "ai" && aiRead.note ? `${aiRead.note} ` : ""}
                      It found {view.length} {view.length === 1 ? "holding" : "holdings"} — listed below exactly as they
                      will be added. Check the names and amounts match your statement.
                      {aiRead.state === "error" && ` AI wasn't available this time (${aiRead.note?.replace(/\.$/, "")}), so Folio read it on its own.`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {readBy !== "ai" && ai.status?.enabled && table && (
                      <Button variant="ghost" className="h-9 text-xs" onClick={() => void readUnknown(table, cols, cls, fileCur, accountName, true)} disabled={aiRead.state === "loading"}>
                        {aiRead.state === "loading" ? "AI is reading…" : "Ask AI to read it"}
                      </Button>
                    )}
                    <Button variant="ghost" className="h-9 text-xs" onClick={() => setStep("columns")}>
                      Fix columns
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">
                    {CLASS_META[cls].label}
                  </span>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">
                    Amounts in {fileCur === "INR" ? "₹ rupees" : "$ dollars"}
                  </span>
                  {FIELDS.filter((f) => cols[f] !== undefined).map((f) => (
                    <span key={f} className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line">
                      {READ_AS[f]} from <strong className="font-semibold text-ink">“{header[cols[f]!] || `column ${cols[f]! + 1}`}”</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {verdict && (
              <p
                className={`flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  verdict.checks === 0
                    ? "bg-sunken text-ink-2"
                    : verdict.consistency >= 0.98
                      ? "bg-up-soft text-up"
                      : "bg-down-soft text-down"
                }`}
              >
                <span className="mt-0.5 shrink-0">{verdict.checks && verdict.consistency >= 0.98 ? Icon.check : "!"}</span>
                <span>
                  {verdict.checks === 0
                    ? "This file has no columns Folio can cross-check against each other, so compare the amounts with your statement before adding."
                    : verdict.consistency >= 0.98
                      ? `Numbers check out: ${
                          cols.price !== undefined ? "quantity × current price equals the current value" : cols.avg !== undefined ? "quantity × average price equals the invested amount" : "current value − invested equals the profit/loss"
                        } on every row.`
                      : `Some numbers don't add up — ${verdict.problems[0]?.toLowerCase() ?? "the columns may be wrong"}. Use Fix columns before adding.`}
                </span>
              </p>
            )}

            {readBy === "preset" ? (
              <p className="text-sm leading-relaxed text-ink-2">
                Adding to <strong className="text-ink">{accountName}</strong> as {CLASS_META[cls].label.toLowerCase()}.
                Holdings you already track there are skipped.{" "}
                <button type="button" className="font-semibold text-accent" onClick={() => setStep("columns")}>
                  Change
                </button>
              </p>
            ) : (
              brokerPicker("Where do you hold these?")
            )}

            <div className="-mx-1 max-h-[42dvh] overflow-auto rounded-2xl ring-1 ring-line">
              <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-ink-3">
                  <tr>
                    <th className="w-10 border-b border-line px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="size-4 accent-[var(--accent)]"
                        checked={view.length > 0 && view.every((r) => r.include || r.duplicate || !(r.avg > 0))}
                        onChange={(e) =>
                          setRows((rs) => rs.map((r) => (!(r.qty > 0) || !(r.avg > 0) ? r : { ...r, include: e.target.checked })))
                        }
                      />
                    </th>
                    <th className="border-b border-line px-2 py-2.5 font-medium">Holding</th>
                    <th className="border-b border-line px-2 py-2.5 text-right font-medium">Quantity</th>
                    <th className="border-b border-line px-2 py-2.5 text-right font-medium">Invested</th>
                    <th className="border-b border-line px-3 py-2.5 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => {
                    const on = r.include && !r.duplicate;
                    const renamed = r.source && r.source.trim().toLowerCase() !== r.label.trim().toLowerCase();
                    return (
                      <tr key={r.key} className={on ? "" : "opacity-55"}>
                        <td className="border-b border-line px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Include ${r.label}`}
                            className="mt-0.5 size-4 accent-[var(--accent)]"
                            checked={on}
                            disabled={r.duplicate || !(r.qty > 0) || !(r.avg > 0)}
                            onChange={(e) =>
                              setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))
                            }
                          />
                        </td>
                        <td className="border-b border-line px-2 py-3">
                          <p className="max-w-[22rem] font-semibold leading-snug">{r.label}</p>
                          {renamed && (
                            <p className="mt-0.5 text-xs text-ink-3">
                              In your file: <span className="text-ink-2">{r.source}</span>
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-ink-2">
                            {r.duplicate
                              ? `Already tracked at ${accountName} — skipped`
                              : r.match
                                ? `Live price · ${cls === "mf" ? "AMFI " : ""}${r.match.ticker}`
                                : "No live price found — valued at the file's amount"}
                          </p>
                          {r.problem && <p className="text-xs text-down">{r.problem}</p>}
                        </td>
                        <td className="num border-b border-line px-2 py-3 text-right align-top">{r.qty > 0 ? fmtQty(r.qty) : "–"}</td>
                        <td className="num border-b border-line px-2 py-3 text-right align-top">
                          {r.invested > 0 ? money(r.invested, r.currency) : "–"}
                        </td>
                        <td className="num border-b border-line px-3 py-3 text-right align-top font-semibold">
                          {r.value ? money(r.value, r.currency) : "–"}
                        </td>
                      </tr>
                    );
                  })}
                  {!view.length && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-sm text-ink-2">
                        No holdings found in this file.{" "}
                        <button type="button" className="font-semibold text-accent" onClick={() => setStep("columns")}>
                          Fix columns
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selected > 0 && totals && (
              <p className="num -mt-2 text-right text-[13px] text-ink-2">
                Adding {money(totals.invested, totals.currency)} invested, worth{" "}
                <strong className="text-ink">{money(totals.value, totals.currency)}</strong> today
              </p>
            )}

            <Button
              className="h-[52px] w-full text-[15px]"
              disabled={!selected || !accountName.trim()}
              onClick={doImport}
            >
              {!accountName.trim()
                ? "Choose where you hold these"
                : selected
                  ? `Add ${selected} ${selected === 1 ? "holding" : "holdings"} to ${accountName}`
                  : "Nothing selected"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Whether a holding is already open at the given broker, so re-imports don't double it. */
function heldAt(data: ReturnType<typeof useStore>["data"], accountName: string) {
  const account = data.accounts.find((a) => a.name.toLowerCase() === accountName.trim().toLowerCase());
  return (cls: AssetClass, match: Resolved | null, label: string, currency: Currency) => {
    if (!account) return false;
    // Same instrument in any pricing currency counts: a coin tracked in ₹ is still that coin.
    const same = data.assets.filter(
      (a) => a.cls === cls && (match ? a.symbol === match.symbol : !a.symbol && a.name === label && a.currency === currency),
    );
    return same.some((asset) => {
      const { byAccount } = replay(data.txns.filter((t) => t.assetId === asset.id));
      return (byAccount[account.id] ?? 0) > 0;
    });
  };
}
