import { allow, deleteCopy, hashToken, readCopy, syncConfigured, writeCopy } from "@/server/syncStore";
import { bad } from "@/server/validate";

/**
 * Encrypted sync copies. Requests carry "Authorization: Bearer <vaultId>.<token>", both derived
 * in the browser from the person's Secret Key. Bodies are ciphertext; nothing here can read them.
 */

export const dynamic = "force-dynamic";

const MAX_BLOB = 3_500_000;

function credentials(req: Request) {
  const m = /^Bearer ([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(req.headers.get("authorization") ?? "");
  return m ? { vaultId: m[1], authHash: hashToken(m[2]) } : null;
}

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";

async function guard(req: Request) {
  if (!syncConfigured()) return { error: bad("Sync isn't set up on this server yet.", 503) };
  if (!(await allow(clientIp(req)))) return { error: bad("Too many requests. Try again in a minute.", 429) };
  const who = credentials(req);
  if (!who) return { error: bad("Missing or malformed sync credentials.", 401) };
  return { who };
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  try {
    const r = await readCopy(g.who.vaultId, g.who.authHash);
    if (r.kind === "missing") return bad("No synced copy for that key.", 404);
    if (r.kind === "denied") return bad("That key doesn't match this copy.", 403);
    return Response.json({ version: r.ver, blob: r.blob, updatedAt: r.at }, { headers: noStore });
  } catch {
    return bad("Sync storage is unavailable right now.", 502);
  }
}

export async function PUT(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  const body = (await req.json().catch(() => null)) as { base?: unknown; blob?: unknown } | null;
  const base = body?.base;
  const blob = body?.blob;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) return bad("Bad version.");
  if (typeof blob !== "string" || !/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(blob)) return bad("Bad payload.");
  if (blob.length > MAX_BLOB) return bad("Your vault is too large to sync.", 413);
  try {
    const w = await writeCopy(g.who.vaultId, g.who.authHash, base, blob);
    if (w.kind === "denied") return bad("That key doesn't match this copy.", 403);
    if (w.kind === "conflict") return Response.json({ error: "Changed elsewhere", version: w.ver }, { status: 409, headers: noStore });
    return Response.json({ version: w.ver }, { headers: noStore });
  } catch {
    return bad("Sync storage is unavailable right now.", 502);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  try {
    const r = await deleteCopy(g.who.vaultId, g.who.authHash);
    if (r === "denied") return bad("That key doesn't match this copy.", 403);
    return Response.json({ ok: true }, { headers: noStore });
  } catch {
    return bad("Sync storage is unavailable right now.", 502);
  }
}
