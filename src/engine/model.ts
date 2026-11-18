// Orchestration layer: assembles the full Model from formula sub-modules.
// Pure functions only — no React, no DOM.
import type { BopRow, Classification, Fpd, Id, Rag, Scope, Workspace } from '../types';
import { buildSpace, type SpaceResult } from './space';
import { computeResourceLoads, type Conflict, type ResourceLoad } from './formulas/resourceDuty';
import { runCpm, type Cpm, type CpmNode } from './formulas/cpmScheduler';
import { calcRow, type LeafCalc, type RowCalc } from './formulas/activityMetrics';
import { calendarOf, learningFactor, leavesOf, wastePct, productionWindowMonths, type Calendar } from './formulas/calendarAndLearning';
import { liftRecord, type LiftRecord } from './formulas/liftPhysics';

// Re-export all formula types and functions for backward compatibility.
export type { Calendar } from './formulas/calendarAndLearning';
export { calendarOf, learningFactor, leavesOf, isBlock, wastePct, productionWindowMonths } from './formulas/calendarAndLearning';
export type { LeafCalc, RowCalc } from './formulas/activityMetrics';
export { leafElapsed, calcRow } from './formulas/activityMetrics';
export type { CpmNode, Cpm } from './formulas/cpmScheduler';
export { opIndex, blockExternalPreds, runCpm } from './formulas/cpmScheduler';
export type { LiftRecord } from './formulas/liftPhysics';
export { liftRecord } from './formulas/liftPhysics';
export type { ResourceLoad, Conflict } from './formulas/resourceDuty';
export { dutyRag } from './formulas/resourceDuty';

// ---------- Scope ----------
export function scopeFpds(ws: Workspace, scope: Scope): Fpd[] {
  const active = ws.fpds.filter((f) => f.active);
  if (scope.mode === 'cell') return active.filter((f) => scope.cellIds.includes(f.assignedCellId));
  if (scope.mode === 'fpd') return active.filter((f) => scope.fpdIds.includes(f.fpdId));
  return active;
}
export function scopeRows(ws: Workspace, scope: Scope): BopRow[] {
  const ids = new Set(scopeFpds(ws, scope).map((f) => f.fpdId));
  return ws.rows.filter((r) => {
    if (!ids.has(r.fpdId)) return false;
    if (!scope.zoneId) return true;
    return leavesOf(r).some((l) => l.originZoneId === scope.zoneId || l.destZoneId === scope.zoneId);
  });
}

// ---------- Full model ----------
export interface FpdRoll {
  fpd: Fpd; rows: number; labourHrs: number; elapsedHrs: number; spanHrs: number;
  startHrs: number; finishHrs: number; lifts: number; criticalOps: number;
  va: number; nnva: number; nva: number;
}
export interface CellLoad {
  cellId: Id; labourHrs: number; rows: number; lifts: number; utilPct: number | null; rag: Rag;
}
export interface Model {
  cal: Calendar; lc: number; wastePct: number;
  windowNominal: number; windowPeak: number; windowActive: number; demandActive: number;
  fpds: Fpd[]; rows: BopRow[]; calcs: Map<Id, RowCalc>; cpm: Cpm;
  durationMonths: number; durationDays: number;
  totals: {
    labourHrs: number; va: number; nnva: number; nva: number; touchHrs: number; manningHrs: number; runHrs: number;
    burdenRaw: number; elapsedSumHrs: number; opportunityHrs: number; lifts: number; moves: number; interCellMoves: number;
    workBlocks: number; activities: number; labourCost: number; arRedCount: number;
  };
  lifts: LiftRecord[]; resources: ResourceLoad[]; conflicts: Conflict[];
  cells: CellLoad[]; fpdRoll: FpdRoll[]; peakCrew: number;
  space: SpaceResult; scheduleRag: Rag; windowRatio: number; concurrentBuilds: number;
}

/** Sets start/end times on each leaf activity from their parent node's early-start. */
function assignLeafTimings(calcs: Map<Id, RowCalc>, cpm: Cpm): void {
  for (const c of calcs.values()) {
    let elapsed = (cpm.nodes.get(c.row.id) as CpmNode).es;
    for (const leaf of c.leaves) { leaf.startHrs = elapsed; elapsed += leaf.elapsedHrs; leaf.endHrs = elapsed; }
  }
}

