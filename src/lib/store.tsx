"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cashBalances } from "./cash";
import type { Account, Asset, CashEntry, ChatMessage, Txn, VaultData } from "./types";
import { createVault, saveVault, unlockVault, vaultExists, type OpenVault } from "./vault";

type Status = "loading" | "new" | "locked" | "open";

const EMPTY: VaultData = {
  accounts: [
    { id: "groww", name: "Groww" },
    { id: "indmoney", name: "INDmoney" },
    { id: "coindcx", name: "CoinDCX" },
  ],
  assets: [],
  txns: [],
};

interface Store {
  status: Status;
  data: VaultData;
  create: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  addAccount: (name: string) => Account;
  upsertAsset: (asset: Omit<Asset, "id">) => Asset;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  /**
   * Records a trade. A sale always puts its money into cash; a buy takes it out of cash
   * only when `fromCash` is set (never more than the cash there is).
   */
  addTxn: (txn: Omit<Txn, "id">, opts?: { fromCash?: boolean }) => void;
  /** Deletes a trade and the cash it moved. */
  deleteTxn: (id: string) => void;
  addCash: (entry: Omit<CashEntry, "id">) => void;
  deleteCash: (id: string) => void;
  /** Updates the assistant conversation (kept in the vault), from the latest saved state. */
  setChat: (update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** Adds many holdings to one broker in a single save. Returns the account id. */
  applyImport: (accountName: string, rows: ImportRow[]) => string;
}

export interface ImportRow {
  asset: Omit<Asset, "id">;
  qty: number;
  /** Average cost per unit, in the asset's currency. */
  price: number;
  ts: number;
}

const Ctx = createContext<Store | null>(null);
const uid = () => crypto.randomUUID();

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<VaultData>(EMPTY);
  const vault = useRef<OpenVault | null>(null);
  const dataRef = useRef(data);

  useEffect(() => {
    vaultExists()
      .then((exists) => setStatus(exists ? "locked" : "new"))
      .catch(() => setStatus("new"));
  }, []);

  /** Apply a change and write the re-encrypted vault to disk. */
  const commit = useCallback((next: VaultData) => {
    dataRef.current = next;
    setData(next);
    if (vault.current) void saveVault(vault.current, next);
  }, []);

  const create = useCallback(async (passphrase: string) => {
    vault.current = await createVault(passphrase, EMPTY);
    dataRef.current = EMPTY;
    setData(EMPTY);
    setStatus("open");
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    try {
      const { open, data } = await unlockVault(passphrase);
      vault.current = open;
      dataRef.current = data;
      setData(data);
      setStatus("open");
      return true;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    vault.current = null;
    dataRef.current = EMPTY;
    setData(EMPTY);
    setStatus("locked");
  }, []);

  const addAccount = useCallback(
    (name: string) => {
      const d = dataRef.current;
      const existing = d.accounts.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) return existing;
      const account = { id: uid(), name: name.trim() };
      commit({ ...d, accounts: [...d.accounts, account] });
      return account;
    },
    [commit],
  );

  const upsertAsset = useCallback(
    (asset: Omit<Asset, "id">) => {
      const d = dataRef.current;
      const existing = d.assets.find(
        (a) =>
          a.cls === asset.cls &&
          a.currency === asset.currency &&
          (asset.symbol ? a.symbol === asset.symbol : !a.symbol && a.name === asset.name),
      );
      if (existing) return existing;
      const created = { ...asset, id: uid() };
      commit({ ...d, assets: [...d.assets, created] });
      return created;
    },
    [commit],
  );

  const updateAsset = useCallback(
    (id: string, patch: Partial<Asset>) => {
      const d = dataRef.current;
      commit({ ...d, assets: d.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    },
    [commit],
  );

  const addTxn = useCallback(
    (txn: Omit<Txn, "id">, opts?: { fromCash?: boolean }) => {
      const d = dataRef.current;
      const id = uid();
      const asset = d.assets.find((a) => a.id === txn.assetId);
      const cash = [...(d.cash ?? [])];
      const total = Math.round(txn.qty * txn.price * 100) / 100;
      if (asset && !txn.opening && total > 0) {
        if (txn.type === "sell") cash.push({ id: uid(), currency: asset.currency, amount: total, ts: txn.ts, kind: "sale", txnId: id });
        else if (opts?.fromCash) {
          const used = Math.min(total, cashBalances({ cash })[asset.currency]);
          if (used > 0) cash.push({ id: uid(), currency: asset.currency, amount: -used, ts: txn.ts, kind: "buy", txnId: id });
        }
      }
      commit({ ...d, txns: [...d.txns, { ...txn, id }], cash });
    },
    [commit],
  );

  const addCash = useCallback(
    (entry: Omit<CashEntry, "id">) => {
      const d = dataRef.current;
      commit({ ...d, cash: [...(d.cash ?? []), { ...entry, id: uid() }] });
    },
    [commit],
  );

  const deleteCash = useCallback(
    (id: string) => {
      const d = dataRef.current;
      commit({ ...d, cash: (d.cash ?? []).filter((e) => e.id !== id) });
    },
    [commit],
  );

  const deleteTxn = useCallback(
    (id: string) => {
      const d = dataRef.current;
      const txns = d.txns.filter((t) => t.id !== id);
      const used = new Set(txns.map((t) => t.assetId));
      const cash = (d.cash ?? []).filter((e) => e.txnId !== id);
      commit({ ...d, txns, cash, assets: d.assets.filter((a) => used.has(a.id)) });
    },
    [commit],
  );

  const setChat = useCallback(
    (update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      const d = dataRef.current;
      const next = typeof update === "function" ? update(d.chat ?? []) : update;
      commit({ ...d, chat: next.slice(-200) });
    },
    [commit],
  );

  const applyImport = useCallback(
    (accountName: string, rows: ImportRow[]) => {
      const d = dataRef.current;
      const accounts = [...d.accounts];
      let account = accounts.find((a) => a.name.toLowerCase() === accountName.trim().toLowerCase());
      if (!account) {
        account = { id: uid(), name: accountName.trim() };
        accounts.push(account);
      }
      const assets = [...d.assets];
      const txns = [...d.txns];
      for (const r of rows) {
        let asset = assets.find(
          (a) =>
            a.cls === r.asset.cls &&
            a.currency === r.asset.currency &&
            (r.asset.symbol ? a.symbol === r.asset.symbol : !a.symbol && a.name === r.asset.name),
        );
        if (!asset) {
          asset = { ...r.asset, id: uid() };
          assets.push(asset);
        }
        txns.push({ id: uid(), assetId: asset.id, accountId: account.id, type: "buy", qty: r.qty, price: r.price, ts: r.ts, opening: true, via: `${account.name} statement` });
      }
      commit({ ...d, accounts, assets, txns });
      return account.id;
    },
    [commit],
  );

  const value = useMemo(
    () => ({
      status,
      data,
      create,
      unlock,
      lock,
      addAccount,
      upsertAsset,
      updateAsset,
      addTxn,
      deleteTxn,
      addCash,
      deleteCash,
      setChat,
      applyImport,
    }),
    [status, data, create, unlock, lock, addAccount, upsertAsset, updateAsset, addTxn, deleteTxn, addCash, deleteCash, setChat, applyImport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
