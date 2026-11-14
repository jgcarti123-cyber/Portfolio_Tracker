/**
 * Insights: the maths behind the Insights tab. Everything here is computed from the
 * recorded trades, real daily closes and the real dollar–rupee history. Where a figure
 * can't be computed (no price history, no buy date), it is left out and reported.
 *
 * Two bases for the risk-style charts:
 *  - "mix":  the holdings you have now, run over the last year of real prices
 *            (works from day one, clearly labelled as your current mix);
 *  - "real": only the days you actually held things, from your own history.
 */
import { CASH_COLOR, cashBalances, cashTotal } from "./cash";
import { closeAt, type DayValue } from "./networth";
import { convert, type Position } from "./portfolio";
import { CLASS_META, CLASS_ORDER, type Asset, type AssetClass, type Candle, type Currency, type VaultData } from "./types";

const DAY = 86_400_000;
/** Weekday samples in a year, for annualising weekday-sampled risk. */
const WEEKDAYS_PER_YEAR = 261;

export type Basis = "mix" | "real";

export interface InsightInput {
  data: VaultData;
  positions: Position[];
  closes: Record<string, Candle[]>;
  usdInr: number;
  fxSeries: { t: number; c: number }[];
  currency: Currency;
  /** Real net-worth history (buildSeries). */
  series: DayValue[];
  /** Cash counts (it doesn't in a filtered view). */
  withCash: boolean;
  /** A year of daily closes for the reference markets (BENCHES), when loaded. */
  bench?: Partial<Record<BenchId, Candle[]>>;
  now?: number;
}

/* ───────────────────────── shared helpers ───────────────────────── */

const fxAt = (inp: InsightInput, ts: number) => closeAt(inp.fxSeries, ts) ?? inp.usdInr;
const endOfDay = (now: number, daysAgo: number) => (daysAgo === 0 ? now : new Date(now - daysAgo * DAY).setHours(23, 59, 59, 999));
const worth = (inp: InsightInput, p: Position) => convert(p.value ?? p.cost, p.asset.currency, inp.currency, inp.usdInr);
const cashNow = (inp: InsightInput) => (inp.withCash ? cashTotal(cashBalances(inp.data), inp.currency, inp.usdInr) : 0);

