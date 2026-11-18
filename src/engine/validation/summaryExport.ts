// summary@V2 export — full factory roll-up for the Multi-Factory Master Control Hub.
import { APP_NAME, APP_VERSION, SUMMARY_SCHEMA, complexityOf } from '../../types';
import type { Workspace } from '../../types';
import type { IntegrityReport } from '../integrity';
import { computeGates, controlDocMissing, isBlindSpot, overallRag, rpnOf, rpnRag } from './releaseGates';
import { routeToGreen } from './routeToGreen';

/** Builds the factory.cells array for the summary export. */
function buildFactoryCells(ws: Workspace, m: ReturnType<typeof import('../model').buildModel>, factoryId: string) {
  return [...ws.cells].sort((a, b) => a.number - b.number).map((cell) => {
    const load = m.cells.find((x) => x.cellId === cell.id)!;
    const mine = m.fpdRoll.filter((f) => f.fpd.assignedCellId === cell.id);
    const zoneIds = new Set(ws.zones.filter((z) => z.cellId === cell.id).map((z) => z.id));
    const liftOps = m.lifts.filter((l) => zoneIds.has(l.zoneId));
    return {
      cellId: `${factoryId}-C${cell.number}`, number: cell.number, name: cell.name, crewPerShift: cell.crewPerShift,
      zones: ws.zones.filter((z) => z.cellId === cell.id).map((z) => z.name),
      fpds: mine.map((f) => f.fpd.fpdCode), workBlocks: mine.reduce((acc, f) => acc + f.rows, 0),
      labourHoursPerBuild: Math.round(load.labourHrs * 10) / 10,
      utilisationPct: load.utilPct == null ? null : Math.round(load.utilPct * 10) / 10,
      lifts: load.lifts, heavyLiftOps: liftOps.filter((l) => l.heavy).length,
      redLiftOps: liftOps.filter((l) => l.rag === 'red').length,
      spatialClashes: m.space.clashes.filter((x) => x.cellId === cell.id).length, rag: load.rag,
    };
  });
}

/** Builds the KPIs section of the summary export. */
function buildKpisSection(ws: Workspace, m: ReturnType<typeof import('../model').buildModel>) {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    activeFpds: m.fpds.length, totalFpds: ws.fpds.length,
    workBlocks: m.totals.workBlocks, activities: m.totals.activities,
    criticalPathMonths: r3(m.durationMonths), criticalPathWorkingDays: r1(m.durationDays),
    criticalPathElapsedHours: r1(m.cpm.durationHrs),
    baselineOperationalMonthsTarget: ws.settings.programme.baselineOpMonths,
    baselineOperationalMonthsModelled: r3(m.durationMonths / m.lc),
    productionWindowNominalMonths: r3(m.windowNominal), productionWindowPeakMonths: r3(m.windowPeak),
    windowUtilisationPct: r1(m.windowRatio * 100), drumbeatMonths: ws.settings.programme.drumbeatMonths,
    concurrentBuildsInWip: m.concurrentBuilds,
    labourHoursPerBuild: r1(m.totals.labourHrs), labourCostPerBuildGbp: Math.round(m.totals.labourCost),
    valueAddPct: r1(m.totals.labourHrs ? (m.totals.va / m.totals.labourHrs) * 100 : 0),
    nnvaPct: r1(m.totals.labourHrs ? (m.totals.nnva / m.totals.labourHrs) * 100 : 0),
    nvaPct: r1(m.totals.labourHrs ? (m.totals.nva / m.totals.labourHrs) * 100 : 0),
    machineLockedLabourOps: m.totals.arRedCount, peakConcurrentCrew: m.peakCrew, scheduleRag: m.scheduleRag,
  };
}

/**
 * Purpose: Assembles the full summary@V2 payload for the Multi-Factory Master Control Hub.
 *   Always uses the factory-wide model (all active FPDs), never a filtered view.
 *
 * Inputs:
 *   @param ws    — workspace
 *   @param integ — integrity report (which carries the factory-wide Model via integ.factory)
 *
 * Downstream impact: consumed by the Master Hub to populate cross-factory dashboards.
 *   Breaking this schema requires coordinator sign-off — see CLAUDE.md Schema Contracts.
 *
 * @returns summary@V2 object — schema-tagged JSON payload
 */
