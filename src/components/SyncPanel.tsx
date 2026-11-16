"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Modal } from "./ui";
import { Qr, qrModules } from "./Qr";

/** The link a phone's camera opens to bring this vault over (the key stays in the #fragment, never sent to the server). */
export const linkUrl = (secretKey: string) => `${location.origin}/#kit=${secretKey}`;

function ago(ts: number | null) {
  if (!ts) return "not yet";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Sync across devices: turn it on (passphrase check → Recovery Kit), link another device by QR,
 * see when it last synced, or turn it off.
 */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  const { sync, enableSync, disableSync, syncNow } = useStore();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const on = sync.state !== "off";
  const key = fresh ?? sync.secretKey;

  async function turnOn(e: React.FormEvent) {
    e.preventDefault();
    if (!pass || busy) return;
    setBusy(true);
    setError("");
    try {
      setFresh(await enableSync(pass));
      setPass("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn sync on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      await disableSync();
      setConfirmOff(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn sync off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Sync across devices" header={<Head />} onClose={() => (fresh && !saved ? undefined : onClose())}>
      {fresh ? (
        /* Step 2: the Recovery Kit, right after turning sync on */
        <div className="fade-in">
          <p className="text-[14px] leading-relaxed text-ink-2">
            Sync is on. Save your <b className="text-ink">Recovery Kit</b> now: with it and your passphrase you can open Folio on any device, even after clearing this browser. Folio can&apos;t recover it for you.
          </p>
          <Kit secretKey={fresh} />
          <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--ink)]" />
            I&apos;ve saved my Recovery Kit somewhere safe
          </label>
          <button type="button" disabled={!saved} onClick={onClose} className="cta press streak-host relative mt-4 h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40">
            <span className="streak-clip" aria-hidden />
            Done
          </button>
        </div>
      ) : on && key ? (
        /* Sync is on: status, link a device, kit, turn off */
        <div className="fade-in space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3 ring-1 ring-line">
            <div className="flex min-w-0 items-center gap-2.5">
              <Dot state={sync.state} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">
                  {sync.state === "syncing" ? "Syncing…" : sync.state === "offline" ? "Offline" : sync.state === "error" ? "Needs attention" : "In sync"}
                </p>
                <p className="truncate text-[12px] text-ink-3">{sync.message ?? `Last synced ${ago(sync.lastSync)}`}</p>
              </div>
            </div>
            <button type="button" onClick={syncNow} className="pill press shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink">
              Sync now
            </button>
          </div>

          <section>
            <h3 className="label text-[10px] text-ink-3">Add a phone or computer</h3>
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <Qr text={linkUrl(key)} size={148} label="QR code that opens Folio on another device with your Secret Key" />
              <ol className="list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-ink-2">
                <li>Point the other device&apos;s camera at this code and open the link.</li>
                <li>Enter your passphrase there.</li>
                <li>That&apos;s it: changes on either device appear on both.</li>
              </ol>
            </div>
            <p className="mt-3 text-[12px] text-ink-3">No camera? On the other device open Folio, choose &ldquo;Restore with Recovery Kit&rdquo; and type the Secret Key.</p>
          </section>

          <details className="group rounded-2xl ring-1 ring-line">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-semibold">
              Recovery Kit
              <span className="text-ink-3 transition-transform group-open:rotate-180" aria-hidden>
                ▾
              </span>
            </summary>
            <div className="px-4 pb-4">
              <Kit secretKey={key} />
            </div>
          </details>

          {confirmOff ? (
            <div className="rounded-2xl bg-down-soft p-4">
              <p className="text-[13px] leading-relaxed text-ink">
                This deletes the encrypted copy on the server. This device keeps all its data; other linked devices keep theirs but stop syncing. Your Recovery Kit will stop working.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={turnOff} disabled={busy} className="press rounded-full bg-down px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
                  {busy ? "Turning off…" : "Turn off sync"}
                </button>
                <button type="button" onClick={() => setConfirmOff(false)} className="pill press rounded-full px-4 py-2 text-[13px] font-semibold">
                  Keep it on
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmOff(true)} className="text-[12.5px] font-semibold text-ink-3 hover:text-down">
              Turn off sync
            </button>
          )}
          {error && <p className="text-[13px] font-medium text-down">{error}</p>}
        </div>
      ) : (
        /* Sync is off: what it is, then the passphrase to turn it on */
        <form onSubmit={turnOn} className="fade-in">
          <ul className="space-y-3">
            <Point title="Encrypted before it leaves" text="Your portfolio is locked with your passphrase on this device. The server only ever stores scrambled data it can't read." />
            <Point title="Survives a cleared browser" text="You'll get a Recovery Kit. With it and your passphrase, your portfolio comes back on any device." />
            <Point title="Phone and laptop in step" text="Scan a QR code once on each device. After that, changes show up everywhere." />
          </ul>
          <label htmlFor="sync-pass" className="label mt-6 block text-[10px] text-ink-3">
            Confirm your passphrase
          </label>
          <input
            id="sync-pass"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => (setPass(e.target.value), setError(""))}
            className="field mt-2 h-11"
            autoFocus
          />
          {error && <p className="mt-2 text-[13px] font-medium text-down">{error}</p>}
          <button type="submit" disabled={!pass || busy} className="cta press streak-host relative mt-4 h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40">
            <span className="streak-clip" aria-hidden />
            {busy ? "Encrypting…" : "Turn on sync"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function Head() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-full bg-sunken text-ink ring-1 ring-line">{CloudIcon}</span>
      <h2 className="text-lg font-bold">Sync across devices</h2>
    </div>
  );
}

function Point({ title, text }: { title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 size-[6px] shrink-0 rounded-full bg-up shadow-[0_0_8px_var(--up)]" aria-hidden />
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="text-[13px] leading-relaxed text-ink-2">{text}</p>
      </div>
    </li>
  );
}

export function Dot({ state }: { state: string }) {
  const c = state === "error" ? "var(--down)" : state === "offline" ? "#e8871e" : state === "syncing" ? "#c9b56b" : "var(--up)";
  return <span className={`size-2 shrink-0 rounded-full ${state === "syncing" ? "animate-pulse" : ""}`} style={{ background: c, boxShadow: `0 0 8px ${c}` }} aria-hidden />;
}

/** The Secret Key with copy and download. */
function Kit({ secretKey }: { secretKey: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-2xl bg-sunken p-4 ring-1 ring-line">
      <p className="label text-[9.5px] text-ink-3">Secret Key</p>
      <p className="num mt-1.5 select-all break-all text-[15px] font-semibold tracking-[0.04em]">{secretKey}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => downloadKit(secretKey)} className="cta press streak-host relative rounded-full px-4 py-2 text-[12.5px] font-semibold">
          <span className="streak-clip" aria-hidden />
          Download Recovery Kit
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(secretKey).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          className="pill press rounded-full px-4 py-2 text-[12.5px] font-semibold"
        >
          {copied ? "Copied" : "Copy key"}
        </button>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">Keep it private, like a spare house key: in a password manager, or printed. It doesn&apos;t include your passphrase.</p>
    </div>
  );
}

/** Draws the Recovery Kit as an image and downloads it. */
function downloadKit(secretKey: string) {
  const W = 1200;
  const H = 1600;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a0b0d";
  g.fillRect(0, 0, W, H);
  const glow = g.createLinearGradient(0, H - 260, 0, H);
  glow.addColorStop(0, "rgba(255,146,92,0)");
  glow.addColorStop(1, "rgba(255,146,92,0.22)");
  g.fillStyle = glow;
  g.fillRect(0, H - 260, W, 260);
  const font = getComputedStyle(document.body).fontFamily;
  g.fillStyle = "#f2f3f5";
  g.font = `800 40px ${font}`;
  g.fillText("F O L I O", 90, 140);
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.font = `600 26px ${font}`;
  g.fillText(`RECOVERY KIT  ·  ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`, 90, 200);
  g.fillStyle = "#ffffff";
  g.font = `600 30px ${font}`;
  g.fillText("Secret Key", 90, 330);
  g.font = `700 50px ui-monospace, Menlo, monospace`;
  g.fillText(secretKey, 90, 400);
  // QR on a white tile
  const m = qrModules(linkUrl(secretKey));
  const cell = Math.floor(560 / (m.length + 6));
  const size = cell * (m.length + 6);
  const x0 = 90;
  const y0 = 470;
  g.fillStyle = "#ffffff";
  g.fillRect(x0, y0, size, size);
  g.fillStyle = "#0b0c0f";
  m.forEach((row, r) => row.forEach((on, col) => on && g.fillRect(x0 + (col + 3) * cell, y0 + (r + 3) * cell, cell, cell)));
  const lines = [
    "To open Folio on a new device or after clearing your browser:",
    "1. Scan the code with the device's camera, or open Folio and",
    "    choose “Restore with Recovery Kit” and type the key.",
    "2. Enter your passphrase (it's not on this page).",
    "",
    "Keep this private. Anyone with this key AND your passphrase",
    "can open your portfolio. Lose either and Folio can't recover it.",
    "",
    location.origin,
  ];
  g.fillStyle = "rgba(255,255,255,0.78)";
  g.font = `400 28px ${font}`;
  lines.forEach((t, i) => g.fillText(t, 90, y0 + size + 90 + i * 46));
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Folio Recovery Kit.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

export const CloudIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.5 12.5h7.25a2.75 2.75 0 0 0 .4-5.47A4 4 0 0 0 4.4 6.6 3 3 0 0 0 4.5 12.5Z" />
  </svg>
);