/** A short, readable name: the ticker for stocks and coins, a trimmed name for funds. */
export function shortName(a: Asset) {
  if (a.cls !== "mf" && a.ticker && a.ticker.length <= 12) return a.ticker.replace(/\.(NS|BO)$/, "");
  const base = a.name
    .split(/\s+-\s+/)[0]
    .replace(/\b(Fund|Direct|Regular|Plan|Growth|Option|IDCW|Payout)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return base.length > 24 ? `${base.slice(0, 23).trim()}…` : base;
}

/** The name without plan and option noise, e.g. "Parag Parikh Flexi Cap Fund - Regular Plan - IDCW" → "Parag Parikh Flexi Cap". */
export function fullName(a: Asset) {
  if (a.cls !== "mf") return a.name.replace(/\b(Inc\.?|Corporation|Corp\.?|Limited|Ltd\.?|Class [A-C])\b/g, "").replace(/\s{2,}/g, " ").replace(/[\s,.]+$/, "").trim();
  return a.name
    .split(/\s+-\s+/)[0]
    .replace(/\b(Fund|Direct|Regular|Plan|Growth|Option|IDCW|Payout)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Very short labels for tight axes, made unique across a set (fund houses shortened, filler words dropped). */
export function tinyNames(assets: Asset[], max = 15) {
  const squeeze = (a: Asset) => {
    if (a.cls !== "mf" && a.ticker && a.ticker.length <= 12) return a.ticker.replace(/\.(NS|BO)$/, "");
    return fullName(a)
      .replace(/\bPrudential\b/gi, "Pru")
      .replace(/\bParag Parikh\b/gi, "PPFAS")
      .replace(/\bNippon India\b/gi, "Nippon")
      .replace(/\bAditya Birla Sun Life\b/gi, "ABSL")
      .replace(/\bKotak Mahindra\b/gi, "Kotak")
      .replace(/\bMotilal Oswal\b/gi, "Motilal")
      .replace(/\bIndex\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  };
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
  let out = assets.map((a) => cut(squeeze(a), max));
  // Still clashing: keep the first word and the distinguishing tail.
  out = out.map((l, i) => {
    if (out.filter((x) => x === l).length < 2) return l;
    const w = squeeze(assets[i]).split(" ");
    return cut(`${w[0]} ${w.slice(-2).join(" ")}`, max);
  });
  return out.map((l, i) => (out.filter((x) => x === l).length > 1 ? `${l.slice(0, max - 2)} ${out.slice(0, i + 1).filter((x) => x === l).length}` : l));
}

/** Holdings with enough daily closes to measure, and the ones without. */
function measurable(inp: InsightInput) {
  const held = inp.positions.filter((p) => p.qty > 0 && worth(inp, p) > 0);
  const ok = held.filter((p) => (inp.closes[p.asset.id]?.length ?? 0) >= 10 && !(p.asset.useManual && p.asset.manualPrice));
  const missing = held.filter((p) => !ok.includes(p)).map((p) => p.asset.name);
  return { ok, missing };
}

/** Value of one unit in the display currency at the end of a day (live price for "now"). */
function unitValue(inp: InsightInput, p: Position, ts: number, live: boolean) {
  const fx = live ? inp.usdInr : fxAt(inp, ts);
  const candles = inp.closes[p.asset.id] ?? [];
  const raw = live && p.price !== null ? p.price : (closeAt(candles, ts) ?? candles[0]?.c ?? null);
  return raw === null ? null : convert(raw, p.asset.currency, inp.currency, fx);
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** First day anything was held, from the trades. */
export function firstHeld(data: VaultData) {
  return data.txns.reduce((m, t) => Math.min(m, t.ts), Infinity);
}

/** Colours for individual holdings: fixed by the holding's place in your list, not by rank. */
const HOLDING_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)"];
const OTHER_COLOR = "var(--ink-3)";

/* ───────────────────────── 1. money vs risk ───────────────────────── */

export interface RiskItem {
  key: string;
  label: string;
  color: string;
  /** Share of your money, 0–1. */
  money: number;
  /** Share of your portfolio's day-to-day swings, 0–1 (can be slightly negative for a hedge). */
  risk: number;
  value: number;
  /** Typical yearly swing of the holding on its own, as a fraction. */
  vol: number;
}

export interface Risk {
  ok: boolean;
  reason?: string;
  /** Market days measured. */
  days: number;
  start: number;
  byClass: RiskItem[];
  byHolding: RiskItem[];
  /** "Behaves like N independent bets" (diversification ratio squared). */
  bets: number;
  holdings: number;
  /** Typical daily swing of the whole portfolio, as a fraction. */
  dailySd: number;
  annualVol: number;
  value: number;
  /** Correlations between the biggest holdings: short unique labels for axes, full names for sentences. */
  corr: { labels: string[]; full: string[]; colors: string[]; m: number[][] };
  missing: string[];
}

export function riskBreakdown(inp: InsightInput, basis: Basis): Risk {
  const now = inp.now ?? Date.now();
  const { ok: list, missing } = measurable(inp);
  const cash = cashNow(inp);
  const start = basis === "mix" ? now - 365 * DAY : new Date(firstHeld(inp.data)).setHours(0, 0, 0, 0);
  const empty: Risk = {
    ok: false,
    days: 0,
    start,
    byClass: [],
    byHolding: [],
    bets: 0,
    holdings: list.length,
    dailySd: 0,
    annualVol: 0,
    value: 0,
    corr: { labels: [], full: [], colors: [], m: [] },
    missing,
  };
  if (!list.length) return { ...empty, reason: "None of your holdings has price history yet." };

  // Weekday grid: a stock and a coin are compared over the same span (Monday includes the weekend).
  const grid: number[] = [];
  for (let i = Math.ceil((now - start) / DAY); i >= 0; i--) {
    const ts = endOfDay(now, i);
    const wd = new Date(ts).getDay();
    if (ts >= start && wd !== 0 && wd !== 6) grid.push(ts);
  }
  const T = grid.length - 1;
  if (T < 20)
    return {
      ...empty,
      days: Math.max(0, T),
      reason: `Your own history has ${Math.max(0, T)} market day${T === 1 ? "" : "s"} so far; this needs at least 20.`,
    };

  const R = list.map((p) => {
    const u = grid.map((ts, k) => unitValue(inp, p, ts, k === grid.length - 1));
    const r: number[] = [];
    for (let t = 1; t < u.length; t++) {
      const a = u[t - 1];
      const b = u[t];
      r.push(a && b && a > 0 ? b / a - 1 : 0);
    }
    return r;
  });
  const n = list.length;
  const mean = R.map((r) => r.reduce((s, x) => s + x, 0) / T);
  const cov = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let t = 0; t < T; t++) s += (R[i][t] - mean[i]) * (R[j][t] - mean[j]);
      return s / Math.max(1, T - 1);
    }),
  );

  const values = list.map((p) => worth(inp, p));
  const total = values.reduce((s, v) => s + v, 0) + cash;
  const w = values.map((v) => v / total);
  const sw = w.map((_, i) => cov[i].reduce((s, c, j) => s + c * w[j], 0));
  const varP = w.reduce((s, wi, i) => s + wi * sw[i], 0);
  if (!(varP > 0)) return { ...empty, reason: "Prices didn't move over this window, so there's nothing to measure." };
  const sdP = Math.sqrt(varP);
  const sd = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const rc = w.map((wi, i) => (wi * sw[i]) / varP);
  const bets = Math.min(n, Math.max(1, (w.reduce((s, wi, i) => s + wi * sd[i], 0) / sdP) ** 2));

  // By holding: the five biggest by value keep their own colour, the rest fold into "Others".
  const order = new Map(inp.data.assets.map((a, i) => [a.id, i]));
  const ranked = list.map((p, i) => ({ p, i })).sort((a, b) => values[b.i] - values[a.i]);
  const top = ranked.slice(0, 5).sort((a, b) => (order.get(a.p.asset.id) ?? 0) - (order.get(b.p.asset.id) ?? 0));
  const rest = ranked.slice(5);
  const byHolding: RiskItem[] = top
    .map(({ p, i }, k) => ({
      key: p.asset.id,
      label: shortName(p.asset),
      color: HOLDING_COLORS[k],
      money: w[i],
      risk: rc[i],
      value: values[i],
      vol: sd[i] * Math.sqrt(WEEKDAYS_PER_YEAR),
    }))
    .sort((a, b) => b.value - a.value);
  if (rest.length)
    byHolding.push({
      key: "others",
      label: `${rest.length} other${rest.length === 1 ? "" : "s"}`,
      color: OTHER_COLOR,
      money: rest.reduce((s, x) => s + w[x.i], 0),
      risk: rest.reduce((s, x) => s + rc[x.i], 0),
      value: rest.reduce((s, x) => s + values[x.i], 0),
      vol: 0,
    });

  const byClass: RiskItem[] = CLASS_ORDER.map((cls) => {
    const idx = list.map((p, i) => (p.asset.cls === cls ? i : -1)).filter((i) => i >= 0);
    const wc = idx.reduce((s, i) => s + w[i], 0);
    // The class on its own: sqrt of its internal variance, per unit of its weight.
    let v = 0;
    for (const i of idx) for (const j of idx) v += w[i] * w[j] * cov[i][j];
    return {
      key: cls,
      label: CLASS_META[cls].label,
      color: CLASS_META[cls].color,
      money: wc,
      risk: idx.reduce((s, i) => s + rc[i], 0),
      value: idx.reduce((s, i) => s + values[i], 0),
      vol: wc > 0 ? (Math.sqrt(Math.max(0, v)) / wc) * Math.sqrt(WEEKDAYS_PER_YEAR) : 0,
    };
  }).filter((c) => c.money > 0);
  if (cash > 0) {
    const item = { key: "cash", label: "Cash", color: CASH_COLOR, money: cash / total, risk: 0, value: cash, vol: 0 };
    byClass.push(item);
    byHolding.push(item);
  }

  // Correlations between the biggest holdings (up to 8), from the same daily moves.
  const corrIdx = ranked.slice(0, 8).map((x) => x.i);
  const colorOf = new Map(byHolding.map((b) => [b.key, b.color]));
  const corr = {
    labels: tinyNames(corrIdx.map((i) => list[i].asset)),
    full: corrIdx.map((i) => fullName(list[i].asset)),
    colors: corrIdx.map((i) => colorOf.get(list[i].asset.id) ?? CLASS_META[list[i].asset.cls].color),
    m: corrIdx.map((i) => corrIdx.map((j) => (sd[i] > 0 && sd[j] > 0 ? cov[i][j] / (sd[i] * sd[j]) : 0))),
  };

  return {
    ok: true,
    days: T,
    start: grid[0],
    byClass,
    byHolding,
    bets,
    holdings: n,
    dailySd: sdP,
    annualVol: sdP * Math.sqrt(WEEKDAYS_PER_YEAR),
    value: total,
    corr,
    missing,
  };
}

