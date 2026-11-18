// Low-level helpers for Excel import/export — types, field accessors, sheet classification.
import { num } from './format';

/** Generic spreadsheet row. */
export type Row = Record<string, unknown>;

export const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const str = (v: unknown): string => (v == null ? '' : String(v).trim());
export const list = (v: unknown): string[] => str(v).split(/[;,\n]+/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'none');
export const yes = (v: unknown, dflt = true): boolean => { const s = str(v).toLowerCase(); return s === '' ? dflt : ['y', 'yes', 'true', '1', 'active'].includes(s); };
export const noneOrEmpty = (s: string): boolean => !s || s.toLowerCase() === 'none';
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
