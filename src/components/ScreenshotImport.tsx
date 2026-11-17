"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAi } from "@/lib/ai";
import { money, price as fmtPrice } from "@/lib/format";
import { useStore, type ImportRow } from "@/lib/store";
import type { Asset, AssetClass, Currency } from "@/lib/types";
import { Icon, Modal } from "./ui";

/**
 * Import from screenshots: pick up to five, black out anything private, let the AI read the
 * holdings, then confirm every row side by side with the pictures (numbers can be corrected)
 * before anything is added.
 */

const MAX_SHOTS = 5;
const MAX_SIDE = 2000;

interface Shot {
  id: string;
  url: string;
  w: number;
  h: number;
  /** Hidden areas, as fractions of the image (so they survive any display size). */
  boxes: { x: number; y: number; w: number; h: number }[];
  /** The redacted copy that was sent, for the confirm view. */
  sent?: string;
  /** The day the screenshot was taken (YYYY-MM-DD), for the NAV that fund values were based on. */
  day: string;
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const longDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const KINDS = [
  { key: "in_stock", cls: "in_stock", amt: "INR", label: "Indian stock" },
  { key: "mf", cls: "mf", amt: "INR", label: "Mutual fund" },
  { key: "us_stock", cls: "us_stock", amt: "USD", label: "US stock" },
  { key: "us_stock_inr", cls: "us_stock", amt: "INR", label: "US stock, ₹ amounts" },
  { key: "crypto", cls: "crypto", amt: "USD", label: "Crypto, $" },
  { key: "crypto_inr", cls: "crypto", amt: "INR", label: "Crypto, ₹" },
] as const satisfies readonly { key: string; cls: AssetClass; amt: Currency; label: string }[];
type KindKey = (typeof KINDS)[number]["key"];
const kindOf = (k: KindKey) => KINDS.find((x) => x.key === k)!;

function kindFrom(cls: AssetClass | null, cur: Currency | null): KindKey {
  if (cls === "us_stock") return cur === "INR" ? "us_stock_inr" : "us_stock";
  if (cls === "crypto") return cur === "INR" ? "crypto_inr" : "crypto";
  if (cls === "mf") return "mf";
  if (cls === "in_stock") return "in_stock";
  return cur === "USD" ? "us_stock" : "in_stock";
}

interface Read {
  name: string;
  ticker: string | null;
  qty: number | null;
  avg: number | null;
  invested: number | null;
  price: number | null;
  value: number | null;
  assetClass: AssetClass | null;
  currency: Currency | null;
}

interface Match {
  symbol: string;
  ticker: string;
  name: string;
  currency: Currency;
}

interface Row {
  id: string;
  shot: number;
  name: string;
  ticker: string | null;
  kind: KindKey;
  qty: string;
  avg: string;
  invested: string;
  /** Which cost figure is the source: the other one is worked out from it and the quantity. */
  costFrom: "avg" | "invested" | null;
  /** The invested amount as the screenshot showed it, to check the row against. */
  investedShown: number | null;
  price: number | null;
  value: number | null;
  include: boolean;
  /** undefined while looking it up; null when no live price was found. */
  match?: Match | null;
  /** "nav" when the quantity was worked out from the value shown and the fund's NAV; "user" once typed. */
  qtyFrom: "read" | "nav" | "user" | null;
  /** The screenshot day the NAV was looked up for, and what was found (null = no NAV that day). */
  navFor?: string;
  navUsed?: { nav: number; date: string } | null;
}

const plain = (n: number | null) => (n === null ? "" : String(Math.round(n * 1e6) / 1e6));
const parse = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
};
const off = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) > 0.02;

function loadImage(file: File): Promise<Shot> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // A screenshot file usually keeps the time it was taken; the person can change it later.
    img.onload = () => resolve({ id: crypto.randomUUID(), url, w: img.naturalWidth, h: img.naturalHeight, boxes: [], day: localDay(Math.min(file.lastModified || Date.now(), Date.now())) });
    img.onerror = () => reject(new Error("That file isn't an image Folio can open."));
    img.src = url;
  });
}

