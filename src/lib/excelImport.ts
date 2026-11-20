// Workbook parsing and workspace import — parseWorkbook, buildImport.
import { blankResource } from '../data/seed';
import type { Component, Fpd, PfmeaItem, ResourceKind, Workspace } from '../types';
import { RESOURCE_KINDS, uid } from '../types';
import { num } from './format';
import { type Row, type ExcelImportResult, type ParsedWorkbook, col, list, nOrNull, str, sheetToRows, scoreBopCandidate, BOP_CONTENT_SIGNALS } from './excelHelpers';
import { processBopSheet } from './excelBopImport';

/**
 * Purpose: Classify resource kind from a free-text "Kind" / "Type" / "Category" cell.
 *
 * Formula: regex match against known domain vocabulary.
 *
 * Downstream impact: determines which resource sub-type (crane, stand, rig, etc.) is created in Tab 3.
 *
 * @returns ResourceKind or null if unrecognised
 */
function classifyResourceKind(v: unknown): ResourceKind | null {
  const s = str(v).toLowerCase();
  if (/crane|gantry|jib|hoist/.test(s)) return 'crane';
  if (/rigging|lifting gear|sling|shackle/.test(s)) return 'rigging';
  if (/vehicle|transport|agv|forklift/.test(s)) return 'vehicle';
  if (/stand|jig|stillage|storage/.test(s)) return 'stand';
  if (/rig|tool/.test(s)) return 'rig';
  return null;
}

/**
 * Purpose: Processes the Resources sheet, creating or updating resource registry entries.
 *
 * Downstream impact: populates ws.resources, which Tab 3 displays and Tab 6 uses for duty-cycle calculations.
 */
function processResourceRows(
  resourceRows: Row[], _ws: Workspace, warnings: string[],
  ensureRes: (kind: ResourceKind, name: string, viaBop?: boolean) => ReturnType<typeof blankResource>,
  cellByNumber: (v: unknown) => string,
  cRes: ExcelImportResult['counts'][number],
): void {
  for (const r of resourceRows) {
    const name = str(col(r, 'Name', 'Resource', 'Description'));
    const kind = classifyResourceKind(col(r, 'Kind', 'Type', 'Category'));
    if (!name) continue;
    if (!kind) { warnings.push(`Resource "${name}": kind "${str(col(r, 'Kind', 'Type', 'Category'))}" not recognised — skipped.`); continue; }
    const before = cRes.added;
    const x = ensureRes(kind, name);
    if (cRes.added === before) cRes.updated++;
    x.qty = Math.max(1, num(col(r, 'Qty', 'Quantity'), x.qty));
    x.cellId = cellByNumber(col(r, 'Cell', 'Home Cell')) || x.cellId;
    x.swlKg = nOrNull(col(r, 'SWL (kg)', 'SWL', 'WLL', 'WLL (kg)', 'SWL / WLL (kg)')) ?? x.swlKg;
    x.hookHeightM = nOrNull(col(r, 'Hook Height (m)', 'Hook Height')) ?? x.hookHeightM;
    x.headroomM = nOrNull(col(r, 'Headroom (m)', 'Headroom')) ?? x.headroomM;
    x.tareKg = nOrNull(col(r, 'Tare (kg)', 'Tare')) ?? x.tareKg;
    x.tiers = nOrNull(col(r, 'Tiers')) ?? x.tiers;
    x.tierHeightM = nOrNull(col(r, 'Tier Height (m)', 'Tier Height')) ?? x.tierHeightM;
    const scores = ['Cx Technical', 'Cx Skill', 'Cx Set-Up', 'Cx Upkeep'].map((h) => str(col(r, h)));
    const cls = str(col(r, 'Complexity', 'Tooling Class', 'Class'));
    if (scores.some((v) => v !== '')) x.complexity = scores.map((v, i) => (v === '' ? x.complexity[i] ?? 1 : Math.min(3, Math.max(1, Math.round(num(v, 1))))));
    else if (/complex/i.test(cls)) x.complexity = [3, 3, 2, 2];
    else if (/medium/i.test(cls)) x.complexity = [2, 2, 2, 2];
    else if (/simple|standard/i.test(cls)) x.complexity = [1, 1, 1, 1];
    x.footprintLM = nOrNull(col(r, 'Footprint L (m)', 'Footprint Length')) ?? x.footprintLM;
    x.footprintWM = nOrNull(col(r, 'Footprint W (m)', 'Footprint Width')) ?? x.footprintWM;
    if (str(col(r, 'Utilities', 'Utility Services'))) x.utilities = list(col(r, 'Utilities', 'Utility Services'));
    if (/full/i.test(str(col(r, 'Dwell Mode', 'Dwell')))) x.dwellMode = 'Full-Build';
  }
}

/** SHEET_KINDS regex table used inside parseWorkbook. */
const SHEET_KINDS: [RegExp, string][] = [
  [/pfmea|fmea|risk/i, 'pfmea'], [/fpd|document|registry/i, 'fpds'],
  [/master.bop|combined.bop|bop.*pfmea|pfmea.*bop/i, 'bop'],
  [/bop|bill.?of.?process|process|ktp|baseline|activit/i, 'bop'],
  [/component|bom|part/i, 'components'], [/resource|equipment|crane|tool/i, 'resources'],
];

