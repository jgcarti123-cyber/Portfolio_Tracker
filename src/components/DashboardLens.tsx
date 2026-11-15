"use client";

import { useState, type ReactNode } from "react";

export interface LensTab {
  key: string;
  label: string;
  /** Small figure beside the label, e.g. today's move. */
  badge?: ReactNode;
  render: () => ReactNode;
}

const KEY = "folio-lens";

/**
 * One card, several views: only the chosen one is drawn, so the dashboard stays short.
 * The last tab is remembered in this browser (a convenience; it falls back to the first).
 */
export function DashboardLens({ tabs }: { tabs: LensTab[] }) {
  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
      return saved && tabs.some((t) => t.key === saved) ? saved : tabs[0].key;
    } catch {
      return tabs[0].key;
    }
  });
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];
  function choose(k: string) {
    setTab(k);
    try {
      localStorage.setItem(KEY, k);
    } catch {}
  }

  return (
    <section className="card-finish rounded-card border border-line bg-surface">
      <div role="tablist" aria-label="Dashboard views" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2 sm:px-5">
        {tabs.map((t) => {
          const on = t.key === active.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => choose(t.key)}
              className={`relative flex shrink-0 items-center gap-2 px-3 pb-3 pt-2.5 transition-colors ${on ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              <span className="label text-[11px]">{t.label}</span>
              {t.badge}
              <span className={`absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent shadow-[0_0_10px_var(--accent)] transition-opacity ${on ? "opacity-100" : "opacity-0"}`} aria-hidden />
            </button>
          );
        })}
      </div>
      <div key={active.key} role="tabpanel" className="fade-in p-5 sm:p-6">
        {active.render()}
      </div>
    </section>
  );
}
