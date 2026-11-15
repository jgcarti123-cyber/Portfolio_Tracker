"use client";

import { signed } from "@/lib/format";
import { MOOD_FOR, MOOD_NAME, moodColor, moodPosition, type MoodReading } from "@/lib/mood";
import type { Today } from "@/lib/today";
import type { AssetClass, Currency } from "@/lib/types";

/** A half-circle gauge from fear (left) to greed (right), with the reading as a glowing dot. */
export function MoodGauge({ reading, size = 120 }: { reading: MoodReading; size?: number }) {
  const pos = moodPosition(reading);
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (f: number) => [cx - r * Math.cos(Math.PI * f), cy - r * Math.sin(Math.PI * f)] as const;
  const [ex, ey] = pt(pos);
  const id = `mood-${reading.key}-${size}`;
  return (
    <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--down)" />
          <stop offset="40%" stopColor="#e8871e" />
          <stop offset="60%" stopColor="#c9b56b" />
          <stop offset="100%" stopColor="var(--up)" />
        </linearGradient>
      </defs>
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke={`url(#${id})`} strokeOpacity={0.22} strokeWidth={6} strokeLinecap="round" />
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={`url(#${id})`} strokeWidth={6} strokeLinecap="round" pathLength={1} className="draw" />
      <circle cx={ex} cy={ey} r={5.5} fill={moodColor(pos)} stroke="var(--surface)" strokeWidth={2.5} style={{ filter: `drop-shadow(0 0 6px ${moodColor(pos)})` }} />
    </svg>
  );
}

function Spark({ data }: { data: { v: number }[] }) {
  if (data.length < 5) return null;
  const W = 120;
  const H = 26;
  const lo = Math.min(...data.map((d) => d.v));
  const hi = Math.max(...data.map((d) => d.v));
  const pts = data.map((d, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(H - 2 - ((d.v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[26px] w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`M${pts.join("L")}`} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Market mood for each market you hold: the published fear & greed reading (VIX for the US),
 * how it changed in a week, and what that market did to your money today.
 */
export function MoodStrip({ readings, missing, today, classes, currency }: { readings: MoodReading[]; missing: MoodReading["key"][]; today: Today; classes: AssetClass[]; currency: Currency }) {
  const keys = (["crypto", "india", "us"] as const).filter((k) => classes.some((c) => MOOD_FOR[c] === k));
  if (!keys.length) return null;
  const yours = (k: MoodReading["key"]) => today.byClass.filter((c) => MOOD_FOR[c.cls] === k).reduce((s, c) => s + c.total, 0);

  return (
    <section aria-label="Market mood" className={`grid grid-cols-1 gap-3 ${keys.length === 3 ? "md:grid-cols-3" : keys.length === 2 ? "md:grid-cols-2" : ""}`}>
      {keys.map((k) => {
        const r = readings.find((x) => x.key === k);
        const move = yours(k);
        if (!r)
          return (
            <div key={k} className="card-finish rounded-card border border-line bg-surface p-5">
              <p className="label text-[10.5px] text-ink-3">{MOOD_NAME[k]} mood</p>
              <p className="mt-3 text-[13px] text-ink-3">{missing.includes(k) ? "The mood index didn't answer. It'll retry on your next visit." : "Loading…"}</p>
            </div>
          );
        const pos = moodPosition(r);
        const prev = r.weekAgo;
        const delta = prev !== null ? r.value - prev : null;
        const fearer = delta !== null && (r.scale === "vix" ? delta > 0 : delta < 0);
        return (
          <div key={k} className="card-finish group relative overflow-hidden rounded-card border border-line bg-surface p-5" title={r.source}>
            <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full opacity-[0.12] blur-2xl" style={{ background: moodColor(pos) }} />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label text-[10.5px] text-ink-2">{MOOD_NAME[k]} mood</p>
                <p className="mt-0.5 truncate text-[11px] text-ink-3">{r.scale === "vix" ? "VIX · higher means more fear" : r.source.replace(/ \(.*\)$/, "")}</p>
              </div>
              <MoodGauge reading={r} size={96} />
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="num text-[34px] font-light leading-none tracking-[-0.03em]">{r.value}</span>
              <span className="text-[13px] font-semibold" style={{ color: moodColor(pos) }}>
                {r.label}
              </span>
            </div>
            <p className="num mt-1.5 text-[12px] text-ink-3">
              {delta === null ? "No reading from a week ago" : (
                <>
                  <span className={fearer ? "text-down" : "text-up"}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}</span> from {prev} a week ago
                  {fearer ? " · more fearful" : delta !== 0 ? " · less fearful" : ""}
                </>
              )}
            </p>
            <div className="mt-3 text-ink-3">
              <Spark data={r.history} />
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-3 text-[12px]">
              <span className="text-ink-3">Your {MOOD_NAME[k] === "India" ? "Indian holdings" : MOOD_NAME[k] === "US" ? "US stocks" : "crypto"} today</span>
              <span className={`num font-semibold ${move < 0 ? "text-down" : move > 0 ? "text-up" : "text-ink-2"}`}>{signed(move, currency)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
