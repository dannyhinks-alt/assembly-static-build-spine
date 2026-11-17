// Excel (.xlsx) import / export. SheetJS is bundled locally and loaded on demand — no CDN.
import { blankResource, blankRow } from '../data/seed';
import type { Model } from '../engine/model';
import { leavesOf } from '../engine/model';
import type { ActionType, BopRow, Classification, Component, Fpd, PfmeaItem, Resource, ResourceKind, Workspace } from '../types';
import { ACTION_TYPES, FLOOR_LEVELS, RESOURCE_KINDS, complexityOf, uid } from '../types';
import { num } from './format';

type Row = Record<string, unknown>;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const list = (v: unknown) => str(v).split(/[;,\n]+/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'none');
const yes = (v: unknown, dflt = true) => { const s = str(v).toLowerCase(); return s === '' ? dflt : ['y', 'yes', 'true', '1', 'active'].includes(s); };

/** Read a column by any of its accepted header spellings. */
function col(r: Row, ...names: string[]): unknown {
  const want = names.map(key);
  for (const [k, v] of Object.entries(r)) if (want.includes(key(k))) return v;
  return '';
}

export interface ExcelImportResult {
  ws: Workspace;
  counts: { label: string; added: number; updated: number }[];
  warnings: string[];
  sheetsRead: string[];
}
export interface ParsedWorkbook { fileName: string; sheets: Record<string, Row[]>; errorCells: string[] }

const SHEET_KINDS: [RegExp, string][] = [
  [/pfmea|fmea|risk/i, 'pfmea'],
  [/fpd|document|registry/i, 'fpds'],
  [/master.bop|combined.bop|bop.*pfmea|pfmea.*bop/i, 'bop'],  // combined Master BOP & PFMEA sheet
  [/bop|bill.?of.?process|process|ktp|baseline|activit/i, 'bop'],  // 'ktp' kept for legacy sheet names
  [/component|bom|part/i, 'components'],
  [/resource|equipment|crane|tool/i, 'resources'],
];

/** Scan the first 15 rows of a sheet to find the actual header row. */
function scanHeaderRow(aoa: unknown[][]): number {
  const SIGNALS = ['route code', 'phase #', 'operation phase title', 'op #', 'fpd code', 'failure mode', 'bom ref', 'name', 'kind', 'resource'];
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const row = aoa[i] as unknown[];
    const rowStr = row.map((v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()).join(' | ');
    if (SIGNALS.some((s) => rowStr.includes(s))) return i;
  }
  return 0;
}

export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets: Record<string, Row[]> = {};
  const errorCells: string[] = [];
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    for (const addr of Object.keys(sh)) {
      if (addr[0] === '!') continue;
      const c = sh[addr] as { t?: string; w?: string; v?: unknown };
      if (c.t === 'e' || (typeof c.v === 'string' && /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM)[!?]?/.test(c.v))) {
        errorCells.push(`${name}!${addr} (${c.w ?? c.v})`);
        delete sh[addr];
      }
    }
    const kind = SHEET_KINDS.find(([re]) => re.test(name))?.[1];
    if (kind && !sheets[kind]) {
      // Dynamic header detection: scan first 15 rows for the real header row.
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '' });
      const hIdx = scanHeaderRow(aoa);
      if (hIdx === 0) {
        sheets[kind] = XLSX.utils.sheet_to_json<Row>(sh, { defval: '' });
      } else {
        const headers = (aoa[hIdx] as unknown[]).map((v) => String(v ?? ''));
        sheets[kind] = (aoa.slice(hIdx + 1) as unknown[][])
          .filter((row) => row.some((v) => v !== '' && v != null))
          .map((row) => {
            const obj: Row = {};
            headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
            return obj;
          });
      }
    }
  }
  return { fileName: file.name, sheets, errorCells };
}

