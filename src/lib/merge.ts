import type { VaultData } from "./types";

/**
 * Three-way merge of two edited copies of the vault against the copy they both started from,
 * so a trade added on the phone and another added on the laptop both survive.
 * Per record (by id): a change on one side wins over no change; a delete on one side wins
 * unless the other side edited that record; if both edited it, this device's edit wins.
 */
export function mergeVaults(base: VaultData, local: VaultData, remote: VaultData): VaultData {
  return {
    accounts: mergeById(base.accounts, local.accounts, remote.accounts),
    assets: mergeById(base.assets, local.assets, remote.assets),
    txns: mergeById(base.txns, local.txns, remote.txns),
    cash: mergeById(base.cash ?? [], local.cash ?? [], remote.cash ?? []),
    chat: mergeById(base.chat ?? [], local.chat ?? [], remote.chat ?? []).sort((a, b) => a.ts - b.ts),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const out: T[] = [];
  const ids = [...local.map((x) => x.id), ...remote.map((x) => x.id).filter((id) => !L.has(id))];
  for (const id of ids) {
    const b = B.get(id);
    const l = L.get(id);
    const r = R.get(id);
    if (l && r) out.push(same(l, r) || !b || same(r, b) ? l : same(l, b) ? r : l);
    else if (l) {
      // Missing remotely: deleted there (if it existed before) unless edited here since.
      if (!b || !same(l, b)) out.push(l);
    } else if (r) {
      if (!b || !same(r, b)) out.push(r);
    }
  }
  return out;
}

/** True when two copies hold the same data. */
export const sameVault = (a: VaultData, b: VaultData) => same(a, b);
