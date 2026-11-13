import { history } from "@/server/providers";
import { bad, isRange, parseInstrument } from "@/server/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const instrument = parseInstrument(body);
  if (!instrument) return bad("Unknown instrument");
  const range = isRange(body.range) ? body.range : "1Y";
  try {
    const candles = await history(instrument, range, body.daily === true);
    return Response.json({ candles });
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Price history unavailable", 502);
  }
}
