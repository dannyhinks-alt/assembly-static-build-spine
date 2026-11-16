// Core calculation engine: row maths, CPM schedule, lift register, resource loading.
// Pure functions only — no React, no DOM — so the same code runs in tests and the UI.
import type { BopRow, Classification, Fpd, Id, Rag, Resource, ResourceField, Scope, Settings, Workspace } from '../types';
import { RESOURCE_KINDS, complexityOf } from '../types';
import { buildSpace, type SpaceResult } from './space';
import { worstRag } from '../lib/format';

const EPS = 1e-6;

// ---------- Calendar, learning curve, waste ----------
export interface Calendar {
  hoursPerDay: number;
  daysPerMonth: number;
  hoursPerMonth: number;
  annualHrs: number;
  activeFactor: number;
  labourEff: number;
}
export function calendarOf(s: Settings): Calendar {
  const hoursPerDay = Math.max(0, s.calendar.shiftsPerDay * s.calendar.hoursPerShift);
  const daysPerMonth = s.calendar.workingDaysPerYear / 12;
  return {
    hoursPerDay,
    daysPerMonth,
    hoursPerMonth: hoursPerDay * daysPerMonth,
    annualHrs: hoursPerDay * s.calendar.workingDaysPerYear,
    activeFactor: Math.max(0.01, s.calendar.activeTimeFactorPct / 100),
    labourEff: Math.max(0.01, s.calendar.labourEfficiencyPct / 100),
  };
}

/** Stepped learning curve: Build #1 starts at 1st-build %, drops by the step each build,
 *  and is held at the stabilised % once `stepBuilds` reductions have been taken. */
export function learningFactor(l: Settings['learning'], build: number): number {
  const steps = Math.max(0, Math.floor(build) - 1);
  if (steps >= l.stepBuilds) return l.stabilisedPct / 100;
  const stepped = l.firstBuildPct - l.stepReductionPct * steps;
  const lo = Math.min(l.firstBuildPct, l.stabilisedPct);
  const hi = Math.max(l.firstBuildPct, l.stabilisedPct);
  return Math.min(hi, Math.max(lo, stepped)) / 100;
}

export const leavesOf = (r: BopRow): BopRow[] => (r.children && r.children.length ? r.children : [r]);
export const isBlock = (r: BopRow): boolean => !!(r.children && r.children.length);

/** Automated waste = Pure-Waste (NVA) share of total manning burden across every active FPD. */
export function wastePct(ws: Workspace): number {
  if (ws.settings.calendar.wasteMode === 'Manual') return ws.settings.calendar.manualWastePct;
  const active = new Set(ws.fpds.filter((f) => f.active).map((f) => f.fpdId));
  let nva = 0;
  let total = 0;
  for (const r of ws.rows) {
    if (!active.has(r.fpdId)) continue;
    for (const l of leavesOf(r)) {
      const b = l.manningHrs * l.crewSize;
      total += b;
      if (l.classification === 'NVA') nva += b;
    }
  }
  return total > 0 ? (nva / total) * 100 : 0;
}

export const productionWindowMonths = (demandPerYear: number, waste: number): number =>
  demandPerYear > 0 ? (12 / demandPerYear) * (1 - waste / 100) : Infinity;

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

// ---------- Row calculations ----------
export interface LeafCalc {
  leaf: BopRow;
  parentId: Id;
  elapsedHrs: number;
  burdenRaw: number;
  labourHrs: number;
  arPct: number | null;
  arRed: boolean;
  opportunityHrs: number;
  startHrs: number;
  endHrs: number;
}
export interface RowCalc {
  row: BopRow;
  leaves: LeafCalc[];
  runHrs: number;
  touchHrs: number;
  manningHrs: number;
  crewMax: number;
  burdenRaw: number;
  labourHrs: number;
  elapsedHrs: number;
  arPct: number | null;
  arRed: boolean;
  opportunityHrs: number;
  byClass: Record<Classification, number>;
  lifts: number;
  moves: number;
  movement: 'Intra-Cell' | 'Inter-Cell' | '—';
}