export function buildSummary(ws: Workspace, integ: IntegrityReport) {
  const m = integ.factory;
  const gates = computeGates(ws, m, integ);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const openPfmea = ws.pfmea.filter((p) => p.status !== 'Closed');
  const rpnBand = (rag: string) => openPfmea.filter((p) => rpnRag(rpnOf(p), ws.settings) === rag).length;
  const factoryId = ws.meta.factoryId || 'F4';
  return {
    schema: SUMMARY_SCHEMA,
    source: { app: APP_NAME, version: APP_VERSION, kind: 'static-build', workspaceSchema: ws.schema },
    exportedAt: new Date().toISOString(),
    locale: 'en-GB',
    factory: { id: factoryId, name: ws.meta.factoryName, workspace: ws.meta.name, floorAreaM2: ws.settings.envelope.lengthM * ws.settings.envelope.widthM, cells: buildFactoryCells(ws, m, factoryId) },
    basis: {
      buildNumber: ws.settings.learning.selectedBuild, learningFactor: Math.round(m.lc * 1000) / 1000,
      demandCase: ws.settings.programme.demandCase, annualDemand: m.demandActive,
      shiftsPerDay: ws.settings.calendar.shiftsPerDay, hoursPerShift: ws.settings.calendar.hoursPerShift,
      workingDaysPerYear: ws.settings.calendar.workingDaysPerYear,
      activeTimeFactorPct: ws.settings.calendar.activeTimeFactorPct,
      labourEfficiencyPct: ws.settings.calendar.labourEfficiencyPct,
      wastePct: Math.round(m.wastePct * 1000) / 1000, currency: 'GBP',
    },
    kpis: buildKpisSection(ws, m),
    lifts: {
      totalLifts: m.totals.lifts, liftOps: m.lifts.length,
      heavyLiftOps: m.lifts.filter((l) => l.heavy).length,
      multiPersonLiftOps: m.lifts.filter((l) => l.multiPerson).length,
      complexLiftOps: m.lifts.filter((l) => l.complex).length,
      multiToolTandemLiftOps: m.lifts.filter((l) => l.multiTool).length,
      elevated3dLiftOps: m.lifts.filter((l) => l.highElevation).length,
      hookHeightBreaches: m.lifts.filter((l) => l.hookBreach).length,
      over90PctSwl: m.lifts.filter((l) => l.utilPct != null && l.utilPct > 90).length,
      redLiftOps: m.lifts.filter((l) => l.rag === 'red').length,
    },
    movement: {
      totalMoves: m.totals.moves, interCellMoves: m.space.interCellMoves, intraCellMoves: m.space.intraCellMoves,
      spaghettiCurrentM: Math.round(m.space.spaghettiM), spaghettiFutureM: Math.round(m.space.spaghettiFutureM),
      spaghettiSavingPct: r1(m.space.spaghettiM ? (1 - m.space.spaghettiFutureM / m.space.spaghettiM) * 100 : 0),
      spatialClashes: m.space.clashes.length, resourceConcurrencyConflicts: m.conflicts.length,
    },
    pfmea: {
      openItems: openPfmea.length, highestOpenRpn: openPfmea.reduce((acc, p) => Math.max(acc, rpnOf(p)), 0),
      red: rpnBand('red'), serious: rpnBand('serious'), amber: rpnBand('amber'), green: rpnBand('green'),
      highSeverityOpen: openPfmea.filter((p) => p.s >= ws.settings.thresholds.blindSpotSeverity).length,
      blindSpots: openPfmea.filter((p) => isBlindSpot(p, ws.settings)).length,
      controlDocsMissing: openPfmea.filter((p) => controlDocMissing(p, ws.settings)).length,
    },
    fpds: m.fpdRoll.map((f) => ({
      fpdCode: f.fpd.fpdCode, title: f.fpd.title, revision: f.fpd.revision, bomRef: f.fpd.subAssemblyBomRef,
      cellId: `${factoryId}-C${ws.cells.find((c) => c.id === f.fpd.assignedCellId)?.number ?? '?'}`,
      workBlocks: f.rows, labourHoursPerBuild: r1(f.labourHrs), spanElapsedHours: r1(f.spanHrs), lifts: f.lifts, criticalOps: f.criticalOps,
    })),
    resources: m.resources.filter((r) => r.opCount > 0).map((r) => ({
      name: r.resource.name, kind: r.resource.kind, qty: r.resource.qty, complexity: complexityOf(r.resource), dwellMode: r.resource.dwellMode,
      shiftsUsed: r1(r.shiftsUsed), programmeShifts: r1(r.programmeShifts), dutyCyclePct: r1(r.dutyPct), highRisk: r.highRisk,
      conflicts: r.conflicts, suggestedQty: r.requiredQty, rag: r.rag, mitigation: ws.mitigations[r.resource.id] ?? '',
    })),
    criticalPath: m.cpm.criticalOps,
    integrity: { passed: integ.passed, total: integ.checks.length, checks: integ.checks.map((c) => ({ n: c.n, title: c.title, pass: c.pass })) },
    gates: gates.map((g) => ({ id: g.id, title: g.title, rag: g.rag, detail: g.detail, signoff: ws.gateSignoffs[g.id] ?? null })),
    routeToGreen: routeToGreen(ws, m, integ, gates).map((x) => ({ gate: `G${x.gate}`, action: x.text })),
    overallRag: overallRag(gates),
  };
}
