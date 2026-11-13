"use client";

import { useState } from "react";
import { pct } from "@/lib/format";
import type { Position } from "@/lib/portfolio";
import { CLASS_META } from "@/lib/types";

type BadgeInput = Pick<Position, "asset"> & Partial<Pick<Position, "gain" | "cost">>;

const logoUrl = (a: Position["asset"]) =>
  a.symbol ? `/api/logo?${new URLSearchParams({ cls: a.cls, symbol: a.symbol, ...(a.cls === "mf" ? { name: a.name } : {}) })}` : null;

/** Stable hue from a name, so each monogram gets its own colour. */
function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * The asset's logo (company, fund house or coin) in a circle, with a thin ring around it
 * showing your gain (green) or loss (red) on it — longer arc, bigger move. Falls back to a
 * coloured monogram when there's no logo. Grows slightly on hover inside a `group`.
 */
export function AssetBadge({ position, size = 40, ring = true }: { position: BadgeInput; size?: number; ring?: boolean }) {
  const { asset } = position;
  const [state, setState] = useState<"loading" | "ok" | "small" | "none">(asset.symbol ? "loading" : "none");
  const url = logoUrl(asset);
  const letters = (asset.cls === "mf" ? asset.name : asset.ticker || asset.name).replace(/[^A-Za-z0-9]/g, "").slice(0, asset.cls === "crypto" ? 3 : 2).toUpperCase();
  const color = CLASS_META[asset.cls].color;
  const h = hue(asset.name);

  const ret = position.gain != null && position.cost ? (position.gain / position.cost) * 100 : null;
  const showRing = ring && ret !== null && isFinite(ret);
  // Square root keeps small moves visible: 2% ≈ a seventh of the ring, 50% ≈ most of it.
  const frac = showRing ? Math.min(1, Math.sqrt(Math.abs(ret!) / 100)) : 0;
  const S = size + 8;
  const r = (S - 3) / 2;

  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: S, height: S }}
      title={showRing ? `${asset.name} · ${pct(ret!)} return` : asset.name}
      aria-hidden
    >
      {showRing && (
        <svg width={S} height={S} className="absolute inset-0 -rotate-90 overflow-visible">
          <circle cx={S / 2} cy={S / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx={S / 2}
            cy={S / 2}
            r={r}
            fill="none"
            stroke={ret! >= 0 ? "var(--up)" : "var(--down)"}
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            className="ring-grow transition-[stroke-width] duration-300 group-hover:[stroke-width:3.5]"
            style={{ strokeDasharray: `${Math.max(frac * 100, 2)} 100` }}
          />
        </svg>
      )}
      <span
        className="relative grid place-items-center overflow-hidden rounded-full transition-transform duration-300 ease-out-quint group-hover:scale-[1.08]"
        style={{
          width: size,
          height: size,
          background: state === "ok" || state === "small" ? "#fff" : `linear-gradient(135deg, hsl(${h} 70% 62%), color-mix(in srgb, ${color} 85%, hsl(${(h + 40) % 360} 60% 40%)))`,
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent)",
        }}
      >
        {url && state !== "none" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            loading="lazy"
            onLoad={(e) => setState(e.currentTarget.naturalWidth < 48 ? "small" : "ok")}
            onError={() => setState("none")}
            className={`object-contain transition-opacity duration-300 ${state === "loading" ? "opacity-0" : "opacity-100"}`}
            style={{ width: state === "small" ? "62%" : "100%", height: state === "small" ? "62%" : "100%" }}
          />
        )}
        {(state === "none" || state === "loading") && (
          <span className={`absolute font-extrabold tracking-tight text-white ${state === "loading" ? "opacity-0" : ""}`} style={{ fontSize: size * (letters.length > 2 ? 0.28 : 0.36) }}>
            {letters}
          </span>
        )}
      </span>
    </span>
  );
}
