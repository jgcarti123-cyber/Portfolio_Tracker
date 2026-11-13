"use client";

import { useState } from "react";
import { CASH_COLOR, CASH_LABEL, cashBalances, cashTotal } from "@/lib/cash";
import { money, toLocalInput } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { CashEntry, Currency } from "@/lib/types";
import { Button, Card, CardHead, Icon, MoneyInput, Segmented } from "./ui";

type Mode = "added" | "withdrawn";
type Day = "today" | "yesterday" | "pick";
const clock = () => Date.now();

/**
 * Cash held, per currency. Sales land here on their own; money can be added or taken
 * out by hand. It counts towards net worth but never as a gain or loss.
 */
export function CashCard({
  currency,
  usdInr,
  onSaved,
}: {
  currency: Currency;
  usdInr: number;
  onSaved?: (m: string) => void;
}) {
  const { data, addCash, deleteCash } = useStore();
  const bal = cashBalances(data);
  const total = cashTotal(bal, currency, usdInr);
  const [mode, setMode] = useState<Mode | null>(null);
  const [cur, setCur] = useState<Currency>(currency);
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState<Day>("today");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const recent = [...(data.cash ?? [])].sort((a, b) => b.ts - a.ts);
  const list = showAll ? recent : recent.slice(0, 4);

  function open(m: Mode) {
    setMode(m);
    setAmount("");
    setNote("");
    setError("");
    setDay("today");
    setWhen(toLocalInput(clock()));
    // Withdraw from whichever currency actually has cash.
    if (m === "withdrawn" && bal[cur] <= 0) setCur(bal.INR > 0 ? "INR" : "USD");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;
    const n = Number(amount);
    if (!(n > 0) || !isFinite(n)) return setError("Enter an amount.");
    const now = clock();
    const ts =
      day === "today"
        ? now
        : day === "yesterday"
          ? now - 86_400_000
          : new Date(when).getTime();
    if (!isFinite(ts) || ts > now + 60_000)
      return setError("That date is in the future.");
    if (mode === "withdrawn") {
      const at = cashBalances(data, ts)[cur];
      if (n > at + 0.005)
        return setError(
          at > 0
            ? `You only had ${money(at, cur)} in cash then.`
            : `There's no ${cur === "INR" ? "rupee" : "dollar"} cash to take out${day === "today" ? "" : " on that date"}.`,
        );
    }
    addCash({
      currency: cur,
      amount: mode === "added" ? n : -n,
      ts,
      kind: mode,
      note: note.trim() || undefined,
    });
    onSaved?.(
      mode === "added"
        ? `Added ${money(n, cur)} cash`
        : `Withdrew ${money(n, cur)} cash`,
    );
    setMode(null);
  }

  const chip = (on: boolean) =>
    `press inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`;

  return (
    <Card className="p-5 sm:p-6">
      <CardHead icon={Icon.wallet} title="Cash" color={CASH_COLOR}>
        <span className="num text-[17px] font-extrabold tracking-tight">
          {money(total, currency, { decimals: 0 })}
        </span>
      </CardHead>

      <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
        <div>
          <div className="grid grid-cols-2 gap-2">
            {(["INR", "USD"] as Currency[]).map((c) => (
              <div
                key={c}
                className={`rounded-2xl bg-sunken px-3.5 py-2.5 ring-1 ring-line ${bal[c] > 0 ? "" : "opacity-60"}`}
              >
                <p className="text-[11px] text-ink-3">
                  {c === "INR" ? "Rupees" : "Dollars"}
                </p>
                <p className="num truncate text-[15px] font-bold">
                  {money(bal[c], c)}
                </p>
              </div>
            ))}
          </div>

          {mode ? (
            <form
              onSubmit={save}
              className="item-in mt-4 space-y-3 rounded-2xl bg-sunken/60 p-3.5 ring-1 ring-line"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">
                  {mode === "added" ? "Add cash" : "Withdraw cash"}
                </p>
                <Segmented
                  options={[
                    { value: "INR", label: "₹" },
                    { value: "USD", label: "$" },
                  ]}
                  value={cur}
                  onChange={(c) => (setCur(c), setError(""))}
                  label="Currency"
                  size="sm"
                />
              </div>
              <MoneyInput
                id="cash-amount"
                value={amount}
                onChange={(v) => (setAmount(v), setError(""))}
                currency={cur}
                autoFocus
              />
              {mode === "withdrawn" && bal[cur] > 0 && (
                <button
                  type="button"
                  className={chip(Number(amount) === bal[cur])}
                  onClick={() => setAmount(String(bal[cur]))}
                >
                  All {money(bal[cur], cur)}
                </button>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={chip(day === "today")}
                  onClick={() => setDay("today")}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={chip(day === "yesterday")}
                  onClick={() => setDay("yesterday")}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  className={chip(day === "pick")}
                  onClick={() => setDay("pick")}
                >
                  Pick a date
                </button>
                {day === "pick" && (
                  <input
                    type="datetime-local"
                    aria-label="When"
                    className="field num h-8 w-auto py-0 text-[12px]"
                    value={when}
                    max={toLocalInput(clock())}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                )}
              </div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional), e.g. Groww wallet"
                maxLength={60}
                className="field h-10 text-[13px]"
                aria-label="Note"
              />
              {error && (
                <p role="alert" className="text-[12px] font-semibold text-down">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  {mode === "added" ? "Add" : "Withdraw"}
                  {Number(amount) > 0 ? ` ${money(Number(amount), cur)}` : ""}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setMode(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => open("added")}>
                {Icon.plus} Add cash
              </Button>
              <Button
                variant="ghost"
                onClick={() => open("withdrawn")}
                disabled={bal.INR <= 0 && bal.USD <= 0}
              >
                Withdraw
              </Button>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {recent.length > 0 ? (
            <ul className="-mt-2 divide-y divide-line">
              {list.map((e) => (
                <Row
                  key={e.id}
                  e={e}
                  confirming={confirmDel === e.id}
                  onAsk={() => setConfirmDel(e.id)}
                  onCancel={() => setConfirmDel(null)}
                  onDelete={() => (deleteCash(e.id), setConfirmDel(null))}
                />
              ))}
              {recent.length > 4 && (
                <li className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAll(!showAll)}
                    className="text-xs font-semibold text-ink-2 hover:text-ink"
                  >
                    {showAll ? "Show less" : `Show all ${recent.length}`}
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed text-ink-3 md:pt-1">
              Money from sales you record lands here. Add what&apos;s sitting in
              your broker wallets so net worth includes it. Cash counts towards
              net worth, never as a gain or loss.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({
  e,
  confirming,
  onAsk,
  onCancel,
  onDelete,
}: {
  e: CashEntry;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const manual = e.kind === "added" || e.kind === "withdrawn";
  return (
    <li className="group flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">
          {e.note || CASH_LABEL[e.kind]}
        </span>
        <span className="block truncate text-[11px] text-ink-3">
          {new Date(e.ts).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })}
          {e.note ? ` · ${CASH_LABEL[e.kind]}` : ""}
          {e.via ? ` · via ${e.via}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full bg-down px-2.5 py-1 text-[11px] font-bold text-white"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-2 py-1 text-[11px] font-semibold text-ink-2"
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <span
              className={`num text-[13px] font-bold ${e.amount > 0 ? "text-up" : ""}`}
            >
              {e.amount > 0 ? "+" : "−"}
              {money(Math.abs(e.amount), e.currency)}
            </span>
            {manual && (
              <button
                type="button"
                onClick={onAsk}
                aria-label="Remove this entry"
                className="text-ink-3 opacity-0 transition-opacity hover:text-down focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
              >
                {Icon.trash}
              </button>
            )}
          </>
        )}
      </span>
    </li>
  );
}
