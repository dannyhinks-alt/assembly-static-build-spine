// Route-to-Green: specific actions that would clear each non-Green governance gate.
import type { Workspace } from '../../types';
import { controlDocMissing, rpnOf, type Gate } from './releaseGates';
import type { IntegrityReport } from '../integrity';
import type { Model } from '../model';

export interface GreenStep { gate: number; tab: number; text: string }

/** Generates schedule-gate actions: days to cut and which critical ops to target. */
function resolveScheduleRoute(ws: Workspace, m: Model, gates: Gate[]): GreenStep[] {
  if (gates[1].rag === 'green' || !m.rows.length) return [];
  const hpd = m.cal.hoursPerDay || 1;
  const target = m.windowActive * 0.95;
  const cutDays = ((m.durationMonths - target) * m.cal.hoursPerMonth) / hpd;
  const criticalNodes = [...m.cpm.nodes.values()].filter((n) => n.critical).sort((a, b) => b.dur - a.dur).slice(0, 3);
  const steps: GreenStep[] = [{
    gate: 2, tab: gates[1].tab,
    text: `Remove ${cutDays.toFixed(1)} working days from the critical path to reach ${target.toFixed(1)} months (95% of the window). The three longest critical operations are ${criticalNodes.map((n) => `${n.opId} (${(n.dur / hpd).toFixed(1)} d)`).join(', ')}.`,
  }];
  const stab = ws.settings.learning.stabilisedPct / 100;
  if (m.lc > stab && (m.durationMonths / m.lc) * stab <= target) {
    steps.push({ gate: 2, tab: gates[1].tab, text: `No method change is needed at maturity: at the stabilised ${(stab * 100).toFixed(0)}% learning factor the same path is ${((m.durationMonths / m.lc) * stab).toFixed(1)} months. Plan Build #${ws.settings.learning.selectedBuild} cover rather than capital.` });
  }
  return steps;
}

/** Generates lift-gate actions for each Red or near-capacity lift. */
function resolveLiftRoute(ws: Workspace, m: Model, gates: Gate[]): GreenStep[] {
  return m.lifts
    .filter((lift) => lift.rag === 'red' || (lift.utilPct != null && lift.utilPct > 90))
    .map((lift) => {
      let text: string;
      if (lift.missingWeight) {
        text = `${lift.opId}: link a component with a weight so the SWL check can run.`;
      } else if (lift.utilPct != null && lift.utilPct > 100) {
        text = `${lift.opId}: load ${Math.round(lift.loadKg!)} kg exceeds ${Math.round(lift.capacityKg)} kg (${lift.capacitySource}). Use lifting equipment rated above ${Math.ceil(lift.loadKg! / 0.9 / 50) * 50} kg or split the lift.`;
      } else if (lift.hookBreach) {
        const lowerRigging = ws.resources.filter((r) => r.kind === 'rigging' && r.headroomM != null && r.swlKg != null && lift.loadKg != null && r.swlKg >= lift.loadKg && lift.headroomM - r.headroomM! >= -lift.hookMarginM - 1e-9).sort((a, b) => b.headroomM! - a.headroomM!)[0];
        text = `${lift.opId}: required hook height ${lift.requiredHookM.toFixed(2)} m exceeds ${lift.availableHookM.toFixed(2)} m by ${(-lift.hookMarginM).toFixed(2)} m. ${lowerRigging ? `Re-rig with ${lowerRigging.name} (${lowerRigging.headroomM!.toFixed(1)} m headroom) to clear it` : 'No registered rigging saves enough headroom — land one level lower, source lower-headroom gear, or use a crane with more hook height'}.`;
      } else {
        text = `${lift.opId}: ${lift.utilPct!.toFixed(0)}% of ${lift.capacitySource}. Confirm weighed mass or move to equipment rated above ${Math.ceil(lift.loadKg! / 0.9 / 50) * 50} kg to drop below 90%.`;
      }
      return { gate: 3, tab: gates[2].tab, text };
    });
}

/**
 * Purpose: Derives the specific corrective actions that would clear each non-Green
 *   gate, ordered by gate and severity.  Used to populate the Route-to-Green section
 *   in the Executive Summary and summary@V2 export.
 *
 * Inputs:
 *   @param ws    — workspace (settings, PFMEA, hold points, assumptions, resources)
 *   @param m     — built Model for the current scope
 *   @param integ — integrity-check report
 *   @param gates — computed Gate[] from computeGates
 *
 * Downstream impact: drives Tab 9 Route-to-Green card and summary@V2 routeToGreen array.
 *
 * @returns GreenStep[] — ordered actions, most direct first
 */
