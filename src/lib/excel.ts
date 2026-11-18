// Excel (.xlsx / .xlsm / .xls / .csv) import / export. SheetJS is bundled locally and loaded on demand — no CDN.
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
const noneOrEmpty = (s: string) => !s || s.toLowerCase() === 'none';

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

/** Score a single array-of-cells row against STRONG_HEADERS. */
function scoreHeaderRow(cells: string[]): number {
  return STRONG_HEADERS.filter((s) => cells.some((c) => c === s || c.includes(s))).length;
}

/** Scan the first 15 rows of a sheet to find the actual header row (highest strong-signal score ≥ 2). */
export function scanHeaderRow(aoa: unknown[][]): number {
  const WEAK = ['route code', 'phase #', 'operation phase title', 'op #', 'fpd code', 'failure mode', 'bom ref', 'name', 'kind', 'resource'];
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const cells = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#()\- ]+/g, ' ').trim());
    const score = scoreHeaderRow(cells);
    if (score >= 2 && score > best.score) best = { idx: i, score };
  }
  if (best.idx >= 0) return best.idx;
  // Fallback: first row containing any weak signal (original behaviour).
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const rowStr = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()).join(' | ');
    if (WEAK.some((s) => rowStr.includes(s))) return i;
  }
  return 0;
}

/** BOP content-scan signals used for sheet classification fallback. */
const BOP_CONTENT_SIGNALS = ['phase #', 'route code', 'operation phase title', 'op #', 'fpd code'];

