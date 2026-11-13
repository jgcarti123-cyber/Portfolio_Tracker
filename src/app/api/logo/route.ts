/**
 * Asset logos, fetched by Folio's server so the browser never tells a logo service what
 * the person holds. Only fixed, known sources are used:
 *   US / Indian stocks -> Financial Modeling Prep's public logo images (by Yahoo-style symbol)
 *   Crypto             -> CoinGecko's coin image (by CoinGecko id)
 *   Mutual funds       -> the fund house's site icon, matched from the scheme name
 * Results (including "no logo") are cached in memory; the response is cached by the browser.
 */

const DAY = 86_400_000;
const cache = new Map<string, { at: number; body: ArrayBuffer | null; type: string }>();
const ALLOWED = ["financialmodelingprep.com", "api.coingecko.com", "coin-images.coingecko.com", "assets.coingecko.com", "www.google.com", "t0.gstatic.com", "t1.gstatic.com", "t2.gstatic.com", "t3.gstatic.com"];

/** Fund house, matched from the start of a scheme name, to its website. */
const AMC: [RegExp, string][] = [
  [/parag parikh|ppfas/i, "amc.ppfas.com"],
  [/icici/i, "www.icicipruamc.com"],
  [/^hdfc/i, "www.hdfcfund.com"],
  [/^sbi/i, "www.sbimf.com"],
  [/nippon|reliance (mutual|large|small|growth)/i, "mf.nipponindiaim.com"],
  [/^axis/i, "www.axismf.com"],
  [/^kotak/i, "www.kotakmf.com"],
  [/aditya birla|absl/i, "mutualfund.adityabirlacapital.com"],
  [/^uti/i, "www.utimf.com"],
  [/^dsp/i, "www.dspim.com"],
  [/^tata/i, "www.tatamutualfund.com"],
  [/^quant/i, "quantmutual.com"],
  [/motilal/i, "www.motilaloswalmf.com"],
  [/franklin/i, "www.franklintempletonindia.com"],
  [/edelweiss/i, "www.edelweissmf.com"],
  [/invesco/i, "invescomutualfund.com"],
  [/canara/i, "www.canararobeco.com"],
  [/^groww/i, "www.growwmf.in"],
  [/^navi/i, "navi.com"],
  [/bandhan|^idfc/i, "bandhanmutual.com"],
  [/^hsbc|^l&t/i, "www.assetmanagement.hsbc.co.in"],
  [/^pgim/i, "www.pgimindiamf.com"],
  [/^lic/i, "www.licmf.com"],
  [/baroda/i, "www.barodabnpparibasmf.in"],
  [/whiteoak/i, "mf.whiteoakamc.com"],
  [/zerodha/i, "www.zerodhafundhouse.com"],
  [/mahindra/i, "www.mahindramanulife.com"],
  [/^iti/i, "www.itiamc.com"],
  [/bajaj/i, "www.bajajamc.com"],
  [/helios/i, "www.heliosmf.in"],
  [/mirae/i, "www.miraeasset.com"],
];

async function grab(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const host = new URL(url).hostname;
  if (!ALLOWED.includes(host)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Folio/1.0" }, redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return null;
  const body = await res.arrayBuffer();
  return body.byteLength > 100 ? { body, type } : null;
}

async function find(cls: string, symbol: string, name: string) {
  if (cls === "us_stock" || cls === "in_stock") {
    if (!/^[A-Z0-9.&_-]{1,20}$/i.test(symbol)) return null;
    return grab(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol.toUpperCase())}.png`);
  }
  if (cls === "crypto") {
    if (!/^[a-z0-9-]{1,60}$/.test(symbol)) return null;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${symbol}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { image?: { large?: string; small?: string } };
    const img = j.image?.large ?? j.image?.small;
    return img ? grab(img) : null;
  }
  if (cls === "mf") {
    const domain = AMC.find(([re]) => re.test(name.trim()))?.[1];
    return domain ? grab(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`) : null;
  }
  return null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const cls = u.searchParams.get("cls") ?? "";
  const symbol = (u.searchParams.get("symbol") ?? "").slice(0, 60);
  const name = (u.searchParams.get("name") ?? "").slice(0, 120);
  const key = `${cls}|${symbol}|${cls === "mf" ? name.toLowerCase() : ""}`;

  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > (hit.body ? 7 * DAY : DAY)) {
    try {
      const got = await find(cls, symbol, name);
      hit = { at: Date.now(), body: got?.body ?? null, type: got?.type ?? "" };
    } catch {
      hit = { at: Date.now() - 23 * 3600_000, body: null, type: "" }; // retry in about an hour
    }
    cache.set(key, hit);
    if (cache.size > 3000) cache.delete(cache.keys().next().value as string);
  }
  if (!hit.body) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=86400" } });
  return new Response(hit.body, { headers: { "content-type": hit.type, "cache-control": "public, max-age=604800, immutable" } });
}
