/**
 * Import accuracy test. Runs every spreadsheet in a fixtures folder through the same
 * code the app uses — header detection, Folio's column guess, the AI reader (via the
 * running dev server), and the arithmetic arbitration — then compares the holdings
 * produced with the answer key.
 *
 *   npx tsx scripts/eval-import.ts <fixtures-dir> [--no-ai] [--server http://localhost:3001]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { chooseMapping } from "../src/lib/importers/choose";
import { checkMapping, extractHoldings, type Cols, type FileHolding } from "../src/lib/importers/extract";
import { detectPreset } from "../src/lib/importers/presets";
import { redactSheet } from "../src/lib/importers/redact";
import { guessColumns, inferClass, parseCsv, pickSheet, readHeader, refineColumns, sheetRows, type Table } from "../src/lib/importers/table";

XLSX.set_fs(fs);

interface Answer {
  file: string;
  cls: string;
  currency: string;
  holdings: { id: string; qty: number; cost: number | null; value: number }[];
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "fixtures";
const useAi = !args.includes("--no-ai");
const server = args[args.indexOf("--server") + 1]?.startsWith("http") ? args[args.indexOf("--server") + 1] : "http://localhost:3001";
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

function load(file: string): Table[] {
  const p = path.join(dir, file);
  if (file.endsWith(".csv")) return [{ sheet: file, rows: parseCsv(fs.readFileSync(p, "utf8")) }];
  const wb = XLSX.readFile(p);
  return wb.SheetNames.map((s) => ({ sheet: s, rows: sheetRows(XLSX, wb.Sheets[s]) }));
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * tol, 0.011);

function score(got: FileHolding[], want: Answer["holdings"]) {
  const errors: string[] = [];
  const used = new Set<number>();
  let ok = 0;
  for (const w of want) {
    const i = got.findIndex(
      (g, k) => !used.has(k) && [g.name, g.ticker, g.isin].some((x) => x && x.toLowerCase() === w.id.toLowerCase()),
    );
    if (i < 0) {
      errors.push(`missing ${w.id}`);
      continue;
    }
    used.add(i);
    const g = got[i];
    const bad: string[] = [];
    if (!near(g.qty, w.qty, 0.001)) bad.push(`qty ${g.qty} ≠ ${w.qty}`);
    if (w.cost !== null && !near(g.cost, w.cost, 0.01)) bad.push(`cost ${g.cost} ≠ ${w.cost}`);
    if (!near(g.value, w.value, 0.01)) bad.push(`value ${g.value} ≠ ${w.value}`);
    if (bad.length) errors.push(`${w.id}: ${bad.join(", ")}`);
    else ok++;
  }
  got.forEach((g, k) => !used.has(k) && errors.push(`extra row "${g.name || g.ticker || g.isin}"`));
  return { ok, total: want.length, pass: ok === want.length && errors.length === 0, errors };
}

async function askAi(labels: string[], body: string[][]) {
  const res = await fetch(`${server}/api/ai/read-sheet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(redactSheet(labels, body)),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.status);
  return json as { columns: Cols & { date?: number }; assetClass: string | null; currency: string | null; notes: string };
}

const fmt = (c: Cols, labels: string[]) =>
  Object.entries(c)
    .map(([k, v]) => `${k}=${JSON.stringify(labels[v as number])}`)
    .join(" ");

async function main() {
  const answers: Answer[] = JSON.parse(fs.readFileSync(path.join(dir, "answers.json"), "utf8"));
  const tally = { guess: 0, ai: 0, chosen: 0, aiCls: 0, aiCur: 0, files: 0 };
  for (const a of answers) {
    if (only && !a.file.includes(only)) continue;
    tally.files++;
    const tables = load(a.file).filter((t) => t.rows.length > 1);
    const t = tables[pickSheet(tables)];
    const { index, labels } = readHeader(t.rows);
    const body = t.rows.slice(index + 1);
    const preset = detectPreset(labels);

    const guess = preset?.cols ?? refineColumns(guessColumns(labels), labels, body);
    const g = score(extractHoldings(body, guess), a.holdings);
    if (g.pass) tally.guess++;

    let aiCols: Cols | null = null;
    let ai: ReturnType<typeof score> | null = null;
    let aiMeta = "";
    if (useAi) {
      // Stay inside the provider's per-minute limit during a batch run.
      await new Promise((r) => setTimeout(r, Number(process.env.AI_GAP_MS ?? 4000)));
      try {
        const r = await askAi(labels, body);
        const { date: _d, ...cols } = r.columns;
        aiCols = cols;
        ai = score(extractHoldings(body, cols), a.holdings);
        if (ai.pass) tally.ai++;
        if (r.assetClass === a.cls) tally.aiCls++;
        if (r.currency === a.currency) tally.aiCur++;
        aiMeta = `class ${r.assetClass}${r.assetClass === a.cls ? "" : `≠${a.cls}`}, currency ${r.currency}${r.currency === a.currency ? "" : `≠${a.currency}`}`;
      } catch (e) {
        aiMeta = `AI error: ${(e as Error).message}`;
      }
    }

    const chosen = chooseMapping(body, guess, aiCols);
    const c = score(extractHoldings(body, chosen.cols), a.holdings);
    if (c.pass) tally.chosen++;
    const check = checkMapping(body, chosen.cols);

    const mark = (s: { pass: boolean } | null) => (s === null ? "  –  " : s.pass ? " PASS" : " FAIL");
    console.log(
      `\n${a.file}  [sheet "${t.sheet}", header row ${index}${preset ? `, preset ${preset.id}` : ""}]` +
        `\n  guess ${mark(g)}  ${g.ok}/${g.total}   ${fmt(guess, labels)}` +
        (g.pass ? "" : `\n         ${g.errors.slice(0, 4).join("; ")}`) +
        (useAi ? `\n  AI    ${mark(ai)}  ${ai ? `${ai.ok}/${ai.total}` : ""}   ${aiCols ? fmt(aiCols, labels) : ""}   (${aiMeta})` : "") +
        (ai && !ai.pass ? `\n         ${ai.errors.slice(0, 4).join("; ")}` : "") +
        `\n  final ${mark(c)}  by ${chosen.by}, cross-checks ${check.checks ? `${Math.round(check.consistency * 100)}% of ${check.checks}` : "none possible"}, guessed class ${inferClass(labels, body) ?? "?"}` +
        (c.pass ? "" : `\n         ${c.errors.slice(0, 4).join("; ")}`),
    );
  }
  const pct = (n: number) => `${n}/${tally.files} (${Math.round((n / tally.files) * 100)}%)`;
  console.log(`\n==== Summary over ${tally.files} files ====`);
  console.log(`Folio's guess alone : ${pct(tally.guess)}`);
  if (useAi) {
    console.log(`AI alone            : ${pct(tally.ai)}`);
    console.log(`AI asset class      : ${pct(tally.aiCls)}`);
    console.log(`AI currency         : ${pct(tally.aiCur)}`);
  }
  console.log(`Final (what the app adds): ${pct(tally.chosen)}`);
}

main();
