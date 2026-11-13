/**
 * The vault: all portfolio data is one JSON document, encrypted in the browser
 * with a key derived from the user's passphrase (PBKDF2-SHA256 -> AES-256-GCM)
 * and kept in IndexedDB. Nothing here ever leaves the device.
 */
import type { VaultData } from "./types";

const DB = "folio";
const STORE = "kv";
const KEY = "vault";
const ITERATIONS = 600_000;

interface Sealed {
  v: 1;
  iter: number;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ct: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true, // only ever exported wrapped, for the tab session below
    ["encrypt", "decrypt"],
  );
}

export interface OpenVault {
  key: CryptoKey;
  salt: Uint8Array<ArrayBuffer>;
}

export async function vaultExists(): Promise<boolean> {
  return (await idbGet<Sealed>(KEY)) !== undefined;
}

export async function createVault(passphrase: string, data: VaultData): Promise<OpenVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const open = { key, salt };
  await saveVault(open, data);
  return open;
}

export async function saveVault(open: OpenVault, data: VaultData): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    open.key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const sealed: Sealed = { v: 1, iter: ITERATIONS, salt: open.salt, iv, ct };
  await idbSet(KEY, sealed);
}

/** Throws if the passphrase is wrong (AES-GCM authentication fails). */
export async function unlockVault(
  passphrase: string,
): Promise<{ open: OpenVault; data: VaultData }> {
  const sealed = await idbGet<Sealed>(KEY);
  if (!sealed) throw new Error("No vault on this device");
  const key = await deriveKey(passphrase, sealed.salt, sealed.iter);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.ct);
  const data = JSON.parse(new TextDecoder().decode(plain)) as VaultData;
  return { open: { key, salt: sealed.salt }, data };
}

/*
 * Staying unlocked until the tab closes. The vault key is wrapped (AES-KW) with a random
 * one-off key: the wrapped copy goes to IndexedDB, the one-off key to this tab's
 * sessionStorage. Neither half opens the vault alone, and the sessionStorage half is gone
 * once the tab closes, so a refresh or Back stays unlocked but a new visit asks again.
 */
const TAB = "folio-tab-key";
/** Each tab keeps its own wrapped key, so tabs don't log each other out. */
const slot = (id: string) => `session:${id}`;

interface Wrapped {
  wrapped: ArrayBuffer;
  salt: Uint8Array<ArrayBuffer>;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function rememberSession(open: OpenVault): Promise<void> {
  try {
    await forgetSession();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const id = crypto.randomUUID();
    const kw = await crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey"]);
    const wrapped = await crypto.subtle.wrapKey("raw", open.key, kw, "AES-KW");
    await idbSet(slot(id), { wrapped, salt: open.salt } satisfies Wrapped);
    sessionStorage.setItem(TAB, JSON.stringify({ id, raw: b64(raw) }));
  } catch {
    // Not fatal: the next refresh just asks for the passphrase.
  }
}

/** Reopens the vault after a refresh in the same tab, or returns null. */
export async function resumeSession(): Promise<{ open: OpenVault; data: VaultData } | null> {
  try {
    const tab = readTab();
    const saved = tab ? await idbGet<Wrapped>(slot(tab.id)) : undefined;
    if (!tab || !saved) return null;
    const kw = await crypto.subtle.importKey("raw", unb64(tab.raw), "AES-KW", false, ["unwrapKey"]);
    const key = await crypto.subtle.unwrapKey("raw", saved.wrapped, kw, "AES-KW", { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const sealed = await idbGet<Sealed>(KEY);
    if (!sealed) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.ct);
    return { open: { key, salt: sealed.salt }, data: JSON.parse(new TextDecoder().decode(plain)) as VaultData };
  } catch {
    await forgetSession();
    return null;
  }
}

/** Forgets this tab's session (other tabs stay unlocked until they lock or close). */
export async function forgetSession(): Promise<void> {
  try {
    const tab = readTab();
    sessionStorage.removeItem(TAB);
    if (tab) await idbDel(slot(tab.id));
  } catch {}
}

function readTab(): { id: string; raw: string } | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TAB) ?? "null") as { id?: unknown; raw?: unknown } | null;
    return t && typeof t.id === "string" && typeof t.raw === "string" ? { id: t.id, raw: t.raw } : null;
  } catch {
    return null;
  }
}