/**
 * Purpose: Parse a File (.xlsx / .xlsm / .xls / .csv) into a ParsedWorkbook for buildImport.
 *   Scores every worksheet as a BOP candidate and selects the highest-scoring sheet so
 *   generic tab names (Sheet1, Sheet2) are handled correctly.  SheetJS is loaded on
 *   demand — never from a CDN.
 *
 * Formula: for BOP candidates, score = headerMatches × 100 + min(dataRows, 100);
 *   the highest-scoring candidate wins.
 *
 * Downstream impact: provides sheet data to buildImport, which populates the workspace.
 */
export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets: Record<string, Row[]> = {};
  const errorCells: string[] = [];
  const bopCandidates: { name: string; score: number; rows: Row[] }[] = [];
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    for (const addr of Object.keys(sh)) {
      if (addr[0] === '!') continue;
      const c = sh[addr] as { t?: string; w?: string; v?: unknown };
      if (c.t === 'e' || (typeof c.v === 'string' && /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM)[!?]?/.test(c.v))) { errorCells.push(`${name}!${addr} (${c.w ?? c.v})`); delete sh[addr]; }
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', blankrows: false });
    let kind = SHEET_KINDS.find(([re]) => re.test(name))?.[1];
    if (!kind) {
      for (let i = 0; i < Math.min(15, aoa.length); i++) {
        const rowStr = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase()).join(' ');
        if (BOP_CONTENT_SIGNALS.some((s) => rowStr.includes(s))) { kind = 'bop'; break; }
      }
    }
    if (kind === 'bop') {
      bopCandidates.push({ name, score: scoreBopCandidate(aoa), rows: sheetToRows(XLSX, sh) });
    } else if (kind && !sheets[kind]) {
      sheets[kind] = sheetToRows(XLSX, sh);
    }
  }
  if (bopCandidates.length) {
    bopCandidates.sort((a, b) => b.score - a.score);
    sheets['bop'] = bopCandidates[0].rows;
  }
  return { fileName: file.name, sheets, errorCells };
}

/**
 * Purpose: Merge or replace a parsed workbook's sheets into the current workspace state.
 *
 * Formula: clone current → apply FPD/Component/Resource/BOP/PFMEA sheets in sequence.
 *
 * Downstream impact: drives the entire workspace import flow visible in Tab 1–9;
 *   returns a new Workspace for the store to commit.
 */
