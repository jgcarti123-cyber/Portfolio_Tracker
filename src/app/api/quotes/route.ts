import { fx, quotes } from "@/server/providers";
import { bad, parseInstrument } from "@/server/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.items) ? body.items : [];
  if (raw.length > 300) return bad("Too many instruments");
  const items = raw.map(parseInstrument).filter((i) => i !== null);

  const [q, rate] = await Promise.all([
    quotes(items),
    fx().catch(() => null),
  ]);
  return Response.json({ quotes: q, usdInr: rate?.rate ?? null, fxSeries: rate?.series ?? [] });
}
