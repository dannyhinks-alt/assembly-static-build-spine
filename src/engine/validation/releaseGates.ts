// Governance gate computations — PFMEA risk helpers and the seven release gate evaluations.
import type { GuideId } from '../../data/guides';
import { ragRank, worstRag } from '../../lib/format';
import type { PfmeaItem, Rag, Settings, Workspace } from '../../types';
import type { IntegrityReport } from '../integrity';
import type { Model } from '../model';

export interface Gate {
  id: string; n: number; title: string; guide: GuideId; rag: Rag; detail: string; tab: number;
}

export const rpnOf = (p: PfmeaItem): number => p.s * p.o * p.d;

/**
 * Purpose: Derives the RAG for a PFMEA Risk Priority Number against the configured thresholds.
 *
 * Formula: red ≥ rpnRed | serious ≥ rpnSerious | amber ≥ rpnAmber | green < rpnAmber
 *
 * @returns Rag
 */
export function rpnRag(rpn: number, s: Settings): Rag {
  const t = s.thresholds;
  return rpn >= t.rpnRed ? 'red' : rpn >= t.rpnSerious ? 'serious' : rpn >= t.rpnAmber ? 'amber' : 'green';
}

/** Returns true when a control document is required for this PFMEA item (high severity or RPN, or manually forced). */
export const controlDocRequired = (p: PfmeaItem, s: Settings): boolean =>
  p.controlDocForced || p.s >= s.thresholds.blindSpotSeverity || rpnOf(p) >= s.thresholds.rpnSerious;

/** Returns true when a required control document has not been entered and the item is not closed. */
export const controlDocMissing = (p: PfmeaItem, s: Settings): boolean =>
  p.status !== 'Closed' && controlDocRequired(p, s) && !p.controlDocRef.trim();

/** Returns true for a high-severity item that RPN-based sorting would miss (severity high, RPN green). */
export const isBlindSpot = (p: PfmeaItem, s: Settings): boolean =>
  p.status !== 'Closed' && p.s >= s.thresholds.blindSpotSeverity && rpnRag(rpnOf(p), s) === 'green';

/** Returns the overall RAG across all gates (worst of the set). */
export const overallRag = (gates: Gate[]): Rag =>
  gates.reduce<Rag>((worst, g) => (ragRank(g.rag) > ragRank(worst) ? g.rag : worst), 'green');

/**
 * Purpose: Evaluates all seven governance gates for the current scope and returns
 *   a Gate record for each with its RAG and human-readable detail text.
 *
 * Inputs:
 *   @param ws    — workspace (settings, PFMEA, hold points, assumptions)
 *   @param m     — built Model for the current scope
 *   @param integ — integrity-check report (factory-wide)
 *
 * Downstream impact: drives Tab 9 Executive gate dashboard and summary@V2 export.
 *
 * @returns Gate[] — ordered G1 … G7
 */
