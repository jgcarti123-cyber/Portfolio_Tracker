import { convert } from "./portfolio";
import type { CashEntry, Currency, VaultData } from "./types";

export type CashBalances = Record<Currency, number>;

/** Cash held in each currency at a moment (now by default). Never below zero. */
export function cashBalances(data: Pick<VaultData, "cash">, at = Infinity): CashBalances {
  const out: CashBalances = { INR: 0, USD: 0 };
  for (const e of data.cash ?? []) if (e.ts <= at) out[e.currency] += e.amount;
  out.INR = Math.max(0, round(out.INR));
  out.USD = Math.max(0, round(out.USD));
  return out;
}

/** All cash in one currency. */
export const cashTotal = (b: CashBalances, display: Currency, usdInr: number) =>
  b.INR * (display === "INR" ? 1 : 1 / usdInr) + convert(b.USD, "USD", display, usdInr);

const round = (n: number) => Math.round(n * 100) / 100;

export const CASH_COLOR = "var(--cat-6)";

export const CASH_LABEL: Record<CashEntry["kind"], string> = {
  added: "Cash added",
  withdrawn: "Cash withdrawn",
  sale: "From a sale",
  buy: "Paid for a buy",
};
