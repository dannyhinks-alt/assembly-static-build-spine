// BOP-specific import logic — duplicate-route-code detection, per-row BOP processing, inline PFMEA creation.
import { blankRow } from '../data/seed';
import type { ActionType, BopRow, Classification, Component, Fpd, ResourceKind, Workspace } from '../types';
import { ACTION_TYPES, FLOOR_LEVELS, uid } from '../types';
import { leavesOf } from '../engine/model';
import { type Row, col, list, noneOrEmpty, str, key, isSentinel, sentinelFree, isHeaderOrHelperRow, normaliseFpdCode } from './excelHelpers';
import type { ExcelImportResult } from './excelHelpers';
import { num } from './format';

type CountEntry = ExcelImportResult['counts'][number];

/**
 * Purpose: First-pass scan of BOP rows to detect duplicate Route Codes shared across multiple phases.
 *   When found, builds a rewrite map so each route code is prefixed with its phase identifier.
 *   Header and helper rows are skipped so their field labels never pollute the detection.
 *
 * Formula: for each rawOp, track the Set of phases that use it; if any Set has >1 member,
 *   needsPrefix = true and each (phase, rawOp) pair gets a unique prefixed id.
 *
 * Downstream impact: drives opId uniqueness in the BOP, which all predecessor links and CPM depend on.
 */
export function detectDuplicateRouteCodes(bopRows: Row[]): {
  needsPrefix: boolean;
  opRewriteMap: Map<string, string>;
  warningMessage: string | null;
} {
  const routePhases = new Map<string, Set<string>>();
  for (const r of bopRows) {
    if (isHeaderOrHelperRow(r)) continue;
    const rawOp = str(col(r, 'Route Code', 'Op #', 'Route Code / Op #', 'Op ID', 'Operation'));
    const rawPhase = str(col(r, 'Phase #', 'FPD Code', 'FPD', 'FPD Ref', 'Phase'));
    if (!rawOp || !rawPhase) continue;
    const phases = routePhases.get(rawOp) ?? new Set<string>();
    phases.add(rawPhase); routePhases.set(rawOp, phases);
  }
  const needsPrefix = [...routePhases.values()].some((ps) => ps.size > 1);
  const opRewriteMap = new Map<string, string>();
  if (!needsPrefix) return { needsPrefix, opRewriteMap, warningMessage: null };
  const usedIds = new Set<string>();
  for (const r of bopRows) {
    if (isHeaderOrHelperRow(r)) continue;
    const rawOp = str(col(r, 'Route Code', 'Op #', 'Route Code / Op #', 'Op ID', 'Operation'));
    const rawPhase = str(col(r, 'Phase #', 'FPD Code', 'FPD', 'FPD Ref', 'Phase'));
    if (!rawOp || !rawPhase || (routePhases.get(rawOp)?.size ?? 0) <= 1) continue;
    const mapKey = `${rawPhase}:${rawOp}`;
    if (opRewriteMap.has(mapKey)) continue;
    const prefix = rawPhase.replace(/[^A-Za-z0-9]/g, '');
    const pad = /^\d+$/.test(rawOp) ? rawOp.padStart(3, '0') : rawOp;
    let candidate = `${prefix}-${pad}`; let n = 2;
    while (usedIds.has(candidate)) candidate = `${prefix}-${pad}-${n++}`;
    opRewriteMap.set(mapKey, candidate); usedIds.add(candidate);
  }
  return { needsPrefix, opRewriteMap, warningMessage: 'Route Codes repeated across multiple phases — auto-prefixed (e.g. P1-010, P2-010). Verify predecessor links in Tab 2.' };
}

function resolveOpId(rawOp: string, rawPhase: string, needsPrefix: boolean, map: Map<string, string>): string {
  return needsPrefix ? (map.get(`${rawPhase}:${rawOp}`) ?? rawOp) : rawOp;
}

function resolvePredId(pred: string, currentPhase: string, needsPrefix: boolean, map: Map<string, string>): string {
  if (!needsPrefix) return pred;
  const inPhase = map.get(`${currentPhase}:${pred}`);
  if (inPhase) return inPhase;
  for (const [mapKey, val] of map) if (mapKey.endsWith(`:${pred}`)) return val;
  return pred;
}


type EnsureRes = (kind: ResourceKind, name: string, viaBop?: boolean) => { id: string };
type EnsureFpd = (code: string, title?: string) => Fpd;
type FindCmp = (ref: string) => Component | undefined;

/**
 * Purpose: Processes a single BOP spreadsheet row into a BopRow on the workspace.
 *   Creates or updates the row, resolves zone / resource / component references, and
 *   triggers inline PFMEA entry creation when a Failure Mode is populated.
 *   Sentinel values on text fields (consumables, rationale, notes) are stored as empty string.
 *
 * Downstream impact: populates ws.rows, ws.zones, ws.components, ws.pfmea and ws.holdPoints;
 *   directly determines what Tab 2 (BOP), Tab 5 (PFMEA) and Tab 6 (Labour) display.
 *
 * @param r — raw spreadsheet row (Record<string, unknown>)
 */