function sheetToRows(XLSX: { utils: { sheet_to_json<T>(ws: unknown, opts?: unknown): T[] } }, sh: unknown): Row[] {
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

export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import('xlsx');
  // XLSX handles .csv natively via the same read() call.
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
    // Classify by sheet name first; fall back to content scan for unrecognised names.
    let kind = SHEET_KINDS.find(([re]) => re.test(name))?.[1];
    if (!kind) {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '' });
      for (let i = 0; i < Math.min(15, aoa.length); i++) {
        const rowStr = (aoa[i] as unknown[]).map((v) => String(v ?? '').toLowerCase()).join(' ');
        if (BOP_CONTENT_SIGNALS.some((s) => rowStr.includes(s))) { kind = 'bop'; break; }
      }
    }
    if (kind && !sheets[kind]) {
      sheets[kind] = sheetToRows(XLSX, sh);
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
    if (ws.cells.length === 0) {
      ws.cells.push({ id: uid('cell'), number: 1, name: 'Main Assembly', crewPerShift: 2, notes: '' });
    }
    const c = count('BOP activities');
    const cPfmea = count('PFMEA items (via BOP)');

    // First pass: detect duplicate Route Codes across different phases and build rewrite map.
    const routePhases = new Map<string, Set<string>>(); // rawOp -> Set of phases
    for (const r of S.bop) {
      const rawOp = str(col(r, 'Route Code', 'Op #', 'Route Code / Op #', 'Op ID', 'Operation'));
      const rawPhase = str(col(r, 'Phase #', 'FPD Code', 'FPD', 'FPD Ref', 'Phase'));
      if (!rawOp || !rawPhase) continue;
      const phases = routePhases.get(rawOp) ?? new Set<string>();
      phases.add(rawPhase);
      routePhases.set(rawOp, phases);
    }
    const needsPrefix = [...routePhases.values()].some((ps) => ps.size > 1);
    const opRewriteMap = new Map<string, string>(); // "phase:rawOp" -> prefixedOpId
    if (needsPrefix) {
      const usedIds = new Set<string>();
      for (const r of S.bop) {
        const rawOp = str(col(r, 'Route Code', 'Op #', 'Route Code / Op #', 'Op ID', 'Operation'));
        const rawPhase = str(col(r, 'Phase #', 'FPD Code', 'FPD', 'FPD Ref', 'Phase'));
        if (!rawOp || !rawPhase || (routePhases.get(rawOp)?.size ?? 0) <= 1) continue;
        const mapKey = `${rawPhase}:${rawOp}`;
        if (!opRewriteMap.has(mapKey)) {
          const prefix = rawPhase.replace(/[^A-Za-z0-9]/g, '');
          const pad = /^\d+$/.test(rawOp) ? rawOp.padStart(3, '0') : rawOp;
          let candidate = `${prefix}-${pad}`;
          let n = 2;
          while (usedIds.has(candidate)) candidate = `${prefix}-${pad}-${n++}`;
          opRewriteMap.set(mapKey, candidate);
          usedIds.add(candidate);
        }
      }
      warnings.push('Route Codes repeated across multiple phases — auto-prefixed (e.g. P1-010, P2-010). Verify predecessor links in Tab 2.');
    }
    const resolveOpId = (rawOp: string, rawPhase: string): string => {
      if (!needsPrefix) return rawOp;
      return opRewriteMap.get(`${rawPhase}:${rawOp}`) ?? rawOp;
    };
    const resolvePredId = (pred: string, currentPhase: string): string => {
      if (!needsPrefix) return pred;
      const inPhase = opRewriteMap.get(`${currentPhase}:${pred}`);
      if (inPhase) return inPhase;
      for (const [mapKey, val] of opRewriteMap) {
        if (mapKey.endsWith(`:${pred}`)) return val;
      }
      return pred;
    };

    const zoneOf = (v: unknown, op: string): string => {
      const s = str(v);
      if (!s || s.toLowerCase() === 'none') return '';
      const z = ws.zones.find((x) => x.name.toLowerCase() === s.toLowerCase() || x.id.toLowerCase() === s.toLowerCase())
        ?? ws.zones.find((x) => x.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(x.name.toLowerCase()));
      if (z) return z.id;
      const cell = cellByNumber(s);
      const first = ws.zones.find((x) => x.cellId === cell);
      if (first) return first.id;
      const codeMatch = s.match(/^Zone\s+([A-Z0-9]+)\s*[·\-–]\s*(.*)/i);
      const zoneName = codeMatch ? codeMatch[2].trim() || s : s;
      const zoneCode = codeMatch ? codeMatch[1].toUpperCase() : undefined;
      const newZone = { id: uid('zone'), cellId: ws.cells[0].id, name: zoneName, code: zoneCode, pos: null, futurePos: null, maxCrewPerLevel: null };
      ws.zones.push(newZone);
      warnings.push(`${op}: zone "${s}" not found — created automatically under Cell 1 (edit in Tab 1).`);
      return newZone.id;
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
    const sod = (v: unknown) => Math.min(10, Math.max(1, Math.round(num(v, 1))));
    const flat = new Map<string, BopRow>();
    for (const r of ws.rows) for (const l of leavesOf(r)) flat.set(l.opId.trim().toLowerCase(), l);
    const lastDestZone = new Map<string, string>();

    for (const r of S.bop) {
      const rawOp = str(col(r, 'Op #', 'Op', 'Route Code', 'Route Code / Op #', 'Op ID', 'Operation'));
      const rawTitle = str(col(r, 'Operation Phase Title', 'Description', 'Activity Description', 'Baseline Work Block / Activity Description', 'Work Block / Activity Description', 'Activity'));
      const rawCode = str(col(r, 'FPD Code', 'FPD', 'FPD Ref', 'Phase #', 'Phase'));

      // Skip blank template rows silently (both Route Code and Operation Phase Title empty or "None").
      if (noneOrEmpty(rawOp) && noneOrEmpty(rawTitle)) continue;

      const op = resolveOpId(rawOp, rawCode);
      const code = rawCode;
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
      row.description = rawTitle || row.description;
      row.taskType = /par/i.test(str(col(r, 'Task Type', 'Type'))) ? 'Parallel' : 'Sequential';
      row.predecessors = list(col(r, 'Predecessors', 'Predecessor #', 'Predecessor', 'Pred', 'Predecessor Phase #'))
        .map((p) => resolvePredId(p, code));
      row.destZoneId = zoneOf(col(r, 'Destination Zone', 'Destination', 'Dest Zone', 'Destination Cell / Zone', 'Zone'), op) || row.destZoneId;
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
      if (row.touchHrs > row.manningHrs + 1e-9) { warnings.push(`${op}: Touch Time ${row.touchHrs} h exceeded Manning Time ${row.manningHrs} h — capped.`); row.touchHrs = row.manningHrs; }
      if (str(col(r, 'Baseline Hours', 'Baseline Hrs'))) row.baselineHrs = Math.max(0, num(col(r, 'Baseline Hours', 'Baseline Hrs')));
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
      // Notes / Rationale / Method / Consumables — each gets its own field.
      row.notes = str(col(r, 'Notes', 'Engineering Notes', 'Comments')) || row.notes;
      const detailRaw = str(col(r, 'Detailed Method Steps', 'Detailed Method & Work Instruction Steps', 'Method Detail'));
      if (detailRaw) row.methodDetail = detailRaw;
      const rationaleRaw = str(col(r, 'Rationale'));
      if (rationaleRaw) row.rationale = rationaleRaw;
      const consumablesRaw = str(col(r, 'Consumables'));
      if (consumablesRaw) row.consumables = consumablesRaw;
      // Quality Gate Sign-off → Hold Point.
      const gateTitle = str(col(r, 'Quality Gate Sign-off', 'Quality Gate', 'Hold Point'));
      if (gateTitle) {
        const existing = ws.holdPoints.find((h) => h.opId === op && h.title.toLowerCase() === gateTitle.toLowerCase());
        if (!existing) ws.holdPoints.push({ id: uid('hp'), fpdId: fpd.fpdId, opId: op, type: 'Hold', title: gateTitle, notes: '', status: 'Planned' });
      }
      // Combined PFMEA ingestion: if Failure Mode is populated on this BOP row, create/update the linked PFMEA entry.
      const fmRaw = str(col(r, 'Failure Mode'));
      if (fmRaw) {
        let p = ws.pfmea.find((x) => x.opId === op && x.failureMode.toLowerCase() === fmRaw.toLowerCase());
        if (!p) {
          p = { id: uid('pf'), fpdId: fpd.fpdId, opId: op, failureMode: fmRaw, effect: '', cause: '', controls: '', s: 1, o: 1, d: 1, recommendedAction: '', owner: '', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: [] };
          ws.pfmea.push(p);
          cPfmea.added++;
        } else cPfmea.updated++;
        p.fpdId = fpd.fpdId;
        const effect = str(col(r, 'Effect of Failure', 'Effect', 'Potential Effect')); if (effect) p.effect = effect;
        const cause = str(col(r, 'Cause of Failure', 'Cause', 'Potential Cause')); if (cause) p.cause = cause;
        const controls = str(col(r, 'Current Process Controls', 'Controls', 'Process Controls')); if (controls) p.controls = controls;
        const action = str(col(r, 'Recommended Corrective Action', 'Recommended Action')); if (action) p.recommendedAction = action;
        const sevRaw = str(col(r, 'Severity (1-10)', 'Severity', 'S')); if (sevRaw) p.s = sod(col(r, 'Severity (1-10)', 'Severity', 'S'));
        const occRaw = str(col(r, 'Occurrence (1-10)', 'Occurrence', 'O')); if (occRaw) p.o = sod(col(r, 'Occurrence (1-10)', 'Occurrence', 'O'));
        const detRaw = str(col(r, 'Detection (1-10)', 'Detection', 'D')); if (detRaw) p.d = sod(col(r, 'Detection (1-10)', 'Detection', 'D'));
        const cdReq = str(col(r, 'Control Doc Required')); if (cdReq) p.controlDocForced = yes(cdReq);
        const phaseSt = str(col(r, 'Phase Status')); if (phaseSt) p.status = /clos/i.test(phaseSt) ? 'Closed' : /progress/i.test(phaseSt) ? 'In Progress' : 'Open';
        const toolId = str(col(r, 'Assigned Tooling ID'));
        if (toolId) {
          const res = ws.resources.find((x) => x.name.toLowerCase() === toolId.toLowerCase() || x.id === toolId);
          if (res && !p.resourceIds.includes(res.id)) p.resourceIds.push(res.id);
        }
      }
    }
  }

  // ---- PFMEA (dedicated sheet) ----
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

/** Dedicated BOP export: 'Bill of Process (Summary)' + 'Master BOP & PFMEA Combined' — exact round-trip headers. */
export async function exportBop(ws: Workspace, m: Model): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const cellName = (id: string) => { const c = ws.cells.find((x) => x.id === id); return c ? `Cell ${c.number} · ${c.name}` : ''; };
  const zone = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '';
  const fpd = (id: string) => ws.fpds.find((f) => f.fpdId === id);
  const names = (ids: string[]) => ids.map((i) => ws.resources.find((r) => r.id === i)?.name ?? '').filter(Boolean).join('; ');
  const hpFor = (opId: string) => ws.holdPoints.filter((h) => h.opId === opId).map((h) => h.title).join('; ');
  const pfmeaFor = (opId: string) => ws.pfmea.filter((p) => p.opId === opId);
  const sheet = (name: string, rows: Row[], widths: number[]) => {
    const sh = XLSX.utils.json_to_sheet(rows);
    sh['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, sh, name);
  };

  // ---- Bill of Process (Summary) sheet ----
  const bopRows: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const node = m.cpm.nodes.get(r.id);
      const calc = m.calcs.get(r.id);
      const f = fpd(l.fpdId);
      const arPct = calc?.arPct;
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
        'Attendance Ratio (%)': arPct != null ? +(arPct * 100).toFixed(1) : 'Manual op',
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
        Rationale: l.rationale ?? '',
        Comments: l.notes,
      });
    }
  }
  sheet('Bill of Process (Summary)', bopRows, [10, 32, 24, 10, 11, 48, 10, 16, 24, 24, 10, 36, 7, 12, 13, 15, 12, 11, 11, 15, 20, 24, 20, 20, 16, 7, 7, 14, 14, 10, 8, 24, 36, 36]);

  // ---- Master BOP & PFMEA Combined sheet — canonical round-trip columns ----
  const combined: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const node = m.cpm.nodes.get(r.id);
      const f = fpd(l.fpdId);
      const pfs = pfmeaFor(l.opId);
      const pf = pfs[0]; // primary PFMEA entry for this op (if any)
      combined.push({
        'Phase #': f?.fpdCode ?? '',
        'Route Code': l.opId,
        'Operation Phase Title': l.description,
        'Detailed Method Steps': l.methodDetail ?? '',
        Zone: zone(l.destZoneId),
        'Task Type': l.taskType,
        'Predecessor Phase #': l.predecessors.join(', '),
        'Component Name/Description': l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.name ?? '').filter(Boolean).join('; '),
        'Crew Density': l.crewSize,
        'Equipment / Bay Run Time (hrs)': l.runHrs,
        'Operator Touch Time (hrs)': l.touchHrs,
        'Labour Content (Hours)': l.manningHrs,
        'Baseline Hours': l.baselineHrs ?? '',
        'Variance (h)': l.baselineHrs != null ? +(l.baselineHrs - l.manningHrs).toFixed(2) : '',
        Crane: names(l.craneIds),
        'L1 Parent Tool': names(l.rigIds),
        Rigging: names(l.riggingIds),
        'L3 Sub-Tool': names(l.standIds),
        Consumables: l.consumables ?? '',
        'Quality Gate Sign-off': hpFor(l.opId),
        Rationale: l.rationale ?? '',
        Comments: l.notes,
        'Failure Mode': pf?.failureMode ?? '',
        'Control Doc Required': pf ? (pf.controlDocForced ? 'Y' : 'N') : '',
        'Effect of Failure': pf?.effect ?? '',
        'Cause of Failure': pf?.cause ?? '',
        'Current Process Controls': pf?.controls ?? '',
        'Recommended Corrective Action': pf?.recommendedAction ?? '',
        'Severity (1-10)': pf?.s ?? '',
        'Occurrence (1-10)': pf?.o ?? '',
        'Detection (1-10)': pf?.d ?? '',
        'RPN Score': pf ? pf.s * pf.o * pf.d : '',
        'RPN Risk Level': pf ? (pf.s * pf.o * pf.d >= 200 ? 'RED' : pf.s * pf.o * pf.d >= 120 ? 'SERIOUS' : pf.s * pf.o * pf.d >= 80 ? 'AMBER' : 'GREEN') : '',
        'Assigned Tooling ID': pf ? names(pf.resourceIds) : '',
        'Phase Status': pf?.status ?? '',
        'Schedule Start (h)': node ? +node.es.toFixed(1) : '',
        'Schedule Finish (h)': node ? +node.ef.toFixed(1) : '',
        Critical: node?.critical ? 'Y' : 'N',
        'Operation Action Category': l.classification,
        'Specific Action Type': l.actionType,
      });
    }
  }
  sheet('Master BOP & PFMEA Combined', combined, [10, 10, 48, 36, 24, 10, 16, 36, 7, 12, 13, 15, 12, 11, 20, 24, 20, 16, 24, 24, 24, 24, 36, 10, 36, 36, 36, 44, 10, 10, 10, 8, 10, 24, 10, 14, 14, 8, 20, 24]);

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
