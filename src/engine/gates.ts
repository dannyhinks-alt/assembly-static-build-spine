// Release gates and the summary@V2 roll-up exported to Multi-Factory Master Control Hub.
import type { GuideId } from '../data/guides';
import { ragRank, worstRag } from '../lib/format';
import type { PfmeaItem, Rag, Settings, Workspace } from '../types';
import { APP_NAME, APP_VERSION, SUMMARY_SCHEMA, complexityOf } from '../types';
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

/** A control document is required for high-severity or high-RPN failure modes, or when forced manually. */
export const controlDocRequired = (p: PfmeaItem, s: Settings): boolean =>
  p.controlDocForced || p.s >= s.thresholds.blindSpotSeverity || rpnOf(p) >= s.thresholds.rpnSerious;
export const controlDocMissing = (p: PfmeaItem, s: Settings): boolean =>
  p.status !== 'Closed' && controlDocRequired(p, s) && !p.controlDocRef.trim();
/** High severity hidden behind a Green RPN — the item an RPN-sorted review would skip. */
export const isBlindSpot = (p: PfmeaItem, s: Settings): boolean =>
  p.status !== 'Closed' && p.s >= s.thresholds.blindSpotSeverity && rpnRag(rpnOf(p), s) === 'green';

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
      : 'No work blocks in the current filter.', 6);

  const redLifts = m.lifts.filter((l) => l.rag === 'red');
  const serLifts = m.lifts.filter((l) => l.rag === 'serious');
  add('Lift & Crane Safety', 'gate3', worstRag(m.lifts.map((l) => l.rag)),
    redLifts.length
      ? `${redLifts.length} Red lift(s): ${redLifts.map((l) => `${l.opId} (${l.missingWeight ? 'no weight' : l.hookBreach ? 'hook-height breach' : 'over capacity'})`).join(', ')}.`
      : serLifts.length ? `${serLifts.length} Serious lift(s) (3+ risk flags or > 90% SWL); none Red.` : `${m.lifts.length} lift op(s) within capacity and hook envelope.`, 4);

  const used = m.resources.filter((r) => r.opCount > 0);
  const hardUnres = m.conflicts.filter((c) => c.hard && !c.resolvable);
  let resRag = worstRag(used.map((r) => r.rag));
  if (hardUnres.length) resRag = 'red';
  const clashUnres = m.space.clashes.filter((c) => !c.resolvable);
  resRag = worstRag([resRag, ...clashUnres.map((c) => c.rag), ...(m.space.clashes.length ? (['amber'] as Rag[]) : [])]);
  const top = [...used].sort((a, b) => b.dutyPct - a.dutyPct)[0];
  add('Resource Capacity & Spatial Conflicts', 'gate4', resRag,
    `${top ? `Highest duty: ${top.resource.name} at ${top.dutyPct.toFixed(0)}%. ` : ''}${m.conflicts.length} resource concurrency conflict(s)${hardUnres.length ? ` (${hardUnres.length} hard, not resolvable within float)` : ''}; ${m.space.clashes.length} spatial clash(es)${clashUnres.length ? ` (${clashUnres.length} not resolvable within float)` : ''}.`, 8);

  const open = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  const worst = open.reduce((mx, p) => Math.max(mx, rpnOf(p)), 0);
  const noDoc = open.filter((p) => controlDocMissing(p, ws.settings)).length;
  const blind = open.filter((p) => isBlindSpot(p, ws.settings)).length;
  add('PFMEA Risk', 'gate5', worstRag([rpnRag(worst, ws.settings), noDoc ? 'amber' : 'green']),
    open.length ? `${open.length} open item(s); highest open RPN ${worst}; ${noDoc} required control document(s) missing; ${blind} high-severity blind spot(s).` : 'No open PFMEA items in the current filter.', 5);

  const hps = ws.holdPoints.filter((h) => !h.fpdId || inScope.has(h.fpdId));
  const rej = hps.filter((h) => h.status === 'Rejected').length;
  const planned = hps.filter((h) => h.status === 'Planned').length;
  add('Quality Hold Points', 'gate6', rej ? 'red' : planned ? 'amber' : 'green',
    hps.length ? `${hps.length} hold point(s): ${hps.length - rej - planned} released, ${planned} planned, ${rej} rejected.` : 'No hold points defined for the current filter.', 5);

  const unc = ws.assumptions.filter((a) => !a.confirmed).length;
  add('Assumptions', 'gate7', unc === 0 ? 'green' : unc <= 2 ? 'amber' : 'serious',
    unc ? `${unc} of ${ws.assumptions.length} assumption(s) unconfirmed.` : `${ws.assumptions.length} assumption(s) confirmed.`, 1);
  return gates;
}

