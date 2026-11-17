import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../data/seed';
import { FACTORY_SCOPE } from '../types';
import { buildModel, learningFactor, rollUpBlock } from './model';
import { buildSummary } from './gates';
import { runIntegrity } from './integrity';

describe('baseline dataset', () => {
  const ws = seedWorkspace();
  it('learning curve steps 130 → 110 over four reductions', () => {
    const l = ws.settings.learning;
    expect([1, 2, 3, 4, 5, 6].map((b) => Math.round(learningFactor(l, b) * 100))).toEqual([130, 125, 120, 115, 110, 110]);
  });
  it('production windows match the programme cadence (7.8 / 6.5 months)', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    expect(m.windowNominal.toFixed(1)).toBe('7.8');
    expect(m.windowPeak.toFixed(1)).toBe('6.5');
    expect(m.durationMonths / m.lc).toBeGreaterThan(5.8);
    expect(m.durationMonths / m.lc).toBeLessThan(6.05);
    expect(m.wastePct).toBeGreaterThan(2.4);
    expect(m.wastePct).toBeLessThan(2.6);
  });
  it('flags the closure-head hook-height breach and the Full-Build stand as the bottleneck', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    expect(m.lifts.filter((l) => l.rag === 'red').map((l) => l.opId)).toEqual(['F5-090']);
    expect(m.lifts.find((l) => l.opId === 'F5-090')!.hookBreach).toBe(true);
    const top = [...m.resources].sort((a, b) => b.dutyPct - a.dutyPct)[0];
    expect(top.resource.name).toBe('3-Tier Static Build Stand');
    expect(top.rag).toBe('serious');
  });
  it('treats zero Bay Run Time as a manual op and flags only machine-locked labour', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    const leaves = [...m.calcs.values()].flatMap((c) => c.leaves);
    const manual = leaves.filter((l) => l.leaf.runHrs === 0);
    expect(manual.length).toBeGreaterThan(30);
    expect(manual.every((l) => l.arPct === null && !l.arRed)).toBe(true);
    expect(leaves.filter((l) => l.arRed).map((l) => l.leaf.opId)).toEqual(['F5-070']);
    // 4 min cycle is below the 5 min floor; 6 min cycle with Manning ≥ Run is locked
    const w = seedWorkspace();
    const r = w.rows.find((x) => x.opId === 'F1-010')!;
    Object.assign(r, { runHrs: 4 / 60, manningHrs: 1 });
    expect(buildModel(w, FACTORY_SCOPE).calcs.get(r.id)!.arRed).toBe(false);
    Object.assign(r, { runHrs: 0.1, manningHrs: 0.1 });
    expect(buildModel(w, FACTORY_SCOPE).calcs.get(r.id)!.arRed).toBe(true);
    Object.assign(r, { runHrs: 0.1, manningHrs: 0.09 });
    expect(buildModel(w, FACTORY_SCOPE).calcs.get(r.id)!.arRed).toBe(false);
  });
  it('computes duty cycle as shifts used over programme shifts', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    const stand = m.resources.find((r) => r.resource.name === '3-Tier Static Build Stand')!;
    expect(stand.shiftsUsed).toBeCloseTo(m.cpm.durationHrs / ws.settings.calendar.hoursPerShift, 6);
    expect(stand.programmeShifts).toBeCloseTo(m.windowNominal * (250 / 12) * 2, 6);
    expect(stand.dutyPct).toBeCloseTo((stand.shiftsUsed / stand.programmeShifts) * 100, 9);
    expect(stand.highRisk).toBe(true);
  });
  it('finds spatial clashes by zone and stand level, and a shorter future spaghetti distance', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    expect(m.space.clashes.map((c) => c.kind).sort()).toEqual(['congestion', 'lift-same-level', 'lift-vertical']);
    const v = m.space.clashes.find((c) => c.kind === 'lift-vertical')!;
    expect(v.zoneId).toBe('ZD');
    expect([v.level, v.otherLevel].sort()).toEqual([1, 2]);
    expect(m.space.spaghettiFutureM).toBeLessThan(m.space.spaghettiM);
    expect(m.space.unpositioned).toBe(0);
    expect(Math.max(...m.space.crewProfile.map((p) => p.crew))).toBe(m.peakCrew);
  });
  it('counts the five lift flags separately', () => {
    const m = buildModel(ws, FACTORY_SCOPE);
    const n = (f: (l: (typeof m.lifts)[number]) => boolean) => m.lifts.filter(f).length;
    expect(m.lifts).toHaveLength(14);
    expect(n((l) => l.multiPerson)).toBe(14);
    expect(n((l) => l.heavy)).toBe(12);
    expect(n((l) => l.highElevation)).toBe(3);
    expect(n((l) => l.multiTool)).toBe(3);
    expect(n((l) => l.complex)).toBeGreaterThan(n((l) => l.multiTool));
  });
  it('exports summary@V2 with six cells under Factory F4 and a route to green', () => {
    const sum = buildSummary(ws, runIntegrity(ws));
    expect(sum.schema).toBe('summary@V2');
    expect(sum.factory.id).toBe('F4');
    expect(sum.factory.cells.map((c) => c.cellId)).toEqual(['F4-C1', 'F4-C2', 'F4-C3', 'F4-C4', 'F4-C5', 'F4-C6']);
    expect(sum.gates).toHaveLength(7);
    expect(sum.routeToGreen.some((x) => x.gate === 'G3' && /F5-090/.test(x.action))).toBe(true);
    expect(sum.pfmea.blindSpots).toBe(2);
    expect(sum.pfmea.controlDocsMissing).toBe(3);
  });
  it('scopes to a single cell without touching the factory-wide window', () => {
    const cell4 = buildModel(ws, { mode: 'cell', cellIds: ['C4'], fpdIds: [], zoneId: '' });
    expect(cell4.fpds.map((f) => f.fpdCode)).toEqual(['FPD-005', 'FPD-007']);
    expect(cell4.totals.workBlocks).toBe(16);
    expect(cell4.windowNominal).toBeCloseTo(buildModel(ws, FACTORY_SCOPE).windowNominal, 9);
    expect(cell4.cpm.external.length).toBeGreaterThan(0);
  });
  it('passes every integrity check except unconfirmed assumptions', () => {
    const rep = runIntegrity(ws);
    expect(rep.checks).toHaveLength(10);
    expect(rep.checks.filter((c) => !c.pass).map((c) => c.key)).toEqual(['assumptions']);
  });
  it('detects a predecessor loop', () => {
    const w = seedWorkspace();
    w.rows.find((r) => r.opId === 'F1-010')!.predecessors = ['F8-060'];
    const rep = runIntegrity(w);
    expect(rep.checks.find((c) => c.key === 'cycle')!.pass).toBe(false);
  });
  it('merging activities into a Baseline Work Block preserves hours, lifts and critical path', () => {
    const w = seedWorkspace();
    const before = buildModel(w, FACTORY_SCOPE);
    const kids = w.rows.filter((r) => ['F2-020', 'F2-030', 'F2-040'].includes(r.opId));
    const block = { ...structuredClone(kids[0]), id: 'blk', description: 'Block', children: structuredClone(kids) };
    rollUpBlock(block);
    const at = w.rows.indexOf(kids[0]);
    w.rows = w.rows.filter((r) => !kids.includes(r));
    w.rows.splice(at, 0, block);
    const after = buildModel(w, FACTORY_SCOPE);
    expect(after.totals.labourHrs).toBeCloseTo(before.totals.labourHrs, 6);
    expect(after.cpm.durationHrs).toBeCloseTo(before.cpm.durationHrs, 6);
    expect(after.totals.activities).toBe(before.totals.activities);
    expect(after.totals.workBlocks).toBe(before.totals.workBlocks - 2);
    expect(runIntegrity(w).checks.find((c) => c.key === 'merge')!.pass).toBe(true);
  });
});
