/**
 * End-to-end encrypted sync: the keys.
 *
 * Turning sync on makes a random 128-bit Secret Key that never leaves the person's devices (it
 * lives in their Recovery Kit and, encrypted, in each linked device's vault). From it come:
 *   - the vault id the server files the copy under,
 *   - the token that proves the right to read or replace that copy,
 *   - half of the encryption key; the other half comes from the passphrase (PBKDF2, 600k).
 * The server only ever holds ciphertext and a hash of the token. Without the Secret Key a leaked
 * copy can't be brute-forced, and without the passphrase the Secret Key alone opens nothing.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const PREFIX = "F1";
const ITERATIONS = 600_000;
const SALT = new TextEncoder().encode("folio-sync-v1");

export interface SyncKeys {
  vaultId: string;
  token: string;
  key: CryptoKey;
}

/** A fresh Secret Key, formatted for people: F1-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX. */
export function newSecretKey(): string {
  return formatSecretKey(crypto.getRandomValues(new Uint8Array(16)));
}

function formatSecretKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  const groups = [out.slice(0, 5), out.slice(5, 10), out.slice(10, 15), out.slice(15, 20), out.slice(20)];
  return [PREFIX, ...groups].join("-");
}

/** Reads a Secret Key as typed or scanned (case, dashes, spaces and look-alike letters forgiven). */
export function parseSecretKey(input: string): Uint8Array | null {
  let s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (s.startsWith(PREFIX) && s.length === 28) s = s.slice(2);
  s = s.replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== 26) return null;
  const out = new Uint8Array(16);
  let bits = 0;
  let value = 0;
  let k = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8 && k < 16) {
      out[k++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return k === 16 ? out : null;
}

/** The canonical spelling of a typed key, or null if it isn't one. */
export function normalizeSecretKey(input: string): string | null {
  const b = parseSecretKey(input);
  return b ? formatSecretKey(b) : null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hkdf(ikm: Uint8Array<ArrayBuffer>, info: string, bytes: number): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode(info) }, base, bytes * 8);
}

/** Everything sync needs, from the Secret Key and the passphrase. Takes about half a second (PBKDF2). */
export async function deriveSyncKeys(secretKey: string, passphrase: string): Promise<SyncKeys> {
  const sk = parseSecretKey(secretKey);
  if (!sk) throw new Error("That isn't a valid Secret Key.");
  const raw = new Uint8Array(sk);
  const [id, token, pwSalt, half] = await Promise.all([hkdf(raw, "vault-id", 16), hkdf(raw, "auth", 32), hkdf(raw, "pw-salt", 16), hkdf(raw, "enc", 32)]);
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const fromPass = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: pwSalt, iterations: ITERATIONS, hash: "SHA-256" }, material, 256);
  const both = new Uint8Array(64);
  both.set(new Uint8Array(fromPass), 0);
  both.set(new Uint8Array(half), 32);
  const keyBits = await hkdf(both, "aes-key", 32);
  const key = await crypto.subtle.importKey("raw", keyBits, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return { vaultId: hex(id), token: hex(token), key };
}

/** The ids and token alone (no passphrase needed), for a device that already holds the key. */
export async function deriveSyncIds(secretKey: string): Promise<{ vaultId: string; token: string }> {
  const sk = parseSecretKey(secretKey);
  if (!sk) throw new Error("That isn't a valid Secret Key.");
  const raw = new Uint8Array(sk);
  const [id, token] = await Promise.all([hkdf(raw, "vault-id", 16), hkdf(raw, "auth", 32)]);
  return { vaultId: hex(id), token: hex(token) };
}

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function exportKey(key: CryptoKey): Promise<string> {
  return b64(await crypto.subtle.exportKey("raw", key));
}
export async function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(raw), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Encrypts a document for the server: "v1.<iv>.<ciphertext>", base64. */
export async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

/** Decrypts a server copy. Throws if the key is wrong (AES-GCM authentication fails). */
export async function unseal<T>(key: CryptoKey, blob: string): Promise<T> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown sync format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