/* ───────────────────────── value paths (mix or real) ───────────────────────── */

interface Path {
  /** Daily points, oldest first; r is the market move that day as a fraction (0 on the first day). */
  points: { ts: number; r: number }[];
  missing: string[];
}

/** Your current holdings run over the last year of real closes (plus cash, which only moves with the rate). */
function mixPath(inp: InsightInput): Path {
  const now = inp.now ?? Date.now();
  const { ok: list, missing } = measurable(inp);
  const bal = inp.withCash ? cashBalances(inp.data) : { INR: 0, USD: 0 };
  const points: Path["points"] = [];
  let prev: number | null = null;
  for (let i = 365; i >= 0; i--) {
    const ts = endOfDay(now, i);
    const fx = i === 0 ? inp.usdInr : fxAt(inp, ts);
    let v = convert(bal.INR, "INR", inp.currency, fx) + convert(bal.USD, "USD", inp.currency, fx);
    for (const p of list) v += p.qty * (unitValue(inp, p, ts, i === 0) ?? 0);
    points.push({ ts, r: prev && prev > 0 ? v / prev - 1 : 0 });
    prev = v;
  }
  return { points, missing };
}

/** Your real history: each day's market move over the previous day's value (money added doesn't count). */
function realPath(inp: InsightInput): Path {
  const s = inp.series;
  return {
    points: s.map((d, i) => ({ ts: d.ts, r: i > 0 && s[i - 1].value > 0 ? d.move / s[i - 1].value : 0 })),
    missing: [],
  };
}

const pathFor = (inp: InsightInput, basis: Basis) => (basis === "mix" ? mixPath(inp) : realPath(inp));

/* ───────────────────────── 2. how rough a normal day is ───────────────────────── */

export interface Moves {
  ok: boolean;
  reason?: string;
  /** Days the value actually moved. */
  returns: { ts: number; r: number }[];
  /** Today's total, to turn % into money. */
  value: number;
  sd: number;
  p5: number;
  p95: number;
  upShare: number;
  best: { ts: number; r: number } | null;
  worst: { ts: number; r: number } | null;
  missing: string[];
}

export function dailyMoves(inp: InsightInput, basis: Basis): Moves {
  const { points, missing } = pathFor(inp, basis);
  const returns = points.slice(1).filter((p) => Math.abs(p.r) > 1e-9);
  const value = inp.positions.reduce((s, p) => s + worth(inp, p), 0) + cashNow(inp);
  const base: Moves = { ok: false, returns, value, sd: 0, p5: 0, p95: 0, upShare: 0, best: null, worst: null, missing };
  if (returns.length < 15)
    return {
      ...base,
      reason:
        basis === "real"
          ? `Your own history has ${returns.length} day${returns.length === 1 ? "" : "s"} with a move so far; this needs at least 15.`
          : "Not enough price history to measure daily moves.",
    };
  const rs = returns.map((p) => p.r);
  const sorted = [...rs].sort((a, b) => a - b);
  const m = rs.reduce((s, x) => s + x, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, rs.length - 1));
  const best = returns.reduce((a, b) => (b.r > a.r ? b : a));
  const worst = returns.reduce((a, b) => (b.r < a.r ? b : a));
  return {
    ok: true,
    returns,
    value,
    sd,
    p5: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
    upShare: rs.filter((x) => x > 0).length / rs.length,
    best,
    worst,
    missing,
  };
}

