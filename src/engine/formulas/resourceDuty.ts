// Resource duty-cycle calculations and concurrent-use conflict detection.
// Pure functions — no React, no DOM.
import type { Id, Rag, Resource, ResourceField, Settings, Workspace } from '../../types';
import { RESOURCE_KINDS } from '../../types';
import { worstRag } from '../../lib/format';
import type { LeafCalc } from './activityMetrics';
import type { Calendar } from './calendarAndLearning';
import type { Cpm, CpmNode } from './cpmScheduler';

export interface ResourceLoad {
  resource: Resource;
  busyHrs: number;
  shiftsUsed: number;
  programmeShifts: number;
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
  resourceId: Id; resourceName: string;
  a: { opId: string; start: number; end: number; float: number };
  b: { opId: string; start: number; end: number; float: number };
  overlapHrs: number; hard: boolean; resolvable: boolean; shiftOp: string; shiftHrs: number;
}

const EPS = 1e-6;

/**
 * Purpose: Derives the RAG for a resource's duty cycle based on its utilisation
 *   percentage relative to the configured Serious and Amber thresholds.
 *
 * Formula: red > 100% | serious > dutySeriousPct% | amber > dutyAmberPct% | green ≤ amber
 *
 * Inputs:
 *   @param dutyPct — duty-cycle percentage (shiftsUsed / programmeShifts × 100)
 *   @param s       — workspace settings (thresholds sub-object)
 *
 * Downstream impact: drives Tab 8 Resource Utilisation table and Gate 4 RAG.
 *
 * @returns Rag
 */
export function dutyRag(dutyPct: number, s: Settings): Rag {
  if (dutyPct > 100) return 'red';
  if (dutyPct > s.thresholds.dutySeriousPct) return 'serious';
  if (dutyPct > s.thresholds.dutyAmberPct) return 'amber';
  return 'green';
}

/** Calculates the number of hours a resource is busy across a build, applying
 *  crane cycle-time and Full-Build dwell-mode rules. */
function computeBusyHrs(
  resource: Resource,
  users: LeafCalc[],
  lc: number,
  cal: Calendar,
  cpm: Cpm,
  s: Settings,
): number {
  if (resource.dwellMode === 'Full-Build') return cpm.durationHrs;
  return users.reduce((total, user) => {
    const occupiedHrs = resource.kind === 'crane' && user.leaf.actionType !== 'Lifting'
      ? Math.min(user.elapsedHrs, (user.leaf.liftCount * s.crane.avgLiftCycleHrs * lc) / cal.activeFactor)
      : user.elapsedHrs;
    return total + occupiedHrs;
  }, 0);
}

/** Runs a concurrency sweep on the early-start schedule for Per-Op resources,
 *  detecting overlapping intervals and recording each as a Conflict. */
function detectConcurrencyConflicts(
  resource: Resource,
  users: LeafCalc[],
  qty: number,
  cpm: Cpm,
  accumulatedConflicts: Conflict[],
): { peak: number; nConf: number; hardConf: number } {
  if (resource.dwellMode === 'Full-Build') return { peak: 1, nConf: 0, hardConf: 0 };
  const intervals = users
    .filter((u) => u.endHrs - u.startHrs > EPS)
    .map((u) => ({ u, float: (cpm.nodes.get(u.parentId) as CpmNode).float }))
    .sort((x, y) => x.u.startHrs - y.u.startHrs);
  let active: typeof intervals = [];
  let peak = 0;
  let nConf = 0;
  let hardConf = 0;
  for (const cur of intervals) {
    active = active.filter((x) => x.u.endHrs > cur.u.startHrs + EPS);
    if (active.length >= qty) {
      const other = active.reduce((m, x) => (x.u.endHrs < m.u.endHrs ? x : m));
      const overlap = Math.min(other.u.endHrs, cur.u.endHrs) - cur.u.startHrs;
      const shiftB = other.u.endHrs - cur.u.startHrs;
      const shiftA = cur.u.endHrs - other.u.startHrs;
      const canB = shiftB <= cur.float + EPS;
      const canA = shiftA <= other.float + EPS;
      const useB = canB || !canA;
      const isHard = resource.kind !== 'crane' || (other.u.leaf.actionType === 'Lifting' && cur.u.leaf.actionType === 'Lifting');
      accumulatedConflicts.push({
        resourceId: resource.id, resourceName: resource.name,
        a: { opId: other.u.leaf.opId, start: other.u.startHrs, end: other.u.endHrs, float: other.float },
        b: { opId: cur.u.leaf.opId, start: cur.u.startHrs, end: cur.u.endHrs, float: cur.float },
        overlapHrs: overlap, hard: isHard, resolvable: canA || canB,
        shiftOp: useB ? cur.u.leaf.opId : other.u.leaf.opId,
        shiftHrs: useB ? shiftB : shiftA,
      });
      nConf++;
      if (isHard) hardConf++;
    }
    active.push(cur);
    peak = Math.max(peak, active.length);
  }
  return { peak, nConf, hardConf };
}

