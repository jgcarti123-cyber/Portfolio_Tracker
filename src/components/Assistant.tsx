"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAi } from "@/lib/ai";
import { cashBalances } from "@/lib/cash";
import { buildContext, holdingIdMap } from "@/lib/assistant";
import { money, pct, price as fmtPrice, qty as fmtQty, signed } from "@/lib/format";
import type { DayValue } from "@/lib/networth";
import { closeAt } from "@/lib/networth";
import { convert, replay, type Position, type Totals } from "@/lib/portfolio";
import { fetchHistory, searchAssets } from "@/lib/prices";
import { useStore } from "@/lib/store";
import type { Today } from "@/lib/today";
import { heldHistory, parseCashLocally, resolveTrade, type ParsedTrade } from "@/lib/tradeText";
import { CLASS_META, quoteKey, type Asset, type AssetClass, type Candle, type ChatCard, type ChatMessage, type Currency, type Quote, type SearchHit } from "@/lib/types";
import { AssetBadge } from "./AssetBadge";
import { Button, Icon } from "./ui";

const uid = () => crypto.randomUUID();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clock = () => Date.now();

export const Sparkle = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 1.5l1.3 3.6L13 6.5l-3.7 1.4L8 11.5 6.7 7.9 3 6.5l3.7-1.4zM12.5 10l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.6-.6 1.6-.6z" />
  </svg>
);

/** Tiny markdown: paragraphs, "- " bullets and **bold**. Text is never injected as HTML. */
function Rich({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <b key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </b>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  return (
    <>
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)))
          return (
            <ul key={i} className="my-1.5 list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{bold(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="my-1.5 first:mt-0 last:mb-0">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {bold(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  positions: Position[];
  totals: Totals;
  today: Today;
  series: DayValue[];
  currency: Currency;
  usdInr: number;
  onSaved: (message: string) => void;
}

type Snap = "peek" | "half" | "full";
const SNAP: Record<Snap, string> = { peek: "84px", half: "56dvh", full: "92dvh" };

/**
 * The portfolio assistant. A side panel on wide screens (the page makes room for it) and a
 * draggable bottom sheet on phones, so charts stay visible above it. It answers from the
 * person's own numbers, records trades they describe (after they confirm), and works out
 * what-ifs. The conversation is kept inside the encrypted vault.
 */
