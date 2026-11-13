const PERSONAL_COL = /\b(portfolio name|client|investor|holder|nominee|account|pan|mobile|phone|e-?mail|folio|ucc|client code|dp id|arn|name of)\b/i;
const HOLDING_COL = /security|scheme|stock|fund|instrument|coin|scrip|symbol/i;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_ID = /(?<![\d.,])\d{8,}(?:\/\d+)?(?![\d.])/g;

/** Rows sent to the AI: enough to see the pattern, few enough to keep the request small. */
export const AI_SAMPLE_ROWS = 8;

/**
 * What the sheet reader is allowed to see: the header and the first rows below it, with
 * person/account columns blanked and PAN, phone, email and long account numbers masked.
 * Rows above the header (where statements print name, PAN and mobile) are never sent.
 */
export function redactSheet(header: string[], body: string[][]) {
  const blank = header.map((h) => PERSONAL_COL.test(h) && !HOLDING_COL.test(h));
  const clean = (c: string) =>
    c.replace(PAN, "[PAN]").replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(LONG_ID, "[id]");
  return {
    header: header.map(clean),
    rows: body.slice(0, AI_SAMPLE_ROWS).map((r) => r.map((c, i) => (blank[i] ? (c ? "[hidden]" : "") : clean(c)))),
  };
}