export function computeGates(ws: Workspace, m: Model, integ: IntegrityReport): Gate[] {
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const gates: Gate[] = [];
  const add = (title: string, guide: GuideId, rag: Rag, detail: string, tab: number) =>
    gates.push({ id: `G${gates.length + 1}`, n: gates.length + 1, title, guide, rag, detail, tab });

  const coreChecks = integ.checks.filter((c) => c.key !== 'assumptions');
  const failedChecks = coreChecks.filter((c) => !c.pass);
  add('Model Integrity', 'gate1', failedChecks.length ? 'red' : 'green',
    failedChecks.length
      ? `${failedChecks.length} of 9 structural checks failing: ${failedChecks.map((c) => `#${c.n}`).join(', ')}.`
      : 'Structural checks 1–9 all pass (factory-wide).', 1);

  add('Schedule vs Production Window', 'gate2', m.rows.length ? m.scheduleRag : 'amber',
    m.rows.length
      ? `Critical path ${m.durationMonths.toFixed(1)} months = ${(m.windowRatio * 100).toFixed(0)}% of the ${m.windowActive.toFixed(1)}-month window; drumbeat ${ws.settings.programme.drumbeatMonths.toFixed(1)} months.`
      : 'No Baseline work blocks in the current filter.', 6);

  const redLifts = m.lifts.filter((l) => l.rag === 'red');
  const seriousLifts = m.lifts.filter((l) => l.rag === 'serious');
  add('Lift & Crane Safety', 'gate3', worstRag(m.lifts.map((l) => l.rag)),
    redLifts.length
      ? `${redLifts.length} Red lift(s): ${redLifts.map((l) => `${l.opId} (${l.missingWeight ? 'no weight' : l.hookBreach ? 'hook-height breach' : 'over capacity'})`).join(', ')}.`
      : seriousLifts.length ? `${seriousLifts.length} Serious lift(s) (3+ risk flags or > 90% SWL); none Red.`
      : `${m.lifts.length} lift op(s) within capacity and hook envelope.`, 4);

  const usedResources = m.resources.filter((r) => r.opCount > 0);
  const hardUnresolvable = m.conflicts.filter((c) => c.hard && !c.resolvable);
  let resRag = worstRag(usedResources.map((r) => r.rag));
  if (hardUnresolvable.length) resRag = 'red';
  const unresolvableClashes = m.space.clashes.filter((c) => !c.resolvable);
  resRag = worstRag([resRag, ...unresolvableClashes.map((c) => c.rag), ...(m.space.clashes.length ? (['amber'] as Rag[]) : [])]);
  const topResource = [...usedResources].sort((a, b) => b.dutyPct - a.dutyPct)[0];
  add('Resource Capacity & Spatial Conflicts', 'gate4', resRag,
    `${topResource ? `Highest duty: ${topResource.resource.name} at ${topResource.dutyPct.toFixed(0)}%. ` : ''}${m.conflicts.length} resource concurrency conflict(s)${hardUnresolvable.length ? ` (${hardUnresolvable.length} hard, not resolvable within float)` : ''}; ${m.space.clashes.length} spatial clash(es)${unresolvableClashes.length ? ` (${unresolvableClashes.length} not resolvable within float)` : ''}.`, 8);

  const openPfmea = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  const worstRpn = openPfmea.reduce((mx, p) => Math.max(mx, rpnOf(p)), 0);
  const missingDocs = openPfmea.filter((p) => controlDocMissing(p, ws.settings)).length;
  const blindSpotCount = openPfmea.filter((p) => isBlindSpot(p, ws.settings)).length;
  add('PFMEA Risk', 'gate5', worstRag([rpnRag(worstRpn, ws.settings), missingDocs ? 'amber' : 'green']),
    openPfmea.length ? `${openPfmea.length} open item(s); highest open RPN ${worstRpn}; ${missingDocs} required control document(s) missing; ${blindSpotCount} high-severity blind spot(s).`
    : 'No open PFMEA items in the current filter.', 5);

  const holdPoints = ws.holdPoints.filter((h) => !h.fpdId || inScope.has(h.fpdId));
  const rejectedHolds = holdPoints.filter((h) => h.status === 'Rejected').length;
  const plannedHolds = holdPoints.filter((h) => h.status === 'Planned').length;
  add('Quality Hold Points', 'gate6', rejectedHolds ? 'red' : plannedHolds ? 'amber' : 'green',
    holdPoints.length ? `${holdPoints.length} hold point(s): ${holdPoints.length - rejectedHolds - plannedHolds} released, ${plannedHolds} planned, ${rejectedHolds} rejected.`
    : 'No hold points defined for the current filter.', 5);

  const unconfirmedAssumptions = ws.assumptions.filter((a) => !a.confirmed).length;
  add('Assumptions', 'gate7', unconfirmedAssumptions === 0 ? 'green' : unconfirmedAssumptions <= 2 ? 'amber' : 'serious',
    unconfirmedAssumptions ? `${unconfirmedAssumptions} of ${ws.assumptions.length} assumption(s) unconfirmed.`
    : `${ws.assumptions.length} assumption(s) confirmed.`, 1);
  return gates;
}
