// Pure calendar, learning-curve, waste and production-window calculations.
// No React, no DOM — safe to call from tests, the UI and the engine alike.
import type { BopRow, Settings, Workspace } from '../../types';

export interface Calendar {
  hoursPerDay: number;
  daysPerMonth: number;
  hoursPerMonth: number;
  annualHrs: number;
  activeFactor: number;
  labourEff: number;
}

/**
 * Purpose: Derives a fully-resolved calendar from workspace settings, normalising
 *   shift configuration into the per-hour and per-month denominators used throughout
 *   the engine.
 *
 * Formula:
 *   hoursPerDay   = shiftsPerDay × hoursPerShift
 *   daysPerMonth  = workingDaysPerYear / 12
 *   hoursPerMonth = hoursPerDay × daysPerMonth
 *   annualHrs     = hoursPerDay × workingDaysPerYear
 *   activeFactor  = max(0.01, activeTimeFactorPct / 100)
 *   labourEff     = max(0.01, labourEfficiencyPct / 100)
 *
 * Inputs:
 *   @param s — workspace Settings (calendar sub-object)
 *
 * Downstream impact: drives all elapsed-hour calculations in activityMetrics,
 *   production window calculations, and resource duty cycle in resourceDuty.
 *
 * @returns Calendar — resolved denominators and factors
 */
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

/**
 * Purpose: Stepped learning curve that reduces from first-build factor toward the
 *   stabilised factor by a fixed step each build, holding at the floor once the
 *   configured number of reductions has been taken.
 *
 * Formula: factor = clamp(firstBuild% − stepReduction% × (build − 1), stabilised%, firstBuild%) / 100
 *
 * Inputs:
 *   @param l     — learning settings (firstBuildPct, stabilisedPct, stepReductionPct, stepBuilds)
 *   @param build — build number (integer ≥ 1)
 *
 * Downstream impact: multiplies elapsed hours in leafElapsed, hence drives critical
 *   path duration, production window ratio, and all schedule-dependent KPIs in Tabs 1 & 9.
 *
 * @returns learning factor as a dimensionless ratio (e.g. 1.30 for Build 1 at 130%)
 */
export function learningFactor(l: Settings['learning'], build: number): number {
  const steps = Math.max(0, Math.floor(build) - 1);
  if (steps >= l.stepBuilds) return l.stabilisedPct / 100;
  const stepped = l.firstBuildPct - l.stepReductionPct * steps;
  const lo = Math.min(l.firstBuildPct, l.stabilisedPct);
  const hi = Math.max(l.firstBuildPct, l.stabilisedPct);
  return Math.min(hi, Math.max(lo, stepped)) / 100;
}

/** Returns the leaf activities of a row: its children array when it is a Baseline Work Block,
 *  or the row itself when it is a plain activity. */
export const leavesOf = (r: BopRow): BopRow[] =>
  r.children && r.children.length ? r.children : [r];

/** Returns true when this row is a merged Baseline Work Block with folded children. */
export const isBlock = (r: BopRow): boolean => !!(r.children && r.children.length);

/**
 * Purpose: Calculates automated waste as the NVA (pure waste) share of total
 *   crew-burden hours across every active FPD.  Falls back to the manual override
 *   when the wasteMode setting is 'Manual'.
 *
 * Formula: wastePct = (Σ NVA burden / Σ total burden) × 100
 *   where burden = manningHrs × crewSize per leaf activity.
 *
 * Inputs:
 *   @param ws — workspace (uses ws.fpds, ws.rows, ws.settings.calendar)
 *
 * Downstream impact: feeds productionWindowMonths, hence the schedule RAG in Tab 2
 *   and the Executive KPI cards in Tab 9.
 *
 * @returns waste percentage (0–100)
 */
export function wastePct(ws: Workspace): number {
  if (ws.settings.calendar.wasteMode === 'Manual') return ws.settings.calendar.manualWastePct;
  const activeIds = new Set(ws.fpds.filter((f) => f.active).map((f) => f.fpdId));
  let nvaHours = 0;
  let totalHours = 0;
  for (const r of ws.rows) {
    if (!activeIds.has(r.fpdId)) continue;
    for (const leaf of leavesOf(r)) {
      const burden = leaf.manningHrs * leaf.crewSize;
      totalHours += burden;
      if (leaf.classification === 'NVA') nvaHours += burden;
    }
  }
  return totalHours > 0 ? (nvaHours / totalHours) * 100 : 0;
}

/**
 * Purpose: Derives the available production window (months per build) from annual
 *   demand, adjusted for the waste overhead that reduces net available capacity.
 *
 * Formula: windowMonths = (12 / demandPerYear) × (1 − waste% / 100)
 *
 * Inputs:
 *   @param demandPerYear — planned annual demand (builds per year)
 *   @param waste         — waste percentage (0–100)
 *
 * Downstream impact: drives scheduleRag and all production window KPIs in Tab 9.
 *
 * @returns production window in calendar months (Infinity when demand is zero)
 */
export const productionWindowMonths = (demandPerYear: number, waste: number): number =>
  demandPerYear > 0 ? (12 / demandPerYear) * (1 - waste / 100) : Infinity;
