import type { AssetClass } from "../types";

export type SourceId = "cams" | "nsdl" | "file";

export interface Source {
  id: SourceId;
  title: string;
  covers: string;
  /** Step-by-step for getting the file. */
  steps: string[];
  password?: string;
  accept: string;
  ready: boolean;
  /** Files Folio reads without asking about columns. */
  recognised?: string;
}

export const SOURCES: Source[] = [
  {
    id: "cams",
    title: "Mutual fund statement (CAS)",
    covers: "Every Indian mutual fund you hold, from any app — Groww, Kuvera, Zerodha Coin, direct with the AMC.",
    steps: [
      "Open camsonline.com, go to Investors, then Statements, and choose “CAS – CAMS+KFintech”. (kfintech.com has the same form.)",
      "Pick the “Detailed” statement and “Specific period”, from the month of your first investment to today.",
      "Enter the email address registered with your funds and your PAN, then set a password for the PDF.",
      "The statement arrives by email within a few minutes. Upload that PDF here and type the password you set.",
    ],
    password: "The password you chose on the CAMS or KFintech form.",
    accept: ".pdf",
    ready: false,
  },
  {
    id: "nsdl",
    title: "Demat statement (NSDL / CDSL CAS)",
    covers: "Indian shares, ETFs and bonds across every broker with a demat account — Groww, Zerodha, INDmoney and others.",
    steps: [
      "Look in your email for “Consolidated Account Statement” from NSDL or CDSL. It's sent each month you had a transaction.",
      "No recent email? Request one on the NSDL or CDSL website — search for “NSDL CAS” or “CDSL CAS”.",
      "Upload the PDF here. Its password is usually your PAN in capital letters.",
    ],
    password: "Usually your PAN in capital letters, e.g. ABCDE1234F.",
    accept: ".pdf",
    ready: false,
  },
  {
    id: "file",
    title: "Holdings file from a broker or exchange",
    covers: "Any CSV or Excel file with one row per holding — from Groww, INDmoney, CoinDCX, Zerodha, Binance or anywhere else.",
    steps: [
      "Groww: open groww.in, go to Reports, and download the “Stocks holdings statement” and the “Mutual funds” holdings report.",
      "INDmoney: open the US stocks section, find Reports or Statements, and download the holdings report.",
      "Any other broker: find the current holdings report — usually under Reports, Statements or Portfolio — not a tax or P&L report. Download it as CSV or Excel.",
      "Upload it here. Files Folio doesn't know yet open a short step to check which column is which.",
    ],
    accept: ".csv,.xlsx,.xlsm,.xls,.ods,.txt",
    ready: true,
    recognised: "Groww stocks holdings statement, Groww mutual funds holdings, INDmoney US stocks holdings report.",
  },
];

export const CLASS_FOR_IMPORT: { value: AssetClass; label: string }[] = [
  { value: "in_stock", label: "Indian stocks" },
  { value: "mf", label: "Mutual funds" },
  { value: "us_stock", label: "US stocks" },
  { value: "crypto", label: "Crypto" },
];