/** Aggregates the labour totals across all row calculations. */
function assembleTotals(all: RowCalc[], leaves: LeafCalc[], s: Workspace['settings']) {
  const sum = (f: (c: RowCalc) => number) => all.reduce((acc, c) => acc + f(c), 0);
  const labourHrs = sum((c) => c.labourHrs);
  return {
    labourHrs, va: sum((c) => c.byClass.VA), nnva: sum((c) => c.byClass.NNVA), nva: sum((c) => c.byClass.NVA),
    touchHrs: sum((c) => c.touchHrs), manningHrs: sum((c) => c.manningHrs), runHrs: sum((c) => c.runHrs),
    burdenRaw: sum((c) => c.burdenRaw), elapsedSumHrs: sum((c) => c.elapsedHrs),
    opportunityHrs: sum((c) => c.opportunityHrs), lifts: sum((c) => c.lifts), moves: sum((c) => c.moves),
    interCellMoves: all.filter((c) => c.movement === 'Inter-Cell').length,
    workBlocks: all.length, activities: leaves.length,
    labourCost: labourHrs * s.programme.labourRateGbp,
    arRedCount: leaves.filter((l) => l.arRed).length,
  };
}

/** Builds the per-cell labour load from destination-zone membership. */
function buildCellLoads(ws: Workspace, leaves: LeafCalc[], cal: Calendar, demandActive: number): CellLoad[] {
  const zoneCell = new Map(ws.zones.map((z) => [z.id, z.cellId]));
  return ws.cells.map((cell) => {
    const mine = leaves.filter((l) => zoneCell.get(l.leaf.destZoneId) === cell.id);
    const hrs = mine.reduce((acc, l) => acc + l.labourHrs, 0);
    const cap = cell.crewPerShift * cal.annualHrs;
    const utilPct = cap > 0 ? ((hrs * demandActive) / cap) * 100 : null;
    const rag: Rag = utilPct == null ? 'green' : utilPct > 100 ? 'red' : utilPct > 90 ? 'serious' : utilPct > 80 ? 'amber' : 'green';
    return { cellId: cell.id, labourHrs: hrs, rows: mine.length, lifts: mine.reduce((acc, l) => acc + l.leaf.liftCount, 0), utilPct, rag };
  });
}

/** Rolls up per-FPD schedule metrics from row calculations and CPM timings. */
function buildFpdRoll(fpds: Fpd[], all: RowCalc[], cpm: Cpm): FpdRoll[] {
  return fpds.map((fpd) => {
    const mine = all.filter((c) => c.row.fpdId === fpd.fpdId);
    const nodes = mine.map((c) => cpm.nodes.get(c.row.id) as CpmNode);
    const start = nodes.length ? Math.min(...nodes.map((n) => n.es)) : 0;
    const finish = nodes.length ? Math.max(...nodes.map((n) => n.ef)) : 0;
    const sm = (g: (c: RowCalc) => number) => mine.reduce((acc, c) => acc + g(c), 0);
    return {
      fpd, rows: mine.length, labourHrs: sm((c) => c.labourHrs), elapsedHrs: sm((c) => c.elapsedHrs), spanHrs: finish - start,
      startHrs: start, finishHrs: finish, lifts: sm((c) => c.lifts), criticalOps: nodes.filter((n) => n.critical).length,
      va: sm((c) => c.byClass.VA), nnva: sm((c) => c.byClass.NNVA), nva: sm((c) => c.byClass.NVA),
    };
  });
}

