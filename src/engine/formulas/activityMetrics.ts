// Per-row and per-leaf elapsed-hours and labour-burden calculations.
// Pure functions — no React, no DOM.
import type { BopRow, Classification, Id, Settings, Workspace } from '../../types';
import { isBlock, leavesOf } from './calendarAndLearning';
import type { Calendar } from './calendarAndLearning';

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

/**
 * Purpose: Derives the elapsed calendar hours for a single leaf activity after
 *   applying the active-time factor and the learning-curve multiplier.
 *
 * Formula: elapsedHrs = max(runHrs, manningHrs) / activeFactor × learningFactor
 *
 * Inputs:
 *   @param l   — leaf BOP row (runHrs, manningHrs)
 *   @param cal — resolved Calendar (activeFactor)
 *   @param lc  — learning-curve factor (dimensionless ratio, e.g. 1.30)
 *
 * Downstream impact: sets node duration in the CPM scheduler; drives the
 *   production window ratio and schedule RAG.
 *
 * @returns elapsed hours (calendar time, not direct labour)
 */
export function leafElapsed(l: BopRow, cal: Calendar, lc: number): number {
  return (Math.max(l.runHrs, l.manningHrs) / cal.activeFactor) * lc;
}

/** Calculates labour metrics for a single leaf activity. */
function computeLeafStats(
  leaf: BopRow,
  parentId: Id,
  cal: Calendar,
  lc: number,
  t: Settings['thresholds'],
): LeafCalc {
  const burdenRaw = leaf.manningHrs * leaf.crewSize;
  const arPct = leaf.runHrs > 0 ? (leaf.manningHrs / leaf.runHrs) * 100 : null;
  return {
    leaf,
    parentId,
    elapsedHrs: leafElapsed(leaf, cal, lc),
    burdenRaw,
    labourHrs: (burdenRaw * lc) / cal.labourEff,
    arPct,
    arRed: arPct != null && arPct >= t.arRedPct && leaf.runHrs * 60 > t.arMinCycleMin,
    opportunityHrs: leaf.manningHrs - leaf.touchHrs,
    startHrs: 0,
    endHrs: 0,
  };
}

/**
 * Purpose: Calculates all labour-analysis metrics for a BOP row or Baseline Work Block.
 *   For a Work Block, the metrics are summed across its folded children.
 *
 * Formula:
 *   burdenRaw = Σ (manningHrs × crewSize) per leaf
 *   labourHrs = (burdenRaw × lc) / labourEff per leaf, then summed
 *   arPct     = manningHrs / runHrs × 100 (null for manual ops)
 *   movement  = 'Inter-Cell' when origin cell ≠ destination cell, else 'Intra-Cell'
 *
 * Inputs:
 *   @param row — BOP row or Baseline Work Block
 *   @param ws  — workspace (zones, settings.thresholds)
 *   @param cal — resolved Calendar
 *   @param lc  — learning-curve factor
 *
 * Downstream impact: populates Tab 2 BOP table, Tab 6 Labour analysis, Tab 9 KPIs,
 *   and feeds the CPM scheduler via elapsedHrs.
 *
 * @returns RowCalc — full metrics bundle for this row
 */
export function calcRow(row: BopRow, ws: Workspace, cal: Calendar, lc: number): RowCalc {
  const t = ws.settings.thresholds;
  const zoneCell = (zoneId: string) => ws.zones.find((z) => z.id === zoneId)?.cellId ?? '';
  const leaves = leavesOf(row).map((leaf) => computeLeafStats(leaf, row.id, cal, lc, t));
  const sum = (f: (l: LeafCalc) => number) => leaves.reduce((acc, l) => acc + f(l), 0);
  const runHrs = sum((l) => l.leaf.runHrs);
  const manningHrs = sum((l) => l.leaf.manningHrs);
  const byClass: Record<Classification, number> = { VA: 0, NNVA: 0, NVA: 0 };
  for (const l of leaves) byClass[l.leaf.classification] += l.labourHrs;
  const originCellId = zoneCell(leaves[0].leaf.originZoneId);
  const destCellId = zoneCell(leaves[leaves.length - 1].leaf.destZoneId);
  return {
    row, leaves, runHrs,
    touchHrs: sum((l) => l.leaf.touchHrs),
    manningHrs,
    crewMax: Math.max(...leaves.map((l) => l.leaf.crewSize), 0),
    burdenRaw: sum((l) => l.burdenRaw),
    labourHrs: sum((l) => l.labourHrs),
    elapsedHrs: sum((l) => l.elapsedHrs),
    arPct: runHrs > 0 ? (manningHrs / runHrs) * 100 : null,
    arRed: isBlock(row) ? leaves.some((l) => l.arRed) : leaves[0].arRed,
    opportunityHrs: sum((l) => l.opportunityHrs),
    byClass,
    lifts: sum((l) => l.leaf.liftCount),
    moves: sum((l) => l.leaf.moveCount),
    movement: !originCellId || !destCellId ? '—' : originCellId === destCellId ? 'Intra-Cell' : 'Inter-Cell',
  };
}
