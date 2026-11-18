// Excel export — round-trippable workbook and dedicated BOP+PFMEA export.
import type * as XlsxNs from 'xlsx';
import type { Model } from '../engine/model';
import { leavesOf } from '../engine/model';
import type { Row } from './excelHelpers';
import type { Workspace } from '../types';
import { FLOOR_LEVELS, RESOURCE_KINDS, complexityOf } from '../types';

type XlsxLib = typeof XlsxNs;

function makeSheetHelper(XLSX: XlsxLib, wb: ReturnType<typeof XLSX.utils.book_new>) {
  return (name: string, rows: Row[], widths: number[]) => {
    const sh = XLSX.utils.json_to_sheet(rows);
    sh['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, sh, name);
  };
}

function bopLeafRow(ws: Workspace, r: ReturnType<typeof leavesOf>[number], isChild: boolean, parentOpId: string, names: (ids: string[]) => string): Row {
  return {
    'FPD Code': ws.fpds.find((f) => f.fpdId === r.fpdId)?.fpdCode ?? '',
    'Op #': r.opId, 'Baseline Work Block': isChild ? parentOpId : '',
    Description: r.description, 'Task Type': r.taskType, Predecessors: r.predecessors.join(', '),
    'Origin Zone': ws.zones.find((z) => z.id === r.originZoneId)?.name ?? '',
    'Destination Zone': ws.zones.find((z) => z.id === r.destZoneId)?.name ?? '',
    'Floor Level': FLOOR_LEVELS[r.floorLevel] ?? 'Ground',
    Components: r.componentIds.map((i) => ws.components.find((c) => c.id === i)?.bomRef ?? '').filter(Boolean).join('; '),
    'Crew Size': r.crewSize, 'Run Time (hrs)': r.runHrs, 'Touch Time (hrs)': r.touchHrs, 'Manning Time (hrs)': r.manningHrs,
    Classification: r.classification, 'Action Type': r.actionType,
    'Process Rigs': names(r.rigIds), Cranes: names(r.craneIds), Rigging: names(r.riggingIds), Vehicles: names(r.vehicleIds), Stands: names(r.standIds),
    Lifts: r.liftCount, Moves: r.moveCount, Notes: r.notes,
  };
}

/**
 * Purpose: Produce a round-trippable workbook containing FPDs, BOP, Components, Resources, PFMEA and Summary sheets.
 *   The same sheet structure the importer reads.
 *
 * Downstream impact: drives the "Export workbook" button on Tab 2;
 *   required for the template download (template=true slices to 2 rows per sheet).
 *
 * @returns Blob containing an .xlsx file
 */
export async function exportWorkbook(ws: Workspace, m: Model, template = false): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheet = makeSheetHelper(XLSX, wb);
  const names = (ids: string[]) => ids.map((i) => ws.resources.find((r) => r.id === i)?.name ?? '').filter(Boolean).join('; ');
  const cellNo = (id: string) => ws.cells.find((c) => c.id === id)?.number ?? '';
  const take = <T,>(xs: T[]) => (template ? xs.slice(0, 2) : xs);
  sheet('FPDs', take(ws.fpds).map((f) => ({ 'FPD Code': f.fpdCode, Title: f.title, 'Sub-Assembly BOM Ref': f.subAssemblyBomRef, 'Assigned Cell': cellNo(f.assignedCellId), Revision: f.revision, Active: f.active ? 'Y' : 'N' })), [12, 42, 34, 14, 10, 8]);
  const bop: Row[] = [];
  for (const r of take(ws.rows)) for (const l of leavesOf(r)) bop.push(bopLeafRow(ws, l, !!(r.children?.length), r.opId, names));
  sheet('BOP', bop, [10, 10, 11, 52, 11, 16, 26, 26, 11, 40, 9, 12, 13, 15, 13, 16, 30, 30, 30, 26, 30, 6, 6, 40]);
  sheet('Components', take(ws.components).map((c) => ({ 'BOM Ref': c.bomRef, Name: c.name, 'Weight (kg)': c.weightKg ?? '', 'Length (m)': c.lengthM ?? '', 'Width (m)': c.widthM ?? '', 'Height (m)': c.heightM ?? '', 'Qty per Build': c.qtyPerBuild })), [34, 30, 12, 11, 11, 11, 13]);
  sheet('Resources', take(ws.resources).map((r) => ({
    Kind: RESOURCE_KINDS.find((k) => k.kind === r.kind)!.label, Name: r.name, Qty: r.qty, Cell: cellNo(r.cellId), 'SWL (kg)': r.swlKg ?? '', 'Hook Height (m)': r.hookHeightM ?? '',
    'Headroom (m)': r.headroomM ?? '', 'Tare (kg)': r.tareKg ?? '', Tiers: r.tiers ?? '', 'Tier Height (m)': r.tierHeightM ?? '', Complexity: complexityOf(r), 'Cx Technical': r.complexity[0], 'Cx Skill': r.complexity[1], 'Cx Set-Up': r.complexity[2], 'Cx Upkeep': r.complexity[3],
    'Footprint L (m)': r.footprintLM ?? '', 'Footprint W (m)': r.footprintWM ?? '', Utilities: r.utilities.join('; '), 'Dwell Mode': r.dwellMode,
  })), [24, 38, 6, 6, 10, 15, 13, 10, 7, 15, 11, 12, 9, 10, 10, 14, 14, 44, 12]);
  sheet('PFMEA', take(ws.pfmea).map((p) => ({ 'FPD Code': ws.fpds.find((f) => f.fpdId === p.fpdId)?.fpdCode ?? '', 'Op #': p.opId, 'Failure Mode': p.failureMode, Effect: p.effect, Cause: p.cause, Controls: p.controls, S: p.s, O: p.o, D: p.d, RPN: p.s * p.o * p.d, 'Recommended Action': p.recommendedAction, Owner: p.owner, Status: p.status, 'Control Doc Ref': p.controlDocRef, 'Assigned Resources': names(p.resourceIds) })), [10, 10, 40, 40, 40, 40, 4, 4, 4, 6, 44, 24, 12, 28, 40]);
  if (!template) {
    const t = m.totals;
    const kv: [string, string | number][] = [
      ['Workspace', ws.meta.name], ['Exported', new Date().toLocaleString('en-GB')], ['Scope', `${m.fpds.length} of ${ws.fpds.length} FPDs · ${t.workBlocks} Baseline work blocks`],
      ['Build #', ws.settings.learning.selectedBuild], ['Learning factor', +m.lc.toFixed(3)], ['Critical path (months)', +m.durationMonths.toFixed(2)],
      ['Production window — nominal (months)', +m.windowNominal.toFixed(2)], ['Production window — peak (months)', +m.windowPeak.toFixed(2)],
      ['Labour hours per build', +t.labourHrs.toFixed(1)], ['Labour cost per build (£)', Math.round(t.labourCost)], ['VA %', +(t.labourHrs ? (t.va / t.labourHrs) * 100 : 0).toFixed(1)],
      ['Lifts per build', t.lifts], ['Spatial conflicts', m.conflicts.length], ['Peak concurrent crew', m.peakCrew],
    ];
    const sh = XLSX.utils.aoa_to_sheet([['Assembly & Static Build Central Spine v1.0 — Summary'], [], ...kv]);
    sh['!cols'] = [{ wch: 40 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, sh, 'Summary');
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Purpose: Dedicated BOP export with canonical round-trip column order and an inline PFMEA column set.
 *   Produces 'Bill of Process (Summary)' and 'Master BOP & PFMEA Combined' sheets.
 *   Column order is a round-trip contract — do not reorder.
 *
 * Downstream impact: exported file is consumed by Master Hub (summary@V2 workflow) and can be re-imported.
 *
 * @returns Blob containing an .xlsx file
 */
export async function exportBop(ws: Workspace, m: Model): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheet = makeSheetHelper(XLSX, wb);
  const zone = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '';
  const fpdOf = (id: string) => ws.fpds.find((f) => f.fpdId === id);
  const names = (ids: string[]) => ids.map((i) => ws.resources.find((r) => r.id === i)?.name ?? '').filter(Boolean).join('; ');
  const cellName = (id: string) => { const c = ws.cells.find((x) => x.id === id); return c ? `Cell ${c.number} · ${c.name}` : ''; };
  const hpFor = (opId: string) => ws.holdPoints.filter((h) => h.opId === opId).map((h) => h.title).join('; ');
  const bopRows: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const node = m.cpm.nodes.get(r.id); const calc = m.calcs.get(r.id); const f = fpdOf(l.fpdId); const arPct = calc?.arPct;
      bopRows.push({ 'FPD Code': f?.fpdCode ?? '', 'FPD Title': f?.title ?? '', 'Cell Name': cellName(f?.assignedCellId ?? ''), 'Op #': l.opId, 'Baseline Work Block': r.children?.length ? r.opId : '', Description: l.description, 'Task Type': l.taskType, Predecessors: l.predecessors.join(', '), 'Origin Zone': zone(l.originZoneId), 'Destination Zone': zone(l.destZoneId), 'Floor Level': FLOOR_LEVELS[l.floorLevel] ?? 'Ground', 'Component Name / Description': l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.name ?? '').filter(Boolean).join('; '), 'Crew Density': l.crewSize, 'Equipment / Bay Run Time (hrs)': l.runHrs, 'Operator Touch Time (hrs)': l.touchHrs, 'Labour Content (Hours)': l.manningHrs, 'Baseline Hours': l.baselineHrs ?? '', 'Variance (h)': l.baselineHrs != null ? +(l.baselineHrs - l.manningHrs).toFixed(2) : '', 'Attendance Ratio (%)': arPct != null ? +(arPct * 100).toFixed(1) : 'Manual op', 'Operation Action Category': l.classification, 'Specific Action Type': l.actionType, 'L1 Parent Tool': names(l.rigIds), Crane: names(l.craneIds), Rigging: names(l.riggingIds), Vehicles: names(l.vehicleIds), 'L3 Sub-Tool': names(l.standIds), 'Lift Count': l.liftCount, 'Move Count': l.moveCount, 'Schedule Start (h)': node ? +node.es.toFixed(1) : '', 'Schedule Finish (h)': node ? +node.ef.toFixed(1) : '', 'Float (h)': node ? +node.float.toFixed(1) : '', Critical: node?.critical ? 'Y' : 'N', 'Quality Gate Sign-off': hpFor(l.opId), Rationale: l.rationale ?? '', Comments: l.notes });
    }
  }
  sheet('Bill of Process (Summary)', bopRows, [10, 32, 24, 10, 11, 48, 10, 16, 24, 24, 10, 36, 7, 12, 13, 15, 12, 11, 11, 15, 20, 24, 20, 20, 16, 7, 7, 14, 14, 10, 8, 24, 36, 36]);
  const combined: Row[] = [];
  for (const r of ws.rows) {
    for (const l of leavesOf(r)) {
      const node = m.cpm.nodes.get(r.id); const f = fpdOf(l.fpdId); const pf = ws.pfmea.find((p) => p.opId === l.opId);
      combined.push({ 'Phase #': f?.fpdCode ?? '', 'Route Code': l.opId, 'Operation Phase Title': l.description, 'Detailed Method Steps': l.methodDetail ?? '', Zone: zone(l.destZoneId), 'Task Type': l.taskType, 'Predecessor Phase #': l.predecessors.join(', '), 'Component Name/Description': l.componentIds.map((i) => ws.components.find((c) => c.id === i)?.name ?? '').filter(Boolean).join('; '), 'Crew Density': l.crewSize, 'Equipment / Bay Run Time (hrs)': l.runHrs, 'Operator Touch Time (hrs)': l.touchHrs, 'Labour Content (Hours)': l.manningHrs, 'Baseline Hours': l.baselineHrs ?? '', 'Variance (h)': l.baselineHrs != null ? +(l.baselineHrs - l.manningHrs).toFixed(2) : '', Crane: names(l.craneIds), 'L1 Parent Tool': names(l.rigIds), Rigging: names(l.riggingIds), 'L3 Sub-Tool': names(l.standIds), Consumables: l.consumables ?? '', 'Quality Gate Sign-off': hpFor(l.opId), Rationale: l.rationale ?? '', Comments: l.notes, 'Failure Mode': pf?.failureMode ?? '', 'Control Doc Required': pf ? (pf.controlDocForced ? 'Y' : 'N') : '', 'Effect of Failure': pf?.effect ?? '', 'Cause of Failure': pf?.cause ?? '', 'Current Process Controls': pf?.controls ?? '', 'Recommended Corrective Action': pf?.recommendedAction ?? '', 'Severity (1-10)': pf?.s ?? '', 'Occurrence (1-10)': pf?.o ?? '', 'Detection (1-10)': pf?.d ?? '', 'RPN Score': pf ? pf.s * pf.o * pf.d : '', 'RPN Risk Level': pf ? (pf.s * pf.o * pf.d >= 200 ? 'RED' : pf.s * pf.o * pf.d >= 120 ? 'SERIOUS' : pf.s * pf.o * pf.d >= 80 ? 'AMBER' : 'GREEN') : '', 'Assigned Tooling ID': pf ? names(pf.resourceIds) : '', 'Phase Status': pf?.status ?? '', 'Schedule Start (h)': node ? +node.es.toFixed(1) : '', 'Schedule Finish (h)': node ? +node.ef.toFixed(1) : '', Critical: node?.critical ? 'Y' : 'N', 'Operation Action Category': l.classification, 'Specific Action Type': l.actionType });
    }
  }
  sheet('Master BOP & PFMEA Combined', combined, [10, 10, 48, 36, 24, 10, 16, 36, 7, 12, 13, 15, 12, 11, 20, 24, 20, 16, 24, 24, 24, 24, 36, 10, 36, 36, 36, 44, 10, 10, 10, 8, 10, 24, 10, 14, 14, 8, 20, 24]);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
