"use client";

import { useEffect, useState } from "react";
import { renderCard, type CardData, type CardSize } from "@/lib/shareCard";
import { Modal, Segmented } from "./ui";

/** Preview a share card, choose its size and whether amounts appear, then share or save it. */
export function ShareCard({ data, onClose }: { data: CardData; onClose: () => void }) {
  const [size, setSize] = useState<CardSize>("square");
  const [amounts, setAmounts] = useState(false);
  const [card, setCard] = useState<{ url: string; blob: Blob } | null>(null);
  const [note, setNote] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url = "";
    renderCard(data, size, amounts)
      .then((c) => new Promise<Blob | null>((r) => c.toBlob(r, "image/png")))
      .then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setCard({ url, blob });
        const file = new File([blob], "folio.png", { type: "image/png" });
        setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
        setCanCopy(typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write);
      })
      .catch(() => !cancelled && setNote("The card couldn't be drawn. Try again."));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data, size, amounts]);

  const name = `folio-${data.kind}-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}${size === "story" ? "-story" : ""}.png`;

  async function share() {
    if (!card) return;
    try {
      await navigator.share({ files: [new File([card.blob], name, { type: "image/png" })], title: data.title });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Sharing didn't work here; save the image instead.");
    }
  }
  async function copy() {
    if (!card) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card.blob })]);
      setNote("Copied. Paste it into any chat.");
    } catch {
      setNote("Couldn't copy here; save the image instead.");
    }
  }
  function save() {
    if (!card) return;
    const a = document.createElement("a");
    a.href = card.url;
    a.download = name;
    a.click();
    setNote("Saved to your downloads.");
  }

  return (
    <Modal title="Share card" onClose={onClose} width={880}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid min-h-[300px] place-items-center rounded-[22px] bg-sunken p-4 ring-1 ring-line">
          {card ? (
            // eslint-disable-next-line @next/next/no-img-element -- the generated card, kept in memory
            <img
              key={card.url}
              src={card.url}
              alt={`Share card for ${data.title}`}
              className={`fade-in block w-auto rounded-2xl shadow-pop ${size === "story" ? "max-h-[62dvh]" : "max-h-[56dvh]"}`}
            />
          ) : (
            <p className="text-[13px] text-ink-3">Drawing the card…</p>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <p className="label text-[9.5px] text-ink-3">Size</p>
            <div className="mt-2">
              <Segmented
                options={[
                  { value: "square", label: "Square" },
                  { value: "story", label: "Story" },
                ]}
                value={size}
                onChange={(v) => (setSize(v), setNote(""))}
                label="Card size"
                size="sm"
              />
            </div>
          </div>

          {data.amounts.length > 0 && (
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block text-[13.5px] font-semibold">Show amounts</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                  Adds {data.amounts.map((a) => a.label.toLowerCase()).join(", ")}. Off by default, so only prices and percentages are shared.
                </span>
              </span>
              <input type="checkbox" checked={amounts} onChange={(e) => (setAmounts(e.target.checked), setNote(""))} className="mt-1 size-4 shrink-0 accent-[var(--ink)]" />
            </label>
          )}

          <div className="mt-auto flex flex-col gap-2">
            {canShare && (
              <button type="button" disabled={!card} onClick={share} className="cta press streak-host relative h-11 rounded-full text-[14px] font-semibold disabled:opacity-50">
                <span className="streak-clip" aria-hidden />
                Share
              </button>
            )}
            {canCopy && (
              <button type="button" disabled={!card} onClick={copy} className={`${canShare ? "pill" : "cta streak-host relative"} press h-11 rounded-full text-[14px] font-semibold disabled:opacity-50`}>
                {!canShare && <span className="streak-clip" aria-hidden />}
                Copy image
              </button>
            )}
            <button type="button" disabled={!card} onClick={save} className="pill press h-11 rounded-full text-[14px] font-semibold disabled:opacity-50">
              Save image
            </button>
            {note && <p className="text-center text-[12px] text-ink-3">{note}</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export const ShareIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 10V2M5 4.8 8 2l3 2.8M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4" />
  </svg>
);
