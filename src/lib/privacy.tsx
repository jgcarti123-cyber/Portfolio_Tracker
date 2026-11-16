"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { setAmountsHidden } from "./format";

/**
 * "Hide amounts" for showing Folio to someone or taking a screenshot: every rupee and dollar
 * amount and unit count is masked, while percentages, market prices and chart shapes stay.
 * The choice is kept on this device.
 */
const KEY = "folio:hide-amounts";
const Ctx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  // The formatters read this flag; set it before any child renders so a toggle repaints every figure.
  setAmountsHidden(hidden);

  const toggle = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(KEY, h ? "0" : "1");
      } catch {}
      return !h;
    });
  }, []);

  return <Ctx.Provider value={{ hidden, toggle }}>{children}</Ctx.Provider>;
}

export const usePrivacy = () => useContext(Ctx);

/** Masks amounts inside free text (an assistant reply): ₹12,400, $1.2K, ₹3.4 lakh… */
export const maskText = (s: string) =>
  s.replace(/([₹$])\s?\d[\d,]*(\.\d+)?(\s?(K|L|Cr|M|B|lakh|lakhs|crore|crores)\b)?/g, "$1••••");
