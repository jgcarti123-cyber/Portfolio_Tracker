import { navOn } from "@/server/providers";
import { bad } from "@/server/validate";

/** NAVs on given days, for working out fund units from a value shown in a screenshot. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (raw.length > 80) return bad("Too many rows");
  const items = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const code = typeof o.code === "string" && /^\d{1,8}$/.test(o.code) ? o.code : null;
    const day = typeof o.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null;
    return code && day ? { code, day } : null;
  });
  const results = await Promise.all(items.map((i) => (i ? navOn(i.code, i.day).catch(() => null) : null)));
  return Response.json({ results });
}
