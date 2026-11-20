// Tests for canonical FPD titles, comma-split assets, and PFMEA isolation.
import { describe, it, expect } from 'vitest';
import { normaliseFpdCode } from '../../lib/excelHelpers';
import { processBopSheet } from '../../lib/excelBopImport';
import { seedWorkspace } from '../../data/seed';

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

function runBop(rows: Record<string, unknown>[]): { ws: ReturnType<typeof seedWorkspace>; warnings: string[] } {
  const ws = seedWorkspace();
  if (ws.cells.length === 0) ws.cells.push({ id: 'cell-1', number: 1, name: 'Main Assembly', crewPerShift: 2, notes: '' });
  const warnings: string[] = [];
  const counts: { label: string; added: number; updated: number }[] = [];
  const noOp = () => undefined;
  const ensureFpd = (code: string, title?: string) => {
    let f = ws.fpds.find((x) => x.fpdCode === code);
    if (!f) { f = { fpdId: `fpd-${code}`, fpdCode: code, title: title ?? code, subAssemblyBomRef: '', assignedCellId: ws.cells[0]?.id ?? '', revision: 'A', active: true }; ws.fpds.push(f); }
    else if (title && f.title === f.fpdCode) f.title = title;
    return f;
  };
  const ensureRes = (_kind: string, name: string) => ({ id: `res-${name}` });
  processBopSheet(rows, ws, warnings, counts, noOp as never, ensureFpd, ensureRes as never, () => '');
  return { ws, warnings };
}

// ---------------------------------------------------------------------------
// normaliseFpdCode — canonical titles for phases 1–19
// ---------------------------------------------------------------------------

describe('normaliseFpdCode — canonical programme titles', () => {
  it.each([
    ['1', 'Initial Power Module Preparations'],
    ['2', 'Prepare Assemblies'],
    ['3', 'Assemble Unit Module'],
    ['4', 'Install Unit Module'],
    ['5', 'Install Closure Head'],
    ['6', 'Install Surveillance Specimen Assembly'],
    ['8', 'Install Transport Bolt Assembly'],
    ['9', 'Install Compression Tube'],
    ['10', 'Install Lower CRDM & Hysteresis Testing'],
    ['12', 'Install Upper CRDM'],
    ['14', 'Install CRDM Coolant Manifold'],
    ['15', 'Test CRDM Assembly'],
    ['16', 'Prepare PMTP'],
    ['17', 'Prepare PM for PMTP Load'],
    ['18', 'Load PM into PMTP'],
    ['19', 'Prepare PMTP for Dispatch'],
  ])('phase %s → "%s"', (phase, expectedTitle) => {
    expect(normaliseFpdCode(phase)).toEqual({ code: phase, title: expectedTitle });
  });

  it.each([['7'], ['11'], ['13']])('unused phase %s falls back to "Phase N"', (phase) => {
    expect(normaliseFpdCode(phase)).toEqual({ code: phase, title: `Phase ${phase}` });
  });

  it('returns empty for sentinel inputs', () => {
    expect(normaliseFpdCode('')).toEqual({ code: '', title: '' });
    expect(normaliseFpdCode('None')).toEqual({ code: '', title: '' });
  });
});

// ---------------------------------------------------------------------------
// processBopSheet — comma-separated assets split into discrete tags
// ---------------------------------------------------------------------------