/**
 * Purpose: Computes the duty-cycle utilisation and concurrency conflicts for every
 *   resource in the workspace, based on the early-start schedule from the CPM.
 *
 * Formula:
 *   dutyPct = (shiftsUsed / programmeShifts) × 100
 *   shiftsUsed = busyHrs / hoursPerShift
 *   programmeShifts = windowActive × daysPerMonth × shiftsPerDay × qty
 *
 * Inputs:
 *   @param ws           — workspace (resources, settings)
 *   @param leaves       — all scheduled leaf activities with start/end times
 *   @param lc           — learning-curve factor
 *   @param cal          — resolved Calendar
 *   @param cpm          — CPM schedule result (node timings)
 *   @param s            — workspace settings
 *   @param windowActive — active production window in months
 *
 * Downstream impact: drives Tab 8 Resource Utilisation, Gate 4, and route-to-green
 *   resource actions.
 *
 * @returns resources array and conflicts array
 */
export function computeResourceLoads(
  ws: Workspace,
  leaves: LeafCalc[],
  lc: number,
  cal: Calendar,
  cpm: Cpm,
  s: Settings,
  windowActive: number,
): { resources: ResourceLoad[]; conflicts: Conflict[] } {
  const hps = Math.max(0.01, s.calendar.hoursPerShift);
  const windowShifts = Number.isFinite(windowActive) && windowActive > 0
    ? windowActive * cal.daysPerMonth * s.calendar.shiftsPerDay : 0;
  const resources: ResourceLoad[] = [];
  const conflicts: Conflict[] = [];
  for (const resource of ws.resources) {
    const field = RESOURCE_KINDS.find((k) => k.kind === resource.kind)!.field as ResourceField;
    const users = leaves.filter((l) => l.leaf[field].includes(resource.id));
    if (users.length === 0) {
      resources.push({ resource, busyHrs: 0, shiftsUsed: 0, programmeShifts: windowShifts * Math.max(1, resource.qty), highRisk: false, opCount: 0, ops: [], dutyPct: 0, peakConcurrent: 0, rag: 'green', requiredQty: 0, conflicts: 0 });
      continue;
    }
    const qty = Math.max(1, resource.qty);
    const busyHrs = computeBusyHrs(resource, users, lc, cal, cpm, s);
    const shiftsUsed = busyHrs / hps;
    const programmeShifts = windowShifts * qty;
    const dutyPct = programmeShifts > 0 ? (shiftsUsed / programmeShifts) * 100 : 0;
    const { peak, nConf, hardConf } = detectConcurrencyConflicts(resource, users, qty, cpm, conflicts);
    let rag = dutyRag(dutyPct, s);
    if (nConf > 0) rag = worstRag([rag, 'amber']);
    const requiredQty = Math.max(
      Math.ceil((dutyPct / 100) * qty / Math.max(0.01, s.thresholds.dutySeriousPct / 100) - EPS),
      resource.dwellMode === 'Per-Op' ? Math.min(peak, qty) : 1,
    );
    resources.push({
      resource, busyHrs, shiftsUsed, programmeShifts, highRisk: dutyPct > s.thresholds.dutySeriousPct || hardConf > 0,
      opCount: users.length, ops: [...new Set(users.map((u) => u.leaf.opId))], dutyPct,
      peakConcurrent: peak, rag, conflicts: nConf, requiredQty,
    });
  }
  return { resources, conflicts };
}