export const overallRag = (gates: Gate[]): Rag => gates.reduce<Rag>((w, g) => (ragRank(g.rag) > ragRank(w) ? g.rag : w), 'green');

export interface GreenStep { gate: number; tab: number; text: string }

/** Route to Green: the specific actions that would clear each non-Green gate, most direct first. */
export function routeToGreen(ws: Workspace, m: Model, integ: IntegrityReport, gates: Gate[]): GreenStep[] {
  const out: GreenStep[] = [];
  const t = ws.settings.thresholds;
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const add = (gate: number, text: string) => out.push({ gate, tab: gates[gate - 1].tab, text });
  const hpd = m.cal.hoursPerDay || 1;
  const rag = (n: number) => gates[n - 1].rag;

  if (rag(1) !== 'green') for (const c of integ.checks.filter((x) => !x.pass && x.key !== 'assumptions')) add(1, `Integrity check ${c.n} — ${c.detail}`);

  if (rag(2) !== 'green' && m.rows.length) {
    const target = m.windowActive * 0.95;
    const cutDays = ((m.durationMonths - target) * m.cal.hoursPerMonth) / hpd;
    const crit = [...m.cpm.nodes.values()].filter((n) => n.critical).sort((a, b) => b.dur - a.dur).slice(0, 3);
    add(2, `Remove ${cutDays.toFixed(1)} working days from the critical path to reach ${target.toFixed(1)} months (95% of the window). The three longest critical operations are ${crit.map((n) => `${n.opId} (${(n.dur / hpd).toFixed(1)} d)`).join(', ')}.`);
    const lcNow = m.lc;
    const stab = ws.settings.learning.stabilisedPct / 100;
    if (lcNow > stab && (m.durationMonths / lcNow) * stab <= target) add(2, `No method change is needed at maturity: at the stabilised ${(stab * 100).toFixed(0)}% learning factor the same path is ${((m.durationMonths / lcNow) * stab).toFixed(1)} months. Plan Build #${ws.settings.learning.selectedBuild} cover (overtime or a third shift on critical ops) rather than capital.`);
  }

  for (const l of m.lifts.filter((x) => x.rag === 'red' || (x.utilPct != null && x.utilPct > 90))) {
    if (l.missingWeight) add(3, `${l.opId}: link a component with a weight so the SWL check can run.`);
    else if (l.utilPct != null && l.utilPct > 100) add(3, `${l.opId}: load ${Math.round(l.loadKg!)} kg exceeds ${Math.round(l.capacityKg)} kg (${l.capacitySource}). Use lifting equipment rated above ${Math.ceil(l.loadKg! / 0.9 / 50) * 50} kg or split the lift.`);
    else if (l.hookBreach) {
      const low = ws.resources.filter((r) => r.kind === 'rigging' && r.headroomM != null && r.swlKg != null && l.loadKg != null && r.swlKg >= l.loadKg && l.headroomM - r.headroomM! >= -l.hookMarginM - 1e-9)
        .sort((a, b) => b.headroomM! - a.headroomM!)[0];
      add(3, `${l.opId}: required hook height ${l.requiredHookM.toFixed(2)} m exceeds ${l.availableHookM.toFixed(2)} m by ${(-l.hookMarginM).toFixed(2)} m. ${low ? `Re-rig with ${low.name} (${low.headroomM!.toFixed(1)} m headroom) to clear it` : `No registered rigging rated for ${Math.round(l.loadKg ?? 0)} kg saves enough headroom — land one level lower, source lower-headroom gear, or use a crane with more hook height`}.`);
    } else add(3, `${l.opId}: ${l.utilPct!.toFixed(0)}% of ${l.capacitySource}. Confirm weighed mass before the lift, or move it to equipment rated above ${Math.ceil(l.loadKg! / 0.9 / 50) * 50} kg to drop below 90%.`);
  }

  for (const r of m.resources.filter((x) => x.opCount > 0 && x.dutyPct > t.dutyAmberPct).sort((a, b) => b.dutyPct - a.dutyPct)) {
    const need = Math.ceil((r.shiftsUsed / Math.max(1, r.programmeShifts / Math.max(1, r.resource.qty))) / (t.dutyAmberPct / 100) - 1e-9);
    add(4, `${r.resource.name}: duty ${r.dutyPct.toFixed(0)}% (${r.shiftsUsed.toFixed(0)} of ${r.programmeShifts.toFixed(0)} programme shifts). ${r.resource.dwellMode === 'Full-Build' ? `It is locked for the whole build; provide ${need} unit(s) or release it earlier by moving late operations off it` : `Provide ${need} unit(s) or move tagged work onto an alternative`} to get below ${t.dutyAmberPct}%.`);
  }
  for (const c of m.conflicts) add(4, c.resolvable ? `${c.resourceName}: delay ${c.shiftOp} by ${c.shiftHrs.toFixed(1)} h (inside its float) to clear the overlap between ${c.a.opId} and ${c.b.opId}.` : `${c.resourceName}: ${c.a.opId} and ${c.b.opId} overlap for ${c.overlapHrs.toFixed(0)} h with no float to absorb it — ${c.hard ? 'add a unit or re-sequence' : 'book crane slots inside the two operations'}.`);
  for (const c of m.space.clashes) {
    const z = ws.zones.find((x) => x.id === c.zoneId)?.name ?? 'zone';
    add(4, c.kind === 'congestion'
      ? `${z}: ${c.crew} crew on one work face against a limit of ${c.cap}. ${c.resolvable ? `Delay ${c.shiftOp} by ${c.shiftHrs.toFixed(1)} h` : 'Stagger the parallel operations or raise the zone limit after a risk assessment'}.`
      : `${z}: ${c.ops[0]} lifts while ${c.ops[1]} is working ${c.kind === 'lift-vertical' ? 'on another level' : 'on the same level'}. ${c.resolvable ? `Delay ${c.shiftOp} by ${c.shiftHrs.toFixed(1)} h` : 'Plan exclusion windows for each lift inside the overlapping operations'}.`);
  }

  const open = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  for (const p of open.filter((x) => rpnOf(x) >= t.rpnAmber).sort((a, b) => rpnOf(b) - rpnOf(a))) {
    const od = Math.floor((t.rpnAmber - 1) / p.s);
    add(5, `${p.opId || 'Factory-wide'} "${p.failureMode.slice(0, 60)}": RPN ${rpnOf(p)}. With Severity ${p.s} fixed, Occurrence × Detection must fall from ${p.o * p.d} to ${od} or less to reach Green${p.recommendedAction ? ` — action: ${p.recommendedAction}` : ''}`);
  }
  const noDoc = open.filter((p) => controlDocMissing(p, ws.settings));
  if (noDoc.length) add(5, `Enter the control document reference for ${noDoc.length} failure mode(s): ${noDoc.map((p) => p.opId || '—').join(', ')}.`);

  const hps = ws.holdPoints.filter((h) => (!h.fpdId || inScope.has(h.fpdId)) && h.status !== 'Released');
  if (hps.length) add(6, `Release ${hps.length} hold point(s) with signed records: ${hps.map((h) => `${h.opId} (${h.status.toLowerCase()})`).join(', ')}.`);

  for (const a of ws.assumptions.filter((x) => !x.confirmed)) add(7, `Confirm with ${a.owner || 'the owner'}: ${a.text}`);
  return out;
}