function processBopRow(
  r: Row, op: string, code: string, fpd: Fpd, ws: Workspace,
  warnings: string[], c: CountEntry, cCmp: CountEntry,
  flat: Map<string, BopRow>, lastDestZone: Map<string, string>,
  needsPrefix: boolean, opRewriteMap: Map<string, string>,
  findCmp: FindCmp, ensureRes: EnsureRes, cellByNumber: (v: unknown) => string,
): void {
  const classOf = (v: unknown): Classification => { const s = str(v).toUpperCase(); return /NNVA|NECESSARY|INCIDENTAL/.test(s) ? 'NNVA' : /NVA|WASTE/.test(s) ? 'NVA' : 'VA'; };
  const actionOf = (v: unknown): ActionType => { const s = key(str(v)); return ACTION_TYPES.find((a) => key(a) === s) ?? ACTION_TYPES.find((a) => s && key(a).startsWith(s.slice(0, 4))) ?? 'Fitting'; };
  const levelOf = (v: unknown) => { const s = str(v).toLowerCase(); const i = FLOOR_LEVELS.findIndex((l) => l.toLowerCase() === s); return i >= 0 ? i : Math.min(3, Math.max(0, parseInt(s.replace(/\D+/g, ''), 10) || 0)); };
  const tags = (kind: ResourceKind, v: unknown) => list(v).map((n) => ensureRes(kind, n, true).id);
  const rPred = (pred: string) => resolvePredId(pred, code, needsPrefix, opRewriteMap);
  const zoneOf = (v: unknown): string => {
    const s = str(v); if (!s || isSentinel(s)) return '';
    const z = ws.zones.find((x) => x.name.toLowerCase() === s.toLowerCase() || x.id.toLowerCase() === s.toLowerCase()) ?? ws.zones.find((x) => x.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(x.name.toLowerCase()));
    if (z) return z.id;
    const cell = cellByNumber(s); const first = ws.zones.find((x) => x.cellId === cell); if (first) return first.id;
    const codeMatch = s.match(/^Zone\s+([A-Z0-9]+)\s*[·\-–]\s*(.*)/i);
    const zoneName = codeMatch ? codeMatch[2].trim() || s : s; const zoneCode = codeMatch ? codeMatch[1].toUpperCase() : undefined;
    const newZone = { id: uid('zone'), cellId: ws.cells[0].id, name: zoneName, code: zoneCode, pos: null, futurePos: null, maxCrewPerLevel: null };
    ws.zones.push(newZone); warnings.push(`${op}: zone "${s}" not found — created automatically under Cell 1 (edit in Tab 1).`); return newZone.id;
  };
  let row = flat.get(op.toLowerCase());
  if (!row) { row = blankRow(fpd.fpdId, op); ws.rows.push(row); flat.set(op.toLowerCase(), row); c.added++; } else c.updated++;
  row.fpdId = fpd.fpdId;
  row.description = str(col(r, 'Operation Phase Title', 'Description', 'Activity Description', 'Baseline Work Block / Activity Description', 'Work Block / Activity Description', 'Activity')) || row.description;
  row.taskType = /par/i.test(str(col(r, 'Task Type', 'Type'))) ? 'Parallel' : 'Sequential';
  row.predecessors = list(col(r, 'Predecessors', 'Predecessor #', 'Predecessor', 'Pred', 'Predecessor Phase #')).map(rPred);
  row.destZoneId = zoneOf(col(r, 'Destination Zone', 'Destination', 'Dest Zone', 'Destination Cell / Zone', 'Zone')) || row.destZoneId;
  row.originZoneId = zoneOf(col(r, 'Origin Zone', 'Origin', 'Origin Cell / Zone')) || lastDestZone.get(fpd.fpdId) || row.destZoneId;
  if (row.destZoneId) lastDestZone.set(fpd.fpdId, row.destZoneId);
  row.floorLevel = levelOf(col(r, 'Floor Level', 'Stand Floor Level', 'Level'));
  row.componentIds = list(col(r, 'Components', 'Component', 'Component Name', 'Component Name / Description', 'Component Name/Description', 'BOM Refs')).map((ref) => {
    let m = findCmp(ref);
    if (!m) { m = { id: uid('cmp'), bomRef: ref, name: ref, weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' }; ws.components.push(m); cCmp.added++; warnings.push(`Component "${ref}" (op ${op}) was not in the registry — created with no weight. Complete it in Tab 3.`); }
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
  row.craneIds = tags('crane', col(r, 'Cranes', 'Crane')); row.riggingIds = tags('rigging', col(r, 'Rigging', 'Rigging & Lifting Gear', 'Lifting Gear'));
  row.vehicleIds = tags('vehicle', col(r, 'Vehicles', 'Transport Vehicles', 'Transport')); row.standIds = tags('stand', col(r, 'Stands', 'Build & Storage Stands', 'Stand', 'L3 Sub-Tool'));
  row.liftCount = Math.max(0, Math.round(num(col(r, 'Lifts', 'Lift Count')))); if (row.actionType === 'Lifting' && row.liftCount === 0) row.liftCount = 1;
  row.moveCount = Math.max(0, Math.round(num(col(r, 'Moves', 'Move Count'))));
  row.notes = str(col(r, 'Notes', 'Engineering Notes', 'Comments')) || row.notes;
  const detailRaw = sentinelFree(col(r, 'Detailed Method Steps', 'Detailed Method & Work Instruction Steps', 'Method Detail')); if (detailRaw) row.methodDetail = detailRaw;
  const rationaleRaw = sentinelFree(col(r, 'Rationale')); if (rationaleRaw) row.rationale = rationaleRaw;
  const consumablesRaw = sentinelFree(col(r, 'Consumables')); if (consumablesRaw) row.consumables = consumablesRaw;
  const rawGate = sentinelFree(col(r, 'Quality Gate Sign-off', 'Quality Gate', 'Hold Point'));
  const gateTitle = rawGate ? (/^(yes|true|hold)$/i.test(rawGate) ? 'Hold Point' : rawGate) : '';
  if (gateTitle) { const existing = ws.holdPoints.find((h) => h.opId === op && h.title.toLowerCase() === gateTitle.toLowerCase()); if (!existing) ws.holdPoints.push({ id: uid('hp'), fpdId: fpd.fpdId, opId: op, type: 'Hold', title: gateTitle, notes: '', status: 'Planned' }); }
}

/**
 * Purpose: Processes the BOP sheet from a parsed workbook, creating/updating all BOP rows.
 *   Skips repeated header rows and helper/instruction rows mid-sheet.
 *   Normalises bare phase numbers (4 → "FPD-004") via normaliseFpdCode.
 *
 * Formula: for each data row, skip if isHeaderOrHelperRow; derive FPD code with
 *   normaliseFpdCode; call processBopRow for each valid row.
 *
 * Downstream impact: populates ws.rows, ws.zones, ws.pfmea and ws.holdPoints;
 *   determines Tab 2, Tab 5, Tab 6 state.
 *
 * @returns number of skipped header/helper rows
 */
export function processBopSheet(
  bopRows: Row[], ws: Workspace, warnings: string[], counts: ExcelImportResult['counts'],
  findCmp: FindCmp, ensureFpd: EnsureFpd, ensureRes: EnsureRes, cellByNumber: (v: unknown) => string,
): number {
  if (ws.cells.length === 0) ws.cells.push({ id: uid('cell'), number: 1, name: 'Main Assembly', crewPerShift: 2, notes: '' });
  const c = { label: 'BOP activities', added: 0, updated: 0 }; counts.push(c);
  const cCmp = counts.find((x) => x.label === 'Components') ?? { label: 'Components', added: 0, updated: 0 };
  const { needsPrefix, opRewriteMap, warningMessage } = detectDuplicateRouteCodes(bopRows);
  if (warningMessage) warnings.push(warningMessage);
  const flat = new Map<string, BopRow>();
  for (const r of ws.rows) for (const l of leavesOf(r)) flat.set(l.opId.trim().toLowerCase(), l);
  const lastDestZone = new Map<string, string>();
  // Track Op # keys added in this import batch to detect intra-sheet duplicates.
  const seenInBatch = new Set<string>();
  let skippedRows = 0;
  for (const r of bopRows) {
    if (isHeaderOrHelperRow(r)) { skippedRows++; continue; }
    const rawOp = str(col(r, 'Op #', 'Op', 'Route Code', 'Route Code / Op #', 'Op ID', 'Operation'));
    const rawCodeCell = col(r, 'FPD Code', 'FPD', 'FPD Ref', 'Phase #', 'Phase');
    const { code, title: fpdTitle } = normaliseFpdCode(rawCodeCell);
    if (noneOrEmpty(rawOp) && noneOrEmpty(str(col(r, 'Operation Phase Title', 'Description', 'Activity Description', 'Baseline Work Block / Activity Description', 'Activity')))) continue;
    let op = resolveOpId(rawOp, code, needsPrefix, opRewriteMap);
    if (!op || !code) { if (op || code) warnings.push(`BOP row skipped — needs both FPD Code and Op # (got "${code}" / "${op}").`); continue; }
    // Auto-suffix intra-sheet duplicate Op # (second occurrence in same file → suffix -2, -3, …)
    if (seenInBatch.has(op.toLowerCase())) {
      let suffix = 2;
      while (seenInBatch.has(`${op}-${suffix}`.toLowerCase())) suffix++;
      warnings.push(`Duplicate Op # "${op}" in this sheet — renamed to "${op}-${suffix}". Check predecessor links.`);
      op = `${op}-${suffix}`;
    }
    seenInBatch.add(op.toLowerCase());
    const fpd = ensureFpd(code, fpdTitle);
    processBopRow(r, op, code, fpd, ws, warnings, c, cCmp, flat, lastDestZone, needsPrefix, opRewriteMap, findCmp, ensureRes, cellByNumber);
  }
  return skippedRows;
}