/** Sweeps the event timeline to find the peak concurrent crew count. */
function computePeakCrew(leaves: LeafCalc[]): number {
  const events: [number, number][] = [];
  for (const l of leaves) {
    if (l.endHrs - l.startHrs > 1e-6) {
      events.push([l.startHrs, l.leaf.crewSize], [l.endHrs, -l.leaf.crewSize]);
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) { current += delta; peak = Math.max(peak, current); }
  return peak;
}

export function buildModel(ws: Workspace, scope: Scope): Model {
  const s = ws.settings;
  const cal = calendarOf(s);
  const lc = learningFactor(s.learning, s.learning.selectedBuild);
  const waste = wastePct(ws);
  const windowNominal = productionWindowMonths(s.programme.demandNominal, waste);
  const windowPeak = productionWindowMonths(s.programme.demandPeak, waste);
  const peakCase = s.programme.demandCase === 'Peak';
  const demandActive = peakCase ? s.programme.demandPeak : s.programme.demandNominal;
  const windowActive = peakCase ? windowPeak : windowNominal;
  const fpds = scopeFpds(ws, scope);
  const rows = scopeRows(ws, scope);
  const calcs = new Map<Id, RowCalc>();
  for (const r of rows) calcs.set(r.id, calcRow(r, ws, cal, lc));
  const activeIds = new Set(ws.fpds.filter((f) => f.active).map((f) => f.fpdId));
  const cpm = runCpm(rows, ws.rows.filter((r) => activeIds.has(r.fpdId)), (r) => calcs.get(r.id)!.elapsedHrs);
  assignLeafTimings(calcs, cpm);
  const all = [...calcs.values()];
  const leaves = all.flatMap((c) => c.leaves);
  const totals = assembleTotals(all, leaves, s);
  const liftRecords = leaves.map((l) => liftRecord(l, ws)).filter((x): x is LiftRecord => !!x);
  const { resources, conflicts } = computeResourceLoads(ws, leaves, lc, cal, cpm, s, windowActive);
  const cells = buildCellLoads(ws, leaves, cal, demandActive);
  const fpdRoll = buildFpdRoll(fpds, all, cpm);
  const peakCrew = computePeakCrew(leaves);
  const durationMonths = cal.hoursPerMonth > 0 ? cpm.durationHrs / cal.hoursPerMonth : 0;
  const windowRatio = windowActive > 0 && Number.isFinite(windowActive) ? durationMonths / windowActive : 0;
  let scheduleRag: Rag = windowRatio <= 0.95 ? 'green' : windowRatio <= 1 ? 'amber' : windowRatio <= 1.1 ? 'serious' : 'red';
  if (durationMonths > s.programme.drumbeatMonths) scheduleRag = 'red';
  return {
    cal, lc, wastePct: waste, windowNominal, windowPeak, windowActive, demandActive, fpds, rows, calcs, cpm,
    durationMonths, durationDays: cal.hoursPerDay > 0 ? cpm.durationHrs / cal.hoursPerDay : 0,
    totals, lifts: liftRecords, resources, conflicts, cells, fpdRoll, peakCrew,
    space: buildSpace(ws, leaves, cpm), scheduleRag, windowRatio,
    concurrentBuilds: Number.isFinite(windowActive) && windowActive > 0
      ? Math.max(1, Math.ceil(durationMonths / windowActive - 1e-6)) : 1,
  };
}

// ---------- Work Block merge / unmerge ----------
/** Roll the stored header fields of a Baseline Work Block up from its folded activities. */
export function rollUpBlock(block: BopRow): void {
  const children = block.children ?? [];
  if (!children.length) return;
  const sum = (f: (c: BopRow) => number) => children.reduce((acc, c) => acc + f(c), 0);
  block.runHrs = sum((c) => c.runHrs);
  block.touchHrs = sum((c) => c.touchHrs);
  block.manningHrs = sum((c) => c.manningHrs);
  block.liftCount = sum((c) => c.liftCount);
  block.moveCount = sum((c) => c.moveCount);
  block.crewSize = Math.max(...children.map((c) => c.crewSize));
  block.floorLevel = Math.max(...children.map((c) => c.floorLevel));
  block.originZoneId = children[0].originZoneId;
  block.destZoneId = children[children.length - 1].destZoneId;
  const union = (f: (c: BopRow) => string[]) => [...new Set(children.flatMap(f))];
  block.componentIds = union((c) => c.componentIds);
  block.rigIds = union((c) => c.rigIds);
  block.craneIds = union((c) => c.craneIds);
  block.riggingIds = union((c) => c.riggingIds);
  block.vehicleIds = union((c) => c.vehicleIds);
  block.standIds = union((c) => c.standIds);
  const hrs: Record<Classification, number> = { VA: 0, NNVA: 0, NVA: 0 };
  const actionHrs = new Map<string, number>();
  for (const c of children) {
    const burden = c.manningHrs * c.crewSize;
    hrs[c.classification] += burden;
    actionHrs.set(c.actionType, (actionHrs.get(c.actionType) ?? 0) + burden);
  }
  block.classification = (Object.keys(hrs) as Classification[]).reduce((m, k) => (hrs[k] > hrs[m] ? k : m), 'VA' as Classification);
  block.actionType = [...actionHrs.entries()].reduce((m, e) => (e[1] > m[1] ? e : m))[0] as BopRow['actionType'];
  const insideOpIds = new Set(children.map((c) => c.opId.trim()));
  block.predecessors = [...new Set(children.flatMap((c) => c.predecessors.map((p) => p.trim())))].filter((p) => p && !insideOpIds.has(p));
}
