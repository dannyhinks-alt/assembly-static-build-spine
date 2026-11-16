// Release gates and the summary@V2 roll-up exported to Multi-Factory Master Control Hub.
import type { GuideId } from '../data/guides';
import { ragRank, worstRag } from '../lib/format';
import type { PfmeaItem, Rag, Settings, Workspace } from '../types';
import { APP_NAME, APP_VERSION, SUMMARY_SCHEMA } from '../types';
import type { IntegrityReport } from './integrity';
import type { Model } from './model';

export interface Gate {
  id: string;
  n: number;
  title: string;
  guide: GuideId;
  rag: Rag;
  detail: string;
  tab: number;
}

export const rpnOf = (p: PfmeaItem): number => p.s * p.o * p.d;
export function rpnRag(rpn: number, s: Settings): Rag {
  const t = s.thresholds;
  return rpn >= t.rpnRed ? 'red' : rpn >= t.rpnSerious ? 'serious' : rpn >= t.rpnAmber ? 'amber' : 'green';
}

export function computeGates(ws: Workspace, m: Model, integ: IntegrityReport): Gate[] {
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const gates: Gate[] = [];
  const add = (title: string, guide: GuideId, rag: Rag, detail: string, tab: number) =>
    gates.push({ id: `G${gates.length + 1}`, n: gates.length + 1, title, guide, rag, detail, tab });

  const core = integ.checks.filter((c) => c.key !== 'assumptions');
  const failed = core.filter((c) => !c.pass);
  add('Model Integrity', 'gate1', failed.length ? 'red' : 'green',
    failed.length ? `${failed.length} of 9 structural checks failing: ${failed.map((c) => `#${c.n}`).join(', ')}.` : 'Structural checks 1–9 all pass (factory-wide).', 1);

  add('Schedule vs Production Window', 'gate2', m.rows.length ? m.scheduleRag : 'amber',
    m.rows.length
      ? `Critical path ${m.durationMonths.toFixed(1)} months = ${(m.windowRatio * 100).toFixed(0)}% of the ${m.windowActive.toFixed(1)}-month window; drumbeat ${ws.settings.programme.drumbeatMonths.toFixed(1)} months.`
      : 'No work blocks in the current filter.', 7);

  const redLifts = m.lifts.filter((l) => l.rag === 'red');
  const serLifts = m.lifts.filter((l) => l.rag === 'serious');
  add('Lift & Crane Safety', 'gate3', worstRag(m.lifts.map((l) => l.rag)),
    redLifts.length
      ? `${redLifts.length} Red lift(s): ${redLifts.map((l) => `${l.opId} (${l.missingWeight ? 'no weight' : l.hookBreach ? 'hook-height breach' : 'over capacity'})`).join(', ')}.`
      : serLifts.length ? `${serLifts.length} Serious lift(s) (3+ risk flags or > 90% SWL); none Red.` : `${m.lifts.length} lift op(s) within capacity and hook envelope.`, 8);

  const used = m.resources.filter((r) => r.opCount > 0);
  const hardUnres = m.conflicts.filter((c) => c.hard && !c.resolvable);
  let resRag = worstRag(used.map((r) => r.rag));
  if (hardUnres.length) resRag = 'red';
  const top = [...used].sort((a, b) => b.dutyPct - a.dutyPct)[0];
  add('Resource Capacity & Spatial Conflicts', 'gate4', resRag,
    `${top ? `Highest duty: ${top.resource.name} at ${top.dutyPct.toFixed(0)}%. ` : ''}${m.conflicts.length} spatial conflict(s)${hardUnres.length ? `, ${hardUnres.length} hard and not resolvable within float` : ''}.`, 8);

  const open = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  const worst = open.reduce((mx, p) => Math.max(mx, rpnOf(p)), 0);
  add('PFMEA Risk', 'gate5', rpnRag(worst, ws.settings),
    open.length ? `${open.length} open item(s); highest open RPN ${worst}.` : 'No open PFMEA items in the current filter.', 6);

  const hps = ws.holdPoints.filter((h) => !h.fpdId || inScope.has(h.fpdId));
  const rej = hps.filter((h) => h.status === 'Rejected').length;
  const planned = hps.filter((h) => h.status === 'Planned').length;
  add('Quality Hold Points', 'gate6', rej ? 'red' : planned ? 'amber' : 'green',
    hps.length ? `${hps.length} hold point(s): ${hps.length - rej - planned} released, ${planned} planned, ${rej} rejected.` : 'No hold points defined for the current filter.', 6);

  const unc = ws.assumptions.filter((a) => !a.confirmed).length;
  add('Assumptions', 'gate7', unc === 0 ? 'green' : unc <= 2 ? 'amber' : 'serious',
    unc ? `${unc} of ${ws.assumptions.length} assumption(s) unconfirmed.` : `${ws.assumptions.length} assumption(s) confirmed.`, 9);
  return gates;
}

export const overallRag = (gates: Gate[]): Rag => gates.reduce<Rag>((w, g) => (ragRank(g.rag) > ragRank(w) ? g.rag : w), 'green');

/** summary@V2 — always the whole factory (all active FPDs), never the filtered view. */
export function buildSummary(ws: Workspace, integ: IntegrityReport) {
  const m = integ.factory;
  const gates = computeGates(ws, m, integ);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    schema: SUMMARY_SCHEMA,
    source: { app: APP_NAME, version: APP_VERSION, kind: 'static-build', workspaceSchema: ws.schema },
    exportedAt: new Date().toISOString(),
    locale: 'en-GB',
    factory: { id: ws.meta.factoryId, name: ws.meta.factoryName, workspace: ws.meta.name, floorAreaM2: ws.settings.envelope.lengthM * ws.settings.envelope.widthM },
    basis: {
      buildNumber: ws.settings.learning.selectedBuild,
      learningFactor: r3(m.lc),
      demandCase: ws.settings.programme.demandCase,
      annualDemand: m.demandActive,
      shiftsPerDay: ws.settings.calendar.shiftsPerDay,
      hoursPerShift: ws.settings.calendar.hoursPerShift,
      workingDaysPerYear: ws.settings.calendar.workingDaysPerYear,
      activeTimeFactorPct: ws.settings.calendar.activeTimeFactorPct,
      labourEfficiencyPct: ws.settings.calendar.labourEfficiencyPct,
      wastePct: r3(m.wastePct),
      currency: 'GBP',
    },
    kpis: {
      activeFpds: m.fpds.length,
      totalFpds: ws.fpds.length,
      workBlocks: m.totals.workBlocks,
      activities: m.totals.activities,
      criticalPathMonths: r3(m.durationMonths),
      criticalPathWorkingDays: r1(m.durationDays),
      criticalPathElapsedHours: r1(m.cpm.durationHrs),
      baselineOperationalMonthsTarget: ws.settings.programme.baselineOpMonths,
      baselineOperationalMonthsModelled: r3(m.durationMonths / m.lc),
      productionWindowNominalMonths: r3(m.windowNominal),
      productionWindowPeakMonths: r3(m.windowPeak),
      windowUtilisationPct: r1(m.windowRatio * 100),
      drumbeatMonths: ws.settings.programme.drumbeatMonths,
      concurrentBuildsInWip: m.concurrentBuilds,
      labourHoursPerBuild: r1(m.totals.labourHrs),
      labourCostPerBuildGbp: Math.round(m.totals.labourCost),
      valueAddPct: r1(m.totals.labourHrs ? (m.totals.va / m.totals.labourHrs) * 100 : 0),
      nnvaPct: r1(m.totals.labourHrs ? (m.totals.nnva / m.totals.labourHrs) * 100 : 0),
      nvaPct: r1(m.totals.labourHrs ? (m.totals.nva / m.totals.labourHrs) * 100 : 0),
      peakConcurrentCrew: m.peakCrew,
      liftsPerBuild: m.totals.lifts,
      liftOps: m.lifts.length,
      heavyLifts: m.lifts.filter((l) => l.heavy).length,
      redLifts: m.lifts.filter((l) => l.rag === 'red').length,
      spatialConflicts: m.conflicts.length,
      scheduleRag: m.scheduleRag,
    },
    cells: ws.cells.map((c) => {
      const load = m.cells.find((x) => x.cellId === c.id)!;
      return { cellId: c.id, number: c.number, name: c.name, crewPerShift: c.crewPerShift, labourHoursPerBuild: r1(load.labourHrs), utilisationPct: load.utilPct == null ? null : r1(load.utilPct), lifts: load.lifts, rag: load.rag };
    }),
    fpds: m.fpdRoll.map((f) => ({
      fpdCode: f.fpd.fpdCode, title: f.fpd.title, revision: f.fpd.revision, bomRef: f.fpd.subAssemblyBomRef, cellId: f.fpd.assignedCellId,
      workBlocks: f.rows, labourHoursPerBuild: r1(f.labourHrs), spanElapsedHours: r1(f.spanHrs), lifts: f.lifts, criticalOps: f.criticalOps,
    })),
    resources: m.resources.filter((r) => r.opCount > 0).map((r) => ({
      name: r.resource.name, kind: r.resource.kind, qty: r.resource.qty, dwellMode: r.resource.dwellMode, busyHoursPerBuild: r1(r.busyHrs),
      dutyCyclePct: r1(r.dutyPct), conflicts: r.conflicts, suggestedQty: r.requiredQty, rag: r.rag, mitigation: ws.mitigations[r.resource.id] ?? '',
    })),
    criticalPath: m.cpm.criticalOps,
    integrity: { passed: integ.passed, total: integ.checks.length, checks: integ.checks.map((c) => ({ n: c.n, title: c.title, pass: c.pass })) },
    gates: gates.map((g) => ({ id: g.id, title: g.title, rag: g.rag, detail: g.detail, signoff: ws.gateSignoffs[g.id] ?? null })),
    overallRag: overallRag(gates),
  };
}
