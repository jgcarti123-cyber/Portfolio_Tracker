import { resolve, type ResolveQuery } from "@/server/resolve";
import { bad, isClass } from "@/server/validate";

const clean = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.items) ? body.items : [];
  if (raw.length > 400) return bad("Too many rows");
  const items: ResolveQuery[] = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      cls: isClass(o.cls) ? o.cls : "in_stock",
      isin: clean(o.isin, 12),
      ticker: clean(o.ticker, 24),
      name: clean(o.name, 160),
      nav: typeof o.nav === "number" && isFinite(o.nav) && o.nav > 0 ? o.nav : undefined,
    };
  });
  return Response.json({ results: await resolve(items) });
}