export function leafElapsed(l: BopRow, cal: Calendar, lc: number): number {
  return (Math.max(l.runHrs, l.manningHrs) / cal.activeFactor) * lc;
}

export function calcRow(row: BopRow, ws: Workspace, cal: Calendar, lc: number): RowCalc {
  const t = ws.settings.thresholds;
  const zoneCell = (z: string) => ws.zones.find((x) => x.id === z)?.cellId ?? '';
  const leaves: LeafCalc[] = leavesOf(row).map((leaf) => {
    const burdenRaw = leaf.manningHrs * leaf.crewSize;
    const arPct = leaf.runHrs > 0 ? (leaf.manningHrs / leaf.runHrs) * 100 : null;
    return {
      leaf,
      parentId: row.id,
      elapsedHrs: leafElapsed(leaf, cal, lc),
      burdenRaw,
      labourHrs: (burdenRaw * lc) / cal.labourEff,
      arPct,
      arRed: arPct != null && arPct >= t.arRedPct && leaf.runHrs * 60 > t.arMinCycleMin,
      opportunityHrs: leaf.manningHrs - leaf.touchHrs,
      startHrs: 0,
      endHrs: 0,
    };
  });
  const s = (f: (l: LeafCalc) => number) => leaves.reduce((a, l) => a + f(l), 0);
  const runHrs = s((l) => l.leaf.runHrs);
  const manningHrs = s((l) => l.leaf.manningHrs);
  const byClass: Record<Classification, number> = { VA: 0, NNVA: 0, NVA: 0 };
  for (const l of leaves) byClass[l.leaf.classification] += l.labourHrs;
  const first = leaves[0].leaf;
  const last = leaves[leaves.length - 1].leaf;
  const oc = zoneCell(first.originZoneId);
  const dc = zoneCell(last.destZoneId);
  const arPct = runHrs > 0 ? (manningHrs / runHrs) * 100 : null;
  return {
    row,
    leaves,
    runHrs,
    touchHrs: s((l) => l.leaf.touchHrs),
    manningHrs,
    crewMax: Math.max(...leaves.map((l) => l.leaf.crewSize), 0),
    burdenRaw: s((l) => l.burdenRaw),
    labourHrs: s((l) => l.labourHrs),
    elapsedHrs: s((l) => l.elapsedHrs),
    arPct,
    arRed: isBlock(row) ? leaves.some((l) => l.arRed) : leaves[0].arRed,
    opportunityHrs: s((l) => l.opportunityHrs),
    byClass,
    lifts: s((l) => l.leaf.liftCount),
    moves: s((l) => l.leaf.moveCount),
    movement: !oc || !dc ? '—' : oc === dc ? 'Intra-Cell' : 'Inter-Cell',
  };
}

// ---------- CPM ----------
export interface CpmNode {
  rowId: Id;
  opId: string;
  preds: Id[];
  succs: Id[];
  dur: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
  critical: boolean;
  implicitPred: boolean;
}
export interface Cpm {
  nodes: Map<Id, CpmNode>;
  durationHrs: number;
  hasCycle: boolean;
  cycleOps: string[];
  dangling: { opId: string; ref: string }[];
  external: { opId: string; ref: string }[];
  criticalOps: string[];
}

/** Maps every Op ID (including activities folded inside Work Blocks) to its top-level row id. */
export function opIndex(rows: BopRow[]): Map<string, Id> {
  const m = new Map<string, Id>();
  for (const r of rows) {
    if (r.opId.trim()) m.set(r.opId.trim(), r.id);
    for (const c of r.children ?? []) if (c.opId.trim() && !m.has(c.opId.trim())) m.set(c.opId.trim(), r.id);
  }
  return m;
}

