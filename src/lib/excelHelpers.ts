// Low-level helpers for Excel import/export — types, field accessors, sheet classification.
import { num } from './format';

/** Generic spreadsheet row. */
export type Row = Record<string, unknown>;

export const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Sentinel values that workbooks use to mean "empty" on text/reference fields. */
const SENTINELS = new Set(['none', 'n/a', 'na', 'n a', '-', '–', '—', 'tbc', 'tbd', 'nil', '']);

/**
 * Purpose: Returns true if a cell value is a placeholder sentinel meaning "no value here".
 *   Prevents fake components, predecessors and resource names being created from "None" cells.
 *
 * Downstream impact: drives list(), sentinelFree(), and inline-PFMEA Failure Mode checks.
 */
export function isSentinel(v: unknown): boolean {
  const s = str(v).toLowerCase();
  return SENTINELS.has(s) || /^-+$/.test(s);
}

/**
 * Purpose: Like str() but returns '' when the value is a known sentinel (None, N/A, -, etc.).
 *   Use on free-text fields (consumables, rationale, notes) so workbook placeholder text
 *   is never stored in the workspace.
 */
export function sentinelFree(v: unknown): string {
  return isSentinel(v) ? '' : str(v);
}

export const list = (v: unknown): string[] =>
  str(v).split(/[;,\n]+/).map((s) => s.trim()).filter((s) => !isSentinel(s));

export const yes = (v: unknown, dflt = true): boolean => {
  const s = str(v).toLowerCase();
  return s === '' ? dflt : ['y', 'yes', 'true', '1', 'active'].includes(s);
};
export const noneOrEmpty = (s: string): boolean =>
  !s || SENTINELS.has(s.toLowerCase()) || /^-+$/.test(s.toLowerCase());
export const nOrNull = (v: unknown): number | null => (str(v) === '' ? null : num(v, 0));

/** Read a column by any of its accepted header spellings. */
export function col(r: Row, ...names: string[]): unknown {
  const want = names.map(key);
  for (const [k, v] of Object.entries(r)) if (want.includes(key(k))) return v;
  return '';
}

export interface ExcelImportResult {
  ws: import('../types').Workspace;
  counts: { label: string; added: number; updated: number }[];
  warnings: string[];
  sheetsRead: string[];
  skippedRows: number;
}
export interface ParsedWorkbook { fileName: string; sheets: Record<string, Row[]>; errorCells: string[] }

const SHEET_KINDS: [RegExp, string][] = [
  [/pfmea|fmea|risk/i, 'pfmea'],
  [/fpd|document|registry/i, 'fpds'],
  [/master.bop|combined.bop|bop.*pfmea|pfmea.*bop/i, 'bop'],
  [/bop|bill.?of.?process|process|ktp|baseline|activit/i, 'bop'],
  [/component|bom|part/i, 'components'],
  [/resource|equipment|crane|tool/i, 'resources'],
];

/** Strong header signals that identify a row as the actual column-header row. */
const STRONG_HEADERS = [
  'phase #', 'route code', 'operation phase title', 'crew density', 'operation action category',
  'specific action type', 'labour content (hours)', 'failure mode', 'severity (1-10)', 'op #', 'fpd code',
  'detailed method steps',
];

function scoreHeaderRow(cells: string[]): number {
  return STRONG_HEADERS.filter((s) => cells.some((c) => c === s || c.includes(s))).length;
}

/**
 * Purpose: Locates the true header row in an aoa (array-of-arrays) from SheetJS,
 *   skipping preamble rows (company name, document title, date, etc.).
 *
 * Formula: score each row; return the first row whose score meets STRONG_HEADERS threshold.
 *
 * Downstream impact: drives BOP sheet classification in parseWorkbook / buildImport.
 *
 * @param aoa - 2-D array from XLSX.utils.sheet_to_json({ header: 1 })
 * @returns 0-based index of the best header row
 */
export function scanHeaderRow(aoa: unknown[][]): number {
  const WEAK = ['route code', 'phase #', 'operation phase title', 'op #', 'fpd code', 'failure mode', 'bom ref', 'name', 'kind', 'resource'];
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const cells = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#()\- ]+/g, ' ').trim());
    const score = scoreHeaderRow(cells);
    if (score >= 2 && score > best.score) best = { idx: i, score };
  }
  if (best.idx >= 0) return best.idx;
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const rowStr = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()).join(' | ');
    if (WEAK.some((s) => rowStr.includes(s))) return i;
  }
  return 0;
}

/**
 * Purpose: Scores a 2-D sheet array as a BOP candidate, counting canonical header
 *   signals and estimated data rows, so the best sheet is preferred over lookup tabs.
 *
 * Formula: headerScore = max BOP-header matches in top 15 rows; dataRows = rows past row 15.
 *
 * Downstream impact: drives BOP sheet selection in parseWorkbook when a workbook has
 *   multiple sheets (Sheet1, Sheet2, etc.).
 *
 * @returns combined score used to rank competing BOP candidates
 */