/** summary@V2 — always the whole factory (all active FPDs), never the filtered view. */
export function buildSummary(ws: Workspace, integ: IntegrityReport) {
  const m = integ.factory;
  const gates = computeGates(ws, m, integ);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const open = ws.pfmea.filter((p) => p.status !== 'Closed');
  const band = (r: Rag) => open.filter((p) => rpnRag(rpnOf(p), ws.settings) === r).length;
  const fid = ws.meta.factoryId || 'F4';
  return {
    schema: SUMMARY_SCHEMA,
    source: { app: APP_NAME, version: APP_VERSION, kind: 'static-build', workspaceSchema: ws.schema },
    exportedAt: new Date().toISOString(),
    locale: 'en-GB',
    factory: {
      id: fid,
      name: ws.meta.factoryName,
      workspace: ws.meta.name,
      floorAreaM2: ws.settings.envelope.lengthM * ws.settings.envelope.widthM,
      cells: [...ws.cells].sort((a, b) => a.number - b.number).map((c) => {
        const load = m.cells.find((x) => x.cellId === c.id)!;
        const mine = m.fpdRoll.filter((f) => f.fpd.assignedCellId === c.id);
        const zoneIds = new Set(ws.zones.filter((z) => z.cellId === c.id).map((z) => z.id));
        const lifts = m.lifts.filter((l) => zoneIds.has(l.zoneId));
        return {
          cellId: `${fid}-C${c.number}`, number: c.number, name: c.name, crewPerShift: c.crewPerShift,
          zones: ws.zones.filter((z) => z.cellId === c.id).map((z) => z.name),
          fpds: mine.map((f) => f.fpd.fpdCode), workBlocks: mine.reduce((a, f) => a + f.rows, 0),
          labourHoursPerBuild: r1(load.labourHrs), utilisationPct: load.utilPct == null ? null : r1(load.utilPct),
          lifts: load.lifts, heavyLiftOps: lifts.filter((l) => l.heavy).length, redLiftOps: lifts.filter((l) => l.rag === 'red').length,
          spatialClashes: m.space.clashes.filter((x) => x.cellId === c.id).length, rag: load.rag,
        };
      }),
    },
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
      machineLockedLabourOps: m.totals.arRedCount,
      peakConcurrentCrew: m.peakCrew,
      scheduleRag: m.scheduleRag,
    },
    lifts: {
      totalLifts: m.totals.lifts,
      liftOps: m.lifts.length,
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
      totalMoves: m.totals.moves,
      interCellMoves: m.space.interCellMoves,
      intraCellMoves: m.space.intraCellMoves,
      spaghettiCurrentM: Math.round(m.space.spaghettiM),
      spaghettiFutureM: Math.round(m.space.spaghettiFutureM),
      spaghettiSavingPct: r1(m.space.spaghettiM ? (1 - m.space.spaghettiFutureM / m.space.spaghettiM) * 100 : 0),
      spatialClashes: m.space.clashes.length,
      resourceConcurrencyConflicts: m.conflicts.length,
    },
    pfmea: {
      openItems: open.length, highestOpenRpn: open.reduce((a, p) => Math.max(a, rpnOf(p)), 0),
      red: band('red'), serious: band('serious'), amber: band('amber'), green: band('green'),
      highSeverityOpen: open.filter((p) => p.s >= ws.settings.thresholds.blindSpotSeverity).length,
      blindSpots: open.filter((p) => isBlindSpot(p, ws.settings)).length,
      controlDocsMissing: open.filter((p) => controlDocMissing(p, ws.settings)).length,
    },
    fpds: m.fpdRoll.map((f) => ({
      fpdCode: f.fpd.fpdCode, title: f.fpd.title, revision: f.fpd.revision, bomRef: f.fpd.subAssemblyBomRef,
      cellId: `${fid}-C${ws.cells.find((c) => c.id === f.fpd.assignedCellId)?.number ?? '?'}`,
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