export function buildImport(parsed: ParsedWorkbook, current: Workspace, mode: 'merge' | 'replace'): ExcelImportResult {
  const ws: Workspace = structuredClone(current);
  const warnings: string[] = [];
  const counts: ExcelImportResult['counts'] = [];
  let skippedRows = 0;
  const count = (label: string) => { const c = { label, added: 0, updated: 0 }; counts.push(c); return c; };
  if (parsed.errorCells.length) warnings.push(`${parsed.errorCells.length} Excel error cell(s) (#REF! etc.) were read as blank: ${parsed.errorCells.slice(0, 8).join(', ')}${parsed.errorCells.length > 8 ? ' …' : ''}`);
  const S = parsed.sheets;
  if (mode === 'replace') { if (S.bop) ws.rows = []; if (S.fpds) ws.fpds = []; if (S.components && !S.bop) ws.components = []; if (S.pfmea) ws.pfmea = []; }
  const cellByNumber = (v: unknown) => { const s = str(v); const n = parseInt(s.replace(/\D+/g, ''), 10); return ws.cells.find((c) => c.number === n || c.id === s || c.name.toLowerCase() === s.toLowerCase())?.id ?? ''; };
  const fpdByCode = (code: string) => ws.fpds.find((f) => f.fpdCode.toLowerCase() === code.toLowerCase());
  const ensureFpd = (code: string, title?: string): Fpd => {
    let f = fpdByCode(code);
    if (!f) { f = { fpdId: uid('fpd'), fpdCode: code, title: title ?? code, subAssemblyBomRef: '', assignedCellId: ws.cells[0]?.id ?? '', revision: 'A', active: true }; ws.fpds.push(f); }
    else if (title && f.title === f.fpdCode) f.title = title;
    return f;
  };
  if (S.fpds) {
    const c = count('FPDs');
    for (const r of S.fpds) {
      const code = str(col(r, 'FPD Code', 'FPD', 'FPD Ref', 'Code', 'Document')); if (!code) continue;
      const existed = !!fpdByCode(code); const f = ensureFpd(code);
      f.title = str(col(r, 'Title', 'FPD Title', 'Description')) || f.title;
      f.subAssemblyBomRef = str(col(r, 'Sub-Assembly BOM Ref', 'BOM Ref', 'BOM')) || f.subAssemblyBomRef;
      const cell = cellByNumber(col(r, 'Assigned Cell', 'Cell'));
      if (cell) f.assignedCellId = cell; else if (str(col(r, 'Assigned Cell', 'Cell'))) warnings.push(`FPD ${code}: cell "${str(col(r, 'Assigned Cell', 'Cell'))}" not recognised — left as is.`);
      f.revision = str(col(r, 'Revision', 'Rev', 'Issue')) || f.revision;
      f.active = (() => { const v = col(r, 'Active'); const sv = str(v).toLowerCase(); return sv === '' ? f.active : ['y', 'yes', 'true', '1', 'active'].includes(sv); })();
      existed ? c.updated++ : c.added++;
    }
  }
  const findCmp = (ref: string): Component | undefined => ws.components.find((m) => m.bomRef.toLowerCase() === ref.toLowerCase() || m.name.toLowerCase() === ref.toLowerCase());
  const cCmp = count('Components');
  for (const r of S.components ?? []) {
    const ref = str(col(r, 'BOM Ref', 'BOM', 'Part Number', 'Component')); const name = str(col(r, 'Name', 'Component Name', 'Description'));
    if (!ref && !name) continue;
    let m = findCmp(ref || name);
    if (!m) { m = { id: uid('cmp'), bomRef: ref || name, name: name || ref, weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' }; ws.components.push(m); cCmp.added++; } else cCmp.updated++;
    Object.assign(m, { name: name || m.name, weightKg: nOrNull(col(r, 'Weight (kg)', 'Weight', 'Mass', 'Mass (kg)')) ?? m.weightKg, lengthM: nOrNull(col(r, 'Length (m)', 'Length', 'L')) ?? m.lengthM, widthM: nOrNull(col(r, 'Width (m)', 'Width', 'W')) ?? m.widthM, heightM: nOrNull(col(r, 'Height (m)', 'Height', 'H')) ?? m.heightM, qtyPerBuild: num(col(r, 'Qty per Build', 'Qty', 'Quantity'), m.qtyPerBuild) || 1 });
  }
  const cRes = count('Resources');
  const ensureRes = (kind: ResourceKind, name: string, viaBop = false) => {
    let r = ws.resources.find((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
    if (!r) { r = { ...blankResource(kind, uid('res')), name }; ws.resources.push(r); cRes.added++; if (viaBop) warnings.push(`${RESOURCE_KINDS.find((k) => k.kind === kind)!.label} "${name}" was not in the registry — created with blank ratings. Complete it in Tab 4.`); }
    return r;
  };
  if (S.resources) processResourceRows(S.resources, ws, warnings, ensureRes, cellByNumber, cRes);
  if (S.bop) skippedRows = processBopSheet(S.bop, ws, warnings, counts, findCmp, ensureFpd, ensureRes, cellByNumber);
  if (S.pfmea) {
    const c = count('PFMEA items');
    const sod = (v: unknown) => Math.min(10, Math.max(1, Math.round(num(v, 1))));
    for (const r of S.pfmea) {
      const fm = str(col(r, 'Failure Mode', 'Potential Failure Mode')); if (!fm) continue;
      const op = str(col(r, 'Op #', 'Op', 'Process Step')); const code = str(col(r, 'FPD Code', 'FPD'));
      let p: PfmeaItem | undefined = ws.pfmea.find((x) => x.opId === op && x.failureMode.toLowerCase() === fm.toLowerCase());
      if (!p) { p = { id: uid('pf'), fpdId: '', opId: op, failureMode: fm, effect: '', cause: '', controls: '', s: 1, o: 1, d: 1, recommendedAction: '', owner: '', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: [] }; ws.pfmea.push(p); c.added++; } else c.updated++;
      const st = str(col(r, 'Status'));
      Object.assign(p, { fpdId: code ? ensureFpd(code).fpdId : p.fpdId, effect: str(col(r, 'Effect', 'Potential Effect')) || p.effect, cause: str(col(r, 'Cause', 'Potential Cause')) || p.cause, controls: str(col(r, 'Controls', 'Current Controls')) || p.controls, s: sod(col(r, 'S', 'Severity')), o: sod(col(r, 'O', 'Occurrence')), d: sod(col(r, 'D', 'Detection')), recommendedAction: str(col(r, 'Recommended Action', 'Action')) || p.recommendedAction, owner: str(col(r, 'Owner')) || p.owner, status: /clos/i.test(st) ? 'Closed' : /progress/i.test(st) ? 'In Progress' : 'Open', controlDocRef: str(col(r, 'Control Doc Ref', 'Control Document', 'Control Plan Ref')) || p.controlDocRef, resourceIds: str(col(r, 'Assigned Resources', 'Tooling', 'Assigned Tooling')) ? list(col(r, 'Assigned Resources', 'Tooling', 'Assigned Tooling')).map((n) => ws.resources.find((x) => x.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x) : p.resourceIds });
    }
  }
  if (!Object.keys(S).length) warnings.push('No recognisable BOP sheets found. Expected a sheet whose first rows contain "Route Code", "Operation Phase Title" and "Phase #" — download the template for the exact column layout.');
  ws.meta.updatedAt = new Date().toISOString();
  return { ws, counts: counts.filter((c) => c.added + c.updated > 0 || c.label !== 'Resources'), warnings, sheetsRead: Object.keys(S), skippedRows };
}
