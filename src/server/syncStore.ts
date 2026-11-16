/**
 * Storage for encrypted sync copies: Upstash Redis over its REST API (what Vercel's Upstash
 * integration provides). Each copy is a hash at folio:v:<vaultId> holding the ciphertext, a
 * version number and a SHA-256 of the access token. The server can't read any of it.
 * In local development without Upstash settings, an in-memory store stands in.
 */
import { createHash } from "node:crypto";

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const syncConfigured = () => !!(URL_ && TOKEN) || process.env.NODE_ENV !== "production";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(URL_!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `Storage error ${res.status}`);
  return json.result as T;
}

/* In-memory stand-in for development only. */
type Rec = { auth: string; ver: number; blob: string; at: number };
const memory: Map<string, Rec> = ((globalThis as unknown as { __folioSync?: Map<string, Rec> }).__folioSync ??= new Map());
const memoryHits = new Map<string, { n: number; until: number }>();
const inMemory = () => !(URL_ && TOKEN);

const key = (vaultId: string) => `folio:v:${vaultId}`;

export type Read = { kind: "ok"; ver: number; blob: string; at: number } | { kind: "missing" } | { kind: "denied" };

export async function readCopy(vaultId: string, authHash: string): Promise<Read> {
  if (inMemory()) {
    const r = memory.get(vaultId);
    if (!r) return { kind: "missing" };
    return r.auth === authHash ? { kind: "ok", ver: r.ver, blob: r.blob, at: r.at } : { kind: "denied" };
  }
  const [auth, ver, blob, at] = await redis<(string | null)[]>(["HMGET", key(vaultId), "auth", "ver", "blob", "at"]);
  if (!auth) return { kind: "missing" };
  if (auth !== authHash) return { kind: "denied" };
  return { kind: "ok", ver: Number(ver), blob: blob ?? "", at: Number(at) };
}

const WRITE = `
local auth = redis.call('HGET', KEYS[1], 'auth')
if auth and auth ~= ARGV[1] then return {-1, 0} end
local ver = tonumber(redis.call('HGET', KEYS[1], 'ver') or '0')
if ver ~= tonumber(ARGV[2]) then return {-2, ver} end
ver = ver + 1
redis.call('HSET', KEYS[1], 'auth', ARGV[1], 'ver', ver, 'blob', ARGV[3], 'at', ARGV[4])
return {ver, 0}`;

export type Write = { kind: "ok"; ver: number } | { kind: "conflict"; ver: number } | { kind: "denied" };

/** Replaces the copy only if it's still at version `base` (0 = create). Atomic. */
export async function writeCopy(vaultId: string, authHash: string, base: number, blob: string): Promise<Write> {
  const now = Date.now();
  if (inMemory()) {
    const r = memory.get(vaultId);
    if (r && r.auth !== authHash) return { kind: "denied" };
    const ver = r?.ver ?? 0;
    if (ver !== base) return { kind: "conflict", ver };
    memory.set(vaultId, { auth: authHash, ver: ver + 1, blob, at: now });
    return { kind: "ok", ver: ver + 1 };
  }
  const [code, ver] = await redis<[number, number]>(["EVAL", WRITE, 1, key(vaultId), authHash, base, blob, now]);
  if (code === -1) return { kind: "denied" };
  if (code === -2) return { kind: "conflict", ver };
  return { kind: "ok", ver: code };
}

const DELETE = `
local auth = redis.call('HGET', KEYS[1], 'auth')
if not auth then return 0 end
if auth ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1`;

export async function deleteCopy(vaultId: string, authHash: string): Promise<"ok" | "denied"> {
  if (inMemory()) {
    const r = memory.get(vaultId);
    if (r && r.auth !== authHash) return "denied";
    memory.delete(vaultId);
    return "ok";
  }
  const code = await redis<number>(["EVAL", DELETE, 1, key(vaultId), authHash]);
  return code === -1 ? "denied" : "ok";
}

const LIMIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return n`;

/** At most `max` requests a minute per client address. */
export async function allow(ip: string, max = 90): Promise<boolean> {
  const bucket = `${ip}:${Math.floor(Date.now() / 60_000)}`;
  if (inMemory()) {
    const now = Date.now();
    const h = memoryHits.get(bucket) ?? { n: 0, until: now + 60_000 };
    h.n++;
    memoryHits.set(bucket, h);
    for (const [k, v] of memoryHits) if (v.until < now) memoryHits.delete(k);
    return h.n <= max;
  }
  try {
    return (await redis<number>(["EVAL", LIMIT, 1, `folio:rl:${bucket}`])) <= max;
  } catch {
    return true; // never lock people out because the limiter hiccuped
  }
}