export function buildImport(parsed: ParsedWorkbook, current: Workspace, mode: 'merge' | 'replace'): ExcelImportResult {
  const ws: Workspace = structuredClone(current);
  const warnings: string[] = [];
  const counts: ExcelImportResult['counts'] = [];
  const count = (label: string) => { const c = { label, added: 0, updated: 0 }; counts.push(c); return c; };
  if (parsed.errorCells.length)
    warnings.push(`${parsed.errorCells.length} Excel error cell(s) (#REF! etc.) were read as blank: ${parsed.errorCells.slice(0, 8).join(', ')}${parsed.errorCells.length > 8 ? ' …' : ''}`);
  const S = parsed.sheets;
  if (mode === 'replace') {
    if (S.bop) ws.rows = [];
    if (S.fpds) ws.fpds = [];
    if (S.components && !S.bop) ws.components = [];
    if (S.pfmea) ws.pfmea = [];
  }

  const cellByNumber = (v: unknown) => {
    const s = str(v);
    const n = parseInt(s.replace(/\D+/g, ''), 10);
    return ws.cells.find((c) => c.number === n || c.id === s || c.name.toLowerCase() === s.toLowerCase())?.id ?? '';
  };

  // ---- FPDs ----
  const fpdByCode = (code: string) => ws.fpds.find((f) => f.fpdCode.toLowerCase() === code.toLowerCase());
  const ensureFpd = (code: string): Fpd => {
    let f = fpdByCode(code);
    if (!f) {
      f = { fpdId: uid('fpd'), fpdCode: code, title: code, subAssemblyBomRef: '', assignedCellId: ws.cells[0]?.id ?? '', revision: 'A', active: true };
      ws.fpds.push(f);
    }
    return f;
  };
  if (S.fpds) {
    const c = count('FPDs');
    for (const r of S.fpds) {
      const code = str(col(r, 'FPD Code', 'FPD', 'FPD Ref', 'Code', 'Document'));
      if (!code) continue;
      const existed = !!fpdByCode(code);
      const f = ensureFpd(code);
      f.title = str(col(r, 'Title', 'FPD Title', 'Description')) || f.title;
      f.subAssemblyBomRef = str(col(r, 'Sub-Assembly BOM Ref', 'BOM Ref', 'BOM')) || f.subAssemblyBomRef;
      const cell = cellByNumber(col(r, 'Assigned Cell', 'Cell'));
      if (cell) f.assignedCellId = cell;
      else if (str(col(r, 'Assigned Cell', 'Cell'))) warnings.push(`FPD ${code}: cell "${str(col(r, 'Assigned Cell', 'Cell'))}" not recognised — left as is.`);
      f.revision = str(col(r, 'Revision', 'Rev', 'Issue')) || f.revision;
      f.active = yes(col(r, 'Active'), f.active);
      existed ? c.updated++ : c.added++;
    }
  }

  // ---- Components ----
  const findCmp = (ref: string) => ws.components.find((m) => m.bomRef.toLowerCase() === ref.toLowerCase() || m.name.toLowerCase() === ref.toLowerCase());
  const cCmp = count('Components');
  const nOrNull = (v: unknown) => (str(v) === '' ? null : num(v, 0));
  for (const r of S.components ?? []) {
    const ref = str(col(r, 'BOM Ref', 'BOM', 'Part Number', 'Component'));
    const name = str(col(r, 'Name', 'Component Name', 'Description'));
    if (!ref && !name) continue;
    let m = findCmp(ref || name);
    if (!m) {
      m = { id: uid('cmp'), bomRef: ref || name, name: name || ref, weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' };
      ws.components.push(m);
      cCmp.added++;
    } else cCmp.updated++;
    const upd: Partial<Component> = {
      name: name || m.name, weightKg: nOrNull(col(r, 'Weight (kg)', 'Weight', 'Mass', 'Mass (kg)')) ?? m.weightKg,
      lengthM: nOrNull(col(r, 'Length (m)', 'Length', 'L')) ?? m.lengthM, widthM: nOrNull(col(r, 'Width (m)', 'Width', 'W')) ?? m.widthM,
      heightM: nOrNull(col(r, 'Height (m)', 'Height', 'H')) ?? m.heightM, qtyPerBuild: num(col(r, 'Qty per Build', 'Qty', 'Quantity'), m.qtyPerBuild) || 1,
    };
    Object.assign(m, upd);
  }

  // ---- Resources ----
  const kindOf = (v: unknown): ResourceKind | null => {
    const s = str(v).toLowerCase();
    if (/crane|gantry|jib|hoist/.test(s)) return 'crane';
    if (/rigging|lifting gear|sling|shackle/.test(s)) return 'rigging';
    if (/vehicle|transport|agv|forklift/.test(s)) return 'vehicle';
    if (/stand|jig|stillage|storage/.test(s)) return 'stand';
    if (/rig|tool/.test(s)) return 'rig';
    return null;
  };
  const cRes = count('Resources');
  const ensureRes = (kind: ResourceKind, name: string, viaBop = false): Resource => {
    let r = ws.resources.find((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
    if (!r) {
      r = { ...blankResource(kind, uid('res')), name };
      ws.resources.push(r);
      cRes.added++;
      if (viaBop) warnings.push(`${RESOURCE_KINDS.find((k) => k.kind === kind)!.label} "${name}" was not in the registry — created with blank ratings. Complete it in Tab 4.`);
    }
    return r;
  };
  for (const r of S.resources ?? []) {
    const name = str(col(r, 'Name', 'Resource', 'Description'));
    const kind = kindOf(col(r, 'Kind', 'Type', 'Category'));
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

  // ---- BOP ----
  if (S.bop) {
    const c = count('BOP activities');
    const zoneOf = (v: unknown, op: string): string => {
      const s = str(v);
      if (!s) return '';
      const z = ws.zones.find((x) => x.name.toLowerCase() === s.toLowerCase() || x.id.toLowerCase() === s.toLowerCase())
        ?? ws.zones.find((x) => x.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(x.name.toLowerCase()));
      if (z) return z.id;
      const cell = cellByNumber(s);
      const first = ws.zones.find((x) => x.cellId === cell);
      if (first) return first.id;
      warnings.push(`${op}: zone "${s}" not recognised — left blank.`);
      return '';
    };
    const classOf = (v: unknown): Classification => { const s = str(v).toUpperCase(); return /NNVA|NECESSARY/.test(s) ? 'NNVA' : /NVA|WASTE/.test(s) ? 'NVA' : 'VA'; };
    const actionOf = (v: unknown): ActionType => {
      const s = key(str(v));
      return ACTION_TYPES.find((a) => key(a) === s) ?? ACTION_TYPES.find((a) => s && key(a).startsWith(s.slice(0, 4))) ?? 'Fitting';
    };
    const levelOf = (v: unknown) => {
      const s = str(v).toLowerCase();
      const i = FLOOR_LEVELS.findIndex((l) => l.toLowerCase() === s);
      return i >= 0 ? i : Math.min(3, Math.max(0, parseInt(s.replace(/\D+/g, ''), 10) || 0));
    };
    const tags = (kind: ResourceKind, v: unknown) => list(v).map((n) => ensureRes(kind, n, true).id);
    const flat = new Map<string, BopRow>();
    for (const r of ws.rows) for (const l of leavesOf(r)) flat.set(l.opId.trim().toLowerCase(), l);
    // Track last destination zone per FPD for origin zone auto-link (Master BOP & PFMEA Combined import).
    const lastDestZone = new Map<string, string>();
    for (const r of S.bop) {
      const op = str(col(r, 'Op #', 'Op', 'Route Code', 'Route Code / Op #', 'Op ID', 'Operation'));
      const code = str(col(r, 'FPD Code', 'FPD', 'FPD Ref', 'Phase #', 'Phase'));
      if (!op || !code) { if (op || code) warnings.push(`BOP row skipped — needs both FPD Code and Op # (got "${code}" / "${op}").`); continue; }
      const fpd = ensureFpd(code);
      let row = flat.get(op.toLowerCase());
      if (!row) {
        row = blankRow(fpd.fpdId, op);
        ws.rows.push(row);
        flat.set(op.toLowerCase(), row);
        c.added++;
      } else c.updated++;
      row.fpdId = fpd.fpdId;
      row.description = str(col(r, 'Description', 'Activity Description', 'Baseline Work Block / Activity Description', 'Work Block / Activity Description', 'Activity', 'Operation Phase Title')) || row.description;
      row.taskType = /par/i.test(str(col(r, 'Task Type', 'Type'))) ? 'Parallel' : 'Sequential';
      row.predecessors = list(col(r, 'Predecessors', 'Predecessor #', 'Predecessor', 'Pred', 'Predecessor Phase #'));
      row.destZoneId = zoneOf(col(r, 'Destination Zone', 'Destination', 'Dest Zone', 'Destination Cell / Zone', 'Zone'), op) || row.destZoneId;
      // Origin zone: explicit column, or auto-link from previous row's destination zone in same FPD.
      const explicitOrigin = zoneOf(col(r, 'Origin Zone', 'Origin', 'Origin Cell / Zone'), op);
      row.originZoneId = explicitOrigin || lastDestZone.get(fpd.fpdId) || row.destZoneId;
      if (row.destZoneId) lastDestZone.set(fpd.fpdId, row.destZoneId);
      row.floorLevel = levelOf(col(r, 'Floor Level', 'Stand Floor Level', 'Level'));
      row.componentIds = list(col(r, 'Components', 'Component', 'Component Name / Description', 'Component Name/Description', 'BOM Refs')).map((ref) => {
        let m = findCmp(ref);
        if (!m) {
          m = { id: uid('cmp'), bomRef: ref, name: ref, weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' };
          ws.components.push(m);
          cCmp.added++;
          warnings.push(`Component "${ref}" (op ${op}) was not in the registry — created with no weight. Complete it in Tab 3.`);
        }
        return m.id;
      });
      row.crewSize = Math.max(1, Math.round(num(col(r, 'Crew Size', 'Crew', 'Crew Density'), 1)));
      row.runHrs = Math.max(0, num(col(r, 'Run Time (hrs)', 'Run Time', 'Equipment / Bay Run Time (hrs)', 'Run')));
      row.manningHrs = Math.max(0, num(col(r, 'Manning Time (hrs)', 'Manning Time', 'Operator Manning Time (hrs)', 'Manning', 'Labour Content (Hours)', 'Labour Content'), row.runHrs));
      row.touchHrs = Math.max(0, num(col(r, 'Touch Time (hrs)', 'Touch Time', 'Operator Touch Time (hrs)', 'Touch'), row.manningHrs));
      if (row.touchHrs > row.manningHrs) { warnings.push(`${op}: Touch Time ${row.touchHrs} h exceeded Manning Time ${row.manningHrs} h — capped.`); row.touchHrs = row.manningHrs; }
      row.classification = classOf(col(r, 'Classification', 'Action Classification', 'VA', 'Operation Action Category'));
      row.actionType = actionOf(col(r, 'Action Type', 'Specific Action Type', 'Action'));
      row.rigIds = tags('rig', col(r, 'Process Rigs', 'Process Rigs & Tooling', 'Rigs', 'Tooling', 'L1 Parent Tool'));
      row.craneIds = tags('crane', col(r, 'Cranes', 'Crane'));
      row.riggingIds = tags('rigging', col(r, 'Rigging', 'Rigging & Lifting Gear', 'Lifting Gear'));
      row.vehicleIds = tags('vehicle', col(r, 'Vehicles', 'Transport Vehicles', 'Transport'));
      row.standIds = tags('stand', col(r, 'Stands', 'Build & Storage Stands', 'Stand', 'L3 Sub-Tool'));
      row.liftCount = Math.max(0, Math.round(num(col(r, 'Lifts', 'Lift Count'))));
      if (row.actionType === 'Lifting' && row.liftCount === 0) row.liftCount = 1;
      row.moveCount = Math.max(0, Math.round(num(col(r, 'Moves', 'Move Count'))));
      row.notes = str(col(r, 'Notes', 'Engineering Notes', 'Rationale', 'Comments')) || row.notes;
      // Quality Gate Sign-off → create a Hold Point if non-empty.
      const gateTitle = str(col(r, 'Quality Gate Sign-off', 'Quality Gate', 'Hold Point'));
      if (gateTitle) {
        const existing = ws.holdPoints.find((h) => h.opId === op && h.title.toLowerCase() === gateTitle.toLowerCase());
        if (!existing) {
          ws.holdPoints.push({ id: uid('hp'), fpdId: fpd.fpdId, opId: op, type: 'Hold', title: gateTitle, notes: '', status: 'Planned' });
        }
      }
    }
  }

  // ---- PFMEA ----
  if (S.pfmea) {
    const c = count('PFMEA items');
    const sod = (v: unknown) => Math.min(10, Math.max(1, Math.round(num(v, 1))));
    for (const r of S.pfmea) {
      const fm = str(col(r, 'Failure Mode', 'Potential Failure Mode'));
      if (!fm) continue;
      const op = str(col(r, 'Op #', 'Op', 'Process Step'));
      const code = str(col(r, 'FPD Code', 'FPD'));
      let p = ws.pfmea.find((x) => x.opId === op && x.failureMode.toLowerCase() === fm.toLowerCase());
      if (!p) {
        p = { id: uid('pf'), fpdId: '', opId: op, failureMode: fm, effect: '', cause: '', controls: '', s: 1, o: 1, d: 1, recommendedAction: '', owner: '', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: [] };
        ws.pfmea.push(p);
        c.added++;
      } else c.updated++;
      const st = str(col(r, 'Status'));
      const upd: Partial<PfmeaItem> = {
        fpdId: code ? ensureFpd(code).fpdId : p.fpdId, effect: str(col(r, 'Effect', 'Potential Effect')) || p.effect, cause: str(col(r, 'Cause', 'Potential Cause')) || p.cause,
        controls: str(col(r, 'Controls', 'Current Controls')) || p.controls, s: sod(col(r, 'S', 'Severity')), o: sod(col(r, 'O', 'Occurrence')), d: sod(col(r, 'D', 'Detection')),
        recommendedAction: str(col(r, 'Recommended Action', 'Action')) || p.recommendedAction, owner: str(col(r, 'Owner')) || p.owner,
        status: /clos/i.test(st) ? 'Closed' : /progress/i.test(st) ? 'In Progress' : 'Open',
        controlDocRef: str(col(r, 'Control Doc Ref', 'Control Document', 'Control Plan Ref')) || p.controlDocRef,
        resourceIds: str(col(r, 'Assigned Resources', 'Tooling', 'Assigned Tooling'))
          ? list(col(r, 'Assigned Resources', 'Tooling', 'Assigned Tooling')).map((n) => ws.resources.find((x) => x.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x)
          : p.resourceIds,
      };
      Object.assign(p, upd);
    }
  }

  if (!Object.keys(S).length) warnings.push('No recognisable sheets found. Expected sheet names containing FPD, BOP, Component, Resource or PFMEA — download the template for the exact layout.');
  ws.meta.updatedAt = new Date().toISOString();
  return { ws, counts: counts.filter((c) => c.added + c.updated > 0 || c.label !== 'Resources'), warnings, sheetsRead: Object.keys(S) };
}

/** Round-trippable workbook: the same sheets the importer reads, plus a Summary sheet. */
export async function exportWorkbook(ws: Workspace, m: Model, template = false): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const cellNo = (id: string) => ws.cells.find((c) => c.id === id)?.number ?? '';
  const zone = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '';
  const fpd = (id: string) => ws.fpds.find((f) => f.fpdId === id)?.fpdCode ?? '';
  const names = (ids: string[]) => ids.map((i) => ws.resources.find((r) => r.id === i)?.name ?? '').filter(Boolean).join('; ');
  const sheet = (name: string, rows: Row[], widths: number[]) => {
    const sh = XLSX.utils.json_to_sheet(rows);
    sh['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, sh, name);
  };
  const take = <T,>(xs: T[]) => (template ? xs.slice(0, 2) : xs);

  sheet('FPDs', take(ws.fpds).map((f) => ({ 'FPD Code': f.fpdCode, Title: f.title, 'Sub-Assembly BOM Ref': f.subAssemblyBomRef, 'Assigned Cell': cellNo(f.assignedCellId), Revision: f.revision, Active: f.active ? 'Y' : 'N' })), [12, 42, 34, 14, 10, 8]);
  const bop: Row[] = [];
  for (const r of take(ws.rows))
    for (const l of leavesOf(r))
      bop.push({
        'FPD Code': fpd(l.fpdId), 'Op #': l.opId, 'Baseline Work Block': r.children?.length ? r.opId : '', Description: l.description, 'Task Type': l.taskType, Predecessors: l.predecessors.join(', '),
        'Origin Zone': zone(l.originZoneId), 'Destination Zone': zone(l.destZoneId), 'Floor Level': FLOOR_LEVELS[l.floorLevel] ?? 'Ground',
        Components: l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.bomRef ?? '').filter(Boolean).join('; '), 'Crew Size': l.crewSize,
        'Run Time (hrs)': l.runHrs, 'Touch Time (hrs)': l.touchHrs, 'Manning Time (hrs)': l.manningHrs, Classification: l.classification, 'Action Type': l.actionType,
        'Process Rigs': names(l.rigIds), Cranes: names(l.craneIds), Rigging: names(l.riggingIds), Vehicles: names(l.vehicleIds), Stands: names(l.standIds),
        Lifts: l.liftCount, Moves: l.moveCount, Notes: l.notes,
      });
  sheet('BOP', bop, [10, 10, 11, 52, 11, 16, 26, 26, 11, 40, 9, 12, 13, 15, 13, 16, 30, 30, 30, 26, 30, 6, 6, 40]);
  sheet('Components', take(ws.components).map((c) => ({ 'BOM Ref': c.bomRef, Name: c.name, 'Weight (kg)': c.weightKg ?? '', 'Length (m)': c.lengthM ?? '', 'Width (m)': c.widthM ?? '', 'Height (m)': c.heightM ?? '', 'Qty per Build': c.qtyPerBuild })), [34, 30, 12, 11, 11, 11, 13]);
  sheet('Resources', take(ws.resources).map((r) => ({
    Kind: RESOURCE_KINDS.find((k) => k.kind === r.kind)!.label, Name: r.name, Qty: r.qty, Cell: cellNo(r.cellId), 'SWL (kg)': r.swlKg ?? '', 'Hook Height (m)': r.hookHeightM ?? '',
    'Headroom (m)': r.headroomM ?? '', 'Tare (kg)': r.tareKg ?? '', Tiers: r.tiers ?? '', 'Tier Height (m)': r.tierHeightM ?? '', Complexity: complexityOf(r), 'Cx Technical': r.complexity[0], 'Cx Skill': r.complexity[1], 'Cx Set-Up': r.complexity[2], 'Cx Upkeep': r.complexity[3],
    'Footprint L (m)': r.footprintLM ?? '', 'Footprint W (m)': r.footprintWM ?? '', Utilities: r.utilities.join('; '), 'Dwell Mode': r.dwellMode,
  })), [24, 38, 6, 6, 10, 15, 13, 10, 7, 15, 11, 12, 9, 10, 10, 14, 14, 44, 12]);
  sheet('PFMEA', take(ws.pfmea).map((p) => ({ 'FPD Code': fpd(p.fpdId), 'Op #': p.opId, 'Failure Mode': p.failureMode, Effect: p.effect, Cause: p.cause, Controls: p.controls, S: p.s, O: p.o, D: p.d, RPN: p.s * p.o * p.d, 'Recommended Action': p.recommendedAction, Owner: p.owner, Status: p.status, 'Control Doc Ref': p.controlDocRef, 'Assigned Resources': names(p.resourceIds) })), [10, 10, 40, 40, 40, 40, 4, 4, 4, 6, 44, 24, 12, 28, 40]);

  if (!template) {
    const t = m.totals;
    const kv: [string, string | number][] = [
      ['Workspace', ws.meta.name], ['Exported', new Date().toLocaleString('en-GB')], ['Scope', `${m.fpds.length} of ${ws.fpds.length} FPDs · ${t.workBlocks} Baseline work blocks`],
      ['Build #', ws.settings.learning.selectedBuild], ['Learning factor', +m.lc.toFixed(3)], ['Critical path (months)', +m.durationMonths.toFixed(2)],
      ['Production window — nominal (months)', +m.windowNominal.toFixed(2)], ['Production window — peak (months)', +m.windowPeak.toFixed(2)],
      ['Labour hours per build', +t.labourHrs.toFixed(1)], ['Labour cost per build (£)', Math.round(t.labourCost)], ['VA %', +(t.labourHrs ? (t.va / t.labourHrs) * 100 : 0).toFixed(1)],
      ['Lifts per build', t.lifts], ['Spatial conflicts', m.conflicts.length], ['Peak concurrent crew', m.peakCrew],
    ];
    const sh = XLSX.utils.aoa_to_sheet([['Assembly & Static Build Central Spine v1.0 — Summary'], [], ...kv]);
    sh['!cols'] = [{ wch: 40 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, sh, 'Summary');
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Dedicated BOP export: 'Bill of Process' sheet (with schedule / CPM / lift data) + 'Master BOP & PFMEA Combined' sheet. */
export async function exportBop(ws: Workspace, m: Model): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const cellName = (id: string) => { const c = ws.cells.find((x) => x.id === id); return c ? `Cell ${c.number} · ${c.name}` : ''; };
  const zone = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '';
  const fpd = (id: string) => ws.fpds.find((f) => f.fpdId === id);
  const names = (ids: string[]) => ids.map((i) => ws.resources.find((r) => r.id === i)?.name ?? '').filter(Boolean).join('; ');
  const hpFor = (opId: string) => ws.holdPoints.filter((h) => h.opId === opId).map((h) => h.title).join('; ');
  const sheet = (name: string, rows: Row[], widths: number[]) => {
    const sh = XLSX.utils.json_to_sheet(rows);
    sh['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, sh, name);
  };

  // ---- Bill of Process sheet ----
  const bopRows: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const node = m.cpm.nodes.get(r.id);
      const f = fpd(l.fpdId);
      bopRows.push({
        'FPD Code': f?.fpdCode ?? '', 'FPD Title': f?.title ?? '', 'Cell Name': cellName(f?.assignedCellId ?? ''),
        'Op #': l.opId, 'Baseline Work Block': r.children?.length ? r.opId : '',
        Description: l.description, 'Task Type': l.taskType,
        Predecessors: l.predecessors.join(', '),
        'Origin Zone': zone(l.originZoneId), 'Destination Zone': zone(l.destZoneId),
        'Floor Level': FLOOR_LEVELS[l.floorLevel] ?? 'Ground',
        'Component Name / Description': l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.name ?? '').filter(Boolean).join('; '),
        'Crew Density': l.crewSize,
        'Equipment / Bay Run Time (hrs)': l.runHrs,
        'Operator Touch Time (hrs)': l.touchHrs,
        'Labour Content (Hours)': l.manningHrs,
        'Baseline Hours': l.baselineHrs ?? '',
        'Variance (h)': l.baselineHrs != null ? +(l.baselineHrs - l.manningHrs).toFixed(2) : '',
        'Operation Action Category': l.classification,
        'Specific Action Type': l.actionType,
        'L1 Parent Tool': names(l.rigIds),
        Crane: names(l.craneIds),
        Rigging: names(l.riggingIds),
        Vehicles: names(l.vehicleIds),
        'L3 Sub-Tool': names(l.standIds),
        'Lift Count': l.liftCount, 'Move Count': l.moveCount,
        'Schedule Start (h)': node ? +node.es.toFixed(1) : '',
        'Schedule Finish (h)': node ? +node.ef.toFixed(1) : '',
        'Float (h)': node ? +node.float.toFixed(1) : '',
        Critical: node?.critical ? 'Y' : 'N',
        'Quality Gate Sign-off': hpFor(l.opId),
        Notes: l.notes,
      });
    }
  }
  sheet('Bill of Process', bopRows, [10, 32, 24, 10, 11, 48, 10, 16, 24, 24, 10, 36, 7, 12, 13, 15, 12, 11, 12, 20, 24, 20, 20, 16, 7, 7, 14, 14, 10, 8, 24, 36]);

  // ---- Master BOP & PFMEA Combined sheet ----
  const combined: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const f = fpd(l.fpdId);
      combined.push({
        'Phase #': f?.fpdCode ?? '', 'Route Code': l.opId,
        'Operation Phase Title': l.description,
        'Task Type': l.taskType, 'Predecessor Phase #': l.predecessors.join(', '),
        Zone: zone(l.destZoneId),
        'Component Name/Description': l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.name ?? '').filter(Boolean).join('; '),
        'Crew Density': l.crewSize,
        'Equipment / Bay Run Time (hrs)': l.runHrs,
        'Labour Content (Hours)': l.manningHrs,
        'Operation Action Category': l.classification,
        'Specific Action Type': l.actionType,
        'L1 Parent Tool': names(l.rigIds),
        Crane: names(l.craneIds),
        Rigging: names(l.riggingIds),
        'L3 Sub-Tool': names(l.standIds),
        'Quality Gate Sign-off': hpFor(l.opId),
        Rationale: l.notes,
      });
    }
  }
  sheet('Master BOP & PFMEA Combined', combined, [10, 10, 48, 10, 16, 24, 36, 7, 12, 15, 20, 24, 24, 20, 20, 16, 24, 36]);

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
