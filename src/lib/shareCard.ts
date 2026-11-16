/**
 * Share cards: a Folio-styled image of a buy, a sale, a holding or the whole portfolio,
 * drawn on a canvas over the unlock panorama. Amounts and unit counts are left off unless
 * the person switches them on; prices, percentages and dates are what's shared.
 * Formatting here ignores "Hide amounts": the card decides for itself what to show.
 */
import { convert, dayPct, isOpening, type Position, type Totals } from "./portfolio";
import { CLASS_META, CLASS_ORDER, type Asset, type Currency, type Txn } from "./types";

export type CardKind = "buy" | "sell" | "holding" | "portfolio";
export type CardSize = "square" | "story";

export interface Stat {
  label: string;
  value: string;
  /** Colours the value: >0 green, <0 red. */
  tone?: number;
}

export interface CardData {
  kind: CardKind;
  title: string;
  subtitle: string;
  logo: string | null;
  /** Fallback when there's no logo: ₹, $, ◔, ₿ or F. */
  glyph: string;
  hero: { label: string; pct: number | null; note?: string };
  date: string;
  stats: Stat[];
  /** Shown only when the person chooses to include amounts. */
  amounts: Stat[];
  mix?: { label: string; share: number; color: string }[];
  top?: { name: string; share: number; ret: number | null }[];
}

/* ------------------------------- formatting ------------------------------- */