/* ───────────────────────── 3. below the peak ───────────────────────── */

export interface Drawdown {
  ok: boolean;
  reason?: string;
  points: { ts: number; dd: number }[];
  deepest: { dd: number; peakTs: number; troughTs: number; recoverTs: number | null } | null;
  /** How far below the high it is today (0 = at a high). */
  now: number;
  lastPeakTs: number;
  /** Longest stretch below a previous high. */
  longest: { days: number; from: number; to: number | null } | null;
  missing: string[];
}

export function drawdown(inp: InsightInput, basis: Basis): Drawdown {
  const { points: path, missing } = pathFor(inp, basis);
  const base: Drawdown = { ok: false, points: [], deepest: null, now: 0, lastPeakTs: 0, longest: null, missing };
  if (path.length < 15)
    return {
      ...base,
      reason: basis === "real" ? `Your own history has ${path.length} day${path.length === 1 ? "" : "s"}; this needs at least 15.` : "Not enough price history.",
    };
  let idx = 1;
  let peak = 1;
  let peakTs = path[0].ts;
  let deepest: NonNullable<Drawdown["deepest"]> = { dd: 0, peakTs, troughTs: peakTs, recoverTs: null };
  let longest: Drawdown["longest"] = null;
  const points: Drawdown["points"] = [];
  for (const p of path) {
    idx *= 1 + p.r;
    if (idx >= peak) {
      if (deepest.dd < 0 && deepest.peakTs === peakTs && deepest.recoverTs === null) deepest = { ...deepest, recoverTs: p.ts };
      const spell = (p.ts - peakTs) / DAY;
      if (spell >= 1 && points.length && points[points.length - 1].dd < 0 && (!longest || spell > longest.days)) longest = { days: Math.round(spell), from: peakTs, to: p.ts };
      peak = idx;
      peakTs = p.ts;
    }
    const dd = idx / peak - 1;
    if (dd < deepest.dd) deepest = { dd, peakTs, troughTs: p.ts, recoverTs: null };
    points.push({ ts: p.ts, dd });
  }
  const last = path[path.length - 1];
  const nowDd = points[points.length - 1].dd;
  if (nowDd < 0) {
    const spell = Math.round((last.ts - peakTs) / DAY);
    if (!longest || spell > longest.days) longest = { days: spell, from: peakTs, to: null };
  }
  return { ok: true, points, deepest: deepest.dd < 0 ? deepest : null, now: nowDd, lastPeakTs: peakTs, longest, missing };
}

/* ───────────────────────── 5. money map ───────────────────────── */

export interface FlowNode {
  id: string;
  label: string;
  col: 0 | 1 | 2;
  color: string;
  value: number;
  kind: "broker" | "gain" | "loss" | "class" | "holding" | "cash";
}
export interface FlowLink {
  from: string;
  to: string;
  value: number;
  kind: "cost" | "gain" | "loss" | "value";
}

export function moneyFlows(inp: InsightInput): { nodes: FlowNode[]; links: FlowLink[]; gain: number; loss: number } {
  const cur = inp.currency;
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  const node = (n: Omit<FlowNode, "value">) => nodes.get(n.id) ?? (nodes.set(n.id, { ...n, value: 0 }).get(n.id) as FlowNode);
  const link = (from: string, to: string, value: number, kind: FlowLink["kind"]) => {
    if (value <= 0) return;
    const k = `${from}>${to}`;
    const l = links.get(k) ?? (links.set(k, { from, to, value: 0, kind }).get(k) as FlowLink);
    l.value += value;
  };
  const accounts = new Map(inp.data.accounts.map((a, i) => [a.id, { ...a, i }]));
  const held = inp.positions.filter((p) => p.qty > 0).sort((a, b) => worth(inp, b) - worth(inp, a));
  const topIds = new Set(held.slice(0, 9).map((p) => p.asset.id));
  let gain = 0;
  let loss = 0;
  for (const p of held) {
    const cost = convert(p.cost, p.asset.currency, cur, inp.usdInr);
    const value = worth(inp, p);
    node({ id: `c:${p.asset.cls}`, label: CLASS_META[p.asset.cls].label, col: 1, color: CLASS_META[p.asset.cls].color, kind: "class" });
    for (const [accId, q] of Object.entries(p.byAccount)) {
      if (q <= 0) continue;
      const acc = accounts.get(accId);
      node({ id: `b:${accId}`, label: acc?.name ?? "Other broker", col: 0, color: `var(--cat-${((acc?.i ?? 5) % 6) + 1})`, kind: "broker" });
      link(`b:${accId}`, `c:${p.asset.cls}`, cost * (q / p.qty), "cost");
    }
    const hid = topIds.has(p.asset.id) ? `h:${p.asset.id}` : "h:others";
    node({ id: hid, label: topIds.has(p.asset.id) ? shortName(p.asset) : `${held.length - topIds.size} other holdings`, col: 2, color: topIds.has(p.asset.id) ? CLASS_META[p.asset.cls].color : OTHER_COLOR, kind: "holding" });
    link(`c:${p.asset.cls}`, hid, value, "value");
    if (value > cost) {
      node({ id: "gain", label: "Market gains", col: 0, color: "var(--up)", kind: "gain" });
      link("gain", `c:${p.asset.cls}`, value - cost, "gain");
      gain += value - cost;
    } else if (cost > value) {
      node({ id: "loss", label: "Market losses", col: 2, color: "var(--down)", kind: "loss" });
      link(`c:${p.asset.cls}`, "loss", cost - value, "loss");
      loss += cost - value;
    }
  }
  const cash = cashNow(inp);
  if (cash > 0) {
    node({ id: "b:cash", label: "Cash you hold", col: 0, color: CASH_COLOR, kind: "cash" });
    node({ id: "c:cash", label: "Cash", col: 1, color: CASH_COLOR, kind: "cash" });
    node({ id: "h:cash", label: "Cash", col: 2, color: CASH_COLOR, kind: "cash" });
    link("b:cash", "c:cash", cash, "cost");
    link("c:cash", "h:cash", cash, "value");
  }
  // A node's size is what flows through it (in and out match, by construction).
  const outOf = (id: string) => [...links.values()].filter((l) => l.from === id).reduce((s, l) => s + l.value, 0);
  const into = (id: string) => [...links.values()].filter((l) => l.to === id).reduce((s, l) => s + l.value, 0);
  for (const n of nodes.values()) n.value = Math.max(outOf(n.id), into(n.id));
  return { nodes: [...nodes.values()], links: [...links.values()], gain, loss };
}