/** Predecessors a Work Block inherits from its folded activities (links leaving the block). */
export function blockExternalPreds(row: BopRow): string[] {
  if (!isBlock(row)) return row.predecessors;
  const inside = new Set(row.children!.map((c) => c.opId.trim()));
  inside.add(row.opId.trim());
  const out = new Set<string>();
  for (const p of row.predecessors) if (!inside.has(p.trim())) out.add(p.trim());
  for (const c of row.children!) for (const p of c.predecessors) if (!inside.has(p.trim())) out.add(p.trim());
  return [...out];
}

export function runCpm(rows: BopRow[], allRows: BopRow[], dur: (r: BopRow) => number): Cpm {
  const idx = opIndex(rows);
  const all = opIndex(allRows);
  const nodes = new Map<Id, CpmNode>();
  const dangling: Cpm['dangling'] = [];
  const external: Cpm['external'] = [];
  const lastInFpd = new Map<Id, Id>();
  for (const r of rows) {
    const preds = new Set<Id>();
    const refs = blockExternalPreds(r).filter((p) => p && p.toLowerCase() !== 'none');
    for (const ref of refs) {
      const hit = idx.get(ref);
      if (hit && hit !== r.id) preds.add(hit);
      else if (!hit && all.has(ref)) external.push({ opId: r.opId, ref });
      else if (!hit) dangling.push({ opId: r.opId, ref });
    }
    let implicitPred = false;
    if (r.taskType === 'Sequential' && refs.length === 0 && lastInFpd.has(r.fpdId)) {
      preds.add(lastInFpd.get(r.fpdId)!);
      implicitPred = true;
    }
    lastInFpd.set(r.fpdId, r.id);
    nodes.set(r.id, {
      rowId: r.id, opId: r.opId, preds: [...preds], succs: [], dur: Math.max(0, dur(r)),
      es: 0, ef: 0, ls: 0, lf: 0, float: 0, critical: false, implicitPred,
    });
  }
  for (const n of nodes.values()) for (const p of n.preds) nodes.get(p)!.succs.push(n.rowId);

  // Kahn topological sort
  const indeg = new Map<Id, number>();
  for (const n of nodes.values()) indeg.set(n.rowId, n.preds.length);
  const queue = [...nodes.values()].filter((n) => n.preds.length === 0).map((n) => n.rowId);
  const order: Id[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of nodes.get(id)!.succs) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const sorted = new Set(order);
  const cyc = [...nodes.values()].filter((n) => !sorted.has(n.rowId));
  const hasCycle = cyc.length > 0;
  for (const n of cyc) order.push(n.rowId); // still schedule the remainder, ignoring unresolved back-edges
  const pos = new Map(order.map((id, i) => [id, i] as const));

  for (let i = 0; i < order.length; i++) {
    const n = nodes.get(order[i])!;
    n.es = Math.max(0, ...n.preds.filter((p) => pos.get(p)! < i).map((p) => nodes.get(p)!.ef));
    n.ef = n.es + n.dur;
  }
  const durationHrs = Math.max(0, ...[...nodes.values()].map((n) => n.ef));
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i])!;
    const later = n.succs.filter((s) => pos.get(s)! > i);
    n.lf = later.length ? Math.min(...later.map((s) => nodes.get(s)!.ls)) : durationHrs;
    n.ls = n.lf - n.dur;
    n.float = Math.max(0, n.ls - n.es);
    n.critical = n.float < EPS && n.dur > EPS;
  }
  return {
    nodes,
    durationHrs,
    hasCycle,
    cycleOps: cyc.map((n) => n.opId),
    dangling,
    external,
    criticalOps: order.map((id) => nodes.get(id)!).filter((n) => n.critical).map((n) => n.opId),
  };
}
// ---------- Lift register ----------
export interface LiftRecord {
  rowId: Id;
  leafId: Id;
  fpdId: Id;
  opId: string;
  description: string;
  lifts: number;
  loadKg: number | null;
  missingWeight: boolean;
  capacityKg: number;
  capacitySource: string;
  utilPct: number | null;
  tandem: boolean;
  elevationM: number;
  floorLevel: number;
  requiredHookM: number;
  availableHookM: number;
  hookMarginM: number;
  hookBreach: boolean;
  compHeightM: number;
  headroomM: number;
  clearanceM: number;
  zoneId: Id;
  craneIds: Id[];
  standIds: Id[];
  crew: number;
  heavy: boolean;
  multiPerson: boolean;
  highElevation: boolean;
  /** Any Complex-class rig, crane, rigging item or stand is tagged. */
  complex: boolean;
  /** Tandem cranes, or rigging / tool items at or above the threshold. */
  multiTool: boolean;
  flagCount: number;
  rag: Rag;
  startHrs: number;
}

