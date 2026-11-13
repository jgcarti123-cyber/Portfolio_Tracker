export type AssetClass = "in_stock" | "us_stock" | "crypto" | "mf";
export type Currency = "INR" | "USD";

export const CLASS_META: Record<
  AssetClass,
  { label: string; short: string; color: string; unit: string; glyph: string; hint: string; popular: string[] }
> = {
  in_stock: { label: "Indian stocks", short: "Indian stock", color: "var(--cat-1)", unit: "shares", glyph: "₹", hint: "NSE and BSE", popular: ["Reliance", "TCS", "HDFC Bank", "Infosys", "ITC"] },
  us_stock: { label: "US stocks", short: "US stock", color: "var(--cat-2)", unit: "shares", glyph: "$", hint: "NYSE and Nasdaq", popular: ["Apple", "Nvidia", "Microsoft", "Tesla", "Alphabet"] },
  mf: { label: "Mutual funds", short: "Mutual fund", color: "var(--cat-3)", unit: "units", glyph: "◔", hint: "Indian funds", popular: ["Parag Parikh Flexi Cap", "Nifty 50 Index", "HDFC Mid Cap", "SBI Small Cap"] },
  crypto: { label: "Crypto", short: "Crypto", color: "var(--cat-4)", unit: "coins", glyph: "₿", hint: "Priced in dollars", popular: ["Bitcoin", "Ethereum", "Solana", "XRP"] },
};
export const CLASS_ORDER: AssetClass[] = ["in_stock", "us_stock", "mf", "crypto"];

/** Fixed order so an account keeps its colour as others come and go. */
export const ACCOUNT_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

export interface Account {
  id: string;
  name: string;
}

export interface Asset {
  id: string;
  cls: AssetClass;
  /** Price-feed key: Yahoo symbol, CoinGecko id or AMFI scheme code. Empty = no feed, manual price only. */
  symbol: string;
  ticker: string;
  name: string;
  currency: Currency;
  /** A price the user typed in, with the moment it was true. */
  manualPrice?: { price: number; ts: number };
  /** When true the manual price wins over the live feed. */
  useManual?: boolean;
}

export interface Txn {
  id: string;
  assetId: string;
  accountId: string;
  type: "buy" | "sell";
  qty: number;
  /** Per unit, in the asset's currency. */
  price: number;
  ts: number;
  /**
   * True for a holding added to Folio as it already stood (imported, or added with
   * what was invested), rather than a buy or sell made that day. Older records have no
   * flag; for them the first record of each asset counts as the opening entry.
   */
  opening?: boolean;
  /** Where an opening entry came from, e.g. "Groww statement". */
  via?: string;
}

/** A card the assistant showed inside a reply: a trade to confirm, or a what-if result. */
export interface ChatCard {
  kind: "trade" | "whatif" | "cash";
  status?: "pending" | "saved" | "cancelled";
  /** What was saved, in words, once confirmed. */
  saved?: string;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  card?: ChatCard;
  suggestions?: string[];
}

/**
 * A movement of cash, kept per currency. Positive = cash in (money added, a sale),
 * negative = cash out (a withdrawal, a buy paid from cash).
 */
export interface CashEntry {
  id: string;
  currency: Currency;
  amount: number;
  ts: number;
  kind: "added" | "withdrawn" | "sale" | "buy";
  /** The trade that moved it, for "sale" and "buy". */
  txnId?: string;
  note?: string;
  via?: string;
}

export interface VaultData {
  accounts: Account[];
  assets: Asset[];
  txns: Txn[];
  /** Cash ledger. Started empty: sales recorded before cash existed don't count. */
  cash?: CashEntry[];
  /** Conversation with the assistant, kept inside the encrypted vault. */
  chat?: ChatMessage[];
}

export interface Quote {
  price: number;
  prevClose: number | null;
  ts: number;
}

export interface Candle {
  /** Unix seconds */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SearchHit {
  cls: AssetClass;
  symbol: string;
  ticker: string;
  name: string;
  currency: Currency;
  exchange?: string;
}

export type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";

export const quoteKey = (a: Pick<Asset, "cls" | "symbol" | "currency">) =>
  `${a.cls}:${a.symbol}:${a.currency}`;