/* ───────────────────────── reference markets ───────────────────────── */

/** Real markets used for comparison. Gold is the Nippon gold ETF most Indian investors use. */
export const BENCHES = [
  { id: "nifty", label: "Nifty 50", cls: "in_stock", symbol: "^NSEI", currency: "INR", color: "var(--cat-1)" },
  { id: "sp500", label: "S&P 500", cls: "us_stock", symbol: "^GSPC", currency: "USD", color: "var(--cat-2)" },
  { id: "gold", label: "Gold", cls: "in_stock", symbol: "GOLDBEES.NS", currency: "INR", color: "#c9a43b" },
  { id: "btc", label: "Bitcoin", cls: "crypto", symbol: "bitcoin", currency: "USD", color: "var(--cat-4)" },
] as const satisfies readonly { id: string; label: string; cls: AssetClass; symbol: string; currency: Currency; color: string }[];
export type BenchId = (typeof BENCHES)[number]["id"];
const benchMeta = (id: BenchId) => BENCHES.find((b) => b.id === id)!;

/** End-of-day weekday points from `start` to now (the last point is now). */
function weekdayGrid(start: number, now: number) {
  const grid: number[] = [];
  for (let i = Math.ceil((now - start) / DAY); i >= 0; i--) {
    const ts = endOfDay(now, i);
    const wd = new Date(ts).getDay();
    if (ts >= start && wd !== 0 && wd !== 6) grid.push(ts);
  }
  return grid;
}
const gridStart = (inp: InsightInput, basis: Basis, now: number) =>
  basis === "mix" ? now - 365 * DAY : new Date(firstHeld(inp.data)).setHours(0, 0, 0, 0);

/** Compounds a daily path onto a grid: one return per grid step. */
function onGrid(points: { ts: number; r: number }[], grid: number[]) {
  const out: number[] = [];
  let k = 0;
  while (k < points.length && points[k].ts <= grid[0]) k++;
  for (let t = 1; t < grid.length; t++) {
    let g = 1;
    while (k < points.length && points[k].ts <= grid[t]) g *= 1 + points[k++].r;
    out.push(g - 1);
  }
  return out;
}

/** Step returns of a price series on a grid. */
function stepReturns(grid: number[], value: (ts: number) => number | null) {
  const v = grid.map(value);
  const out: number[] = [];
  for (let t = 1; t < v.length; t++) {
    const a = v[t - 1];
    const b = v[t];
    out.push(a && b && a > 0 ? b / a - 1 : 0);
  }
  return out;
}

/** A reference market's price on a day, in its own currency or converted to yours. */
function benchValue(inp: InsightInput, id: BenchId, native: boolean) {
  const candles = inp.bench?.[id];
  return (ts: number) => {
    const c = candles ? closeAt(candles, ts) : null;
    if (c === null) return null;
    return native ? c : convert(c, benchMeta(id).currency, inp.currency, fxAt(inp, ts));
  };
}
const hasBench = (inp: InsightInput, id: BenchId) => (inp.bench?.[id]?.length ?? 0) > 20;

function covOf(R: number[][]) {
  const n = R.length;
  const T = R[0]?.length ?? 0;
  const mean = R.map((r) => r.reduce((s, x) => s + x, 0) / Math.max(1, T));
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let t = 0; t < T; t++) s += (R[i][t] - mean[i]) * (R[j][t] - mean[j]);
      return s / Math.max(1, T - 1);
    }),
  );
}

/** Spread and swing of a set of weights over a covariance matrix. */
function mixStats(cov: number[][], w: number[]) {
  const sw = w.map((_, i) => cov[i].reduce((s, c, j) => s + c * w[j], 0));
  const varP = w.reduce((s, wi, i) => s + wi * sw[i], 0);
  const sdP = Math.sqrt(Math.max(0, varP));
  const sd = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const risky = w.filter((wi, i) => wi > 0 && sd[i] > 0).length;
  const bets = sdP > 0 ? Math.min(Math.max(1, risky), Math.max(1, (w.reduce((s, wi, i) => s + wi * sd[i], 0) / sdP) ** 2)) : 1;
  // Each item's share of the swings (they add up to 1).
  const rc = w.map((wi, i) => (varP > 0 ? (wi * sw[i]) / varP : 0));
  return { sdP, bets, vol: sdP * Math.sqrt(WEEKDAYS_PER_YEAR), rc };
}