export function liftRecord(lc: LeafCalc, ws: Workspace): LiftRecord | null {
  const l = lc.leaf;
  if (l.liftCount <= 0) return null;
  const s = ws.settings;
  const res = (ids: Id[]) => ids.map((id) => ws.resources.find((r) => r.id === id)).filter((r): r is Resource => !!r);
  const comps = l.componentIds.map((id) => ws.components.find((c) => c.id === id)).filter((c) => !!c);
  const cranes = res(l.craneIds);
  const rigging = res(l.riggingIds);
  const stands = res(l.standIds);
  const rigs = res(l.rigIds);

  const missingWeight = comps.length === 0 || comps.some((c) => c!.weightKg == null || c!.weightKg <= 0);
  const weights = comps.map((c) => c!.weightKg ?? 0);
  const tare = rigging.reduce((a, r) => a + (r.tareKg ?? 0), 0);
  // Individual lifts when there are at least as many lifts as linked components, otherwise a combined lift.
  const payload = weights.length === 0 ? 0 : l.liftCount >= weights.length ? Math.max(...weights) : weights.reduce((a, b) => a + b, 0);
  const loadKg = missingWeight ? null : payload + tare;

  const tandem = cranes.length >= 2;
  let capacityKg = s.crane.primarySwlKg;
  let capacitySource = 'Primary crane SWL (Tab 1)';
  if (cranes.length === 1) {
    capacityKg = cranes[0].swlKg ?? s.crane.primarySwlKg;
    capacitySource = cranes[0].name;
  } else if (tandem) {
    capacityKg = cranes.reduce((a, c) => a + (c.swlKg ?? 0), 0) * (1 - s.crane.tandemDeratePct / 100);
    capacitySource = `Tandem (${cranes.length} cranes, −${s.crane.tandemDeratePct}%)`;
  }
  for (const r of rigging) {
    if (r.swlKg != null && r.swlKg < capacityKg) {
      capacityKg = r.swlKg;
      capacitySource = `${r.name} (WLL)`;
    }
  }
  const utilPct = loadKg != null && capacityKg > 0 ? (loadKg / capacityKg) * 100 : null;

  const tierH = stands.find((x) => x.tierHeightM != null)?.tierHeightM ?? s.crane.defaultTierHeightM;
  const elevationM = l.floorLevel * tierH;
  const compH = Math.max(0, ...comps.map((c) => c!.heightM ?? 0));
  const headroom = rigging.length ? Math.max(...rigging.map((r) => r.headroomM ?? s.crane.defaultRiggingHeadroomM)) : s.crane.defaultRiggingHeadroomM;
  const requiredHookM = elevationM + compH + headroom + s.crane.clearanceMarginM;
  const availableHookM = cranes.length ? Math.min(...cranes.map((c) => c.hookHeightM ?? s.crane.hookHeightM)) : s.crane.hookHeightM;
  const hookMarginM = availableHookM - requiredHookM;
  const hookBreach = hookMarginM < -EPS;

  const t = s.thresholds;
  const heavy = loadKg != null && loadKg > t.heavyLiftKg;
  const multiPerson = l.crewSize >= t.multiPersonCrew;
  const highElevation = elevationM >= t.highElevationM || l.floorLevel >= t.highElevationFloors;
  const toolItems = rigging.length + rigs.length;
  const multiTool = tandem || toolItems >= t.multiToolItems;
  const complex = [...rigging, ...rigs, ...cranes, ...stands].some((r) => complexityOf(r) === 'Complex');
  const flagCount = [heavy, multiPerson, highElevation, complex, multiTool].filter(Boolean).length;

  let rag: Rag = flagCount >= 3 ? 'serious' : flagCount >= 1 ? 'amber' : 'green';
  if (utilPct != null && utilPct > 90) rag = worstRag([rag, 'serious']);
  if (missingWeight || hookBreach || (utilPct != null && utilPct > 100)) rag = 'red';

  return {
    rowId: lc.parentId, leafId: l.id, fpdId: l.fpdId, opId: l.opId, description: l.description, lifts: l.liftCount,
    loadKg, missingWeight, capacityKg, capacitySource, utilPct, tandem, elevationM, floorLevel: l.floorLevel,
    requiredHookM, availableHookM, hookMarginM, hookBreach, compHeightM: compH, headroomM: headroom, clearanceM: s.crane.clearanceMarginM,
    zoneId: l.destZoneId, craneIds: l.craneIds, standIds: l.standIds, crew: l.crewSize,
    heavy, multiPerson, highElevation, complex, multiTool, flagCount, rag, startHrs: lc.startHrs,
  };
}

