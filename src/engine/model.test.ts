import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../data/seed';
import { FACTORY_SCOPE } from '../types';
import { buildModel, learningFactor, rollUpBlock } from './model';
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
  it('merging activities into a Work Block preserves hours, lifts and critical path', () => {
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