function corrOf(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return { beta: sbb > 0 ? sab / sbb : 0, corr: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0 };
}

const totalNow = (inp: InsightInput) => inp.positions.reduce((s, p) => s + worth(inp, p), 0) + cashNow(inp);

/* ───────────────────────── 8. where you stand ───────────────────────── */

export interface StandPoint {
  key: string;
  label: string;
  /** Independent bets. */
  bets: number;
  /** Typical yearly swing, as a fraction. */
  vol: number;
  you?: boolean;
  parts: number;
}

/** Your spread and swing next to real reference portfolios over the same days (equal parts, in your currency). */
export function standing(inp: InsightInput, basis: Basis, risk: Risk): StandPoint[] {
  if (!risk.ok) return [];
  const now = inp.now ?? Date.now();
  const grid = weekdayGrid(gridStart(inp, basis, now), now);
  const R: Partial<Record<BenchId, number[]>> = {};
  for (const b of BENCHES) if (hasBench(inp, b.id)) R[b.id] = stepReturns(grid, benchValue(inp, b.id, false));
  const blends: BenchId[][] = [["nifty"], ["sp500"], ["gold"], ["btc"], ["nifty", "sp500"], ["nifty", "sp500", "gold"], ["nifty", "sp500", "gold", "btc"]];
  const out: StandPoint[] = [];
  for (const ids of blends) {
    if (!ids.every((id) => R[id])) continue;
    const s = mixStats(
      covOf(ids.map((id) => R[id]!)),
      ids.map(() => 1 / ids.length),
    );
    out.push({ key: ids.join("+"), label: ids.length === 1 ? benchMeta(ids[0]).label : ids.map((id) => benchMeta(id).label.replace(/ 50$/, "")).join(" + "), bets: s.bets, vol: s.vol, parts: ids.length });
  }
  out.push({ key: "you", label: "You", bets: risk.bets, vol: risk.annualVol, you: true, parts: risk.holdings });
  return out;
}

/* ───────────────────────── 9. what's concentrating you ───────────────────────── */

export interface Driver {
  tone: "warn" | "good" | "info";
  /** Short sentence; **double-starred** parts are emphasised. */
  text: string;
}

export function concentration(inp: InsightInput, risk: Risk): Driver[] {
  if (!risk.ok) return [];
  const out: Driver[] = [];
  const pct = (f: number) => `${Math.round(Math.max(0, f) * 100)}%`;
  const holdings = risk.byHolding.filter((h) => h.key !== "cash" && h.key !== "others");
  const top = holdings[0];
  if (top && top.money >= 0.25)
    out.push({ tone: "warn", text: `**${top.label}** alone is **${pct(top.money)}** of your money and **${pct(top.risk)}** of your swings.` });
  const cls = risk.byClass.filter((c) => c.key !== "cash").sort((a, b) => b.risk - b.money - (a.risk - a.money))[0];
  // Skip the asset type when it is just the top holding again (e.g. one coin = all of crypto).
  if (cls && cls.risk - cls.money >= 0.15 && !(top && Math.abs(cls.money - top.money) < 0.01))
    out.push({ tone: "warn", text: `**${cls.label}** is ${pct(cls.money)} of your money but drives **${pct(cls.risk)}** of your swings.` });
  // Overlap: pairs that move almost together.
  const { labels, m, full } = risk.corr;
  const pairs: { i: number; j: number; v: number }[] = [];
  for (let i = 0; i < labels.length; i++) for (let j = 0; j < i; j++) pairs.push({ i, j, v: m[i][j] });
  pairs.sort((a, b) => b.v - a.v);
  for (const p of pairs.filter((x) => x.v >= 0.75).slice(0, 2))
    out.push({ tone: "warn", text: `**${full[p.i]}** and **${full[p.j]}** move together (**${p.v.toFixed(2)}**), so holding both adds little spread.` });
  const steady = pairs.length ? [...pairs].sort((a, b) => Math.abs(a.v) - Math.abs(b.v))[0] : null;
  if (steady && Math.abs(steady.v) < 0.2)
    out.push({ tone: "good", text: `**${full[steady.i]}** and **${full[steady.j]}** move independently (${steady.v.toFixed(2)}), which genuinely spreads your risk.` });
  const cashItem = risk.byClass.find((c) => c.key === "cash");
  if (cashItem && cashItem.money >= 0.05) out.push({ tone: "good", text: `Cash is **${pct(cashItem.money)}** of your money and doesn't swing, which calms the total.` });
  // Currency.
  const foreign = inp.positions.filter((p) => p.asset.currency !== inp.currency).reduce((s, p) => s + worth(inp, p), 0);
  const total = totalNow(inp);
  if (total > 0 && foreign > 0)
    out.push({ tone: "info", text: `**${pct(foreign / total)}** of your money is priced in ${inp.currency === "INR" ? "dollars" : "rupees"}, so the exchange rate moves it too.` });
  return out;
}

/* ───────────────────────── 10. what-if tester ───────────────────────── */

export interface WhatIfItem {
  key: string;
  label: string;
  color: string;
  value: number;
  kind: "holding" | "cash" | "extra";
}
export interface WhatIfModel {
  items: WhatIfItem[];
  cov: number[][];
  days: number;
}