// ---------- Resource loading & spatial conflicts ----------
export interface ResourceLoad {
  resource: Resource;
  busyHrs: number;
  /** Shifts the resource is occupied per build. */
  shiftsUsed: number;
  /** Shifts available in the programme window (all units). */
  programmeShifts: number;
  /** Over the Serious duty limit, or over-subscribed by operations that genuinely hold it. */
  highRisk: boolean;
  opCount: number;
  ops: string[];
  dutyPct: number;
  peakConcurrent: number;
  rag: Rag;
  requiredQty: number;
  conflicts: number;
}
export interface Conflict {
  resourceId: Id;
  resourceName: string;
  a: { opId: string; start: number; end: number; float: number };
  b: { opId: string; start: number; end: number; float: number };
  overlapHrs: number;
  hard: boolean;
  resolvable: boolean;
  shiftOp: string;
  shiftHrs: number;
}

export function dutyRag(dutyPct: number, s: Settings): Rag {
  if (dutyPct > 100) return 'red';
  if (dutyPct > s.thresholds.dutySeriousPct) return 'serious';
  if (dutyPct > s.thresholds.dutyAmberPct) return 'amber';
  return 'green';
}

// ---------- Full model ----------
export interface FpdRoll {
  fpd: Fpd;
  rows: number;
  labourHrs: number;
  elapsedHrs: number;
  spanHrs: number;
  startHrs: number;
  finishHrs: number;
  lifts: number;
  criticalOps: number;
  va: number;
  nnva: number;
  nva: number;
}
export interface CellLoad {
  cellId: Id;
  labourHrs: number;
  rows: number;
  lifts: number;
  utilPct: number | null;
  rag: Rag;
}
export interface Model {
  cal: Calendar;
  lc: number;
  wastePct: number;
  windowNominal: number;
  windowPeak: number;
  windowActive: number;
  demandActive: number;
  fpds: Fpd[];
  rows: BopRow[];
  calcs: Map<Id, RowCalc>;
  cpm: Cpm;
  durationMonths: number;
  durationDays: number;
  totals: {
    labourHrs: number; va: number; nnva: number; nva: number; touchHrs: number; manningHrs: number; runHrs: number;
    burdenRaw: number; elapsedSumHrs: number; opportunityHrs: number; lifts: number; moves: number; interCellMoves: number;
    workBlocks: number; activities: number; labourCost: number; arRedCount: number;
  };
  lifts: LiftRecord[];
  resources: ResourceLoad[];
  conflicts: Conflict[];
  cells: CellLoad[];
  fpdRoll: FpdRoll[];
  peakCrew: number;
  space: SpaceResult;
  scheduleRag: Rag;
  windowRatio: number;
  concurrentBuilds: number;
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

