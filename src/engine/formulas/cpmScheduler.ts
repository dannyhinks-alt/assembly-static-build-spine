// Critical Path Method (CPM) scheduler — pure topological sort + float calculation.
// No React, no DOM.
import type { BopRow, Id } from '../../types';
import { isBlock } from './calendarAndLearning';

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

const EPS = 1e-6;

/**
 * Purpose: Maps every Op ID (including activities folded inside Work Blocks) to its
 *   top-level row id — used by the CPM to resolve predecessor links.
 *
 * Inputs:
 *   @param rows — BOP rows (may include Baseline Work Blocks with children)
 *
 * @returns Map<opId, rowId>
 */
export function opIndex(rows: BopRow[]): Map<string, Id> {
  const index = new Map<string, Id>();
  for (const r of rows) {
    if (r.opId.trim()) index.set(r.opId.trim(), r.id);
    for (const child of r.children ?? []) {
      if (child.opId.trim() && !index.has(child.opId.trim())) index.set(child.opId.trim(), r.id);
    }
  }
  return index;
}

/**
 * Purpose: Collects the predecessor links that cross the boundary of a Baseline Work
 *   Block — links from the block's internal activities to operations outside it.
 *
 * Inputs:
 *   @param row — BOP row (plain activity or Work Block)
 *
 * @returns predecessor Op IDs that are outside this row's scope
 */
export function blockExternalPreds(row: BopRow): string[] {
  if (!isBlock(row)) return row.predecessors;
  const insideOpIds = new Set(row.children!.map((c) => c.opId.trim()));
  insideOpIds.add(row.opId.trim());
  const externalPreds = new Set<string>();
  for (const pred of row.predecessors) if (!insideOpIds.has(pred.trim())) externalPreds.add(pred.trim());
  for (const child of row.children!) {
    for (const pred of child.predecessors) if (!insideOpIds.has(pred.trim())) externalPreds.add(pred.trim());
  }
  return [...externalPreds];
}

/** Builds the CPM node map, resolving predecessors and injecting implicit sequential chain links. */
function buildCpmNodeMap(
  rows: BopRow[],
  allRows: BopRow[],
  dur: (r: BopRow) => number,
): { nodes: Map<Id, CpmNode>; dangling: Cpm['dangling']; external: Cpm['external'] } {
  const scopeIdx = opIndex(rows);
  const factoryIdx = opIndex(allRows);
  const nodes = new Map<Id, CpmNode>();
  const dangling: Cpm['dangling'] = [];
  const external: Cpm['external'] = [];
  const lastInFpd = new Map<Id, Id>();
  for (const r of rows) {
    const preds = new Set<Id>();
    const refs = blockExternalPreds(r).filter((p) => p && p.toLowerCase() !== 'none');
    for (const ref of refs) {
      const hit = scopeIdx.get(ref);
      if (hit && hit !== r.id) preds.add(hit);
      else if (!hit && factoryIdx.has(ref)) external.push({ opId: r.opId, ref });
      else if (!hit) dangling.push({ opId: r.opId, ref });
    }
    let implicitPred = false;
    if (r.taskType === 'Sequential' && refs.length === 0 && lastInFpd.has(r.fpdId)) {
      preds.add(lastInFpd.get(r.fpdId)!);
      implicitPred = true;
    }
    lastInFpd.set(r.fpdId, r.id);
    nodes.set(r.id, {
      rowId: r.id, opId: r.opId, preds: [...preds], succs: [],
      dur: Math.max(0, dur(r)), es: 0, ef: 0, ls: 0, lf: 0, float: 0, critical: false, implicitPred,
    });
  }
  for (const node of nodes.values()) for (const predId of node.preds) nodes.get(predId)!.succs.push(node.rowId);
  return { nodes, dangling, external };
}

/** Kahn topological sort — returns order and identifies cycle members. */
function kahnTopologicalSort(nodes: Map<Id, CpmNode>): { order: Id[]; hasCycle: boolean; cycleOps: string[] } {
  const indegree = new Map<Id, number>();
  for (const node of nodes.values()) indegree.set(node.rowId, node.preds.length);
  const queue = [...nodes.values()].filter((n) => n.preds.length === 0).map((n) => n.rowId);
  const order: Id[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const succId of nodes.get(id)!.succs) {
      indegree.set(succId, indegree.get(succId)! - 1);
      if (indegree.get(succId) === 0) queue.push(succId);
    }
  }
  const cycleNodes = [...nodes.values()].filter((n) => !new Set(order).has(n.rowId));
  for (const node of cycleNodes) order.push(node.rowId);
  return { order, hasCycle: cycleNodes.length > 0, cycleOps: cycleNodes.map((n) => n.opId) };
}

/** Applies forward then backward pass float calculations to the sorted node list. */
function applySchedulePasses(nodes: Map<Id, CpmNode>, order: Id[]): void {
  const pos = new Map(order.map((id, i) => [id, i] as const));
  for (let i = 0; i < order.length; i++) {
    const node = nodes.get(order[i])!;
    node.es = Math.max(0, ...node.preds.filter((p) => pos.get(p)! < i).map((p) => nodes.get(p)!.ef));
    node.ef = node.es + node.dur;
  }
  const durationHrs = Math.max(0, ...[...nodes.values()].map((n) => n.ef));
  for (let i = order.length - 1; i >= 0; i--) {
    const node = nodes.get(order[i])!;
    const laterSuccs = node.succs.filter((s) => pos.get(s)! > i);
    node.lf = laterSuccs.length ? Math.min(...laterSuccs.map((s) => nodes.get(s)!.ls)) : durationHrs;
    node.ls = node.lf - node.dur;
    node.float = Math.max(0, node.ls - node.es);
    node.critical = node.float < EPS && node.dur > EPS;
  }
}

/**
 * Purpose: Runs a full CPM schedule across the given BOP rows, computing early/late
 *   start, finish, float, and critical-path membership for every row.
 *
 * Formula: Standard CPM forward (ES/EF) and backward (LS/LF) pass with Kahn
 *   topological sort; float = LS − ES; critical = float < ε and dur > ε.
 *
 * Inputs:
 *   @param rows    — BOP rows in scope (may be a cell or FPD subset)
 *   @param allRows — all active factory rows (for external predecessor resolution)
 *   @param dur     — duration callback: (row) → elapsed hours
 *
 * Downstream impact: drives Tab 2 Gantt bars, Tab 9 critical-path KPI, all schedule
 *   gates, and resource-conflict timing in resourceDuty.
 *
 * @returns Cpm — full schedule result with node map and diagnostics
 */
export function runCpm(rows: BopRow[], allRows: BopRow[], dur: (r: BopRow) => number): Cpm {
  const { nodes, dangling, external } = buildCpmNodeMap(rows, allRows, dur);
  const { order, hasCycle, cycleOps } = kahnTopologicalSort(nodes);
  applySchedulePasses(nodes, order);
  const durationHrs = Math.max(0, ...[...nodes.values()].map((n) => n.ef));
  return {
    nodes, durationHrs, hasCycle, cycleOps, dangling, external,
    criticalOps: order.map((id) => nodes.get(id)!).filter((n) => n.critical).map((n) => n.opId),
  };
}