/** Your holdings plus reference markets you could test adding, with their real covariances. */
export function whatIfModel(inp: InsightInput, basis: Basis): WhatIfModel | null {
  const now = inp.now ?? Date.now();
  const { ok: list } = measurable(inp);
  if (!list.length) return null;
  const grid = weekdayGrid(gridStart(inp, basis, now), now);
  if (grid.length < 21) return null;
  const items: WhatIfItem[] = [];
  const R: number[][] = [];
  const order = [...list].sort((a, b) => worth(inp, b) - worth(inp, a));
  order.forEach((p) => {
    items.push({ key: p.asset.id, label: shortName(p.asset), color: CLASS_META[p.asset.cls].color, value: worth(inp, p), kind: "holding" });
    R.push(stepReturns(grid, (ts) => unitValue(inp, p, ts, ts === grid[grid.length - 1])));
  });
  const cash = cashNow(inp);
  if (cash > 0) {
    items.push({ key: "cash", label: "Cash", color: CASH_COLOR, value: cash, kind: "cash" });
    R.push(grid.slice(1).map(() => 0));
  }
  const held = new Set(inp.positions.map((p) => p.asset.symbol));
  for (const b of BENCHES) {
    if (!hasBench(inp, b.id) || held.has(b.symbol)) continue;
    items.push({ key: `x:${b.id}`, label: b.id === "gold" ? "Gold fund" : `${b.label}${b.id === "btc" ? "" : " index fund"}`, color: b.color, value: 0, kind: "extra" });
    R.push(stepReturns(grid, benchValue(inp, b.id, false)));
  }
  return { items, cov: covOf(R), days: grid.length - 1 };
}

export function evalWhatIf(model: WhatIfModel, values: number[]) {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return { total: 0, bets: 0, vol: 0, daySd: 0, money: values.map(() => 0), swings: values.map(() => 0) };
  const w = values.map((v) => Math.max(0, v) / total);
  const s = mixStats(model.cov, w);
  return { total, bets: s.bets, vol: s.vol, daySd: s.sdP, money: w, swings: s.rc };
}

/* ───────────────────────── 11. what drives you ───────────────────────── */

export interface Factor {
  key: string;
  label: string;
  color: string;
  /** Your move per 1% move in this market. */
  beta: number;
  /** Share of your daily moves that line up with this market, 0–1. */
  r2: number;
  /** Your change in money when this market falls 1% (for the rupee: when it strengthens 1%). */
  per1: number;
  fall: string;
}

export function marketDrivers(inp: InsightInput, basis: Basis): { ok: boolean; reason?: string; factors: Factor[]; value: number; days: number } {
  const now = inp.now ?? Date.now();
  const grid = weekdayGrid(gridStart(inp, basis, now), now);
  const value = totalNow(inp);
  if (grid.length < 21) return { ok: false, reason: `Your own history has ${Math.max(0, grid.length - 1)} market days so far; this needs at least 20.`, factors: [], value, days: 0 };
  const rp = onGrid(pathFor(inp, basis).points, grid);
  const factors: Factor[] = [];
  for (const b of BENCHES) {
    if (!hasBench(inp, b.id)) continue;
    const { beta, corr } = corrOf(rp, stepReturns(grid, benchValue(inp, b.id, true)));
    factors.push({ key: b.id, label: b.label, color: b.color, beta, r2: corr * corr, per1: -beta * 0.01 * value, fall: `${b.label} falls 1%` });
  }
  if (inp.fxSeries.length > 20 && inp.currency === "INR") {
    const { corr } = corrOf(
      rp,
      stepReturns(grid, (ts) => closeAt(inp.fxSeries, ts)),
    );
    // The currency effect is arithmetic, not a guess: dollar holdings lose exactly their share when the rupee gains.
    const foreign = inp.positions.filter((p) => p.asset.currency === "USD").reduce((s, p) => s + worth(inp, p), 0) + (inp.withCash ? cashBalances(inp.data).USD * inp.usdInr : 0);
    factors.push({ key: "fx", label: "Dollar vs rupee", color: "var(--cat-5)", beta: foreign / Math.max(1, value), r2: corr * corr, per1: -0.01 * foreign, fall: "the rupee strengthens 1%" });
  }
  factors.sort((a, b) => b.r2 - a.r2);
  return { ok: factors.length > 0, reason: factors.length ? undefined : "Market prices haven't loaded yet.", factors, value, days: grid.length - 1 };
}

/* ───────────────────────── 12. risk scorecard ───────────────────────── */

export interface Scorecard {
  top: { label: string; money: number; risk: number } | null;
  badDay: { pct: number; amount: number; nifty: number | null } | null;
  worstMonth: { pct: number; amount: number; from: number; to: number } | null;
  deepest: { dd: number; peakTs: number; troughTs: number; recoverDays: number | null; now: number; spark: number[] } | null;
  foreign: { share: number; hit: number; word: string };
  vol: { you: number; nifty: number | null } | null;
}