  // Leaf timing: activities folded into a Work Block run back-to-back inside the block window.
  for (const c of calcs.values()) {
    let t = cpm.nodes.get(c.row.id)!.es;
    for (const l of c.leaves) {
      l.startHrs = t;
      t += l.elapsedHrs;
      l.endHrs = t;
    }
  }

  const all = [...calcs.values()];
  const leaves = all.flatMap((c) => c.leaves);
  const sumOf = (f: (c: RowCalc) => number) => all.reduce((a, c) => a + f(c), 0);
  const labourHrs = sumOf((c) => c.labourHrs);
  const totals = {
    labourHrs,
    va: sumOf((c) => c.byClass.VA),
    nnva: sumOf((c) => c.byClass.NNVA),
    nva: sumOf((c) => c.byClass.NVA),
    touchHrs: sumOf((c) => c.touchHrs),
    manningHrs: sumOf((c) => c.manningHrs),
    runHrs: sumOf((c) => c.runHrs),
    burdenRaw: sumOf((c) => c.burdenRaw),
    elapsedSumHrs: sumOf((c) => c.elapsedHrs),
    opportunityHrs: sumOf((c) => c.opportunityHrs),
    lifts: sumOf((c) => c.lifts),
    moves: sumOf((c) => c.moves),
    interCellMoves: all.filter((c) => c.movement === 'Inter-Cell').length,
    workBlocks: rows.length,
    activities: leaves.length,
    labourCost: labourHrs * s.programme.labourRateGbp,
    arRedCount: leaves.filter((l) => l.arRed).length,
  };

  const lifts = leaves.map((l) => liftRecord(l, ws)).filter((x): x is LiftRecord => !!x);