/** The screenshot with its hidden areas filled solid black, scaled down, as a JPEG data URL. */
async function redacted(shot: Shot): Promise<string> {
  const img = new Image();
  img.src = shot.url;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(shot.w, shot.h));
  const c = document.createElement("canvas");
  c.width = Math.round(shot.w * scale);
  c.height = Math.round(shot.h * scale);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  g.fillStyle = "#000";
  for (const b of shot.boxes) g.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height);
  return c.toDataURL("image/jpeg", 0.86);
}

export function ScreenshotImport({ onClose, onBack, onSaved, tone }: { onClose: () => void; onBack: () => void; onSaved?: (m: string) => void; tone?: "dark" }) {
  const { data, applyImport } = useStore();
  const { ensureConsent, status } = useAi();
  const [step, setStep] = useState<"pick" | "hide" | "confirm">("pick");
  const [shots, setShots] = useState<Shot[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [broker, setBroker] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [newAccount, setNewAccount] = useState("");
  const [fx, setFx] = useState(88);
  const fileInput = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    setError("");
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return setError("Choose screenshots (PNG or JPG).");
    const room = MAX_SHOTS - shots.length;
    if (list.length > room) setError(`Up to ${MAX_SHOTS} screenshots at a time; the first ${room} were added.`);
    try {
      const loaded = await Promise.all(list.slice(0, room).map(loadImage));
      setShots((s) => [...s, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that image.");
    }
  }

  // Paste a screenshot straight from the clipboard on the first step.
  useEffect(() => {
    if (step !== "pick") return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function read() {
    setError("");
    if (!status?.enabled) return setError("AI isn't set up on this server, so screenshots can't be read.");
    if (!(await ensureConsent())) return;
    setReading({ done: 0, total: shots.length });
    const out: Row[] = [];
    let seenBroker: string | null = null;
    const sent: string[] = [];
    try {
      for (let i = 0; i < shots.length; i++) {
        const image = await redacted(shots[i]);
        sent.push(image);
        const res = await fetch("/api/ai/read-screenshot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) });
        const json = (await res.json().catch(() => ({}))) as { error?: string; broker?: string | null; holdings?: Read[] };
        if (!res.ok) throw new Error(json.error ?? "The AI couldn't read that screenshot.");
        seenBroker ??= json.broker ?? null;
        for (const h of json.holdings ?? []) {
          const key = (h.ticker || h.name).toLowerCase().replace(/[^a-z0-9]/g, "");
          // The same row in two overlapping screenshots: keep the first.
          if (out.some((r) => (r.ticker || r.name).toLowerCase().replace(/[^a-z0-9]/g, "") === key && parse(r.qty) === h.qty)) continue;
          const avg = h.avg ?? (h.invested && h.qty ? h.invested / h.qty : null);
          const invested = h.invested ?? (h.avg && h.qty ? h.avg * h.qty : null);
          out.push({
            id: crypto.randomUUID(),
            shot: i,
            name: h.name,
            ticker: h.ticker,
            kind: kindFrom(h.assetClass, h.currency),
            qty: plain(h.qty),
            avg: plain(avg),
            invested: plain(invested),
            costFrom: h.avg !== null ? "avg" : h.invested !== null ? "invested" : null,
            investedShown: h.invested,
            qtyFrom: h.qty !== null ? "read" : null,
            price: h.price,
            value: h.value,
            include: h.qty !== null && avg !== null,
          });
        }
        setReading({ done: i + 1, total: shots.length });
      }
    } catch (e) {
      setReading(null);
      return setError(e instanceof Error ? e.message : "Couldn't read the screenshots.");
    }
    setShots((s) => s.map((x, i) => ({ ...x, sent: sent[i] })));
    setReading(null);
    if (!out.length) return setError("No holdings were found in those screenshots. Try a clearer one showing your holdings list.");
    setRows(out);
    setBroker(seenBroker);
    const hit = seenBroker ? data.accounts.find((a) => a.name.toLowerCase().includes(seenBroker!.toLowerCase()) || seenBroker!.toLowerCase().includes(a.name.toLowerCase())) : undefined;
    setAccountId(hit?.id ?? "");
    setNewAccount(hit ? "" : (seenBroker ?? ""));
    setActive(0);
    setStep("confirm");
    void lookUp(out);
    fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [] }) })
      .then((r) => r.json())
      .then((j: { usdInr?: number | null }) => j.usdInr && setFx(j.usdInr))
      .catch(() => {});
  }

  /** Finds each row's live-price listing. */
  async function lookUp(list: Row[]) {
    if (!list.length) return;
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: list.map((r) => {
            const q = parse(r.qty);
            // The per-unit price shown helps tell similar funds apart (Direct vs Regular).
            const nav = kindOf(r.kind).cls === "mf" ? (r.price ?? (r.value && q ? r.value / q : undefined)) : undefined;
            return { cls: kindOf(r.kind).cls, ticker: r.ticker ?? undefined, name: r.name, nav };
          }),
        }),
      }).then((r) => r.json() as Promise<{ results: (Match | null)[] }>);
      setRows((rs) => rs.map((r) => {
        const i = list.findIndex((x) => x.id === r.id);
        return i >= 0 && list[i].kind === r.kind ? { ...r, match: res.results[i] ?? null } : r;
      }));
    } catch {
      setRows((rs) => rs.map((r) => (list.some((x) => x.id === r.id) ? { ...r, match: null } : r)));
    }
  }

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  /** Quantity, average and invested stay linked: whichever cost figure was typed (or read) drives the other. */
  function edit(r: Row, field: "qty" | "avg" | "invested", raw: string) {
    const v = raw.replace(/[^0-9.,]/g, "");
    const next: Row = { ...r, [field]: v, include: true };
    if (field !== "qty") next.costFrom = field;
    else next.qtyFrom = "user";
    patch(r.id, relink(next));
  }

  /** Keeps average and invested consistent with the quantity, from whichever cost figure leads. */
  function relink(next: Row): Row {
    const q = parse(next.qty);
    if (q && next.costFrom === "avg") {
      const a = parse(next.avg);
      next.invested = a ? plain(q * a) : next.invested;
    } else if (q && next.costFrom === "invested") {
      const inv = parse(next.invested);
      next.avg = inv ? String(Math.round((inv / q) * 1e4) / 1e4) : next.avg;
    }
    return next;
  }

  // Funds whose units aren't shown: units = value shown ÷ the NAV the app used that day.
  const navAsked = useRef(new Set<string>()); // lookups in flight
  useEffect(() => {
    const need = rows.filter((r) => {
      const day = shots[r.shot]?.day;
      return (
        kindOf(r.kind).cls === "mf" && r.match && r.value && day &&
        (r.qtyFrom === "nav" || r.qtyFrom === null) &&
        r.navFor !== day && !navAsked.current.has(`${r.id}:${r.match.symbol}:${day}`)
      );
    });
    if (!need.length) return;
    const asks = need.map((r) => ({ id: r.id, code: r.match!.symbol, day: shots[r.shot].day }));
    asks.forEach((a) => navAsked.current.add(`${a.id}:${a.code}:${a.day}`));
    fetch("/api/nav", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: asks.map(({ code, day }) => ({ code, day })) }) })
      .then((res) => res.json() as Promise<{ results: ({ nav: number; date: string } | null)[] }>)
      .catch(() => ({ results: asks.map(() => null) }))
      .then(({ results }) => {
        // Only in-flight lookups are remembered, so going back to an earlier day asks again.
        asks.forEach((a) => navAsked.current.delete(`${a.id}:${a.code}:${a.day}`));
        setRows((rs) =>
          rs.map((r) => {
            const i = asks.findIndex((a) => a.id === r.id);
            const a = asks[i];
            // Skip if the person has since typed a quantity, changed the fund or the day.
            if (i < 0 || r.qtyFrom === "user" || r.qtyFrom === "read" || r.match?.symbol !== a.code || shots[r.shot]?.day !== a.day) return r;
            const nav = results[i] ?? null;
            if (!nav || !r.value) return { ...r, navFor: a.day, navUsed: null, ...(r.qtyFrom === "nav" ? { qty: "", qtyFrom: null } : {}) };
            const units = Math.round((r.value / nav.nav) * 1000) / 1000;
            const next = relink({ ...r, qty: plain(units), qtyFrom: "nav", navFor: a.day, navUsed: nav });
            return { ...next, include: parse(next.qty) !== null && parse(next.avg) !== null };
          }),
        );
      });
  }, [rows, shots]);

  const checked = useMemo(
    () =>
      rows.map((r) => {
        const q = parse(r.qty);
        const a = parse(r.avg);
        const inv = parse(r.invested);
        const k = kindOf(r.kind);
        const warns: string[] = [];
        const working = q === null && kindOf(r.kind).cls === "mf" && r.value && r.qtyFrom === null && (r.match === undefined || (r.match && r.navFor !== shots[r.shot]?.day));
        if (working) warns.push("Working out the units from the fund's NAV…");
        else if (q === null || a === null)
          warns.push(
            q === null
              ? r.navUsed === null && r.navFor
                ? "Quantity isn't shown and no NAV was found for that day; type it to include this."
                : inv
                  ? "Quantity isn't shown; type it and the average price is worked out from the invested amount."
                  : "Quantity isn't shown; type it to include this."
              : "No cost shown; type your average price or the amount invested to include this.",
          );
        if (inv && r.investedShown && off(inv, r.investedShown)) warns.push(`Invested is ${money(inv, k.amt)}, but the screenshot shows ${money(r.investedShown, k.amt)}.`);
        if (q && r.price && r.value && off(q * r.price, r.value)) warns.push(`Quantity × price is ${money(q * r.price, k.amt)}, but the screenshot shows ${money(r.value, k.amt)} current value.`);
        return { ...r, q, a, warns, ok: q !== null && a !== null };
      }),
    [rows, shots],
  );
  const chosen = checked.filter((r) => r.include && r.ok);
  const accountName = accountId ? (data.accounts.find((a) => a.id === accountId)?.name ?? "") : newAccount.trim();

  function save() {
    if (!chosen.length || !accountName) return;
    const now = Date.now();
    const items: ImportRow[] = chosen.map((r) => {
      const k = kindOf(r.kind);
      const assetCur: Currency = k.cls === "us_stock" ? "USD" : k.cls === "crypto" ? k.amt : "INR";
      const conv = (n: number) => (k.amt === assetCur ? n : assetCur === "USD" ? n / fx : n * fx);
      const shownPrice = r.price ?? (r.value && r.q ? r.value / r.q : null);
      const asset: Omit<Asset, "id"> = r.match
        ? { cls: k.cls, symbol: r.match.symbol, ticker: r.match.ticker, name: r.match.name, currency: r.match.currency }
        : {
            cls: k.cls,
            symbol: "",
            ticker: (r.ticker ?? r.name).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase(),
            name: r.name,
            currency: assetCur,
            ...(shownPrice ? { manualPrice: { price: conv(shownPrice), ts: now } } : {}),
          };
      return { asset, qty: r.q!, price: conv(r.a!), ts: now };
    });
    applyImport(accountName, items);
    onSaved?.(`${items.length} ${items.length === 1 ? "holding" : "holdings"} added from ${shots.length === 1 ? "a screenshot" : `${shots.length} screenshots`}`);
    onClose();
  }

  const shot = shots[active];
  const titles = { pick: "Import from screenshots", hide: "Hide anything private", confirm: "Check what Folio read" };

  return (
    <Modal
      title={titles[step]}
      tone={tone}
      onClose={onClose}
      width={step === "confirm" ? 1080 : step === "hide" ? 760 : undefined}
      header={
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={() => (setError(""), step === "pick" ? onBack() : setStep(step === "confirm" ? "hide" : "pick"))}
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink"
          >
            {Icon.back}
          </button>
          <h2 className="truncate text-xl font-extrabold tracking-tight">{titles[step]}</h2>
        </div>
      }
    >
      <div key={step} className="step-fwd">
        {step === "pick" && (
          <div>
            <p className="text-sm leading-relaxed text-ink-2">
              Take screenshots of your holdings in any broker or exchange app. Folio&apos;s AI reads the names, quantities and prices, and you check every row before anything is added.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => (e.preventDefault(), void addFiles(e.dataTransfer.files))}
              className="press mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-line bg-sunken px-6 py-9 text-center hover:border-ink-3"
            >
              <span className="grid size-11 place-items-center rounded-full bg-surface text-ink ring-1 ring-line">{Icon.upload}</span>
              <span className="text-[15px] font-semibold">Choose screenshots</span>
              <span className="text-[12.5px] text-ink-3">Up to {MAX_SHOTS} · PNG or JPG · or drop / paste them here</span>
            </button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
            {shots.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2.5">
                {shots.map((s, i) => (
                  <div key={s.id} className="pop-in relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
                    <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-24 w-auto rounded-xl object-cover ring-1 ring-line" />
                    <button
                      type="button"
                      aria-label={`Remove screenshot ${i + 1}`}
                      onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))}
                      className="press absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-canvas shadow"
                    >
                      <svg width="9" height="9" viewBox="0 0 14 14" aria-hidden>
                        <path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-3 text-[13px] font-medium text-down">{error}</p>}
            <button
              type="button"
              disabled={!shots.length}
              onClick={() => (setActive(0), setStep("hide"))}
              className="cta press streak-host relative mt-5 h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40"
            >
              <span className="streak-clip" aria-hidden />
              Next: hide anything private
            </button>
          </div>
        )}

        {step === "hide" && shot && (
          <div>
            <p className="text-sm leading-relaxed text-ink-2">
              Drag over your name, client ID or account numbers. Those areas are blacked out on this device before the picture is sent to {status?.provider || "the AI provider"}.
            </p>
            {shots.length > 1 && <Thumbs shots={shots} active={active} onPick={setActive} />}
            <Redactor
              key={shot.id}
              shot={shot}
              onChange={(boxes) => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, boxes } : x)))}
            />
            <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink-3">
              <span>
                {shot.boxes.length ? `${shot.boxes.length} area${shot.boxes.length === 1 ? "" : "s"} hidden` : "Nothing hidden yet"} · tap a black box to remove it
              </span>
              {shot.boxes.length > 0 && (
                <button type="button" className="font-semibold hover:text-ink" onClick={() => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, boxes: [] } : x)))}>
                  Clear
                </button>
              )}
            </div>
            {error && <p className="mt-3 text-[13px] font-medium text-down">{error}</p>}
            <button type="button" disabled={!!reading} onClick={read} className="cta press streak-host relative mt-5 h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-60">
              <span className="streak-clip" aria-hidden />
              {reading ? `Reading ${Math.min(reading.done + 1, reading.total)} of ${reading.total}…` : `Read ${shots.length === 1 ? "screenshot" : `${shots.length} screenshots`} with AI`}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-ink-3">Folio doesn&apos;t keep the picture, and nothing is added until you confirm each row.</p>
          </div>
        )}

        {step === "confirm" && (
          <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* The pictures, as sent */}
            <aside className="lg:sticky lg:top-0 lg:self-start">
              {shots.length > 1 && <Thumbs shots={shots} active={active} onPick={setActive} />}
              <div className="max-h-[38dvh] overflow-y-auto rounded-2xl ring-1 ring-line lg:max-h-[64dvh]">
                {/* eslint-disable-next-line @next/next/no-img-element -- the redacted copy kept in memory */}
                <img src={shots[active]?.sent ?? shots[active]?.url} alt={`Screenshot ${active + 1}, as read`} className="block w-full" />
              </div>
              <p className="mt-2 text-[11.5px] text-ink-3">The screenshot as it was sent. Compare each row with it.</p>
              {shots[active] && (
                <label className="wi-field mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-[10.5px] text-ink-3">Screenshot taken on</span>
                    <span className="block text-[11px] leading-snug text-ink-3">Fund units are worked out from that day&apos;s NAV</span>
                  </span>
                  <input
                    type="date"
                    value={shots[active].day}
                    max={localDay(Date.now())}
                    onChange={(e) => e.target.value && setShots((s) => s.map((x, i) => (i === active ? { ...x, day: e.target.value } : x)))}
                    className="num shrink-0 bg-transparent text-[13px] font-semibold outline-none"
                  />
                </label>
              )}
            </aside>

            <div className="min-w-0">
              <p className="text-[13.5px] text-ink-2">
                Read <b className="text-ink">{rows.length}</b> holding{rows.length === 1 ? "" : "s"}
                {broker ? (
                  <>
                    {" "}from <b className="text-ink">{broker}</b>
                  </>
                ) : null}
                . Correct any number that doesn&apos;t match, and untick anything you don&apos;t want.
              </p>

              <div className="mt-4">
                <p className="label text-[9.5px] text-ink-3">Held with</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.accounts.map((a) => (
                    <button key={a.id} type="button" data-on={accountId === a.id} onClick={() => (setAccountId(a.id), setNewAccount(""))} className={`pill press rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${accountId === a.id ? "" : "text-ink-2 hover:text-ink"}`}>
                      {a.name}
                    </button>
                  ))}
                  <input
                    value={newAccount}
                    onChange={(e) => (setNewAccount(e.target.value), setAccountId(""))}
                    placeholder="Another broker…"
                    className={`h-[30px] w-40 rounded-full bg-sunken px-3 text-[12.5px] outline-none ring-1 ${!accountId && newAccount ? "ring-ink" : "ring-line"}`}
                  />
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {checked.map((r) => {
                  const k = kindOf(r.kind);
                  const sign = k.amt === "INR" ? "₹" : "$";
                  return (
                    <li key={r.id} className={`rounded-2xl p-3.5 ring-1 transition-colors ${r.include && r.ok ? "bg-surface ring-line" : "bg-sunken/60 ring-line"} ${r.warns.length && r.include ? "ring-[#e8871e]/50" : ""}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={r.include && r.ok}
                          disabled={!r.ok}
                          onChange={(e) => patch(r.id, { include: e.target.checked })}
                          aria-label={`Include ${r.name}`}
                          className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px] font-semibold">{r.name}</p>
                              <p className="truncate text-[11.5px] text-ink-3">
                                {r.match === undefined
                                  ? "Looking up live prices…"
                                  : r.match
                                    ? `Live prices: ${r.match.name} · ${r.match.ticker}`
                                    : "No live price found; it'll be tracked at the price shown"}
                                {shots.length > 1 && (
                                  <button type="button" onClick={() => setActive(r.shot)} className="ml-1.5 font-semibold text-ink-2 hover:text-ink">
                                    · screenshot {r.shot + 1}
                                  </button>
                                )}
                              </p>
                            </div>
                            <select
                              value={r.kind}
                              onChange={(e) => {
                                const kind = e.target.value as KindKey;
                                patch(r.id, { kind, match: undefined, navFor: undefined, ...(r.qtyFrom === "nav" ? { qty: "", qtyFrom: null } : {}) });
                                void lookUp([{ ...r, kind }]);
                              }}
                              aria-label={`Type of ${r.name}`}
                              className="h-7 max-w-[44%] shrink-0 rounded-full bg-sunken px-2.5 text-[11.5px] font-semibold text-ink-2 outline-none ring-1 ring-line"
                            >
                              {KINDS.map((x) => (
                                <option key={x.key} value={x.key}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field label={r.qtyFrom === "nav" ? "Units · worked out" : "Quantity"}>
                              <input inputMode="decimal" value={r.qty} onChange={(e) => edit(r, "qty", e.target.value)} className="num w-full bg-transparent text-[14px] font-semibold outline-none" />
                            </Field>
                            <Field label={r.costFrom === "invested" && r.avg ? "Avg price · worked out" : "Avg price"}>
                              <span className="flex items-baseline gap-1">
                                <span className="text-[12px] text-ink-3">{sign}</span>
                                <input inputMode="decimal" value={r.avg} onChange={(e) => edit(r, "avg", e.target.value)} className="num w-full bg-transparent text-[14px] font-semibold outline-none" />
                              </span>
                            </Field>
                            <Field label={r.costFrom === "avg" && r.invested && r.investedShown === null ? "Invested · worked out" : "Invested"}>
                              <span className="flex items-baseline gap-1">
                                <span className="text-[12px] text-ink-3">{sign}</span>
                                <input inputMode="decimal" value={r.invested} onChange={(e) => edit(r, "invested", e.target.value)} className="num w-full bg-transparent text-[14px] font-semibold outline-none" />
                              </span>
                            </Field>
                            <Info label="Value shown" value={r.value ? money(r.value, k.amt) : r.price && r.q ? `${fmtPrice(r.price, k.amt)} each` : "–"} />
                          </div>
                          {r.qtyFrom === "nav" && r.navUsed && r.value && (
                            <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
                              Units worked out as {money(r.value, k.amt)} shown ÷ NAV {fmtPrice(r.navUsed.nav, "INR")} on {longDay(r.navUsed.date)}
                              {r.costFrom === "invested" ? `; average price = ${money(parse(r.invested) ?? 0, k.amt)} invested ÷ units` : ""}. Change the screenshot&apos;s date if it was taken on another day.
                            </p>
                          )}
                          {r.warns.map((w) => (
                            <p key={w} className="mt-2 flex gap-1.5 text-[12px] leading-snug text-[#c2741b] dark:text-[#f0a64b]">
                              <span aria-hidden>!</span>
                              {w}
                            </p>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="sticky -bottom-6 -mb-6 mt-4 flex pb-6 sm:-bottom-7 sm:-mb-7 sm:pb-7 flex-wrap items-center justify-between gap-3 bg-surface pt-3">
                <p className="text-[12px] text-ink-3">
                  {chosen.length ? `${chosen.length} to add${accountName ? ` to ${accountName}` : ""}, at your average price as of today.` : "Nothing selected yet."}
                  {!accountName && chosen.length ? " Choose where they're held." : ""}
                </p>
                <button type="button" disabled={!chosen.length || !accountName} onClick={save} className="cta press streak-host relative h-11 rounded-full px-6 text-[14px] font-semibold disabled:opacity-40">
                  <span className="streak-clip" aria-hidden />
                  Add {chosen.length || ""} holding{chosen.length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="wi-field block rounded-xl px-3 pb-1.5 pt-1.5">
      <span className="block truncate text-[10.5px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1 pt-1.5">
      <p className="truncate text-[10.5px] text-ink-3">{label}</p>
      <p className="num truncate text-[13.5px] font-semibold text-ink-2">{value}</p>
    </div>
  );
}

function Thumbs({ shots, active, onPick }: { shots: Shot[]; active: number; onPick: (i: number) => void }) {
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto">
      {shots.map((s, i) => (
        <button key={s.id} type="button" onClick={() => onPick(i)} aria-label={`Show screenshot ${i + 1}`} className={`shrink-0 overflow-hidden rounded-lg ring-2 ${i === active ? "ring-ink" : "ring-transparent opacity-60 hover:opacity-100"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local thumbnail */}
          <img src={s.sent ?? s.url} alt="" className="h-14 w-auto" />
        </button>
      ))}
    </div>
  );
}