describe('processBopSheet — comma-separated assets in Columns G/L/M/N/O/P', () => {
  it('splits Component Name (Col G) on commas into separate componentIds', () => {
    const rows = [{
      'Phase #': '4', 'Route Code': '100', 'Operation Phase Title': 'Install Bearings',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 1,
      'Component Name': 'Bearing A, Bearing B, Bearing C',
    }];
    const { ws } = runBop(rows);
    expect(ws.rows).toHaveLength(1);
    expect(ws.rows[0].componentIds).toHaveLength(3);
    expect(ws.components.map((c) => c.name)).toEqual(expect.arrayContaining(['Bearing A', 'Bearing B', 'Bearing C']));
  });

  it('splits Crane (Col L) on commas into separate craneIds', () => {
    const rows = [{
      'Phase #': '4', 'Route Code': '110', 'Operation Phase Title': 'Hoist Module',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 0.5,
      'Crane': 'Overhead Crane 1, Jib Crane A',
    }];
    const { ws } = runBop(rows);
    expect(ws.rows[0].craneIds).toHaveLength(2);
  });

  it('splits L1 Parent Tool (Col M) on commas into separate rigIds', () => {
    const rows = [{
      'Phase #': '5', 'Route Code': '120', 'Operation Phase Title': 'Fit Closure Head',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 1,
      'L1 Parent Tool': 'Torque Rig Alpha, Torque Rig Beta',
    }];
    const { ws } = runBop(rows);
    expect(ws.rows[0].rigIds).toHaveLength(2);
  });

  it('splits Rigging (Col N) on commas into separate riggingIds', () => {
    const rows = [{
      'Phase #': '9', 'Route Code': '130', 'Operation Phase Title': 'Install Compression Tube',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 0.75,
      'Rigging': 'Sling Set A, Shackle 10T, Spreader Bar',
    }];
    const { ws } = runBop(rows);
    expect(ws.rows[0].riggingIds).toHaveLength(3);
  });

  it('splits L3 Sub-Tool (Col O) on commas into separate standIds', () => {
    const rows = [{
      'Phase #': '12', 'Route Code': '140', 'Operation Phase Title': 'Install Upper CRDM',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 2,
      'L3 Sub-Tool': 'Build Stand X, Build Stand Y',
    }];
    const { ws } = runBop(rows);
    expect(ws.rows[0].standIds).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// processBopSheet — phases 1–19 all receive canonical titles
// ---------------------------------------------------------------------------

describe('processBopSheet — canonical FPD titles for phases 1–19', () => {
  it.each([
    ['1', 'Initial Power Module Preparations'],
    ['5', 'Install Closure Head'],
    ['9', 'Install Compression Tube'],
    ['14', 'Install CRDM Coolant Manifold'],
    ['18', 'Load PM into PMTP'],
  ])('phase %s creates FPD titled "%s"', (phase, expectedTitle) => {
    const rows = [{
      'Phase #': phase, 'Route Code': `op-${phase}`, 'Operation Phase Title': 'Some Operation',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 1,
    }];
    const { ws } = runBop(rows);
    const fpd = ws.fpds.find((f) => f.fpdCode === phase);
    expect(fpd).toBeDefined();
    expect(fpd!.title).toBe(expectedTitle);
  });
});

// ---------------------------------------------------------------------------
// processBopSheet — PFMEA isolation (ws.pfmea must stay empty)
// ---------------------------------------------------------------------------

describe('processBopSheet — PFMEA isolation', () => {
  it('never creates PFMEA items even when Failure Mode column is populated', () => {
    const rows = [
      {
        'Phase #': '4', 'Route Code': '200', 'Operation Phase Title': 'Install Unit Module',
        'Task Type': 'Sequential', 'Labour Content (Hours)': 1.5,
        'Failure Mode': 'Cross-threaded fastener',
        'Severity (1-10)': 8, 'Occurrence (1-10)': 3, 'Detection (1-10)': 4,
        'Cause': 'Improper torque', 'Effect': 'Structural failure',
      },
      {
        'Phase #': '5', 'Route Code': '210', 'Operation Phase Title': 'Install Closure Head',
        'Task Type': 'Sequential', 'Labour Content (Hours)': 2,
        'Failure Mode': 'Seal leak',
        'Severity (1-10)': 9, 'Occurrence (1-10)': 2, 'Detection (1-10)': 3,
      },
    ];
    const { ws } = runBop(rows);
    expect(ws.pfmea).toHaveLength(0);
    expect(ws.rows).toHaveLength(2);
  });

  it('zero PFMEA items even when sheet name contains "PFMEA"', () => {
    const rows = [{
      'Phase #': '10', 'Route Code': '300', 'Operation Phase Title': 'CRDM Prep',
      'Task Type': 'Sequential', 'Labour Content (Hours)': 3,
      'Failure Mode': 'Misalignment', 'Severity (1-10)': 7,
    }];
    const { ws } = runBop(rows);
    expect(ws.pfmea).toHaveLength(0);
    expect(ws.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// processBopSheet — intra-sheet duplicate Op # auto-suffix
// ---------------------------------------------------------------------------

describe('processBopSheet — intra-sheet duplicate Op # auto-suffix', () => {
  it('auto-suffixes the second occurrence of a duplicate Op # and warns', () => {
    const rows = [
      { 'Phase #': '4', 'Route Code': '010', 'Operation Phase Title': 'First install', 'Task Type': 'Sequential', 'Labour Content (Hours)': 1 },
      { 'Phase #': '4', 'Route Code': '010', 'Operation Phase Title': 'Duplicate op', 'Task Type': 'Sequential', 'Labour Content (Hours)': 0.5 },
    ];
    const { ws, warnings } = runBop(rows);
    expect(ws.rows).toHaveLength(2);
    expect(ws.rows[0].opId).toBe('010');
    expect(ws.rows[1].opId).toBe('010-2');
    expect(warnings.some((w) => w.includes('010-2'))).toBe(true);
  });

  it('suffixes a third occurrence as -3', () => {
    const rows = [
      { 'Phase #': '5', 'Route Code': '020', 'Operation Phase Title': 'First', 'Task Type': 'Sequential', 'Labour Content (Hours)': 1 },
      { 'Phase #': '5', 'Route Code': '020', 'Operation Phase Title': 'Second', 'Task Type': 'Sequential', 'Labour Content (Hours)': 1 },
      { 'Phase #': '5', 'Route Code': '020', 'Operation Phase Title': 'Third', 'Task Type': 'Sequential', 'Labour Content (Hours)': 1 },
    ];
    const { ws } = runBop(rows);
    expect(ws.rows.map((r) => r.opId)).toEqual(['020', '020-2', '020-3']);
  });
});