  // Resource loading
  const resources: ResourceLoad[] = [];
  const conflicts: Conflict[] = [];
  // Duty Cycle % = Shifts Used ÷ Programme Shifts, where the programme is the Max Production Window for one unit.
  const hps = Math.max(0.01, s.calendar.hoursPerShift);
  const windowShifts = Number.isFinite(windowActive) && windowActive > 0
    ? windowActive * cal.daysPerMonth * s.calendar.shiftsPerDay
    : 0;
  for (const r of ws.resources) {
    const field = RESOURCE_KINDS.find((k) => k.kind === r.kind)!.field as ResourceField;
    const users = leaves.filter((l) => l.leaf[field].includes(r.id));
    if (users.length === 0) {
      resources.push({ resource: r, busyHrs: 0, shiftsUsed: 0, programmeShifts: windowShifts * Math.max(1, r.qty), highRisk: false, opCount: 0, ops: [], dutyPct: 0, peakConcurrent: 0, rag: 'green', requiredQty: 0, conflicts: 0 });
      continue;
    }
    const qty = Math.max(1, r.qty);
    let busy = 0;
    if (r.dwellMode === 'Full-Build') busy = cpm.durationHrs;
    else
      for (const u of users) {
        busy +=
          r.kind === 'crane' && u.leaf.actionType !== 'Lifting'
            ? Math.min(u.elapsedHrs, (u.leaf.liftCount * s.crane.avgLiftCycleHrs * lc) / cal.activeFactor)
            : u.elapsedHrs;
      }
    const shiftsUsed = busy / hps;
    const programmeShifts = windowShifts * qty;
    const dutyPct = programmeShifts > 0 ? (shiftsUsed / programmeShifts) * 100 : 0;
    let hardConf = 0;

    // Concurrency sweep on the early-start schedule (Per-Op resources only).
    let peak = r.dwellMode === 'Full-Build' ? 1 : 0;
    let nConf = 0;
    if (r.dwellMode === 'Per-Op') {
      const iv = users
        .filter((u) => u.endHrs - u.startHrs > EPS)
        .map((u) => ({ u, float: cpm.nodes.get(u.parentId)!.float }))
        .sort((x, y) => x.u.startHrs - y.u.startHrs);
      let active: typeof iv = [];
      for (const cur of iv) {
        active = active.filter((x) => x.u.endHrs > cur.u.startHrs + EPS);
        if (active.length >= qty) {
          const other = active.reduce((m, x) => (x.u.endHrs < m.u.endHrs ? x : m));
          const overlap = Math.min(other.u.endHrs, cur.u.endHrs) - cur.u.startHrs;
          const shiftB = other.u.endHrs - cur.u.startHrs;
          const shiftA = cur.u.endHrs - other.u.startHrs;
          const canB = shiftB <= cur.float + EPS;
          const canA = shiftA <= other.float + EPS;
          const useB = canB || !canA;
          conflicts.push({
            resourceId: r.id,
            resourceName: r.name,
            a: { opId: other.u.leaf.opId, start: other.u.startHrs, end: other.u.endHrs, float: other.float },
            b: { opId: cur.u.leaf.opId, start: cur.u.startHrs, end: cur.u.endHrs, float: cur.float },
            overlapHrs: overlap,
            hard: r.kind !== 'crane' || (other.u.leaf.actionType === 'Lifting' && cur.u.leaf.actionType === 'Lifting'),
            resolvable: canA || canB,
            shiftOp: useB ? cur.u.leaf.opId : other.u.leaf.opId,
            shiftHrs: useB ? shiftB : shiftA,
          });
          nConf++;
          if (conflicts[conflicts.length - 1].hard) hardConf++;
        }
        active.push(cur);
        peak = Math.max(peak, active.length);
      }
    }
    let rag = dutyRag(dutyPct, s);
    if (nConf > 0) rag = worstRag([rag, 'amber']);
    resources.push({
      resource: r, busyHrs: busy, shiftsUsed, programmeShifts, highRisk: dutyPct > s.thresholds.dutySeriousPct || hardConf > 0, opCount: users.length, ops: [...new Set(users.map((u) => u.leaf.opId))], dutyPct,
      peakConcurrent: peak, rag, conflicts: nConf,
      requiredQty: Math.max(Math.ceil((dutyPct / 100) * qty / Math.max(0.01, s.thresholds.dutySeriousPct / 100) - EPS), r.dwellMode === 'Per-Op' ? Math.min(peak, qty) : 1),
    });
  }

  // Cell loading (work is booked to the destination cell of each activity)
  const zoneCell = new Map(ws.zones.map((z) => [z.id, z.cellId]));
  const cells: CellLoad[] = ws.cells.map((c) => {
    const mine = leaves.filter((l) => zoneCell.get(l.leaf.destZoneId) === c.id);
    const hrs = mine.reduce((a, l) => a + l.labourHrs, 0);
    const cap = c.crewPerShift * cal.annualHrs;
    const utilPct = cap > 0 ? ((hrs * demandActive) / cap) * 100 : null;
    return {
      cellId: c.id, labourHrs: hrs, rows: mine.length, lifts: mine.reduce((a, l) => a + l.leaf.liftCount, 0), utilPct,
      rag: utilPct == null ? 'green' : utilPct > 100 ? 'red' : utilPct > 90 ? 'serious' : utilPct > 80 ? 'amber' : 'green',
    };
  });

  const fpdRoll: FpdRoll[] = fpds.map((f) => {
    const mine = all.filter((c) => c.row.fpdId === f.fpdId);
    const ns = mine.map((c) => cpm.nodes.get(c.row.id)!);
    const start = ns.length ? Math.min(...ns.map((n) => n.es)) : 0;
    const finish = ns.length ? Math.max(...ns.map((n) => n.ef)) : 0;
    const sm = (g: (c: RowCalc) => number) => mine.reduce((a, c) => a + g(c), 0);
    return {
      fpd: f, rows: mine.length, labourHrs: sm((c) => c.labourHrs), elapsedHrs: sm((c) => c.elapsedHrs), spanHrs: finish - start,
      startHrs: start, finishHrs: finish, lifts: sm((c) => c.lifts), criticalOps: ns.filter((n) => n.critical).length,
      va: sm((c) => c.byClass.VA), nnva: sm((c) => c.byClass.NNVA), nva: sm((c) => c.byClass.NVA),
    };
  });

