// Robustness tests for the BOP importer — repeated headers, helper rows, sentinels, bare phase numbers.
import { describe, it, expect } from 'vitest';
import { buildImport } from '../../lib/excelImport';
import { isHeaderOrHelperRow, normaliseFpdCode, isSentinel, sentinelFree, scoreBopCandidate } from '../../lib/excelHelpers';
import { detectDuplicateRouteCodes, processBopSheet } from '../../lib/excelBopImport';
import { seedWorkspace } from '../../data/seed';

// ---------------------------------------------------------------------------
// Unit tests for individual helpers
// ---------------------------------------------------------------------------

describe('isSentinel', () => {
  it('recognises common sentinel strings', () => {
    expect(isSentinel('None')).toBe(true);
    expect(isSentinel('none')).toBe(true);
    expect(isSentinel('N/A')).toBe(true);
    expect(isSentinel('-')).toBe(true);
    expect(isSentinel('—')).toBe(true);
    expect(isSentinel('')).toBe(true);
  });

  it('leaves real values alone', () => {
    expect(isSentinel('Zone A')).toBe(false);
    expect(isSentinel('Marshall & Doc Release')).toBe(false);
    expect(isSentinel('Hold Point (Quality Audit)')).toBe(false);
  });
});

describe('sentinelFree', () => {
  it('returns empty string for sentinel values', () => {
    expect(sentinelFree('None')).toBe('');
    expect(sentinelFree('N/A')).toBe('');
  });

  it('passes through real values unchanged', () => {
    expect(sentinelFree('Some consumable')).toBe('Some consumable');
  });
});

describe('normaliseFpdCode', () => {
  it('converts bare integer to FPD-NNN format', () => {
    expect(normaliseFpdCode(4)).toEqual({ code: 'FPD-004', title: 'Phase 4' });
    expect(normaliseFpdCode('4')).toEqual({ code: 'FPD-004', title: 'Phase 4' });
    expect(normaliseFpdCode('12')).toEqual({ code: 'FPD-012', title: 'Phase 12' });
  });

  it('leaves existing FPD codes unchanged', () => {
    expect(normaliseFpdCode('FPD-004')).toEqual({ code: 'FPD-004', title: 'FPD-004' });
  });

  it('returns empty code for sentinel inputs', () => {
    expect(normaliseFpdCode('None')).toEqual({ code: '', title: '' });
    expect(normaliseFpdCode('')).toEqual({ code: '', title: '' });
  });
});

describe('isHeaderOrHelperRow', () => {
  it('flags a repeated column-header row', () => {
    expect(isHeaderOrHelperRow({ 'Route Code': 'Route Code', 'Phase #': 'Phase #' })).toBe(true);
  });

  it('flags a helper/instruction row by task type cell', () => {
    expect(isHeaderOrHelperRow({ 'Task Type': 'Sequential/Parellel', 'Phase #': '001' })).toBe(true);
    expect(isHeaderOrHelperRow({ 'Task Type': 'Sequential/Parallel', 'Phase #': '001' })).toBe(true);
  });

  it('flags a row whose phase cell contains the column header label', () => {
    expect(isHeaderOrHelperRow({ 'Phase #': 'Phase #', 'Route Code': '10' })).toBe(true);
    expect(isHeaderOrHelperRow({ 'Phase #': 'FPD Number', 'Route Code': '10' })).toBe(true);
  });

  it('passes a normal data row', () => {
    expect(isHeaderOrHelperRow({ 'Phase #': '4', 'Route Code': '10', 'Task Type': 'Sequential' })).toBe(false);
  });
});

describe('scoreBopCandidate', () => {
  it('scores a sheet with multiple BOP headers higher than a lookup sheet', () => {
    const bopSheet: unknown[][] = [
      ['Phase #', 'Route Code', 'Operation Phase Title', 'Crew Density', 'Operation Action Category', 'Labour Content (Hours)'],
      [4, '10', 'Marshall & Doc Release', 1, 'Pure Waste (NVA)', 2],
    ];
    const lookupSheet: unknown[][] = [
      ['Code', 'Description'],
      ['A', 'Some lookup value'],
    ];
    expect(scoreBopCandidate(bopSheet)).toBeGreaterThan(scoreBopCandidate(lookupSheet));
  });
});

// ---------------------------------------------------------------------------
// Integration test: full processBopSheet pipeline
// ---------------------------------------------------------------------------

