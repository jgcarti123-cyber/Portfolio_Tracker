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
    false,
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
