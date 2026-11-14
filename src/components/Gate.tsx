"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** Wordmark: extended, tracked capitals with a small indicator light, like a panel legend. */
export function Logo({ tone = "ink" }: { tone?: "ink" | "white" }) {
  return (
    <span className={`flex items-center gap-2 ${tone === "white" ? "text-white" : "text-ink"}`}>
      <span className="font-label text-[15px] font-extrabold uppercase leading-none tracking-[0.26em]" style={{ fontStretch: "125%" }}>
        Folio
      </span>
      <span className="size-[6px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden />
    </span>
  );
}

/** The four pictures, and where each one's horizon sits so a wide screen crops around it. */
const SLIDES = [
  { src: "/unlock/1.webp", y: "64%" },
  { src: "/unlock/2.webp", y: "60%" },
  { src: "/unlock/3.webp", y: "55%" },
  { src: "/unlock/4.webp", y: "54%" },
];
const HOLD = 7000;
const SEGMENTS = 32;

type MeterState = "idle" | "reading" | "error";

export function Gate() {
  const { status, create, unlock } = useStore();
  const isNew = status === "new";
  const [step, setStep] = useState<"pass" | "confirm">("pass");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<MeterState>("idle");
  const [slide, setSlide] = useState({ on: 0, prev: -1, cycle: 0 });
  const input = useRef<HTMLInputElement>(null);

  // Slow slideshow; it stays on the first picture for people who prefer less motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSlide((s) => ({ on: (s.on + 1) % SLIDES.length, prev: s.on, cycle: s.cycle + 1 })), HOLD);
    return () => clearInterval(t);
  }, []);

  const value = step === "pass" ? pass : confirm;
  const setValue = step === "pass" ? setPass : setConfirm;

  function fail(message: string) {
    setError(message);
    setState("error");
    setTimeout(() => setState("idle"), 650);
    input.current?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "reading" || !value) return;
    setError("");
    if (isNew && step === "pass") {
      if (pass.length < 8) return fail("Use at least 8 characters.");
      setStep("confirm");
      setTimeout(() => input.current?.focus(), 0);
      return;
    }
    if (isNew && pass !== confirm) {
      setConfirm("");
      return fail("Those don't match. Type it again.");
    }
    setState("reading");
    if (isNew) await create(pass);
    else if (!(await unlock(pass))) return fail("That passphrase doesn't open this vault.");
    setState("idle");
  }

  const headline = isNew ? ["Everything you own,", "on one page."] : ["Everything you own.", "Nobody else's business."];
  const prompt = isNew ? (step === "pass" ? "Choose a passphrase" : "Type it again") : "Passphrase";

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white" onPointerDown={() => setTimeout(() => input.current?.focus(), 0)}>
      {/* Pictures */}
      {SLIDES.map((s, i) => (
        <div key={s.src} className="poster-slide absolute inset-0" data-on={i === slide.on || i === slide.prev} style={{ opacity: i === slide.on ? 1 : 0 }} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- a plain background picture; next/image adds nothing here */}
          <img src={s.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: `50% ${s.y}` }} fetchPriority={i === 0 ? "high" : "low"} />
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.6),transparent_22%,transparent_42%,rgba(0,0,0,0.78)_68%,rgba(0,0,0,0.94))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_0%_100%,rgba(0,0,0,0.7),transparent_70%)]" />
      <div className="grain pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex h-full flex-col px-6 pb-6 pt-6 sm:px-12 sm:pb-10 sm:pt-9">
        {/* Top: wordmark and model code, like the corner of a print ad */}
        <header className="rise-in flex items-start justify-between" style={{ animationDelay: "0.15s" }}>
          <Logo tone="white" />
          <span className="label text-white/55">PF-01 · Private ledger</span>
        </header>

        {/* Edge text, set vertically */}
        <p
          className="label rise-in pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 text-white/40 sm:block sm:right-12"
          style={{ writingMode: "vertical-rl", animationDelay: "0.6s" }}
          aria-hidden
        >
          Encrypted · On this device · Yours alone
        </p>

        <div className="mt-auto w-full max-w-[640px]">
          <h1 className="text-[34px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[60px]">
            <span className="rise-in block" style={{ animationDelay: "0.35s" }}>
              {headline[0]}
            </span>
            <span className="rise-in block text-white/45" style={{ animationDelay: "0.5s" }}>
              {headline[1]}
            </span>
          </h1>

          <form onSubmit={submit} className="rise-in mt-8 sm:mt-10" style={{ animationDelay: "0.75s" }}>
            <div className="flex items-baseline justify-between">
              <label htmlFor="pass" className="label text-white/70">
                {prompt}
              </label>
              <span className="label text-white/40" aria-live="polite">
                {state === "reading" ? "Reading…" : value.length ? `${value.length} character${value.length === 1 ? "" : "s"}` : isNew && step === "pass" ? "8 or more" : "Type to begin"}
              </span>
            </div>

            <div className="mt-4 flex items-center gap-5">
              <div className="relative flex-1">
                <Meter count={value.length} state={state} min={isNew && step === "pass" ? 8 : 0} />
                {/* The real field sits over the meter, invisible, so typing, pasting and password managers all work. */}
                <input
                  ref={input}
                  id="pass"
                  key={step}
                  type="password"
                  autoFocus
                  autoComplete={isNew ? "new-password" : "current-password"}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    if (error) setError("");
                  }}
                  disabled={state === "reading"}
                  className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
                  aria-describedby={error ? "pass-error" : undefined}
                  aria-invalid={!!error}
                />
              </div>
              <button
                type="submit"
                disabled={!value || state === "reading"}
                className="label press flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-white ring-1 ring-white/35 transition-[background-color,opacity,box-shadow] hover:bg-white hover:text-black disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-white"
              >
                {isNew && step === "pass" ? "Next" : isNew ? "Create" : "Enter"}
                <span aria-hidden>↵</span>
              </button>
            </div>

            <p id="pass-error" role="alert" className={`mt-4 min-h-[18px] text-[13px] font-medium ${error ? "text-[#ffb35c]" : "text-white/40"}`}>
              {error ||
                (isNew
                  ? step === "pass"
                    ? "There's no reset. If you forget it, the data can't be recovered — not by you, not by us."
                    : "Once more, so a typo doesn't lock you out."
                  : "")}
            </p>
          </form>
        </div>

        {/* Bottom: slide counter and the small print */}
        <footer className="rise-in mt-8 flex items-end justify-between gap-6 border-t border-white/10 pt-5 sm:mt-10" style={{ animationDelay: "0.95s" }}>
          <div className="flex items-center gap-4">
            <span className="label num whitespace-nowrap text-white/70">
              {String(slide.on + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
            </span>
            <div className="flex gap-1.5" aria-hidden>
              {SLIDES.map((s, i) => (
                <span key={s.src} className="h-px w-7 overflow-hidden bg-white/20">
                  {i === slide.on && <span key={slide.cycle} className="block h-full origin-left bg-white" style={{ animation: `grow ${HOLD}ms linear both` }} />}
                </span>
              ))}
            </div>
          </div>
          <span className="label text-right text-white/45">
            AES-256 · <span className="hidden sm:inline">Stored only </span>on this device
          </span>
        </footer>
      </div>
    </main>
  );
}

/** A row of thin segments that light up one per character, like a hi-fi level meter. */
function Meter({ count, state, min }: { count: number; state: MeterState; min: number }) {
  const lit = Math.min(count, SEGMENTS);
  return (
    <div className="meter relative flex h-10 items-center justify-between" data-state={state} aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className="meter-seg h-7 w-[4px] rounded-full bg-white/25"
          data-lit={i < lit}
          data-head={state === "idle" && i === lit - 1}
          style={state === "reading" ? { animationDelay: `${(i % 16) * 40}ms` } : undefined}
        />
      ))}
      {min > 0 && (
        <span className="absolute -bottom-3 text-[9px] font-semibold tracking-[0.14em] text-white/40" style={{ left: `calc(${((min - 0.5) / SEGMENTS) * 100}% - 8px)` }}>
          MIN
        </span>
      )}
      {count > SEGMENTS && <span className="label absolute -right-1 -top-3 text-white/55">+{count - SEGMENTS}</span>}
    </div>
  );
}