export function scorecard(inp: InsightInput, basis: Basis, risk: Risk, moves: Moves, dd: Drawdown): Scorecard {
  const now = inp.now ?? Date.now();
  const value = totalNow(inp);
  const top = risk.ok ? risk.byHolding.filter((h) => h.key !== "cash" && h.key !== "others")[0] : undefined;
  // Nifty for comparison over the same window.
  let niftyBad: number | null = null;
  let niftyVol: number | null = null;
  if (hasBench(inp, "nifty")) {
    const start = gridStart(inp, basis, now);
    const c = inp.bench!.nifty!.filter((x) => x.t * 1000 >= start);
    const r = c.slice(1).map((x, i) => x.c / c[i].c - 1);
    if (r.length > 15) {
      niftyBad = quantile([...r].sort((a, b) => a - b), 0.05);
      const m = r.reduce((s, x) => s + x, 0) / r.length;
      niftyVol = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
    }
  }
  // Worst 30 days in a row.
  const pts = pathFor(inp, basis).points;
  let worstMonth: Scorecard["worstMonth"] = null;
  if (pts.length > 30) {
    const idx: number[] = [];
    let v = 1;
    for (const p of pts) idx.push((v *= 1 + p.r));
    for (let i = 30; i < idx.length; i++) {
      const r = idx[i] / idx[i - 30] - 1;
      if (!worstMonth || r < worstMonth.pct) worstMonth = { pct: r, amount: r * value, from: pts[i - 30].ts, to: pts[i].ts };
    }
  }
  const deep = dd.ok && dd.deepest ? dd.deepest : null;
  const step = Math.max(1, Math.floor(dd.points.length / 60));
  const foreign = inp.positions.filter((p) => p.asset.currency !== inp.currency).reduce((s, p) => s + worth(inp, p), 0);
  const share = value > 0 ? foreign / value : 0;
  return {
    top: top ? { label: top.label, money: top.money, risk: top.risk } : null,
    badDay: moves.ok ? { pct: moves.p5, amount: moves.p5 * moves.value, nifty: niftyBad } : null,
    worstMonth: worstMonth && worstMonth.pct < 0 ? worstMonth : null,
    deepest: deep
      ? {
          dd: deep.dd,
          peakTs: deep.peakTs,
          troughTs: deep.troughTs,
          recoverDays: deep.recoverTs ? Math.round((deep.recoverTs - deep.troughTs) / DAY) : null,
          now: dd.now,
          spark: dd.points.filter((_, i) => i % step === 0).map((p) => p.dd),
        }
      : null,
    foreign: { share, hit: share * value * 0.05, word: inp.currency === "INR" ? "dollars" : "rupees" },
    vol: risk.ok ? { you: risk.annualVol, nifty: niftyVol } : null,
  };
}

/* ───────────────────────── 13. portfolio behaviour ───────────────────────── */

export interface MarketBehaviour {
  key: BenchId;
  label: string;
  color: string;
  /** Share of the market's average up-day / down-day move that you caught. */
  capUp: number | null;
  capDown: number | null;
  /** On the market's 10 worst days: its average move and yours. */
  worstMkt: number;
  worstYou: number;
  n: number;
  beta: number;
  corr: number;
  /** Daily [market, you] pairs, for the scatter. */
  pairs: [number, number][];
}

export interface Behaviour {
  ok: boolean;
  reason?: string;
  markets: MarketBehaviour[];
  upShare: number;
  streakUp: number;
  streakDown: number;
  days: number;
}

export function behaviour(inp: InsightInput, basis: Basis): Behaviour {
  const now = inp.now ?? Date.now();
  const grid = weekdayGrid(gridStart(inp, basis, now), now);
  const empty: Behaviour = { ok: false, markets: [], upShare: 0, streakUp: 0, streakDown: 0, days: 0 };
  if (grid.length < 21) return { ...empty, reason: `Your own history has ${Math.max(0, grid.length - 1)} market days so far; this needs at least 20.` };
  const rp = onGrid(pathFor(inp, basis).points, grid);
  const markets: MarketBehaviour[] = [];
  for (const id of ["nifty", "sp500", "btc"] as const) {
    if (!hasBench(inp, id)) continue;
    const rf = stepReturns(grid, benchValue(inp, id, true));
    const pairs = rf.map((f, i) => [f, rp[i]] as [number, number]).filter(([f]) => Math.abs(f) > 1e-9);
    const ups = pairs.filter(([f]) => f > 0);
    const downs = pairs.filter(([f]) => f < 0);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const cap = (set: [number, number][]) => (set.length >= 5 ? avg(set.map((x) => x[1])) / avg(set.map((x) => x[0])) : null);
    const worst = [...pairs].sort((a, b) => a[0] - b[0]).slice(0, 10);
    const { beta, corr } = corrOf(
      pairs.map((x) => x[1]),
      pairs.map((x) => x[0]),
    );
    const meta = benchMeta(id);
    markets.push({ key: id, label: meta.label, color: meta.color, capUp: cap(ups), capDown: cap(downs), worstMkt: avg(worst.map((x) => x[0])), worstYou: avg(worst.map((x) => x[1])), n: worst.length, beta, corr, pairs });
  }
  // Streaks on days that moved.
  const moved = pathFor(inp, basis).points.filter((p) => p.ts >= grid[0] && Math.abs(p.r) > 1e-9);
  let up = 0;
  let down = 0;
  let su = 0;
  let sd = 0;
  for (const p of moved) {
    if (p.r > 0) {
      up++;
      down = 0;
    } else {
      down++;
      up = 0;
    }
    su = Math.max(su, up);
    sd = Math.max(sd, down);
  }
  return {
    ok: markets.length > 0,
    reason: markets.length ? undefined : "Market prices haven't loaded yet.",
    markets,
    upShare: moved.length ? moved.filter((p) => p.r > 0).length / moved.length : 0,
    streakUp: su,
    streakDown: sd,
    days: grid.length - 1,
  };
}
