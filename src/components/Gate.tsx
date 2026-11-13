"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Icon } from "./ui";

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <defs>
          <pattern id="logo-stripe" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="4" fill="var(--accent)" />
          </pattern>
        </defs>
        <rect x="2" y="12" width="6" height="12" rx="2" fill="url(#logo-stripe)" />
        <rect x="10" y="7" width="6" height="17" rx="2" fill="url(#logo-stripe)" />
        <rect x="18" y="2" width="6" height="22" rx="2" fill="var(--accent)" />
      </svg>
      Folio
    </span>
  );
}

export function Gate() {
  const { status, create, unlock } = useStore();
  const isNew = status === "new";
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (isNew) {
      if (pass.length < 8) return setError("Use at least 8 characters.");
      if (pass !== confirm) return setError("The two passphrases don't match.");
    }
    setBusy(true);
    if (isNew) await create(pass);
    else if (!(await unlock(pass))) setError("That passphrase doesn't open this vault. Try again.");
    setBusy(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form
          onSubmit={submit}
          className="pop-in rounded-[26px] border border-line bg-surface p-7 shadow-card"
        >
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
            {isNew ? "Everything you own, on one page" : "Unlock your portfolio"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            {isNew
              ? "Your holdings are encrypted and kept only in this browser. Choose a passphrase to lock them."
              : "Your holdings are encrypted on this device. Enter your passphrase to open them."}
          </p>

          <label className="mt-6 block text-[13px] font-semibold" htmlFor="pass">
            Passphrase
          </label>
          <input
            id="pass"
            type="password"
            autoFocus
            autoComplete={isNew ? "new-password" : "current-password"}
            className="field mt-1.5"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />

          {isNew && (
            <>
              <label className="mt-4 block text-[13px] font-semibold" htmlFor="confirm">
                Type it again
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                className="field mt-1.5"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-down">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !pass} className="mt-6 h-11 w-full">
            {Icon.lock}
            {busy ? "Working…" : isNew ? "Create vault" : "Unlock"}
          </Button>

          {isNew && (
            <p className="mt-4 text-xs leading-relaxed text-ink-3">
              There is no reset. If you forget the passphrase, the data can&apos;t be recovered — not by
              you and not by us.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
