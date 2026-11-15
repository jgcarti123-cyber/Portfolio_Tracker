"use client";

import type { ReactNode } from "react";

/** Height of the visual and its panel on wide screens; the panel's content is laid out to fit it. */
export const LENS_H = 500;

/**
 * Shared frame for the dashboard lens views (Orbit, Map), matching Today's movers:
 * a row of pills on top, the visual on the left, a detail panel on the right.
 */
export function LensGrid({ children }: { children: ReactNode }) {
  return <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">{children}</div>;
}

export function Pills({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={label}>
      {children}
    </div>
  );
}

export function Pill({ on, onClick, label, dot, figure }: { on: boolean; onClick: () => void; label: string; dot?: string; figure?: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`press flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition-colors ${on ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink"}`}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {label}
      {figure !== undefined && <span className={`num ${on ? "" : "text-ink-3"}`}>{figure}</span>}
    </button>
  );
}

/**
 * The right-hand panel, finished like the net worth card: always dark (in light theme too),
 * a deep gradient, a fine top edge and white type. Fixed height on wide screens so hovering
 * never shifts the layout; anything that can't fit is clipped inside, never spilled.
 */
export function Inspector({ children }: { children: ReactNode }) {
  return (
    <aside
      className="scope-dark relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#07080a] p-5 text-ink shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)] xl:h-[var(--lens-h)]"
      style={{ ["--lens-h" as string]: `${LENS_H}px` }}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_70%_at_0%_0%,rgba(122,140,255,0.10),transparent_60%),radial-gradient(90%_60%_at_100%_100%,rgba(255,255,255,0.04),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-[#07080a] to-transparent" />
      {children}
    </aside>
  );
}

/** Panel label with a glowing dot, as on the net worth card. */
export function PanelHead({ label, dot = "var(--accent)", children }: { label: string; dot?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-[6px] shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 10px ${dot}` }} aria-hidden />
        <p className="label truncate text-[10.5px] text-white/70">{label}</p>
      </div>
      {children}
    </div>
  );
}

/** A row of figures split by hairlines, like the net worth card's period stats. */
export function Stats({ children }: { children: ReactNode }) {
  return <dl className="mt-3.5 grid auto-cols-fr grid-flow-col divide-x divide-white/10 border-y border-white/10 py-2.5">{children}</dl>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: number }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="label truncate text-[9px] text-white/40">{label}</dt>
      <dd className={`num mt-1 truncate text-[14px] font-semibold ${tone === undefined || Math.abs(tone) < 1e-9 ? "text-white/90" : tone > 0 ? "text-up" : "text-down"}`}>{value}</dd>
      {sub && <dd className="truncate text-[10px] text-white/40">{sub}</dd>}
    </div>
  );
}

export function Section({ title, children, aside, grow = false }: { title: string; children: ReactNode; aside?: ReactNode; grow?: boolean }) {
  return (
    <div className={`mt-3 flex flex-col ${grow ? "min-h-0 flex-1" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="label text-[9px] text-white/40">{title}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** A glowing share bar on a faint track. */
export function GlowBar({ share, color }: { share: number; color: string }) {
  return (
    <span className="mt-1.5 block h-[3px] rounded-full bg-white/[0.07]">
      <span className="seg-grow block h-full rounded-full" style={{ width: `${Math.max(share * 100, 0.8)}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
    </span>
  );
}

/** A clickable row in the panel; hovering it highlights the same item in the visual. */
export function ItemRow({
  badge,
  label,
  sub,
  value,
  tone = 0,
  active,
  onHover,
  onClick,
}: {
  badge: ReactNode;
  label: string;
  sub?: ReactNode;
  value: ReactNode;
  tone?: number;
  active?: boolean;
  onHover?: (on: boolean) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={`press flex w-full shrink-0 items-center gap-2.5 rounded-xl px-2 py-0.5 text-left transition-colors ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
    >
      {badge}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold leading-tight text-white/90">{label}</span>
        {sub && <span className="num mt-px block truncate text-[10.5px] leading-tight text-white/45">{sub}</span>}
      </span>
      <span className={`num shrink-0 text-[12px] font-semibold ${tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-white/80"}`}>{value}</span>
    </button>
  );
}

/** Small round button in the panel (Open, Add or withdraw). */
export function PanelButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="press shrink-0 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11.5px] font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/[0.1]">
      {children}
    </button>
  );
}
