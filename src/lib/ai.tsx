"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface AiStatus {
  enabled: boolean;
  model: string;
  provider: string;
}

const CONSENT_KEY = "folio-ai-consent";

interface AiCtx {
  status: AiStatus | null;
  consented: boolean;
  /**
   * Resolves true once the user agrees (asking them if needed), false if they decline.
   * After a "Not now", quiet callers (quiet: true) stop asking for the rest of the session;
   * an explicit request like "Explain my portfolio" still asks.
   */
  ensureConsent: (opts?: { quiet?: boolean }) => Promise<boolean>;
  revoke: () => void;
  asking: boolean;
  answer: (yes: boolean) => void;
}

const Ctx = createContext<AiCtx | null>(null);

export function AiProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [consented, setConsented] = useState(false);
  const [asking, setAsking] = useState(false);
  const declined = useRef(false);
  const pending = useRef<((v: boolean) => void) | null>(null);

  useEffect(() => {
    try {
      setConsented(localStorage.getItem(CONSENT_KEY) === "1");
    } catch {}
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, model: "", provider: "" }));
  }, []);

  const ensureConsent = useCallback((opts?: { quiet?: boolean }) => {
    if (consented) return Promise.resolve(true);
    if (opts?.quiet && declined.current) return Promise.resolve(false);
    setAsking(true);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }, [consented]);

  const answer = useCallback((yes: boolean) => {
    setAsking(false);
    if (!yes) declined.current = true;
    if (yes) {
      setConsented(true);
      try {
        localStorage.setItem(CONSENT_KEY, "1");
      } catch {}
    }
    pending.current?.(yes);
    pending.current = null;
  }, []);

  const revoke = useCallback(() => {
    setConsented(false);
    try {
      localStorage.removeItem(CONSENT_KEY);
    } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ status, consented, ensureConsent, revoke, asking, answer }}>{children}</Ctx.Provider>
  );
}

export function useAi() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAi outside AiProvider");
  return c;
}

export { redactSheet } from "./importers/redact";
