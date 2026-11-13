"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Width and height of a box, so a chart fills whatever space its card gives it. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The one-sentence finding at the top of each chart. Wrap figures in <b>. */
export function Finding({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[15px] leading-snug text-ink-2 [&_b]:font-semibold [&_b]:text-ink ${className}`}>{children}</p>;
}

/** Dark hover card, kept inside its chart box. */
export function Tip({
  x,
  y,
  box,
  children,
  width = 210,
}: {
  x: number;
  y: number;
  box: { w: number; h: number };
  children: ReactNode;
  width?: number;
}) {
  const left = x + width + 16 > box.w ? Math.max(0, x - width - 12) : x + 12;
  const top = Math.max(0, Math.min(y - 20, box.h - 90));
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-xl px-3 py-2 text-[12px] leading-snug text-white shadow-pop transition-[left,top] duration-100 ease-out"
      style={{ left, top, width, background: "var(--tip)" }}
    >
      {children}
    </div>
  );
}

export const TipTitle = ({ children }: { children: ReactNode }) => <p className="text-[10.5px] font-medium text-white/60">{children}</p>;
export const TipValue = ({ children, tone }: { children: ReactNode; tone?: number }) => (
  <p className={`num text-[14px] font-bold ${tone === undefined || tone === 0 ? "" : tone > 0 ? "text-[#5fdc9a]" : "text-[#ff8a92]"}`}>{children}</p>
);
export const TipNote = ({ children }: { children: ReactNode }) => <p className="mt-0.5 text-[11px] text-white/70">{children}</p>;

/** Why a chart can't be drawn, with an optional way out. */
export function ChartEmpty({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-2xl bg-sunken/60 px-6 py-8 text-center ring-1 ring-line">
      <div className="max-w-[360px]">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Small print under a chart: what it's built from, and anything left out. */
export function Basis({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">{children}</p>;
}

export function missingNote(missing: string[]) {
  if (!missing.length) return null;
  const names = missing.slice(0, 3).join(", ") + (missing.length > 3 ? ` and ${missing.length - 3} more` : "");
  return ` ${names} ${missing.length === 1 ? "has" : "have"} no price history, so ${missing.length === 1 ? "it's" : "they're"} left out.`;
}

/** A stat in a quiet row under a chart. */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-ink-3">{label}</p>
      <p className={`num mt-0.5 truncate text-[14px] font-bold ${tone === undefined || tone === 0 ? "" : tone > 0 ? "text-up" : "text-down"}`}>{value}</p>
      {sub && <p className="num truncate text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

const ic = (d: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

export const InsightIcon = {
  bridge: ic(<path d="M2 13V9M5.5 13V5M9 13V7M12.5 13V3" />),
  risk: ic(<path d="M2 8h2.5l1.5-4 2.5 8 1.5-4H14" />),
  bell: ic(
    <>
      <path d="M2 13h12" />
      <path d="M3 13c1.5 0 2-7 5-7s3.5 7 5 7" />
    </>,
  ),
  dip: ic(
    <>
      <path d="M2 4h12" strokeDasharray="1.5 2" />
      <path d="M2 4c2 0 2.5 7 5 7s2.5-5 4-5 2 1 3 2" />
    </>,
  ),
  flow: ic(
    <>
      <path d="M2 4c5 0 5 8 12 8M2 12c5 0 5-8 12-8" />
    </>,
  ),
  clock: ic(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>,
  ),
  target: ic(
    <>
      <circle cx="5" cy="10" r="1.6" />
      <circle cx="10.5" cy="5.5" r="2.2" />
      <path d="M2 14h12M2 14V2" />
    </>,
  ),
  spark: ic(<path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" />),
};

/** Smallest "nice" step for about `count` ticks over a range. */
export function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

export const pctText = (f: number, digits = 1) => `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f * 100).toFixed(digits)}%`;
export const shareText = (f: number) => `${Math.round(Math.max(0, f) * 100)}%`;

/** One or two plain sentences under a card title: what the chart shows and how to read it. */
export function Explain({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-[640px] text-[12.5px] leading-relaxed text-ink-3 [&_b]:font-semibold [&_b]:text-ink-2">{children}</p>;
}

/** Renders "**bold**" segments of a sentence. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") ? (
          <b key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