export function scoreBopCandidate(aoa: unknown[][]): number {
  const BOP_HDRS = ['phase #', 'route code', 'operation phase title', 'crew density', 'operation action category', 'labour content (hours)'];
  let hScore = 0;
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const cells = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase().trim());
    const s = BOP_HDRS.filter((h) => cells.some((c) => c.includes(h))).length;
    if (s > hScore) hScore = s;
  }
  const dataRows = Math.max(0, aoa.length - 15);
  return hScore * 100 + Math.min(dataRows, 100);
}

/** BOP content-scan signals used for sheet classification fallback. */
export const BOP_CONTENT_SIGNALS = ['phase #', 'route code', 'operation phase title', 'op #', 'fpd code'];

type XlsxUtils = { utils: { sheet_to_json<T>(ws: unknown, opts?: unknown): T[] } };

/**
 * Purpose: Converts a SheetJS worksheet to an array of Row objects, honouring multi-row preambles.
 *
 * Formula: scan for the header row via scanHeaderRow, then slice from hIdx+1.
 *
 * Downstream impact: all BOP, PFMEA, FPD, Component and Resource import paths.
 *
 * @returns Row[] suitable for column-accessor functions
 */
export function sheetToRows(XLSX: XlsxUtils, sh: unknown): Row[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '' });
  const hIdx = scanHeaderRow(aoa);
  if (hIdx === 0) return XLSX.utils.sheet_to_json<Row>(sh, { defval: '' });
  const headers = (aoa[hIdx] as unknown[]).map((v) => String(v ?? ''));
  return (aoa.slice(hIdx + 1) as unknown[][])
    .filter((row) => row.some((v) => v !== '' && v != null))
    .map((row) => {
      const obj: Row = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
}

/**
 * Purpose: Classify a workbook's named sheets into domain kinds (bop, fpds, etc.).
 *
 * Formula: regex match on sheet name; fall back to BOP_CONTENT_SIGNALS scan.
 *
 * Downstream impact: determines which buildImport sub-routines run.
 *
 * @returns kind string or undefined if unrecognised
 */
export function classifySheet(name: string, XLSX: XlsxUtils, sh: unknown): string | undefined {
  const byName = SHEET_KINDS.find(([re]) => re.test(name))?.[1];
  if (byName) return byName;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const rowStr = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase()).join(' ');
    if (BOP_CONTENT_SIGNALS.some((s) => rowStr.includes(s))) return 'bop';
  }
  return undefined;
}

/**
 * Purpose: Normalises a Phase # / FPD Code from a BOP workbook cell.
 *   Bare integers (e.g. 4 or "4") become "FPD-004" with display title "Phase 4",
 *   matching the workspace canonical FPD Code format.
 *
 * Formula: if numeric, zero-pad to 3 digits and prefix FPD-.
 *
 * Downstream impact: drives FPD creation in processBopSheet and all BOP row fpdId
 *   assignments; ensures FPDs created from bare phase numbers merge correctly on
 *   subsequent imports.
 */
export function normaliseFpdCode(raw: unknown): { code: string; title: string } {
  const s = str(raw).trim();
  if (!s || isSentinel(raw)) return { code: '', title: '' };
  if (/^\d+$/.test(s)) { const p = s.padStart(3, '0'); return { code: `FPD-${p}`, title: `Phase ${s}` }; }
  return { code: s, title: s };
}

/**
 * Purpose: Detects whether a spreadsheet row is a repeated column-header row or a
 *   helper/instruction row that workbooks sometimes embed mid-sheet.  Such rows must
 *   be skipped so they never become bogus FPDs or BOP operations.
 *
 * Formula: check key reference cells for known header-cell text patterns
 *   (e.g. "Route Code", "Op Number", "Phase #", "Sequential/Parellel").
 *
 * Downstream impact: prevents bogus FPDs (named "Phase #"), fake operations
 *   (named "Route Code") and corrupted predecessor links appearing in Tab 2 BOP.
 */
export function isHeaderOrHelperRow(r: Row): boolean {
  const routeCode = str(col(r, 'Route Code', 'Op #', 'Route Code / Op #', 'Op ID')).toLowerCase();
  const title = str(col(r, 'Operation Phase Title', 'Description', 'Activity Description')).toLowerCase();
  const phase = str(col(r, 'Phase #', 'FPD Code', 'FPD', 'FPD Ref')).toLowerCase();
  const taskType = str(col(r, 'Task Type', 'Type')).toLowerCase();
  if (routeCode === 'route code' || routeCode === 'op number' || routeCode === 'op #') return true;
  if (title === 'operation phase title' || title === 'op description' || title === 'activity description') return true;
  if (phase === 'phase #' || phase === 'fpd number' || phase === 'fpd code') return true;
  if (taskType === 'sequential/parellel' || taskType === 'sequential/parallel') return true;
  return false;
}