export function routeToGreen(ws: Workspace, m: Model, integ: IntegrityReport, gates: Gate[]): GreenStep[] {
  const out: GreenStep[] = [];
  const t = ws.settings.thresholds;
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const add = (gate: number, text: string) => out.push({ gate, tab: gates[gate - 1].tab, text });
  if (gates[0].rag !== 'green') {
    for (const c of integ.checks.filter((x) => !x.pass && x.key !== 'assumptions')) add(1, `Integrity check ${c.n} — ${c.detail}`);
  }
  out.push(...resolveScheduleRoute(ws, m, gates));
  out.push(...resolveLiftRoute(ws, m, gates));
  for (const r of m.resources.filter((x) => x.opCount > 0 && x.dutyPct > t.dutyAmberPct).sort((a, b) => b.dutyPct - a.dutyPct)) {
    const need = Math.ceil((r.shiftsUsed / Math.max(1, r.programmeShifts / Math.max(1, r.resource.qty))) / (t.dutyAmberPct / 100) - 1e-9);
    add(4, `${r.resource.name}: duty ${r.dutyPct.toFixed(0)}% (${r.shiftsUsed.toFixed(0)} of ${r.programmeShifts.toFixed(0)} programme shifts). ${r.resource.dwellMode === 'Full-Build' ? `Provide ${need} unit(s) or release it earlier` : `Provide ${need} unit(s) or move tagged work onto an alternative`} to get below ${t.dutyAmberPct}%.`);
  }
  for (const c of m.conflicts) {
    add(4, c.resolvable ? `${c.resourceName}: delay ${c.shiftOp} by ${c.shiftHrs.toFixed(1)} h (inside its float) to clear the overlap between ${c.a.opId} and ${c.b.opId}.` : `${c.resourceName}: ${c.a.opId} and ${c.b.opId} overlap for ${c.overlapHrs.toFixed(0)} h with no float — ${c.hard ? 'add a unit or re-sequence' : 'book crane slots inside the two operations'}.`);
  }
  for (const clash of m.space.clashes) {
    const zoneName = ws.zones.find((x) => x.id === clash.zoneId)?.name ?? 'zone';
    add(4, clash.kind === 'congestion'
      ? `${zoneName}: ${clash.crew} crew on one work face against a limit of ${clash.cap}. ${clash.resolvable ? `Delay ${clash.shiftOp} by ${clash.shiftHrs.toFixed(1)} h` : 'Stagger the parallel operations or raise the zone limit'}.`
      : `${zoneName}: ${clash.ops[0]} lifts while ${clash.ops[1]} is working ${clash.kind === 'lift-vertical' ? 'on another level' : 'on the same level'}. ${clash.resolvable ? `Delay ${clash.shiftOp} by ${clash.shiftHrs.toFixed(1)} h` : 'Plan exclusion windows for each lift'}.`);
  }
  const openPfmea = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  for (const p of openPfmea.filter((x) => rpnOf(x) >= t.rpnAmber).sort((a, b) => rpnOf(b) - rpnOf(a))) {
    const od = Math.floor((t.rpnAmber - 1) / p.s);
    add(5, `${p.opId || 'Factory-wide'} "${p.failureMode.slice(0, 60)}": RPN ${rpnOf(p)}. With Severity ${p.s} fixed, O × D must fall from ${p.o * p.d} to ${od} or less${p.recommendedAction ? ` — action: ${p.recommendedAction}` : ''}`);
  }
  const noDoc = openPfmea.filter((p) => controlDocMissing(p, ws.settings));
  if (noDoc.length) add(5, `Enter the control document reference for ${noDoc.length} failure mode(s): ${noDoc.map((p) => p.opId || '—').join(', ')}.`);
  const pendingHolds = ws.holdPoints.filter((h) => (!h.fpdId || inScope.has(h.fpdId)) && h.status !== 'Released');
  if (pendingHolds.length) add(6, `Release ${pendingHolds.length} hold point(s) with signed records: ${pendingHolds.map((h) => `${h.opId} (${h.status.toLowerCase()})`).join(', ')}.`);
  for (const a of ws.assumptions.filter((x) => !x.confirmed)) add(7, `Confirm with ${a.owner || 'the owner'}: ${a.text}`);
  return out;
}
