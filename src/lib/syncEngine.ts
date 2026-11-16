import { mergeVaults, sameVault } from "./merge";
import { deriveSyncIds, importKey, seal, unseal } from "./syncCrypto";
import type { VaultData } from "./types";
import type { SyncState } from "./vault";

export interface SyncStatus {
  /** off: not set up · idle: in step · syncing · offline: will retry · error: needs attention */
  state: "off" | "idle" | "syncing" | "offline" | "error";
  lastSync: number | null;
  message?: string;
  /** This vault's Secret Key, for showing the Recovery Kit and linking devices. */
  secretKey?: string | null;
}

interface Hooks {
  getData: () => VaultData;
  /** Show merged data from another device (and write it to this device's vault). */
  apply: (data: VaultData) => void;
  persist: (state: SyncState) => Promise<void>;
  onStatus: (status: SyncStatus) => void;
}

export class SyncError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** One call to the sync API with this vault's credentials. */
export async function syncRequest(method: "GET" | "PUT" | "DELETE", ids: { vaultId: string; token: string }, body?: unknown) {
  let res: Response;
  try {
    res = await fetch("/api/sync", {
      method,
      headers: { Authorization: `Bearer ${ids.vaultId}.${ids.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new SyncError("You're offline. Changes will sync when you're back.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; version?: number; blob?: string };
  if (!res.ok && res.status !== 409) throw new SyncError(json.error ?? `Sync failed (${res.status})`, res.status);
  return { status: res.status, ...json };
}

const PUSH_DELAY = 1200;
const POLL = 45_000;

/**
 * Keeps this device's vault and the encrypted server copy in step. Changes go up a moment after
 * they're made; other devices' changes come down when the app is opened or brought back to the
 * front, and every 45 seconds while it's showing. Edits made on two devices at once are merged.
 */
export class SyncEngine {
  private state: SyncState | null = null;
  private key: CryptoKey | null = null;
  private ids: { vaultId: string; token: string } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private status: SyncStatus = { state: "off", lastSync: null };

  constructor(private hooks: Hooks) {}

  get secretKey() {
    return this.state?.secretKey ?? null;
  }

  async start(state: SyncState) {
    this.stop();
    this.state = state;
    this.key = await importKey(state.keyRaw);
    this.ids = await deriveSyncIds(state.secretKey);
    this.set({ state: "idle", lastSync: state.lastSync });
    window.addEventListener("focus", this.onWake);
    window.addEventListener("online", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
    this.pollTimer = setInterval(() => document.visibilityState === "visible" && this.pull(), POLL);
    this.pull();
  }

  stop() {
    window.removeEventListener("focus", this.onWake);
    window.removeEventListener("online", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pushTimer = this.pollTimer = null;
    this.state = this.key = this.ids = null;
    this.set({ state: "off", lastSync: null });
  }

  /** Call after every local change. */
  changed() {
    if (!this.state) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.run(() => this.pushNow()), PUSH_DELAY);
  }

  pull() {
    if (this.state) this.run(() => this.pullNow());
  }

  private onWake = () => {
    if (document.visibilityState === "visible") this.pull();
  };

  private set(s: SyncStatus) {
    this.status = { ...s, secretKey: this.state?.secretKey ?? null };
    this.hooks.onStatus(this.status);
  }

  /** Runs sync steps one at a time. */
  private run(step: () => Promise<void>) {
    this.queue = this.queue.then(step).catch((e) => this.fail(e));
  }

  private fail(e: unknown) {
    if (!this.state) return;
    const err = e instanceof SyncError ? e : new SyncError("Sync failed. It will try again.", -1);
    if (err.status === 0) return this.set({ state: "offline", lastSync: this.status.lastSync, message: err.message });
    if (err.status === 404) return this.set({ state: "error", lastSync: this.status.lastSync, message: "The synced copy is gone; sync may have been turned off on another device. Turn it off here and on again to start fresh." });
    this.set({ state: "error", lastSync: this.status.lastSync, message: err.message });
  }

  private async save(next: SyncState) {
    this.state = next;
    await this.hooks.persist(next);
  }

  private async pullNow(depth = 0): Promise<void> {
    if (!this.state || !this.key || !this.ids) return;
    this.set({ ...this.status, state: "syncing" });
    const r = await syncRequest("GET", this.ids);
    if (!this.state) return;
    if (r.version === this.state.version) {
      if (!sameVault(this.hooks.getData(), this.state.base)) return this.pushNow(depth);
      return this.done();
    }
    const remote = await unseal<VaultData>(this.key, r.blob!);
    const local = this.hooks.getData();
    const merged = mergeVaults(this.state.base, local, remote);
    if (!sameVault(merged, local)) this.hooks.apply(merged);
    await this.save({ ...this.state, version: r.version!, base: remote, lastSync: Date.now() });
    if (!sameVault(merged, remote)) return this.pushNow(depth);
    this.done();
  }

  private async pushNow(depth = 0): Promise<void> {
    if (!this.state || !this.key || !this.ids) return;
    const data = this.hooks.getData();
    if (sameVault(data, this.state.base)) return this.done();
    this.set({ ...this.status, state: "syncing" });
    const blob = await seal(this.key, data);
    const r = await syncRequest("PUT", this.ids, { base: this.state.version, blob });
    if (!this.state) return;
    if (r.status === 409) {
      // Another device got there first: take its changes, merge, and try again.
      if (depth >= 3) throw new SyncError("Couldn't merge with another device's changes. It will try again.", -1);
      return this.pullNow(depth + 1);
    }
    await this.save({ ...this.state, version: r.version!, base: data, lastSync: Date.now() });
    this.done();
  }

  private done() {
    this.set({ state: "idle", lastSync: this.state?.lastSync ?? Date.now() });
  }
}
