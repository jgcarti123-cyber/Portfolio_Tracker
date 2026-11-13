import { checkMapping, type Cols } from "./extract";

/** Whether a column choice has what's needed to value holdings: an identifier plus enough amounts. */
export function isUsable(c: Cols) {
  const id = c.name !== undefined || c.ticker !== undefined || c.isin !== undefined;
  const qty = c.qty !== undefined;
  const cost = c.avg !== undefined || c.invested !== undefined || c.pnl !== undefined;
  const value = c.value !== undefined || c.price !== undefined || c.pnl !== undefined;
  return id && ((qty && (cost || value)) || (c.invested !== undefined && (c.value !== undefined || c.pnl !== undefined)));
}

/** Higher is better: every row complete, every cross-check passing. */
export function mappingScore(body: string[][], c: Cols) {
  if (!isUsable(c)) return -1;
  const m = checkMapping(body, c);
  return m.complete * 2 + (m.checks ? m.consistency * 1.5 : 0.75) + Math.min(m.checks, 10) / 100;
}

/**
 * Picks between Folio's own guess and the AI's reading by testing both against the
 * numbers. The AI wins ties because it can read meaning the rules can't.
 */
export function chooseMapping(body: string[][], guess: Cols, ai: Cols | null): { cols: Cols; by: "ai" | "guess" } {
  const g = mappingScore(body, guess);
  const a = ai ? mappingScore(body, ai) : -2;
  return a >= g && a >= 0 ? { cols: ai!, by: "ai" } : { cols: guess, by: "guess" };
}