const loc = (c: Currency) => (c === "INR" ? "en-IN" : "en-US");
const cardMoney = (n: number, c: Currency) =>
  new Intl.NumberFormat(loc(c), { style: "currency", currency: c, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);
const cardSigned = (n: number, c: Currency) => `${n > 0 ? "+" : ""}${cardMoney(n, c)}`;
export const cardPrice = (n: number, c: Currency) => {
  const a = Math.abs(n);
  return new Intl.NumberFormat(loc(c), { style: "currency", currency: c, minimumFractionDigits: 2, maximumFractionDigits: a >= 1 ? 2 : a >= 0.01 ? 4 : 8 }).format(n);
};
const cardQty = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: n >= 100 ? 2 : 6 }).format(n);
export const cardPct = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(2)}%`;
const longDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function heldFor(from: number, to: number) {
  const days = Math.max(0, Math.round((to - from) / 86_400_000));
  if (days < 1) return "Under a day";
  if (days < 45) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 548) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

const logoUrl = (a: Asset) =>
  a.symbol ? `/api/logo?${new URLSearchParams({ cls: a.cls, symbol: a.symbol, ...(a.cls === "mf" ? { name: a.name } : {}) })}` : null;

/**
 * Average cost and when the current run of holding began, just before a moment. `since` is
 * null when the run began with a holding added to Folio as it stood (its real purchase date
 * isn't known).
 */
function before(txns: Txn[], ts: number, excludeId?: string) {
  let qty = 0;
  let cost = 0;
  let since: number | null = null;
  for (const t of [...txns].sort((a, b) => a.ts - b.ts)) {
    if (t.ts > ts || t.id === excludeId) continue;
    if (t.type === "buy") {
      if (qty < 1e-9) since = isOpening(t, txns) ? null : t.ts;
      qty += t.qty;
      cost += t.qty * t.price;
    } else {
      const sold = Math.min(t.qty, qty);
      if (qty > 0) cost -= (cost / qty) * sold;
      qty -= sold;
      if (qty < 1e-9) {
        qty = 0;
        cost = 0;
        since = null;
      }
    }
  }
  return { qty, avg: qty > 0 ? cost / qty : 0, since };
}

/* --------------------------------- builders -------------------------------- */

const base = (a: Asset) => ({
  title: a.name,
  subtitle: `${a.ticker} · ${CLASS_META[a.cls].short}`,
  logo: logoUrl(a),
  glyph: CLASS_META[a.cls].glyph,
});

export function buyCard(t: Txn, asset: Asset, position: Position | undefined): CardData {
  const c = asset.currency;
  const now = position?.price ?? null;
  const since = now !== null ? (now / t.price - 1) * 100 : null;
  return {
    kind: "buy",
    ...base(asset),
    hero: { label: "Since I bought", pct: since },
    date: longDate(t.ts),
    stats: [
      { label: "Bought at", value: cardPrice(t.price, c) },
      ...(now !== null ? [{ label: "Price now", value: cardPrice(now, c) }] : []),
      { label: "Bought on", value: longDate(t.ts) },
    ],
    amounts: [
      { label: CLASS_META[asset.cls].unit.replace(/^\w/, (x) => x.toUpperCase()), value: cardQty(t.qty) },
      { label: "Amount", value: cardMoney(t.qty * t.price, c) },
      ...(now !== null ? [{ label: "Worth now", value: cardMoney(t.qty * now, c) }] : []),
    ],
  };
}

export function sellCard(t: Txn, asset: Asset, assetTxns: Txn[]): CardData {
  const c = asset.currency;
  const b = before(assetTxns, t.ts, t.id);
  const sold = Math.min(t.qty, b.qty || t.qty);
  const ret = b.avg > 0 ? (t.price / b.avg - 1) * 100 : null;
  return {
    kind: "sell",
    ...base(asset),
    hero: { label: ret === null ? "Sold" : ret >= 0 ? "Profit on the sale" : "Loss on the sale", pct: ret },
    date: longDate(t.ts),
    stats: [
      { label: "Sold at", value: cardPrice(t.price, c) },
      ...(b.avg > 0 ? [{ label: "Average cost", value: cardPrice(b.avg, c) }] : []),
      ...(b.since !== null ? [{ label: "Held for", value: heldFor(b.since, t.ts) }] : [{ label: "Sold on", value: longDate(t.ts) }]),
    ],
    amounts: [
      { label: "Units sold", value: cardQty(t.qty) },
      ...(b.avg > 0 ? [{ label: ret !== null && ret < 0 ? "Loss" : "Profit", value: cardSigned((t.price - b.avg) * sold, c), tone: t.price - b.avg }] : []),
      { label: "Proceeds", value: cardMoney(t.qty * t.price, c) },
    ],
  };
}

export function holdingCard(p: Position, assetTxns: Txn[]): CardData {
  const c = p.asset.currency;
  const ret = p.cost > 0 && p.value !== null ? (p.value / p.cost - 1) * 100 : null;
  const b = before(assetTxns, Date.now());
  const today = dayPct(p);
  return {
    kind: "holding",
    ...base(p.asset),
    hero: { label: "Total return", pct: ret },
    date: longDate(Date.now()),
    stats: [
      { label: "Average price", value: cardPrice(p.avgPrice, c) },
      ...(p.price !== null ? [{ label: "Price now", value: cardPrice(p.price, c) }] : []),
      ...(today !== null ? [{ label: "Today", value: cardPct(today), tone: today }] : []),
      ...(b.since !== null ? [{ label: "Holding for", value: heldFor(b.since, Date.now()) }] : []),
    ].slice(0, 4),
    amounts: [
      { label: CLASS_META[p.asset.cls].unit.replace(/^\w/, (x) => x.toUpperCase()), value: cardQty(p.qty) },
      ...(p.value !== null ? [{ label: "Value", value: cardMoney(p.value, c) }] : []),
      ...(p.gain !== null ? [{ label: "Gain", value: cardSigned(p.gain, c), tone: p.gain }] : []),
    ],
  };
}

/** "Reliance Industries Limited" → "Reliance" for a tight spot. */
const fitName = (n: string) => n.replace(/\b(Limited|Ltd\.?|Inc\.?|Corporation|Corp\.?|Fund|Direct|Plan|Growth|Option|Industries|Technologies|Services)\b/gi, "").replace(/[-,.]+/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");

const CAT_HEX: Record<string, string> = { in_stock: "#5b8cff", us_stock: "#f0a24b", mf: "#2ec4b0", crypto: "#a78bfa" };

export function portfolioCard(positions: Position[], totals: Totals, display: Currency, usdInr: number, todayTotal: number, firstTs: number | null): CardData {
  const val = (p: Position) => convert(p.value ?? p.cost, p.asset.currency, display, usdInr);
  const ret = totals.cost > 0 ? (totals.value / totals.cost - 1) * 100 : null;
  const base0 = totals.value - todayTotal;
  const today = base0 > 0 ? (todayTotal / base0) * 100 : null;
  const mix = CLASS_ORDER.map((cls) => ({
    label: CLASS_META[cls].label,
    share: totals.value > 0 ? positions.filter((p) => p.asset.cls === cls).reduce((s, p) => s + val(p), 0) / totals.value : 0,
    color: CAT_HEX[cls],
  })).filter((m) => m.share > 0.0005);
  const retOf = (p: Position) => (p.cost > 0 && p.value !== null ? (p.value / p.cost - 1) * 100 : null);
  const best = positions.filter((p) => retOf(p) !== null).sort((a, b) => retOf(b)! - retOf(a)!)[0];
  const top = [...positions]
    .sort((a, b) => val(b) - val(a))
    .slice(0, 3)
    .map((p) => ({ name: p.asset.name, share: totals.value > 0 ? val(p) / totals.value : 0, ret: p.cost > 0 && p.value !== null ? (p.value / p.cost - 1) * 100 : null }));
  return {
    kind: "portfolio",
    title: "My portfolio",
    subtitle: `${positions.length} holding${positions.length === 1 ? "" : "s"} · ${mix.length} market${mix.length === 1 ? "" : "s"}`,
    logo: null,
    glyph: "F",
    hero: { label: "Total return", pct: ret },
    date: longDate(Date.now()),
    stats: [
      // Nothing moved (markets shut): leave "Today" off rather than show 0.00%.
      ...(today !== null && Math.abs(today) >= 0.005 ? [{ label: "Today", value: cardPct(today), tone: today }] : []),
      ...(best ? [{ label: "Best performer", value: `${fitName(best.asset.name)} ${cardPct(retOf(best)!)}`, tone: retOf(best)! }] : []),
      ...(firstTs ? [{ label: "Investing since", value: new Date(firstTs).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) }] : []),
    ],
    amounts: [
      { label: "Net worth", value: cardMoney(totals.value, display) },
      { label: "Invested", value: cardMoney(totals.cost, display) },
      { label: "Gain", value: cardSigned(totals.gain, display), tone: totals.gain },
    ],
    mix,
    top,
  };
}

/* --------------------------------- drawing --------------------------------- */

const KIND_WORD: Record<CardKind, string> = { buy: "BOUGHT", sell: "SOLD", holding: "HOLDING", portfolio: "PORTFOLIO" };
const UP = "#6ef0ae";
const DOWN = "#ff8b8b";
const toneColor = (n: number | null | undefined) => (n == null || Math.abs(n) < 1e-9 ? "#ffffff" : n > 0 ? UP : DOWN);

function cssFont(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v || fallback;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(src: string) {
  if (!images.has(src))
    images.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }),
    );
  return images.get(src)!;
}

function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Letter-spaced caps (canvas letterSpacing where supported, otherwise plain). */
function caps(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const gg = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in gg) {
    gg.letterSpacing = `${spacing}px`;
    g.fillText(text, x, y);
    gg.letterSpacing = "0px";
  } else g.fillText(text, x, y);
}
function capsWidth(g: CanvasRenderingContext2D, text: string, spacing: number) {
  return g.measureText(text).width + ("letterSpacing" in g ? spacing * text.length : 0);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export async function renderCard(d: CardData, size: CardSize, withAmounts: boolean): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = size === "story" ? 1920 : 1080;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const serif = cssFont("--font-instrument", "Georgia, serif");
  const sans = cssFont("--font-inter-tight", "system-ui, sans-serif");
  await Promise.all([document.fonts.load(`200px ${serif}`), document.fonts.load(`600 40px ${sans}`), document.fonts.load(`400 40px ${sans}`)]).catch(() => {});
  const [pano, logo] = await Promise.all([image("/unlock/panorama.webp"), d.logo ? image(d.logo) : Promise.resolve(null)]);

  // Night sky and the ring's horizon, cropped just right of the bright wall.
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, W, H);
  if (pano) {
    const scale = (H * 1.08) / pano.height;
    const sw = W / scale;
    const sx = pano.width * (size === "story" ? 0.4 : 0.36);
    g.drawImage(pano, sx, pano.height * 0.02, sw, H / scale, 0, 0, W, H);
  }
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(5,6,10,0.72)");
  shade.addColorStop(0.3, "rgba(5,6,10,0.25)");
  shade.addColorStop(0.5, "rgba(5,6,10,0.15)");
  shade.addColorStop(0.72, "rgba(5,6,10,0.7)");
  shade.addColorStop(1, "rgba(5,6,10,0.96)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  // A glow in the result's colour behind the big number.
  const tone = toneColor(d.hero.pct);
  const heroY = size === "story" ? 760 : 420;
  const glow = g.createRadialGradient(260, heroY, 10, 260, heroY, 560);
  glow.addColorStop(0, tone === "#ffffff" ? "rgba(140,170,255,0.20)" : tone === UP ? "rgba(70,230,150,0.20)" : "rgba(255,110,110,0.22)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  const pad = 76;
  g.textBaseline = "alphabetic";

  // Header: wordmark and what this card is.
  g.fillStyle = "#ffffff";
  g.font = `600 30px ${sans}`;
  caps(g, "FOLIO", pad, pad + 26, 10);
  const fw = capsWidth(g, "FOLIO", 10);
  g.beginPath();
  g.arc(pad + fw + 10, pad + 16, 5, 0, Math.PI * 2);
  g.fill();

  g.font = `600 22px ${sans}`;
  const word = KIND_WORD[d.kind];
  const ww = capsWidth(g, word, 5) + 64;
  const px = W - pad - ww;
  roundRect(g, px, pad - 8, ww, 50, 25);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = d.kind === "sell" ? DOWN : d.kind === "buy" ? UP : "#9fb7ff";
  g.beginPath();
  g.arc(px + 26, pad + 17, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  caps(g, word, px + 42, pad + 25, 5);

  // Asset line.
  let y = size === "story" ? 470 : 214;
  const badge = 92;
  g.save();
  g.beginPath();
  g.arc(pad + badge / 2, y + badge / 2, badge / 2, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.94)";
  g.fill();
  g.clip();
  if (logo) {
    const inset = 12;
    g.drawImage(logo, pad + inset, y + inset, badge - inset * 2, badge - inset * 2);
  } else {
    g.fillStyle = "#0b0c10";
    g.font = `400 54px ${serif}`;
    g.textAlign = "center";
    g.fillText(d.glyph, pad + badge / 2, y + badge / 2 + 19);
    g.textAlign = "left";
  }
  g.restore();
  g.beginPath();
  g.arc(pad + badge / 2, y + badge / 2, badge / 2 + 5, 0, Math.PI * 2);
  g.strokeStyle = "rgba(255,255,255,0.28)";
  g.lineWidth = 2;
  g.stroke();

  const tx = pad + badge + 28;
  g.fillStyle = "#ffffff";
  g.font = `600 44px ${sans}`;
  g.fillText(fit(g, d.title, W - tx - pad), tx, y + 44);
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.font = `500 22px ${sans}`;
  caps(g, fit(g, d.subtitle.toUpperCase(), W - tx - pad - 60), tx, y + 82, 3);

  // The big number.
  y += badge + (size === "story" ? 120 : 84);
  g.fillStyle = "rgba(255,255,255,0.62)";
  g.font = `600 22px ${sans}`;
  caps(g, d.hero.label.toUpperCase(), pad, y, 5);
  const big = d.hero.pct === null ? "—" : cardPct(d.hero.pct);
  let heroSize = size === "story" ? 250 : 210;
  g.font = `400 ${heroSize}px ${serif}`;
  while (g.measureText(big).width > W - pad * 2 && heroSize > 120) g.font = `400 ${(heroSize -= 10)}px ${serif}`;
  g.fillStyle = tone;
  g.shadowColor = tone === "#ffffff" ? "rgba(255,255,255,0.25)" : tone === UP ? "rgba(70,230,150,0.45)" : "rgba(255,110,110,0.45)";
  g.shadowBlur = 60;
  g.fillText(big, pad - 6, y + heroSize * 0.86);
  g.shadowBlur = 0;
  y += heroSize * 0.86;

  // Stats (and amounts when chosen) in a glass panel at the foot.
  const rows: Stat[][] = [];
  if (d.stats.length) rows.push(d.stats);
  if (withAmounts && d.amounts.length) rows.push(d.amounts);
  const footerH = 64;
  const rowH = 118;
  const mixH = d.mix?.length ? 132 : 0;
  const topH = size === "story" && d.top?.length ? 70 + d.top.length * 74 : 0;
  const panelH = rows.length * rowH + mixH + topH + 40;
  const panelY = H - pad - footerH - panelH;
  roundRect(g, pad - 20, panelY, W - (pad - 20) * 2, panelH, 34);
  g.fillStyle = "rgba(10,12,18,0.62)";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 1.5;
  g.stroke();
  // A thin line of light along the panel's top edge.
  const edge = g.createLinearGradient(pad, 0, W - pad, 0);
  edge.addColorStop(0, "rgba(255,255,255,0)");
  edge.addColorStop(0.5, "rgba(255,255,255,0.55)");
  edge.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = edge;
  g.fillRect(pad + 40, panelY, W - pad * 2 - 80, 1.5);

  let ry = panelY + 20;
  const innerW = W - pad * 2;
  for (const row of rows) {
    const colW = innerW / row.length;
    row.forEach((s, i) => {
      const x = pad + i * colW;
      if (i) {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(x - 16, ry + 22, 1.5, rowH - 44);
      }
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `600 19px ${sans}`;
      caps(g, fit(g, s.label.toUpperCase(), colW - 30), x, ry + 46, 3.5);
      g.fillStyle = s.tone !== undefined ? toneColor(s.tone) : "#ffffff";
      g.font = `500 ${row.length > 3 ? 32 : 36}px ${sans}`;
      g.fillText(fit(g, s.value, colW - 26), x, ry + 92);
    });
    ry += rowH;
  }
  if (d.mix?.length) {
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = `600 19px ${sans}`;
    caps(g, "MIX", pad, ry + 40, 3.5);
    const barY = ry + 60;
    let bx = pad;
    d.mix.forEach((m, i) => {
      const w = Math.max(6, innerW * m.share - (i < d.mix!.length - 1 ? 6 : 0));
      roundRect(g, bx, barY, w, 14, 7);
      g.fillStyle = m.color;
      g.fill();
      bx += w + 6;
    });
    let lx = pad;
    g.font = `500 21px ${sans}`;
    for (const m of d.mix) {
      const text = `${m.label} ${Math.round(m.share * 100)}%`;
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(lx + 6, barY + 50, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.fillText(text, lx + 20, barY + 58);
      lx += g.measureText(text).width + 54;
    }
    ry += mixH;
  }
  if (topH && d.top) {
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = `600 19px ${sans}`;
    caps(g, "LARGEST HOLDINGS", pad, ry + 44, 3.5);
    let ty = ry + 70;
    for (const t of d.top) {
      g.fillStyle = "#ffffff";
      g.font = `500 30px ${sans}`;
      g.fillText(fit(g, t.name, innerW - 330), pad, ty + 40);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `500 26px ${sans}`;
      g.textAlign = "right";
      g.fillText(`${Math.round(t.share * 100)}% of it`, W - pad - 170, ty + 40);
      g.fillStyle = toneColor(t.ret);
      g.fillText(t.ret === null ? "—" : cardPct(t.ret), W - pad, ty + 40);
      g.textAlign = "left";
      ty += 74;
    }
  }

  // Footer.
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.font = `500 21px ${sans}`;
  g.fillText("Tracked privately with Folio", pad, H - pad + 6);
  g.textAlign = "right";
  g.fillText(d.date, W - pad, H - pad + 6);
  g.textAlign = "left";
  return c;
}