export function Assistant(props: Props) {
  const { open, onClose, positions, totals, today, series, currency, usdInr } = props;
  const { data, setChat } = useStore();
  const ai = useAi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<ChatMessage | null>(null);
  const [snap, setSnap] = useState<Snap>("half");
  const [drag, setDrag] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; h: number } | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = useMemo(() => data.chat ?? [], [data.chat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const lead = today.movers[0];
  const greeting = `Hi! I can see your **${positions.length} holdings**, worth **${money(totals.value, currency, { decimals: 0 })}**. Today you're **${today.total >= 0 ? "up" : "down"} ${money(Math.abs(today.total), currency)}**${lead ? `, mostly from **${lead.position.asset.name}**` : ""}.\n\nAsk me anything about your portfolio, try a what-if, or tell me about a trade you made and I'll record it.`;
  const hasCrypto = positions.some((p) => p.asset.cls === "crypto");
  const starters = [
    `Why am I ${today.total >= 0 ? "up" : "down"} today?`,
    "What's my biggest holding?",
    lead ? `How is ${lead.position.asset.name.split(" ").slice(0, 2).join(" ")} doing overall?` : "How am I doing overall?",
    hasCrypto ? "What if crypto falls 20%?" : "What if markets fall 10%?",
    "I sold something — record it",
  ];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const chips = messages.length ? (lastAssistant?.suggestions ?? []) : starters;

  async function send(raw: string, retry?: ChatMessage) {
    const q = raw.trim();
    if (!q || busy) return;
    setError("");
    setFailed(null);
    if (!ai.status?.enabled) return setError("The assistant isn't set up on this server.");
    if (!(await ai.ensureConsent())) return setError("The assistant needs AI turned on. Your question wasn't sent.");
    const user: ChatMessage = retry ?? { id: uid(), role: "user", text: q, ts: clock() };
    if (!retry) setChat((prev) => [...prev, user]);
    setText("");
    setBusy(true);
    try {
      const context = buildContext({ data, positions, totals, today, series, currency, usdInr });
      // Unanswered questions from earlier failures are left out, so the AI sees a clean conversation.
      const answered = [...messages.filter((m) => m.id !== user.id), user].filter((m, i, all) => m.role === "assistant" || m.id === user.id || all[i + 1]?.role === "assistant");
      const history = answered.slice(-8).map((m) => ({
        role: m.role,
        content:
          m.text +
          (m.card ? (m.card.status === "saved" ? `\n[Recorded: ${m.card.saved}]` : m.card.status === "cancelled" ? "\n[The person cancelled that card.]" : m.card.kind === "trade" ? "\n[Showed a trade for the person to confirm.]" : m.card.kind === "cash" ? "\n[Showed a cash entry for the person to confirm.]" : "\n[Showed a what-if card.]") : ""),
      }));
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context, messages: history }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The assistant couldn't answer right now.");
      const ids = holdingIdMap(data);
      const a = json.action as Record<string, unknown> | null;
      let card: ChatCard | undefined;
      if (a?.type === "trade") card = { kind: "trade", status: "pending", payload: { assetId: ids.get(a.holdingId as string) ?? null, newHolding: a.newHolding, trade: a.trade } };
      if (a?.type === "cash") card = { kind: "cash", status: "pending", payload: { direction: a.direction, amount: a.amount, currency: a.currency, date: a.date ?? null, note: a.note ?? null } };
      // The AI sometimes answers in words only; a clear cash deposit or withdrawal is still offered as a card.
      if (!a) {
        const c = parseCashLocally(q, data.accounts.map((x) => x.name));
        if (c) card = { kind: "cash", status: "pending", payload: { ...c } };
      }
      if (a?.type === "whatif") {
        const scope = (a.scope ?? {}) as { holdingIds?: string[] | null; assetType?: AssetClass | null };
        card = {
          kind: "whatif",
          payload: {
            assetId: ids.get(a.holdingId as string) ?? null,
            trade: a.trade,
            priceChangePct: a.priceChangePct,
            targetAvgPrice: a.targetAvgPrice ?? null,
            assetIds: (scope.holdingIds ?? []).map((h) => ids.get(h)).filter(Boolean),
            cls: scope.assetType ?? null,
          },
        };
      }
      setChat((prev) => [...prev, { id: uid(), role: "assistant", text: json.reply, ts: clock(), card, suggestions: json.suggestions }]);
    } catch (e) {
      setError((e as Error).message);
      setFailed(user);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function updateCard(id: string, patch: Partial<ChatCard>) {
    setChat((prev) => prev.map((m) => (m.id === id && m.card ? { ...m, card: { ...m.card, ...patch } } : m)));
  }

  // Bottom sheet dragging (phones). Snaps to the nearest of peek / half / full.
  function onDragStart(e: React.PointerEvent) {
    const h = sheet.current?.getBoundingClientRect().height ?? 0;
    dragStart.current = { y: e.clientY, h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    setDrag(Math.max(56, Math.min(window.innerHeight * 0.94, dragStart.current.h + (dragStart.current.y - e.clientY))));
  }
  function onDragEnd() {
    if (!dragStart.current) return;
    const h = drag ?? dragStart.current.h;
    const vh = window.innerHeight;
    const options: [Snap, number][] = [
      ["peek", 84],
      ["half", vh * 0.56],
      ["full", vh * 0.92],
    ];
    setSnap(options.reduce((best, o) => (Math.abs(o[1] - h) < Math.abs(best[1] - h) ? o : best))[0]);
    setDrag(null);
    dragStart.current = null;
  }

  if (!open) return null;
  const peek = snap === "peek" && drag === null;

  return (
    <aside
      ref={sheet}
      aria-label="Folio assistant"
      className="assistant-in fixed inset-x-0 bottom-0 z-40 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface shadow-pop lg:inset-y-0 lg:left-auto lg:right-0 lg:h-dvh lg:w-[400px] lg:rounded-none lg:border-y-0 lg:border-r-0"
      style={{ "--sheet-h": drag !== null ? `${drag}px` : SNAP[snap], transition: drag !== null ? "none" : "height .35s var(--ease-out-quint)" } as React.CSSProperties}
    >
      {/* drag handle (phones) */}
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center lg:hidden"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onClick={() => peek && setSnap("half")}
        role="separator"
        aria-label="Drag to resize the assistant"
      >
        <span className="h-1.5 w-10 rounded-full bg-line" />
      </div>

      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 pb-3 lg:py-4">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-accent to-[var(--cat-4)] text-white shadow-[0_6px_16px_-6px_var(--accent)]">
          <Sparkle />
        </span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => peek && setSnap("half")}>
          <p className="text-[15px] font-bold leading-tight">Folio assistant</p>
          <p className="truncate text-[11px] text-ink-3">{peek ? "Tap to ask about your portfolio" : `Knows your ${positions.length} holdings and every trade`}</p>
        </button>
        {messages.length > 0 && !peek && (
          <button
            type="button"
            onClick={() => confirm("Clear this conversation? It can't be undone.") && setChat([])}
            className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-ink-3 hover:bg-sunken hover:text-ink"
          >
            Clear
          </button>
        )}
        <button type="button" onClick={() => setSnap(peek ? "half" : "peek")} aria-label={peek ? "Expand" : "Minimise"} className="grid size-8 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink lg:hidden">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={peek ? "rotate-180" : ""}>
            <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" onClick={onClose} aria-label="Close assistant" className="grid size-8 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink">
          <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden>
            <path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {!peek && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {!ai.status?.enabled ? (
              <p className="rounded-2xl bg-sunken p-4 text-sm text-ink-2">The assistant needs an AI key on the server (LLM_API_KEY). Everything else in Folio works without it.</p>
            ) : (
              <div className="space-y-4">
                <Bubble role="assistant">
                  <Rich text={greeting} />
                </Bubble>
                {messages.map((m) => (
                  <div key={m.id} className="item-in space-y-2">
                    <Bubble role={m.role}>{m.role === "assistant" ? <Rich text={m.text} /> : m.text}</Bubble>
                    {m.card?.kind === "trade" && <TradeCard card={m.card} positions={positions} currency={currency} usdInr={usdInr} onUpdate={(p) => updateCard(m.id, p)} onSaved={props.onSaved} />}
                    {m.card?.kind === "cash" && <CashActionCard card={m.card} onUpdate={(p) => updateCard(m.id, p)} onSaved={props.onSaved} />}
                    {m.card?.kind === "whatif" && <WhatIfCard card={m.card} positions={positions} totals={totals} currency={currency} usdInr={usdInr} />}
                  </div>
                ))}
                {busy && (
                  <Bubble role="assistant">
                    <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${i * 120}ms` }} />
                      ))}
                    </span>
                  </Bubble>
                )}
                {error && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-down-soft px-3.5 py-2.5 text-[13px] text-down">
                    <span>{error}</span>
                    {failed && (
                      <button type="button" onClick={() => void send(failed.text, failed)} className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink ring-1 ring-line hover:bg-sunken">
                        Try again
                      </button>
                    )}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {ai.status?.enabled && (
            <div className="shrink-0 border-t border-line px-4 pb-4 pt-3">
              {chips.length > 0 && !busy && (
                <div className="-mx-4 mb-2.5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
                  {chips.map((c) => (
                    <button key={c} type="button" onClick={() => void send(c)} className="press shrink-0 rounded-full bg-sunken px-3 py-1.5 text-xs font-medium text-ink-2 ring-1 ring-line hover:text-ink">
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
                className="field-wrap flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3.5 transition-shadow"
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(text);
                    }
                  }}
                  placeholder="Ask about your portfolio, or tell me a trade…"
                  aria-label="Message the assistant"
                  className="max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-2 text-[14px] outline-none placeholder:text-ink-3"
                />
                <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="press grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                  </svg>
                </button>
              </form>
              <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
                Answers come from your own numbers via {ai.status?.model ?? "AI"} on {ai.status?.provider ?? "the AI service"}. It can be wrong, and it isn&apos;t investment advice.{" "}
                <button type="button" className="font-semibold text-accent hover:underline" onClick={() => (ai.revoke(), onClose())}>
                  Turn off AI
                </button>
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return role === "user" ? (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[18px] rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-snug text-white">{children}</div>
    </div>
  ) : (
    <div className="flex gap-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Sparkle size={11} />
      </span>
      <div className="min-w-0 max-w-[92%] text-[14px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Cards                                                                      */
/* ------------------------------------------------------------------------ */

const PRICE_NOTE = { you: "price you gave", total: "from your total", live: "today's price", close: "close that day", avg: "your average" } as const;

/** Everything needed to work out a trade on one asset: what's held, live price, closes. */
function useTradeBasis(payload: Record<string, unknown>, positions: Position[]) {
  const { data } = useStore();
  const assetId = payload.assetId as string | null;
  const newHolding = payload.newHolding as { query: string; assetType: AssetClass | null } | null;
  const trade = payload.trade as ParsedTrade | null;
  const [found, setFound] = useState<{ hit: SearchHit; price: number | null } | null | "none">(null);
  const [closes, setCloses] = useState<Candle[] | null>(null);
  const existing = assetId ? data.assets.find((a) => a.id === assetId) : undefined;
  const asset: Pick<Asset, "cls" | "symbol" | "currency" | "name" | "ticker"> | undefined = existing ?? (found && found !== "none" ? found.hit : undefined);

  // Something not held yet: find it and its price.
  useEffect(() => {
    if (existing || !newHolding) return;
    let alive = true;
    searchAssets(newHolding.query, newHolding.assetType ?? "in_stock")
      .then(async (hits) => {
        const hit = hits[0];
        if (!hit) return alive && setFound("none");
        const r = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ cls: hit.cls, symbol: hit.symbol, currency: hit.currency }] }) });
        const j = (await r.json()) as { quotes: Record<string, Quote> };
        if (alive) setFound({ hit, price: j.quotes?.[quoteKey(hit)]?.price ?? null });
      })
      .catch(() => alive && setFound("none"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, newHolding?.query]);

  // A past date (or "closing price") needs daily closes.
  const needsCloses = !!trade && ((!!trade.date && trade.date !== ymd(new Date(clock()))) || trade.priceRule === "close");
  useEffect(() => {
    if (!needsCloses || !asset?.symbol) return;
    let alive = true;
    fetchHistory(asset, "1Y", true)
      .then((c) => alive && setCloses(c))
      .catch(() => alive && setCloses([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCloses, asset?.symbol]);

  const txns = existing ? data.txns.filter((t) => t.assetId === existing.id) : [];
  const held = replay(txns);
  const history = heldHistory(txns);
  const position = existing ? positions.find((p) => p.asset.id === existing.id) : undefined;
  const livePrice = position?.price ?? (found && found !== "none" ? found.price : null);
  const ready = !!asset && (!needsCloses || closes !== null || !asset.symbol);
  return { data, existing, asset, found, held, history, position, livePrice, closes, trade, ready, newHolding };
}

function TradeCard({
  card,
  positions,
  currency,
  usdInr,
  onUpdate,
  onSaved,
}: {
  card: ChatCard;
  positions: Position[];
  currency: Currency;
  usdInr: number;
  onUpdate: (p: Partial<ChatCard>) => void;
  onSaved: (m: string) => void;
}) {
  const { addTxn, upsertAsset, updateAsset } = useStore();
  const b = useTradeBasis(card.payload, positions);
  const [funding, setFunding] = useState<"cash" | "new" | null>(((card.payload.trade as ParsedTrade | null)?.paidFrom as "cash" | "new" | null | undefined) ?? null);

  if (card.status === "saved" || card.status === "cancelled") {
    return (
      <div className={`ml-8 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] ${card.status === "saved" ? "bg-up-soft text-up" : "bg-sunken text-ink-3"}`}>
        {card.status === "saved" ? "✓ Recorded: " : "Cancelled. "}
        <span className="text-ink-2">{card.saved ?? ""}</span>
      </div>
    );
  }
  if (b.found === "none" && !b.existing) return <CardShell>I couldn&apos;t find “{b.newHolding?.query}”. Try its exact name or ticker, or use Add a holding.</CardShell>;
  if (!b.asset || !b.trade || !b.ready) return <CardShell>Working out the trade…</CardShell>;

  const asset = b.asset;
  const cur = asset.currency;
  const accounts = b.data.accounts.map((a) => ({ id: a.id, name: a.name }));
  const lastAccount = b.existing ? [...b.data.txns].filter((t) => t.assetId === b.existing!.id).sort((x, y) => y.ts - x.ts)[0]?.accountId : undefined;
  const res = resolveTrade(
    b.trade,
    {
      today: ymd(new Date(clock())),
      accounts,
      heldBy: b.held.byAccount,
      currentAccountId: lastAccount ?? accounts[0]?.id ?? "",
      livePrice: b.livePrice,
      avg: b.held.qty > 0 ? b.held.cost / b.held.qty : 0,
      closeOn: (d) => (b.closes?.length ? closeAt(b.closes, new Date(`${d}T23:59:59`).getTime()) : null),
      heldOn: b.history.heldOn,
      firstDateWith: b.history.firstDateWith,
    },
    cur,
    usdInr,
  );
  const q = res.legs.reduce((s, l) => s + (l.qty ?? 0), 0);
  const p = res.price ?? 0;
  const avg = b.held.qty > 0 ? b.held.cost / b.held.qty : 0;
  const unit = CLASS_META[asset.cls].unit;
  const legName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "";
  const brokers = res.legs.filter((l) => (l.qty ?? 0) > 0).map((l) => (res.legs.length > 1 ? `${legName(l.accountId)} ${fmtQty(l.qty!)}` : legName(l.accountId))).join(" + ");
  const isToday = res.date === ymd(new Date(clock()));
  const when = new Date(`${res.date}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const all = res.type === "sell" && b.held.qty > 0 && Math.abs(q - b.held.qty) < Math.max(1e-9, b.held.qty * 1e-7);
  const cashHere = cashBalances(b.data)[cur];
  const askFunding = res.type === "buy" && cashHere > 0;
  const fromCash = askFunding && funding === "cash" ? Math.min(cashHere, q * p) : 0;
  const canSave = !!res.type && q > 0 && p > 0 && !res.missing.length && !res.problems.length && (!askFunding || !!funding);
  const verb = res.type === "sell" ? "Sold" : res.type === "buy" ? "Bought" : "Traded";
  const summary = `${verb} ${all ? "all " : ""}${fmtQty(q)} ${unit} of ${asset.name} at ${fmtPrice(p, cur)} on ${when}${brokers ? ` (${brokers})` : ""}`;

  function confirmSave() {
    if (!canSave) return;
    const id = b.existing?.id ?? upsertAsset({ cls: asset.cls, symbol: asset.symbol, ticker: asset.ticker, name: asset.name, currency: asset.currency }).id;
    const time = res.time ?? (asset.cls === "in_stock" ? "15:30" : "12:00");
    const ts = isToday ? clock() : new Date(`${res.date}T${time}`).getTime();
    if (!asset.symbol) updateAsset(id, { manualPrice: { price: p, ts } });
    for (const l of res.legs) {
      if (!(l.qty! > 0)) continue;
      const here = b.held.byAccount[l.accountId] ?? 0;
      const units = res.type === "sell" && Math.abs(l.qty! - here) <= Math.max(1e-9, here * 1e-7) ? here : l.qty!;
      addTxn({ assetId: id, accountId: l.accountId, type: res.type!, qty: units, price: p, ts, opening: false, via: "Ask Folio" }, { fromCash: askFunding && funding === "cash" });
    }
    const cashNote = res.type === "sell" ? ` · ${money(q * p, cur)} to cash` : fromCash > 0 ? ` · ${money(fromCash, cur)} from cash` : "";
    onUpdate({ status: "saved", saved: summary + cashNote });
    onSaved(res.type === "sell" ? "Sale added" : "Purchase added");
  }

  const need = [...res.missing.map((m) => (m === "type" ? "whether you bought or sold" : m === "quantity" ? `how many ${unit}` : "the price")), ...res.problems];
  return (
    <div className="ml-8 overflow-hidden rounded-[20px] ring-1 ring-accent/35">
      <div className="flex items-center gap-3 bg-accent-soft px-3.5 py-3">
        <AssetBadge position={b.position ?? { asset: { ...asset, id: "new" } }} size={30} ring={false} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-accent">{b.existing ? "Record this trade?" : "Add this new holding?"}</p>
          <p className="num truncate text-[14px] font-bold">
            {verb} {all ? "all " : ""}
            {q > 0 ? `${fmtQty(q)} ${unit}` : unit} of {asset.name}
          </p>
        </div>
      </div>
      <dl className="num grid grid-cols-2 gap-x-3 gap-y-2.5 bg-surface px-3.5 py-3 text-[13px]">
        <Fact label="Price each" value={p > 0 ? fmtPrice(p, cur) : "—"} sub={res.priceFrom ? PRICE_NOTE[res.priceFrom] : "needed"} />
        <Fact label={res.type === "sell" ? "You received" : "You paid"} value={q > 0 && p > 0 ? money(q * p, cur) : "—"} sub={cur !== currency && q > 0 && p > 0 ? money(convert(q * p, cur, currency, usdInr), currency) : undefined} />
        <Fact label="When" value={when} sub={isToday ? "today" : undefined} />
        <Fact label="Broker" value={brokers || "—"} />
      </dl>
      {res.type === "sell" && q > 0 && p > 0 && avg > 0 && !res.problems.length && (
        <p className="num border-t border-line bg-surface px-3.5 py-2 text-xs text-ink-2">
          Gain on these: <b className={p >= avg ? "text-up" : "text-down"}>{signed(q * (p - avg), cur)}</b> ({pct((p / avg - 1) * 100)}).{all ? " Closes your position." : ""}
        </p>
      )}
      {res.type === "buy" && q > 0 && p > 0 && b.held.qty > 0 && (
        <p className="num border-t border-line bg-surface px-3.5 py-2 text-xs text-ink-2">
          Average cost goes from {fmtPrice(avg, cur)} to <b className="text-ink">{fmtPrice((b.held.cost + q * p) / (b.held.qty + q), cur)}</b>.
        </p>
      )}
      {res.type === "sell" && q > 0 && p > 0 && !res.problems.length && (
        <p className="num border-t border-line bg-surface px-3.5 py-2 text-xs text-ink-2">
          <b className="text-ink">{money(q * p, cur)}</b> goes into your cash.
        </p>
      )}
      {askFunding && q > 0 && p > 0 && (
        <div className="border-t border-line bg-surface px-3.5 py-2.5">
          <p className="mb-1.5 text-xs font-semibold">Where did the money come from?</p>
          <div className="flex flex-wrap gap-1.5">
            {(["cash", "new"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFunding(f)}
                className={`press h-7 rounded-full px-2.5 text-[11.5px] font-semibold ring-1 transition-colors ${funding === f ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
              >
                {f === "cash" ? `My cash (${money(cashHere, cur)})` : "New money"}
              </button>
            ))}
          </div>
          {funding === "cash" && (
            <p className="num mt-1.5 text-[11px] text-ink-3">
              {fromCash < q * p ? `Uses all ${money(fromCash, cur)} of cash; the other ${money(q * p - fromCash, cur)} counts as new money.` : `Leaves ${money(cashHere - fromCash, cur)} in cash.`}
            </p>
          )}
        </div>
      )}
      {need.length > 0 && (
        <div className="border-t border-line bg-surface px-3.5 py-2 text-xs font-semibold text-down">
          {res.earliestDate ? res.problems[0] : `Still needed: ${need.join("; ")}. Just reply with it.`}
          {res.earliestDate && (
            <button
              type="button"
              onClick={() => onUpdate({ payload: { ...card.payload, trade: { ...b.trade!, date: res.earliestDate } } })}
              className="mt-1.5 block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent hover:brightness-105"
            >
              Record it on {new Date(`${res.earliestDate}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} instead
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2 border-t border-line bg-surface p-2.5">
        <Button onClick={confirmSave} disabled={!canSave} className="h-9 flex-1">
          Confirm and save
        </Button>
        <Button variant="quiet" className="h-9" onClick={() => onUpdate({ status: "cancelled", saved: summary })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Money added to or taken out of cash, described in the chat. Saved only on confirm. */
function CashActionCard({ card, onUpdate, onSaved }: { card: ChatCard; onUpdate: (p: Partial<ChatCard>) => void; onSaved: (m: string) => void }) {
  const { data, addCash } = useStore();
  const pl = card.payload as { direction: "add" | "withdraw"; amount: number; currency: Currency; date: string | null; note: string | null };
  const [cur, setCur] = useState<Currency>(pl.currency ?? "INR");
  if (card.status === "saved" || card.status === "cancelled") {
    return (
      <div className={`ml-8 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] ${card.status === "saved" ? "bg-up-soft text-up" : "bg-sunken text-ink-3"}`}>
        {card.status === "saved" ? "✓ Recorded: " : "Cancelled. "}
        <span className="text-ink-2">{card.saved ?? ""}</span>
      </div>
    );
  }
  const add = pl.direction === "add";
  const today = ymd(new Date(clock()));
  const date = pl.date ?? today;
  const ts = date === today ? null : new Date(`${date}T12:00`).getTime();
  const have = cashBalances(data, ts ?? Infinity)[cur];
  const short = !add && pl.amount > have + 0.005;
  const label = `${add ? "Added" : "Withdrew"} ${money(pl.amount, cur)} ${add ? "to" : "from"} cash${date !== today ? ` on ${new Date(`${date}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}`;
  function confirm() {
    if (short) return;
    addCash({ currency: cur, amount: add ? pl.amount : -pl.amount, ts: ts ?? clock(), kind: add ? "added" : "withdrawn", note: pl.note ?? undefined, via: "Ask Folio" });
    onUpdate({ status: "saved", saved: label });
    onSaved(add ? "Cash added" : "Cash withdrawn");
  }
  return (
    <div className="ml-8 overflow-hidden rounded-[20px] ring-1 ring-[color-mix(in_srgb,var(--cat-6)_45%,transparent)]">
      <div className="flex items-center gap-3 px-3.5 py-3" style={{ background: "color-mix(in srgb, var(--cat-6) 14%, var(--surface))" }}>
        <span className="grid size-[30px] place-items-center rounded-full text-white" style={{ background: "var(--cat-6)" }}>
          {Icon.wallet}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold" style={{ color: "var(--cat-6)" }}>
            {add ? "Add to your cash?" : "Take out of your cash?"}
          </p>
          <p className="num truncate text-[14px] font-bold">{money(pl.amount, cur)}</p>
        </div>
        <div className="ml-auto flex rounded-full bg-surface p-0.5 ring-1 ring-line">
          {(["INR", "USD"] as Currency[]).map((c) => (
            <button key={c} type="button" onClick={() => setCur(c)} className={`h-6 rounded-full px-2 text-[11px] font-bold ${cur === c ? "bg-ink text-canvas" : "text-ink-3"}`} aria-pressed={cur === c}>
              {c === "INR" ? "₹" : "$"}
            </button>
          ))}
        </div>
      </div>
      <dl className="num grid grid-cols-2 gap-x-3 gap-y-2.5 bg-surface px-3.5 py-3 text-[13px]">
        <Fact label="When" value={new Date(`${date}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} sub={date === today ? "today" : undefined} />
        <Fact label="Cash after" value={money(Math.max(0, have + (add ? pl.amount : -pl.amount)), cur)} sub={pl.note ?? undefined} />
      </dl>
      {short && <p className="border-t border-line bg-surface px-3.5 py-2 text-xs font-semibold text-down">You {ts ? "had" : "have"} {money(have, cur)} in cash{ts ? " then" : ""}, so you can&apos;t take out {money(pl.amount, cur)}.</p>}
      <div className="flex gap-2 border-t border-line bg-surface p-2.5">
        <Button onClick={confirm} disabled={short} className="h-9 flex-1">
          Confirm and save
        </Button>
        <Button variant="quiet" className="h-9" onClick={() => onUpdate({ status: "cancelled", saved: label })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function WhatIfCard({ card, positions, totals, currency, usdInr }: { card: ChatCard; positions: Position[]; totals: Totals; currency: Currency; usdInr: number }) {
  const b = useTradeBasis(card.payload, positions);
  const pctMove = card.payload.priceChangePct as number | null;

  if (pctMove !== null && pctMove !== undefined) {
    const ids = (card.payload.assetIds as string[]) ?? [];
    const cls = card.payload.cls as AssetClass | null;
    const one = card.payload.assetId as string | null;
    const hit = positions.filter((p) => (ids.length ? ids.includes(p.asset.id) : one ? p.asset.id === one : cls ? p.asset.cls === cls : true));
    const disp = (p: Position) => convert(p.value ?? p.cost, p.asset.currency, currency, usdInr);
    const base = hit.reduce((s, p) => s + disp(p), 0);
    const delta = (base * pctMove) / 100;
    const label = ids.length || one ? hit.map((p) => p.asset.name).join(", ") : cls ? CLASS_META[cls].label : "your whole portfolio";
    return (
      <div className="ml-8 rounded-[20px] bg-sunken/70 p-3.5 ring-1 ring-line">
        <p className="text-[11px] font-semibold text-ink-3">What if {label} moved {pct(pctMove)}?</p>
        <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[13px]">
          <Fact label="Those holdings now" value={money(base, currency, { decimals: 0 })} />
          <Fact label="Change" value={signed(delta, currency)} tone={delta} />
          <Fact label="Net worth would be" value={money(totals.value + delta, currency, { decimals: 0 })} sub={`${pct(totals.value > 0 ? (delta / totals.value) * 100 : 0)} overall`} />
          <Fact label="Total return would be" value={signed(totals.gain + delta, currency)} tone={totals.gain + delta} sub={totals.cost > 0 ? pct(((totals.gain + delta) / totals.cost) * 100) : undefined} />
        </dl>
        <p className="mt-2 text-[10.5px] text-ink-3">Worked out by Folio from today&apos;s values. For exploring only — not a prediction.</p>
      </div>
    );
  }

  const target = card.payload.targetAvgPrice as number | null;
  if (target && b.asset) {
    // Units to buy at price P so (cost + q·P) / (units + q) reaches the target average T: q = (cost − T·units) / (T − P).
    const asset = b.asset;
    const cur = asset.currency;
    const unit = CLASS_META[asset.cls].unit;
    const P = b.trade?.pricePerUnit ?? b.livePrice;
    const Q = b.held.qty;
    const C = b.held.cost;
    const A = Q > 0 ? C / Q : 0;
    let body: ReactNode;
    if (!P) body = <p>I need a price to work this out — there&apos;s no live price for {asset.name}.</p>;
    else if (Q <= 0) body = <p>You don&apos;t hold any {asset.name} yet, so any purchase price becomes your average.</p>;
    else if (A <= target) body = <p>Your average is already {fmtPrice(A, cur)}, at or below {fmtPrice(target, cur)}.</p>;
    else if (P >= target) body = <p>At {fmtPrice(P, cur)} each, buying more can never bring your average below {fmtPrice(target, cur)} — every purchase would be at or above it.</p>;
    else {
      const q = (C - target * Q) / (target - P);
      body = (
        <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[13px]">
          <Fact label={`${unit[0].toUpperCase()}${unit.slice(1)} to buy`} value={`just over ${fmtQty(q)}`} />
          <Fact label="It would cost" value={money(q * P, cur)} sub={cur !== currency ? money(convert(q * P, cur, currency, usdInr), currency) : undefined} />
          <Fact label="Average now" value={fmtPrice(A, cur)} sub={`${fmtQty(Q)} ${unit}`} />
          <Fact label="Average after" value={`below ${fmtPrice(target, cur)}`} sub={`${fmtQty(Q + q)} ${unit}`} />
        </dl>
      );
    }
    return (
      <div className="ml-8 rounded-[20px] bg-sunken/70 p-3.5 ring-1 ring-line">
        <p className="text-[11px] font-semibold text-ink-3">
          To bring your {asset.name} average below {fmtPrice(target, cur)}
          {P ? `, buying at ${fmtPrice(P, cur)}${b.trade?.pricePerUnit ? "" : " (today's price)"}` : ""}
        </p>
        <div className="text-[13px] text-ink-2">{body}</div>
        <p className="mt-2 text-[10.5px] text-ink-3">Worked out by Folio from your holding. Maths only — not a suggestion to buy.</p>
      </div>
    );
  }

  if (!b.asset || !b.trade || !b.ready) return <CardShell>Working it out…</CardShell>;
  const asset = b.asset;
  const cur = asset.currency;
  const accounts = b.data.accounts.map((a) => ({ id: a.id, name: a.name }));
  const avg = b.held.qty > 0 ? b.held.cost / b.held.qty : 0;
  const res = resolveTrade(
    b.trade,
    { today: ymd(new Date(clock())), accounts, heldBy: b.held.byAccount, currentAccountId: accounts[0]?.id ?? "", livePrice: b.livePrice, avg, closeOn: (d) => (b.closes?.length ? closeAt(b.closes, new Date(`${d}T23:59:59`).getTime()) : null) },
    cur,
    usdInr,
  );
  const q = res.legs.reduce((s, l) => s + (l.qty ?? 0), 0);
  const p = res.price ?? 0;
  const unit = CLASS_META[asset.cls].unit;
  if (!(q > 0) || !(p > 0)) return <CardShell>I need {!(q > 0) ? `how many ${unit}` : "a price"} to work that out.</CardShell>;
  const sell = res.type === "sell";
  const left = Math.max(0, b.held.qty - q);
  return (
    <div className="ml-8 rounded-[20px] bg-sunken/70 p-3.5 ring-1 ring-line">
      <p className="text-[11px] font-semibold text-ink-3">
        If you {sell ? "sold" : "bought"} {fmtQty(q)} {unit} of {asset.name} at {fmtPrice(p, cur)} ({res.priceFrom ? PRICE_NOTE[res.priceFrom] : ""})
      </p>
      <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[13px]">
        {sell ? (
          <>
            <Fact label="You'd receive" value={money(q * p, cur)} sub={cur !== currency ? money(convert(q * p, cur, currency, usdInr), currency) : undefined} />
            <Fact label="Gain on those" value={avg ? signed(q * (p - avg), cur) : "—"} tone={q * (p - avg)} sub={avg ? pct((p / avg - 1) * 100) : undefined} />
            <Fact label={`${unit[0].toUpperCase()}${unit.slice(1)} left`} value={fmtQty(left)} />
            <Fact label="Left over is worth" value={money(left * (b.livePrice ?? p), cur)} />
          </>
        ) : (
          <>
            <Fact label="You'd pay" value={money(q * p, cur)} sub={cur !== currency ? money(convert(q * p, cur, currency, usdInr), currency) : undefined} />
            <Fact label="Average cost" value={fmtPrice((b.held.cost + q * p) / (b.held.qty + q), cur)} sub={avg ? `now ${fmtPrice(avg, cur)}` : "new holding"} />
            <Fact label={`${unit[0].toUpperCase()}${unit.slice(1)} after`} value={fmtQty(b.held.qty + q)} />
            <Fact label="Invested after" value={money(b.held.cost + q * p, cur)} />
          </>
        )}
      </dl>
      {sell && res.problems.length > 0 && <p className="mt-2 text-xs font-semibold text-down">{res.problems[0]}</p>}
      <p className="mt-2 text-[10.5px] text-ink-3">Worked out by Folio from your holding. Nothing is saved; for exploring only.</p>
    </div>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return <div className="ml-8 rounded-[20px] bg-sunken/70 px-3.5 py-3 text-[13px] text-ink-2 ring-1 ring-line">{children}</div>;
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={`truncate font-bold ${tone === undefined ? "" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : ""}`}>{value}</dd>
      {sub && <dd className="truncate text-[11px] text-ink-3">{sub}</dd>}
    </div>
  );
}