describe('processBopSheet — real workbook row scenario', () => {
  /**
   * Simulates the exact multi-sheet workbook layout described in the task:
   *   Row 1: column headers
   *   Row 2: helper/instruction row  (Phase # = "FPD Number",  Task Type = "Sequential/Parellel")
   *   Row 3: repeated header row     (Phase # = "Phase #",     Route Code = "Route Code")
   *   Row 4: real data row           (Phase # = 4, Route Code = 10, …, Consumables = "None", etc.)
   */
  it('imports only 1 BOP row; FPD code is FPD-004; consumables is empty; hold point is created; zero errors', () => {
    const helperRow = {
      'Phase #': 'FPD Number', 'Route Code': 'Route Code / Op #', 'Operation Phase Title': 'Op Description',
      'Task Type': 'Sequential/Parellel', 'Predecessors': 'Predecessor Phase #',
      'Crew Density': 'Crew Density', 'Operation Action Category': 'Operation Action Category',
      'Labour Content (Hours)': 'Labour Content (Hours)', 'Consumables': 'Consumables',
      'Quality Gate': 'Quality Gate Sign-off',
    };
    const repeatedHeaderRow = {
      'Phase #': 'Phase #', 'Route Code': 'Route Code', 'Operation Phase Title': 'Operation Phase Title',
      'Task Type': 'Task Type', 'Predecessors': 'Predecessors', 'Crew Density': 'Crew Density',
      'Operation Action Category': 'Operation Action Category', 'Labour Content (Hours)': 'Labour Content (Hours)',
      'Consumables': 'Consumables', 'Quality Gate': 'Quality Gate',
    };
    const dataRow = {
      'Phase #': 4,
      'Route Code': '10',
      'Operation Phase Title': 'Marshall & Doc Release',
      'Task Type': 'Sequential',
      'Predecessors': 'None',
      'Crew Density': 1,
      'Operation Action Category': 'Pure Waste (NVA)',
      'Labour Content (Hours)': 2,
      'Crane': 'None',
      'L1 Parent Tool': 'None',
      'Rigging': 'None',
      'L3 Sub-Tool': 'None',
      'Consumables': 'None',
      'Quality Gate': 'Hold Point (Quality Audit)',
    };

    const bopRows = [helperRow, repeatedHeaderRow, dataRow];
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

    const skippedRows = processBopSheet(
      bopRows, ws, warnings, counts,
      noOp as never, ensureFpd, ensureRes as never, () => '',
    );

    // Exactly 2 rows should be skipped (helper row + repeated header row)
    expect(skippedRows).toBe(2);

    // Exactly 1 BOP operation should be created
    expect(ws.rows).toHaveLength(1);
    expect(ws.rows[0].opId).toBe('10');
    expect(ws.rows[0].description).toBe('Marshall & Doc Release');

    // FPD must be "FPD-004" with title "Phase 4" — NOT "Phase #" or "FPD Number"
    expect(ws.fpds).toHaveLength(1);
    expect(ws.fpds[0].fpdCode).toBe('FPD-004');
    expect(ws.fpds[0].title).toBe('Phase 4');

    // Consumables sentinel "None" must NOT be stored
    expect(ws.rows[0].consumables).toBeUndefined();

    // Hold point should be created
    expect(ws.holdPoints).toHaveLength(1);
    expect(ws.holdPoints[0].title).toBe('Hold Point (Quality Audit)');

    // No unexpected warnings from the sentinel values
    const bogusWarnings = warnings.filter((w) => /none|n\/a/i.test(w));
    expect(bogusWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildImport integration: skippedRows returned in result
// ---------------------------------------------------------------------------

describe('buildImport — skippedRows field', () => {
  it('returns skippedRows = 0 when no BOP sheet is present', () => {
    const ws = seedWorkspace();
    const result = buildImport({ fileName: 'test.xlsx', sheets: {}, errorCells: [] }, ws, 'merge');
    expect(result.skippedRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectDuplicateRouteCodes skips header/helper rows
// ---------------------------------------------------------------------------

describe('detectDuplicateRouteCodes', () => {
  it('does not count header rows as phase-route-code pairs', () => {
    const rows = [
      { 'Route Code': 'Route Code', 'Phase #': 'Phase #' },
      { 'Route Code': '10', 'Phase #': 'FPD-001' },
    ];
    const { needsPrefix } = detectDuplicateRouteCodes(rows);
    expect(needsPrefix).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared helper: wires up processBopSheet with minimal stubs
// ---------------------------------------------------------------------------

function runProcessBopSheet(rows: Record<string, unknown>[]): { ws: ReturnType<typeof seedWorkspace>; skipped: number; warnings: string[] } {
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
  const skipped = processBopSheet(rows, ws, warnings, counts, noOp as never, ensureFpd, ensureRes as never, () => '');
  return { ws, skipped, warnings };
}

// ---------------------------------------------------------------------------
// Layout A — 5-row matrix preamble (title banner, Present/Not Present, governance labels, headers, data)
// ---------------------------------------------------------------------------

describe('processBopSheet — Layout A (5-row matrix preamble)', () => {
  it('skips the four preamble rows and imports only the data row', () => {
    // Layout A structure (after sheetToRows has promoted the real header row):
    //   Row 1: Title banner (non-header cells)
    //   Row 2: Present / Not Present metadata
    //   Row 3: FREE-TEXT / PRE-DEFINED / INTEGER FREE-TEXT / DEFINE IN TARGETS TAB governance
    //   Row 4: Repeated column-header row
    //   Row 5: Real data
    const rows = [
      { 'Phase #': 'Assembly BOP Template v2.1', 'Route Code': '', 'Operation Phase Title': '', 'Crew Density': '', 'Task Type': '', 'Zone': '' },
      { 'Phase #': 'Present', 'Route Code': 'Present', 'Operation Phase Title': 'Present', 'Crew Density': 'Present', 'Task Type': 'Not Present', 'Zone': 'Present' },
      { 'Phase #': 'PRE-DEFINED', 'Route Code': 'PRE-DEFINED', 'Operation Phase Title': 'FREE-TEXT', 'Crew Density': 'INTEGER FREE-TEXT', 'Task Type': 'PRE-DEFINED', 'Zone': 'DEFINE IN TARGETS TAB' },
      { 'Phase #': 'Phase #', 'Route Code': 'Route Code', 'Operation Phase Title': 'Operation Phase Title', 'Crew Density': 'Crew Density', 'Task Type': 'Task Type', 'Zone': 'Zone' },
      { 'Phase #': 'FPD-001', 'Route Code': '10', 'Operation Phase Title': 'Install Main Frame', 'Crew Density': 2, 'Task Type': 'Sequential', 'Zone': 'Zone A', 'Labour Content (Hours)': 1.5, 'Operation Action Category': 'VA' },
    ];
    const { ws, skipped } = runProcessBopSheet(rows);
    // Rows 1–4 must be skipped (3 governance/helper rows + 1 repeated header)
    expect(skipped).toBeGreaterThanOrEqual(3);
    expect(ws.rows).toHaveLength(1);
    expect(ws.rows[0].opId).toBe('10');
    expect(ws.rows[0].description).toBe('Install Main Frame');
    expect(ws.fpds.some((f) => f.fpdCode === 'FPD-001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layout B — clean Row-1 export (re-loop from exportBop)
// ---------------------------------------------------------------------------

describe('processBopSheet — Layout B (clean Row-1 export)', () => {
  it('imports all rows when there is no preamble and "Yes" gate creates a Hold Point', () => {
    // Layout B: sheetToRows produces rows directly with no preamble rows present
    const rows = [
      { 'Phase #': 'FPD-002', 'Route Code': '20', 'Operation Phase Title': 'Fit Wing Spar', 'Crew Density': 1, 'Task Type': 'Sequential', 'Zone': 'Zone B', 'Labour Content (Hours)': 2.0, 'Operation Action Category': 'VA' },
      { 'Phase #': 'FPD-002', 'Route Code': '30', 'Operation Phase Title': 'Torque Main Bolts', 'Crew Density': 2, 'Task Type': 'Sequential', 'Zone': 'Zone B', 'Labour Content (Hours)': 0.5, 'Operation Action Category': 'VA' },
      { 'Phase #': 'FPD-002', 'Route Code': '40', 'Operation Phase Title': 'Inspect & Sign Off', 'Crew Density': 1, 'Task Type': 'Sequential', 'Zone': 'Zone B', 'Labour Content (Hours)': 0.25, 'Operation Action Category': 'VA', 'Quality Gate Sign-off': 'Yes' },
    ];
    const { ws, skipped } = runProcessBopSheet(rows);
    expect(skipped).toBe(0);
    expect(ws.rows).toHaveLength(3);
    expect(ws.rows[0].opId).toBe('20');
    expect(ws.rows[1].opId).toBe('30');
    expect(ws.rows[2].opId).toBe('40');
    // "Yes" Quality Gate Sign-off must create a Hold Point with canonical title
    expect(ws.holdPoints).toHaveLength(1);
    expect(ws.holdPoints[0].title).toBe('Hold Point');
    expect(ws.holdPoints[0].opId).toBe('40');
  });
});