  // Peak concurrent crew on the early-start schedule
  const ev: [number, number][] = [];
  for (const l of leaves) if (l.endHrs - l.startHrs > EPS) ev.push([l.startHrs, l.leaf.crewSize], [l.endHrs, -l.leaf.crewSize]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peakCrew = 0;
  for (const [, d] of ev) {
    cur += d;
    peakCrew = Math.max(peakCrew, cur);
  }

  const durationMonths = cal.hoursPerMonth > 0 ? cpm.durationHrs / cal.hoursPerMonth : 0;
  const windowRatio = windowActive > 0 && Number.isFinite(windowActive) ? durationMonths / windowActive : 0;
  let scheduleRag: Rag = windowRatio <= 0.95 ? 'green' : windowRatio <= 1 ? 'amber' : windowRatio <= 1.1 ? 'serious' : 'red';
  if (durationMonths > s.programme.drumbeatMonths) scheduleRag = 'red';

  return {
    cal, lc, wastePct: waste, windowNominal, windowPeak, windowActive, demandActive, fpds, rows, calcs, cpm,
    durationMonths, durationDays: cal.hoursPerDay > 0 ? cpm.durationHrs / cal.hoursPerDay : 0,
    totals, lifts, resources, conflicts, cells, fpdRoll, peakCrew, space: buildSpace(ws, leaves, cpm), scheduleRag, windowRatio,
    concurrentBuilds: Number.isFinite(windowActive) && windowActive > 0 ? Math.max(1, Math.ceil(durationMonths / windowActive - EPS)) : 1,
  };
}

// ---------- Work Block merge / unmerge ----------
/** Roll the stored header fields of a Work Block up from its folded activities. */
export function rollUpBlock(block: BopRow): void {
  const ch = block.children ?? [];
  if (!ch.length) return;
  const s = (f: (c: BopRow) => number) => ch.reduce((a, c) => a + f(c), 0);
  block.runHrs = s((c) => c.runHrs);
  block.touchHrs = s((c) => c.touchHrs);
  block.manningHrs = s((c) => c.manningHrs);
  block.liftCount = s((c) => c.liftCount);
  block.moveCount = s((c) => c.moveCount);
  block.crewSize = Math.max(...ch.map((c) => c.crewSize));
  block.floorLevel = Math.max(...ch.map((c) => c.floorLevel));
  block.originZoneId = ch[0].originZoneId;
  block.destZoneId = ch[ch.length - 1].destZoneId;
  const u = (f: (c: BopRow) => string[]) => [...new Set(ch.flatMap(f))];
  block.componentIds = u((c) => c.componentIds);
  block.rigIds = u((c) => c.rigIds);
  block.craneIds = u((c) => c.craneIds);
  block.riggingIds = u((c) => c.riggingIds);
  block.vehicleIds = u((c) => c.vehicleIds);
  block.standIds = u((c) => c.standIds);
  const hrs: Record<Classification, number> = { VA: 0, NNVA: 0, NVA: 0 };
  const act = new Map<string, number>();
  for (const c of ch) {
    const b = c.manningHrs * c.crewSize;
    hrs[c.classification] += b;
    act.set(c.actionType, (act.get(c.actionType) ?? 0) + b);
  }
  block.classification = (Object.keys(hrs) as Classification[]).reduce((m, k) => (hrs[k] > hrs[m] ? k : m), 'VA');
  block.actionType = [...act.entries()].reduce((m, e) => (e[1] > m[1] ? e : m))[0] as BopRow['actionType'];
  const inside = new Set(ch.map((c) => c.opId.trim()));
  block.predecessors = [...new Set(ch.flatMap((c) => c.predecessors.map((p) => p.trim())))].filter((p) => p && !inside.has(p));
}
