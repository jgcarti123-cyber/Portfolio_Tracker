import { search } from "@/server/providers";
import { bad, isClass } from "@/server/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 60) : "";
  if (q.length < 2) return Response.json({ hits: [] });
  if (!isClass(body.cls)) return bad("Unknown asset type");
  try {
    return Response.json({ hits: await search(q, body.cls) });
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Search unavailable", 502);
  }
}