/** Drag on the picture to add a black box; tap a box to remove it. */
function Redactor({ shot, onChange }: { shot: Shot; onChange: (boxes: Shot["boxes"]) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const box = (d: NonNullable<typeof draft>) => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
  return (
    <div className="mt-4 max-h-[58dvh] overflow-y-auto rounded-2xl ring-1 ring-line">
      <div
        ref={wrap}
        className="relative cursor-crosshair select-none"
        style={{ touchAction: "none", aspectRatio: `${shot.w} / ${shot.h}` }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.box) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = at(e);
          setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => draft && setDraft({ ...draft, x1: at(e).x, y1: at(e).y })}
        onPointerUp={() => {
          if (draft) {
            const b = box(draft);
            if (b.w > 0.01 && b.h > 0.005) onChange([...shot.boxes, b]);
          }
          setDraft(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the chosen file, shown for marking */}
        <img src={shot.url} alt="Screenshot to mark" className="pointer-events-none block h-full w-full" draggable={false} />
        {shot.boxes.map((b, i) => (
          <button
            key={i}
            type="button"
            data-box="1"
            aria-label="Remove this hidden area"
            onClick={() => onChange(shot.boxes.filter((_, j) => j !== i))}
            className="absolute bg-black ring-1 ring-white/30"
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          />
        ))}
        {draft && (
          <span
            className="pointer-events-none absolute bg-black/80 ring-2 ring-white/70"
            style={{ left: `${box(draft).x * 100}%`, top: `${box(draft).y * 100}%`, width: `${box(draft).w * 100}%`, height: `${box(draft).h * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

export const ScreenshotIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="1.5" width="8" height="13" rx="2" />
    <path d="M6.5 5h3M6.5 7.5h3M6.5 10h2" />
  </svg>
);

