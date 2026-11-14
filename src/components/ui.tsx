"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Currency } from "@/lib/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function IconTile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-[7px] text-white [&_svg]:size-[13px]"
      style={{ background: color }}
      aria-hidden
    >
      {children}
    </span>
  );
}

export function CardHead({
  icon,
  color = "var(--accent)",
  title,
  children,
}: {
  icon: ReactNode;
  color?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <IconTile color={color}>{icon}</IconTile>
        <h2 className="label text-[11.5px] text-ink">{title}</h2>
      </div>
      {children}
    </header>
  );
}

/** Segmented control whose highlight slides to the chosen option. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    const t = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(t);
    };
  }, [value, options.length]);

  return (
    <div
      ref={wrap}
      role="radiogroup"
      aria-label={label}
      className="relative inline-flex rounded-full bg-sunken p-1 ring-1 ring-line"
    >
      {thumb && (
        <span
          aria-hidden
          className="absolute bottom-1 top-1 rounded-full bg-raised shadow-thumb"
          style={{
            left: 0,
            width: thumb.width,
            transform: `translateX(${thumb.left}px)`,
            transition: ready ? "transform .28s var(--ease-out-quint), width .28s var(--ease-out-quint)" : "none",
          }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative whitespace-nowrap rounded-full font-semibold transition-colors ${
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]"
            } ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" }) {
  const styles = {
    primary:
      "bg-accent text-white hover:bg-accent-ink shadow-[0_8px_20px_-8px_var(--accent)] disabled:opacity-45 disabled:shadow-none disabled:pointer-events-none",
    ghost: "bg-surface text-ink ring-1 ring-line hover:bg-sunken",
    quiet: "text-ink-2 hover:bg-sunken hover:text-ink",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Change pill: arrow + text, so direction never rests on colour alone. */
export function Delta({ value, children }: { value: number; children: ReactNode }) {
  const flat = Math.abs(value) < 1e-9;
  const up = value > 0;
  return (
    <span
      className={`num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        flat ? "bg-sunken text-ink-2" : up ? "bg-up-soft text-up" : "bg-down-soft text-down"
      }`}
    >
      {!flat && (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={up ? "" : "rotate-180"}>
          <path d="M5 1.5 9 8H1z" fill="currentColor" />
        </svg>
      )}
      {children}
    </span>
  );
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Eases a displayed number toward its target so totals glide instead of snapping. */
export function useAnimatedNumber(target: number, ms = 420) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      const v = origin + (target - origin) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

/** Large amount field: currency symbol in front, digits grouped as you type. */
export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  autoFocus,
  placeholder = "0",
}: {
  id: string;
  value: string;
  onChange: (raw: string) => void;
  currency: Currency;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [whole, frac] = value.split(".");
  const grouped =
    value === ""
      ? ""
      : new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US").format(Number(whole || 0)) +
        (frac !== undefined ? "." + frac : "");
  return (
    <div className="field-wrap flex h-16 items-center gap-2 rounded-2xl border border-line bg-surface px-4 transition-shadow">
      <span className="text-2xl font-bold text-ink-3">{currency === "INR" ? "₹" : "$"}</span>
      <input
        id={id}
        autoFocus={autoFocus}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className="num w-full min-w-0 bg-transparent text-[26px] font-extrabold tracking-tight outline-none placeholder:text-ink-3/60"
        value={grouped}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, "");
          const [w, ...rest] = raw.split(".");
          onChange(rest.length ? `${w}.${rest.join("").slice(0, 2)}` : w);
        }}
      />
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  header,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  header?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-end backdrop-blur-[6px] sm:place-items-center sm:p-6"
      style={{ background: "var(--scrim)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={`pop-in max-h-[94dvh] w-full overflow-y-auto overflow-x-hidden rounded-t-[30px] bg-surface p-6 shadow-pop sm:rounded-[30px] sm:p-7 ${wide ? "sm:max-w-[760px]" : "sm:max-w-[540px]"}`}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          {header ?? <h2 className="text-lg font-bold">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
              <path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icon = {
  wallet: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 5.5v6a1.5 1.5 0 0 0 1.5 1.5h8.5v-7H4A1.5 1.5 0 0 1 2.5 4.5 1.5 1.5 0 0 1 4 3h7.5" />
      <path d="M10.5 9.5h.01" />
    </svg>
  ),
  pie: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M8 2.5A5.5 5.5 0 1 0 13.5 8H8z" />
      <path d="M10.5 2.6a5.5 5.5 0 0 1 2.9 2.9h-2.9z" />
    </svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
    </svg>
  ),
  tag: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 8.2V3.5a1 1 0 0 1 1-1h4.7l5.3 5.3-5.7 5.7z" />
      <path d="M5.5 5.5h.01" />
    </svg>
  ),
  plus: (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke} strokeWidth={2}>
      <path d="M7 2v10M2 7h10" />
    </svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  ),
  back: (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M9.5 3.5 5 8l4.5 4.5" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke} strokeWidth={2.2}>
      <path d="m2.5 7.5 3 3 6-7" />
    </svg>
  ),
  upload: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  ),
  file: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M9 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.8z" />
      <path d="M9 1.8v4h4M5.5 9h5M5.5 11.5h3" />
    </svg>
  ),
  sun: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </svg>
  ),
  moon: (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z" />
    </svg>
  ),
};

/**
 * A card that folds down to its header. The header carries a one-line summary so the
 * key number is visible while closed. Open/closed is remembered per card in this browser.
 */
export function Disclosure({
  id,
  icon,
  color = "var(--accent)",
  title,
  summary,
  children,
}: {
  id: string;
  icon: ReactNode;
  color?: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const key = `folio-open-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const [seen, setSeen] = useState(open);
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setSeen(true);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {}
  }
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="group flex w-full items-center gap-3 rounded-card px-5 py-4 text-left sm:px-6"
      >
        <IconTile color={color}>{icon}</IconTile>
        <h2 className="label shrink-0 text-[11.5px] text-ink">{title}</h2>
        <span className="ml-auto flex min-w-0 items-center justify-end gap-3 text-[13px] text-ink-2">{summary}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 transition-colors group-hover:bg-line group-hover:text-ink">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`transition-transform duration-300 ease-out-quint ${open ? "rotate-180" : ""}`}>
            <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div id={`${id}-body`} className="expand" data-open={open}>
        <div>
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">{seen && children}</div>
        </div>
      </div>
    </section>
  );
}
