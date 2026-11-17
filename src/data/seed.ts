// Worked pre-loaded dataset: PMA / UMA Heavy Assembly Baseline (6 cells, 8 FPDs).
import type {
  ActionType, Ancillary, AncillaryKind, BopRow, Cell, Classification, Component, Fpd, Resource, ResourceKind, Settings, Workspace, Zone,
} from '../types';
import { APP_VERSION, WORKSPACE_SCHEMA, uid } from '../types';

export const defaultSettings = (): Settings => ({
  programme: { baselineOpMonths: 6.0, demandNominal: 1.5, demandPeak: 1.8, drumbeatMonths: 16.0, demandCase: 'Nominal', labourRateGbp: 55 },
  learning: { firstBuildPct: 130, stabilisedPct: 110, stepReductionPct: 5, stepBuilds: 4, selectedBuild: 1 },
  calendar: {
    shiftsPerDay: 2, hoursPerShift: 7.5, workingDaysPerYear: 250, wasteMode: 'Automated', manualWastePct: 10.0,
    activeTimeFactorPct: 85.0, labourEfficiencyPct: 100.0,
  },
  envelope: { lengthM: 80, widthM: 40 },
  crane: {
    primarySwlKg: 2500, hookHeightM: 3.5, clearanceMarginM: 0.3, avgLiftCycleHrs: 0.5, tandemDeratePct: 25,
    defaultTierHeightM: 0.8, defaultRiggingHeadroomM: 0.5,
  },
  thresholds: {
    heavyLiftKg: 250, multiPersonCrew: 2, highElevationM: 2.0, highElevationFloors: 2, multiToolItems: 2,
    dutyAmberPct: 65, dutySeriousPct: 85, arRedPct: 100, arMinCycleMin: 5, nearCriticalFloatHrs: 40,
    rpnAmber: 80, rpnSerious: 120, rpnRed: 200, blindSpotSeverity: 8,
  },
});

const cells: Cell[] = [
  { id: 'C1', number: 1, name: 'Stores & Kitting Intake', crewPerShift: 2, notes: 'Goods-in, receiving inspection and kit marshalling.' },
  { id: 'C2', number: 2, name: 'Sub-Assembly Prep A', crewPerShift: 2, notes: 'Fuel cell module prep and pipework spool welding.' },
  { id: 'C3', number: 3, name: 'Sub-Assembly Prep B', crewPerShift: 2, notes: 'Core barrel sub-assembly under the Zone C jib.' },
  { id: 'C4', number: 4, name: 'PMA Main Static Build Stand', crewPerShift: 4, notes: '3-tier static build stand under the PMA overhead gantry.' },
  { id: 'C5', number: 5, name: 'UMA Heavy Sub-Build', crewPerShift: 3, notes: 'UMA cradle, turnover jig and UMA crane.' },
  { id: 'C6', number: 6, name: 'Final Test & Dispatch Bay', crewPerShift: 2, notes: 'Hydro bench, acceptance test, preservation and dispatch.' },
];

const zone = (id: string, cellId: string, name: string, pos: [number, number], cap: number, futurePos: [number, number] | null = null): Zone => ({
  id, cellId, name, pos, futurePos, maxCrewPerLevel: cap,
});
const zones: Zone[] = [
  zone('ZA', 'C1', 'Zone A · Main Stores Input', [8, 30], 6),
  zone('ZA2', 'C1', 'Zone A2 · Kit Marshalling', [8, 11], 6, [13, 19]),
  zone('ZB', 'C2', 'Zone B · Prep A Benches', [24, 30], 6, [27, 25]),
  zone('ZC', 'C3', 'Zone C · Prep B & Jib', [24, 11], 6, [29, 14]),
  zone('ZD', 'C4', 'Zone D · PMA Static Build Stand', [46, 12], 8),
  zone('ZE', 'C5', 'Zone E · UMA Heavy Build', [46, 32], 8, [46, 29]),
  zone('ZF', 'C6', 'Zone F · Test Bay', [69, 12], 6, [63, 13]),
  zone('ZG', 'C6', 'Zone G · Final Dispatch Bay', [69, 33], 6),
];

const fpds: Fpd[] = [
  { fpdId: 'F1', fpdCode: 'FPD-001', title: 'Stores Receipt, Inspection & Kitting', subAssemblyBomRef: 'BOM-6000008601-Kit-Set', assignedCellId: 'C1', revision: 'C', active: true },
  { fpdId: 'F2', fpdCode: 'FPD-002', title: 'Fuel Cell Module Preparation', subAssemblyBomRef: 'BOM-6000008657-Fuel-Cell-04', assignedCellId: 'C2', revision: 'B', active: true },
  { fpdId: 'F3', fpdCode: 'FPD-003', title: 'Core Barrel Sub-Assembly', subAssemblyBomRef: 'BOM-6000008648-Core-Barrel', assignedCellId: 'C3', revision: 'D', active: true },
  { fpdId: 'F4', fpdCode: 'FPD-004', title: 'Pipework Spool Orbital Welding', subAssemblyBomRef: 'BOM-6000008662-Pipe-Spool-Set', assignedCellId: 'C2', revision: 'B', active: true },
  { fpdId: 'F5', fpdCode: 'FPD-005', title: 'PMA Main Static Build', subAssemblyBomRef: 'BOM-6000008600-PMA-Top-Level', assignedCellId: 'C4', revision: 'E', active: true },
  { fpdId: 'F6', fpdCode: 'FPD-006', title: 'UMA Heavy Sub-Build', subAssemblyBomRef: 'BOM-6000008700-UMA-Top-Level', assignedCellId: 'C5', revision: 'C', active: true },
  { fpdId: 'F7', fpdCode: 'FPD-007', title: 'PMA / UMA Mate & Integration', subAssemblyBomRef: 'BOM-6000008750-Mated-Assembly', assignedCellId: 'C4', revision: 'A', active: true },
  { fpdId: 'F8', fpdCode: 'FPD-008', title: 'Final Hydro Test, Inspection & Dispatch', subAssemblyBomRef: 'BOM-6000008790-Dispatch-Config', assignedCellId: 'C6', revision: 'B', active: true },
];

const cmp = (id: string, bomRef: string, name: string, weightKg: number, l: number, w: number, h: number, qty = 1): Component => ({
  id, bomRef, name, weightKg, lengthM: l, widthM: w, heightM: h, qtyPerBuild: qty, notes: '',
});
const components: Component[] = [
  cmp('M01', 'BOM-6000008657-Fuel-Cell-04', 'Fuel Cell Module 04', 420, 1.2, 0.8, 0.9, 4),
  cmp('M02', 'BOM-6000008648-Core-Barrel', 'Core Barrel', 920, 1.4, 1.4, 1.6),
  cmp('M03', 'BOM-6000008651-Base-Frame', 'PMA Base Frame', 2180, 3.2, 2.4, 0.6),
  cmp('M04', 'BOM-6000008653-Support-Skirt', 'Core Support Skirt', 640, 1.6, 1.6, 0.5),
  cmp('M05', 'BOM-6000008662-Pipe-Spool-Set', 'Primary Pipework Spool Set', 180, 2.4, 0.6, 0.4, 6),
  cmp('M06', 'BOM-6000008665-Manifold-Block', 'Manifold Block', 95, 0.6, 0.4, 0.3, 4),
  cmp('M07', 'BOM-6000008670-Upper-Casing', 'UMA Upper Casing', 1450, 2.2, 2.2, 1.1),
  cmp('M08', 'BOM-6000008672-Heat-Exchanger', 'Heat Exchanger Bundle', 880, 1.8, 0.9, 0.9),
  cmp('M09', 'BOM-6000008675-Control-Cabinet', 'Control Cabinet', 310, 0.8, 0.6, 1.4),
  cmp('M10', 'BOM-6000008678-Cable-Harness-Set', 'Cable Harness Set', 60, 1.0, 0.6, 0.3),
  cmp('M11', 'BOM-6000008680-Fastener-Kit', 'Primary Joint Fastener Kit', 35, 0.6, 0.4, 0.2),
  cmp('M12', 'BOM-6000008684-Closure-Head', 'Closure Head', 1200, 1.6, 1.6, 0.45),
  cmp('M13', 'BOM-6000008690-Instrument-Rack', 'Instrument Rack', 140, 1.2, 0.5, 0.9),
  cmp('M14', 'BOM-6000008695-Transit-Frame', 'Dispatch Transit Frame', 760, 3.6, 2.6, 0.5),
  cmp('M15', 'BOM-6000008700-UMA-Top-Level', 'UMA Complete Sub-Build', 1950, 2.2, 2.2, 1.3),
];

const res = (
  id: string, kind: ResourceKind, name: string, cellId: string, o: Partial<Resource> = {},
): Resource => ({
  id, kind, name, qty: 1, cellId, swlKg: null, hookHeightM: null, headroomM: null, tareKg: null, tiers: null, tierHeightM: null,
  complexity: [1, 1, 1, 1], footprintLM: null, footprintWM: null, utilities: [], dwellMode: 'Per-Op', notes: '', ...o,
});
const U = { p415: '415 V 3-phase', p230: '230 V single-phase', air: 'Compressed air', argon: 'Argon / shield gas', he: 'Helium', water: 'Demineralised water', lev: 'Extraction (LEV)', data: 'Data / network' };
const resources: Resource[] = [
  res('R1', 'rig', 'Orbital Welding Rig', 'C2', { complexity: [3, 3, 2, 3], footprintLM: 2.0, footprintWM: 1.2, utilities: [U.p415, U.argon, U.lev, U.data] }),
  res('R2', 'rig', 'DC Multi-Nutrunner Array', 'C4', { complexity: [3, 2, 3, 3], footprintLM: 2.5, footprintWM: 1.5, utilities: [U.p415, U.data] }),
  res('R3', 'rig', 'High-Pressure Hydro Bench', 'C6', { complexity: [3, 3, 2, 3], footprintLM: 4.0, footprintWM: 2.5, utilities: [U.p415, U.water, U.air, U.data] }),
  res('R4', 'rig', 'Laser Alignment Tracker', '', { qty: 2, complexity: [2, 3, 2, 2], footprintLM: 1.0, footprintWM: 1.0, utilities: [U.p230, U.data] }),
  res('R5', 'rig', 'Helium Leak Test Set', '', { complexity: [2, 2, 2, 2], footprintLM: 1.2, footprintWM: 0.8, utilities: [U.p230, U.he] }),
  res('K1', 'crane', 'PMA Overhead Gantry 2.5t · 3.5m hook', 'C4', { swlKg: 2500, hookHeightM: 3.5, complexity: [2, 2, 1, 3], utilities: [U.p415] }),
  res('K2', 'crane', 'UMA Crane 5.0t · 6.0m hook', 'C5', { swlKg: 5000, hookHeightM: 6.0, complexity: [2, 2, 1, 3], utilities: [U.p415] }),
  res('K3', 'crane', 'Zone C Jib Crane 1.0t', 'C3', { swlKg: 1000, hookHeightM: 3.2, complexity: [1, 2, 1, 2], footprintLM: 1.0, footprintWM: 1.0, utilities: [U.p415] }),
  res('L1', 'rigging', 'L2 4-Leg Chain Sling Set 3.2t', '', { swlKg: 3200, headroomM: 0.9, tareKg: 28, qty: 2, complexity: [1, 1, 1, 2] }),
  res('L2', 'rigging', 'L2 Spreader Beam 2.5t', 'C4', { swlKg: 2500, headroomM: 0.6, tareKg: 85, complexity: [1, 2, 1, 2] }),
  res('L3', 'rigging', 'L3 Modular Lifting Frame 5.0t', '', { swlKg: 5000, headroomM: 0.8, tareKg: 220, complexity: [3, 3, 3, 2] }),
  res('L4', 'rigging', 'L2 Round Sling Pair 1.0t', '', { swlKg: 1000, headroomM: 0.4, tareKg: 4, qty: 4 }),
  res('L5', 'rigging', 'L3 Load-Cell Shackle Set', '', { swlKg: 4750, headroomM: 0.2, tareKg: 12, complexity: [3, 2, 2, 3], utilities: [U.data] }),
  res('L6', 'rigging', 'L2 Vacuum Lifter 750 kg', 'C2', { swlKg: 750, headroomM: 0.5, tareKg: 40, complexity: [2, 2, 1, 2], utilities: [U.air] }),
  res('V1', 'vehicle', 'Heavy AGV Transporter', '', { swlKg: 12000, complexity: [3, 2, 1, 2], footprintLM: 4.0, footprintWM: 2.5, utilities: [U.p415, U.data] }),
  res('V2', 'vehicle', 'Air-Skate Mover', 'C4', { swlKg: 8000, complexity: [2, 2, 2, 1], footprintLM: 2.0, footprintWM: 2.0, utilities: [U.air] }),
  res('V3', 'vehicle', 'Forklift', 'C1', { swlKg: 2500, qty: 2, complexity: [1, 2, 1, 2], footprintLM: 2.5, footprintWM: 1.2 }),
  res('S1', 'stand', '3-Tier Static Build Stand', 'C4', { swlKg: 15000, tiers: 3, tierHeightM: 0.8, dwellMode: 'Full-Build', complexity: [3, 2, 3, 2], footprintLM: 12, footprintWM: 12, utilities: [U.p415, U.air, U.lev, U.data] }),
  res('S2', 'stand', 'Turnover Jig', 'C5', { swlKg: 3000, tiers: 1, tierHeightM: 0.8, complexity: [3, 3, 2, 2], footprintLM: 4, footprintWM: 3, utilities: [U.p415] }),
  res('S3', 'stand', 'WIP Storage Stillage', '', { swlKg: 1500, qty: 6, footprintLM: 1.2, footprintWM: 1.0 }),
  res('S4', 'stand', 'UMA Build Cradle', 'C5', { swlKg: 6000, tiers: 1, tierHeightM: 0.8, complexity: [1, 1, 2, 1], footprintLM: 4, footprintWM: 4 }),
  res('S5', 'stand', 'Core Barrel Assembly Fixture', 'C3', { swlKg: 2000, tiers: 1, tierHeightM: 0.8, complexity: [2, 1, 2, 2], footprintLM: 3, footprintWM: 3, utilities: [U.air] }),
];

interface RowOpt {
  par?: boolean; pre?: string[]; from?: string; to: string; lvl?: number; cmp?: string[]; crew?: number;
  run: number; touch?: number; man?: number; cls?: Classification; act: ActionType;
  rig?: string[]; crane?: string[]; rigging?: string[]; veh?: string[]; stand?: string[]; lifts?: number; moves?: number; notes?: string;
}
const row = (fpdId: string, opId: string, description: string, o: RowOpt): BopRow => ({
  id: `row_${opId}`,
  fpdId,
  opId,
  description,
  taskType: o.par ? 'Parallel' : 'Sequential',
  predecessors: o.pre ?? [],
  originZoneId: o.from ?? o.to,
  destZoneId: o.to,
  floorLevel: o.lvl ?? 0,
  componentIds: o.cmp ?? [],
  crewSize: o.crew ?? 2,
  // `man` given → equipment-paced op (Bay Run Time = run). Otherwise a manual op: no equipment cycle, Manning = run.
  runHrs: o.man === undefined ? 0 : o.run,
  touchHrs: o.touch ?? o.man ?? o.run,
  manningHrs: o.man ?? o.run,
  classification: o.cls ?? 'VA',
  actionType: o.act,
  rigIds: o.rig ?? [],
  craneIds: o.crane ?? [],
  riggingIds: o.rigging ?? [],
  vehicleIds: o.veh ?? [],
  standIds: o.stand ?? [],
  liftCount: o.lifts ?? 0,
  moveCount: o.moves ?? 0,
  notes: o.notes ?? '',
});

const rows: BopRow[] = [
  // FPD-001 Stores Receipt, Inspection & Kitting
  row('F1', 'F1-010', 'Goods receipt, booking-in and certificate of conformity check', { to: 'ZA', run: 16, touch: 12, cls: 'NNVA', act: 'Administrating' }),
  row('F1', 'F1-020', 'Receiving inspection of critical components (dimensional + visual)', { to: 'ZA', run: 24, touch: 20, cls: 'NNVA', act: 'Testing', rig: ['R4'] }),
  row('F1', 'F1-030', 'Build and marshal kits for Prep A (fuel cell + pipework)', { pre: ['F1-020'], from: 'ZA', to: 'ZA2', run: 20, touch: 16, cls: 'NNVA', act: 'Gathering', cmp: ['M01', 'M05', 'M06'], veh: ['V3'], stand: ['S3'], moves: 6 }),
  row('F1', 'F1-040', 'Build and marshal kits for Prep B (core barrel)', { par: true, pre: ['F1-020'], from: 'ZA', to: 'ZA2', run: 18, touch: 14, cls: 'NNVA', act: 'Gathering', cmp: ['M02', 'M04'], stand: ['S3'], moves: 4, notes: 'Hand pallet truck — no forklift required.' }),
  row('F1', 'F1-050', 'Marshal PMA / UMA heavy items and load stillages', { par: true, pre: ['F1-020'], from: 'ZA', to: 'ZA2', run: 24, touch: 18, cls: 'NNVA', act: 'Gathering', cmp: ['M03', 'M07', 'M08', 'M12'], veh: ['V3'], stand: ['S3'], moves: 8 }),
  row('F1', 'F1-060', 'Search, re-handle and wait for missing release paperwork', { par: true, pre: ['F1-020'], to: 'ZA2', run: 12, touch: 0, cls: 'NVA', act: 'Administrating', notes: 'Observed waste — target elimination via pre-release document check.' }),

  // FPD-002 Fuel Cell Module Preparation
  row('F2', 'F2-010', 'Move fuel cell kit from marshalling to Prep A', { pre: ['F1-030'], from: 'ZA2', to: 'ZB', run: 2, cls: 'NNVA', act: 'Moving', cmp: ['M01'], veh: ['V3'], moves: 4 }),
  row('F2', 'F2-020', 'Unpack, clean and inspect fuel cell modules', { to: 'ZB', run: 16, touch: 14, act: 'Fitting', cmp: ['M01'] }),
  row('F2', 'F2-030', 'Fit manifold blocks and seals to fuel cell modules', { to: 'ZB', run: 32, touch: 28, act: 'Fastening', cmp: ['M01', 'M06'] }),
  row('F2', 'F2-040', 'Harness pre-fit and continuity test', { to: 'ZB', run: 24, touch: 20, act: 'Fitting', cmp: ['M10'] }),
  row('F2', 'F2-050', 'Helium leak check of module manifolds', { to: 'ZB', run: 12, touch: 3, man: 6, cls: 'NNVA', act: 'Testing', rig: ['R5'], cmp: ['M01'] }),
  row('F2', 'F2-060', 'Lift completed modules to WIP stillage', { to: 'ZB', run: 3, crew: 2, cls: 'NNVA', act: 'Lifting', cmp: ['M01'], rigging: ['L6'], veh: ['V3'], stand: ['S3'], lifts: 4 }),

  // FPD-003 Core Barrel Sub-Assembly
  row('F3', 'F3-010', 'Move core barrel kit to Prep B on forklift', { pre: ['F1-040'], from: 'ZA2', to: 'ZC', run: 3, cls: 'NNVA', act: 'Moving', cmp: ['M02', 'M04'], veh: ['V3'], moves: 2 }),
  row('F3', 'F3-020', 'Lift core barrel into assembly fixture', { to: 'ZC', run: 4, crew: 3, cls: 'NNVA', act: 'Lifting', cmp: ['M02'], crane: ['K3'], rigging: ['L1'], stand: ['S5'], lifts: 1 }),
  row('F3', 'F3-030', 'Fit core support skirt and laser-align to datum', { to: 'ZC', run: 44, touch: 38, crew: 3, act: 'Fitting', cmp: ['M04'], crane: ['K3'], rigging: ['L4'], rig: ['R4'], stand: ['S5'], lifts: 1 }),
  row('F3', 'F3-040', 'Torque and tension skirt flange fasteners', { to: 'ZC', run: 28, touch: 24, act: 'Fastening', cmp: ['M11'], stand: ['S5'] }),
  row('F3', 'F3-050', 'Dimensional survey and QA buy-off of core barrel', { to: 'ZC', run: 12, touch: 10, cls: 'NNVA', act: 'Testing', rig: ['R4'], stand: ['S5'] }),

  // FPD-004 Pipework Spool Orbital Welding
  row('F4', 'F4-010', 'Spool fit-up, purge set-up and tack', { pre: ['F1-030'], to: 'ZB', run: 36, touch: 30, act: 'Fitting', cmp: ['M05'] }),
  row('F4', 'F4-020', 'Orbital weld primary pipework spools', { to: 'ZB', run: 64, touch: 18, man: 30, act: 'Welding / Joining', cmp: ['M05'], rig: ['R1'] }),
  row('F4', 'F4-030', 'NDT (radiography) and weld acceptance', { to: 'ZB', run: 24, touch: 8, man: 12, crew: 1, cls: 'NNVA', act: 'Testing', cmp: ['M05'] }),
  row('F4', 'F4-040', 'Wait for NDT results and repeat-shot re-handling', { to: 'ZB', run: 16, touch: 0, cls: 'NVA', act: 'Administrating', notes: 'Queue time behind shared radiography slot.' }),
  row('F4', 'F4-050', 'Clean, cap, tag and load spools to stillage', { to: 'ZB', run: 6, cls: 'NNVA', act: 'Gathering', cmp: ['M05'], stand: ['S3'], moves: 6 }),

  // FPD-005 PMA Main Static Build
  row('F5', 'F5-010', 'Position PMA base frame on 3-tier build stand', { pre: ['F1-050'], from: 'ZA2', to: 'ZD', run: 8, crew: 4, cls: 'NNVA', act: 'Lifting', cmp: ['M03'], crane: ['K1'], rigging: ['L2'], veh: ['V2'], stand: ['S1'], lifts: 1, moves: 1 }),
  row('F5', 'F5-020', 'Level, shim and survey base frame', { to: 'ZD', run: 60, touch: 52, crew: 3, act: 'Fitting', cmp: ['M03'], rig: ['R4'], stand: ['S1'] }),
  row('F5', 'F5-030', 'Install core barrel sub-assembly into base frame', { pre: ['F5-020', 'F3-050'], from: 'ZC', to: 'ZD', lvl: 0, run: 12, crew: 4, cls: 'NNVA', act: 'Lifting', cmp: ['M02', 'M04'], crane: ['K1'], rigging: ['L1'], veh: ['V1'], stand: ['S1'], lifts: 1, moves: 1 }),
  row('F5', 'F5-040', 'Fit support structure and Tier 1 mechanical installation', { to: 'ZD', lvl: 1, run: 260, touch: 220, crew: 4, act: 'Fitting', cmp: ['M04', 'M11'], stand: ['S1'] }),
  row('F5', 'F5-050', 'Install fuel cell modules at Level 2', { pre: ['F5-040', 'F2-060'], from: 'ZB', to: 'ZD', lvl: 2, run: 16, crew: 4, cls: 'NNVA', act: 'Lifting', cmp: ['M01'], crane: ['K1'], rigging: ['L2'], veh: ['V3'], stand: ['S1'], lifts: 4, moves: 4 }),
  row('F5', 'F5-060', 'Install pipework spools and complete closure welds', { pre: ['F5-050', 'F4-050'], to: 'ZD', lvl: 2, run: 320, touch: 250, crew: 3, act: 'Welding / Joining', cmp: ['M05'], rig: ['R1'], crane: ['K1'], rigging: ['L4'], stand: ['S1'], lifts: 6 }),
  row('F5', 'F5-070', 'Multi-nutrunner bolting of primary joints', { to: 'ZD', lvl: 2, run: 90, touch: 40, man: 90, act: 'Fastening', cmp: ['M11'], rig: ['R2'], stand: ['S1'] }),
  row('F5', 'F5-080', 'Electrical harness and instrument rack installation at Level 1', { par: true, pre: ['F5-050'], to: 'ZD', lvl: 1, run: 240, touch: 200, crew: 3, act: 'Fitting', cmp: ['M10', 'M13'], crane: ['K1'], rigging: ['L4'], stand: ['S1'], lifts: 2 }),
  row('F5', 'F5-090', 'Lift and fit closure head at Level 3', { pre: ['F5-070', 'F5-080'], to: 'ZD', lvl: 3, run: 10, crew: 4, cls: 'NNVA', act: 'Lifting', cmp: ['M12'], crane: ['K1'], rigging: ['L2'], stand: ['S1'], lifts: 1 }),
  row('F5', 'F5-100', 'In-stand pressure and leak pre-test', { to: 'ZD', lvl: 1, run: 72, touch: 14, man: 30, cls: 'NNVA', act: 'Testing', rig: ['R5'], stand: ['S1'] }),
  row('F5', 'F5-110', 'Wait for crane availability and access permits', { to: 'ZD', run: 16, touch: 0, crew: 4, cls: 'NVA', act: 'Administrating', stand: ['S1'], notes: 'Crew stood down while gantry serves parallel work.' }),

  // FPD-006 UMA Heavy Sub-Build
  row('F6', 'F6-010', 'Load UMA upper casing into build cradle', { pre: ['F1-050'], from: 'ZA2', to: 'ZE', run: 8, crew: 3, cls: 'NNVA', act: 'Lifting', cmp: ['M07'], crane: ['K2'], rigging: ['L1'], veh: ['V1'], stand: ['S4'], lifts: 1, moves: 1 }),
  row('F6', 'F6-020', 'Install heat exchanger bundle', { to: 'ZE', run: 60, touch: 50, crew: 3, act: 'Fitting', cmp: ['M08'], crane: ['K2'], rigging: ['L1', 'L5'], stand: ['S4'], lifts: 1 }),
  row('F6', 'F6-030', 'Internal fit-out and fastening', { to: 'ZE', run: 200, touch: 170, crew: 3, act: 'Fastening', cmp: ['M11'], stand: ['S4'] }),
  row('F6', 'F6-040', 'Turn over and re-orient UMA in turnover jig', { to: 'ZE', run: 6, crew: 4, cls: 'NNVA', act: 'Lifting', cmp: ['M07', 'M08'], crane: ['K2'], rigging: ['L3'], stand: ['S2'], lifts: 1 }),
  row('F6', 'F6-045', 'Wait for turnover jig release and re-sling after turnover', { to: 'ZE', run: 9, touch: 0, crew: 3, cls: 'NVA', act: 'Administrating', stand: ['S2'], notes: 'Jig thorough-examination paperwork not available at point of use.' }),
  row('F6', 'F6-050', 'Control cabinet and harness fit', { to: 'ZE', run: 120, touch: 100, act: 'Fitting', cmp: ['M09', 'M10'], crane: ['K2'], rigging: ['L4'], stand: ['S4'], lifts: 1 }),
  row('F6', 'F6-060', 'UMA sub-build inspection and buy-off', { to: 'ZE', run: 16, touch: 12, cls: 'NNVA', act: 'Testing', stand: ['S4'] }),

  // FPD-007 PMA / UMA Mate & Integration
  row('F7', 'F7-010', 'Transport UMA sub-build to PMA stand', { pre: ['F5-110', 'F6-060'], from: 'ZE', to: 'ZD', run: 6, crew: 3, cls: 'NNVA', act: 'Moving', cmp: ['M15'], veh: ['V1'], moves: 1 }),
  row('F7', 'F7-020', 'Mate UMA to PMA on build stand', { to: 'ZD', lvl: 1, run: 16, crew: 5, cls: 'NNVA', act: 'Lifting', cmp: ['M15'], crane: ['K1'], rigging: ['L3'], stand: ['S1'], lifts: 1 }),
  row('F7', 'F7-030', 'Interface bolting and alignment verification', { to: 'ZD', lvl: 2, run: 100, touch: 70, crew: 3, act: 'Fastening', cmp: ['M11'], rig: ['R2', 'R4'], stand: ['S1'] }),
  row('F7', 'F7-040', 'System integration, harness mating and functional checks', { to: 'ZD', lvl: 2, run: 180, touch: 150, crew: 3, act: 'Fitting', cmp: ['M10', 'M13'], stand: ['S1'] }),
  row('F7', 'F7-050', 'Integration QA buy-off', { to: 'ZD', run: 30, touch: 24, cls: 'NNVA', act: 'Testing', stand: ['S1'] }),

  // FPD-008 Final Hydro Test, Inspection & Dispatch
  row('F8', 'F8-010', 'Transfer mated assembly to test bay', { pre: ['F7-050'], from: 'ZD', to: 'ZF', run: 10, crew: 4, cls: 'NNVA', act: 'Moving', veh: ['V1', 'V2'], moves: 1 }),
  row('F8', 'F8-020', 'High-pressure hydro test', { to: 'ZF', run: 96, touch: 16, man: 40, cls: 'NNVA', act: 'Testing', rig: ['R3'] }),
  row('F8', 'F8-025', 'Wait for test witness availability', { to: 'ZF', run: 14, touch: 0, cls: 'NVA', act: 'Administrating', notes: 'Witness attendance not booked against the build schedule.' }),
  row('F8', 'F8-030', 'Final functional and acceptance test', { to: 'ZF', run: 80, touch: 45, man: 60, cls: 'NNVA', act: 'Testing' }),
  row('F8', 'F8-040', 'Final inspection and documentation pack', { to: 'ZF', run: 60, touch: 50, cls: 'NNVA', act: 'Administrating' }),
  row('F8', 'F8-050', 'Preserve, pack and secure to transit frame', { from: 'ZF', to: 'ZG', run: 36, touch: 30, crew: 4, cls: 'NNVA', act: 'Moving', cmp: ['M14'], veh: ['V2', 'V3'], moves: 2 }),
  row('F8', 'F8-060', 'Dispatch release and vehicle loading', { to: 'ZG', run: 8, crew: 3, cls: 'NNVA', act: 'Moving', veh: ['V1'], moves: 1 }),
];

const rect = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

/** A completely empty workspace — no FPDs, no rows, no PFMEA, no components, no resources. */
export function blankWorkspace(): Workspace {
  const now = new Date().toISOString();
  return {
    schema: WORKSPACE_SCHEMA,
    meta: { name: 'New Workspace', factoryId: 'F1', factoryName: 'Factory 1', createdAt: now, updatedAt: now, appVersion: APP_VERSION },
    settings: defaultSettings(),
    cells: [],
    zones: [],
    fpds: [],
    components: [],
    resources: [],
    rows: [],
    pfmea: [],
    holdPoints: [],
    assumptions: [],
    ancillaries: [],
    gateSignoffs: {},
    mitigations: {},
    layout: { snapM: 0.5, image: null, shapes: [], floors: [], floorAreaOverrideM2: null },
  };
}

export function seedWorkspace(): Workspace {
  const now = new Date().toISOString();
  return {
    schema: WORKSPACE_SCHEMA,
    meta: { name: 'PMA / UMA Heavy Assembly Baseline', factoryId: 'F4', factoryName: 'F4 · Static Build & Heavy Assembly Factory', createdAt: now, updatedAt: now, appVersion: APP_VERSION },
    settings: defaultSettings(),
    cells: structuredClone(cells),
    zones: structuredClone(zones),
    fpds: structuredClone(fpds),
    components: structuredClone(components),
    resources: structuredClone(resources),
    rows: structuredClone(rows),
    ancillaries: [],
    pfmea: [
      { id: 'P1', fpdId: 'F5', opId: 'F5-090', failureMode: 'Closure head contacts gantry hook block before clearing Level 3 landing', effect: 'Dropped / snagged load, damage to closure head sealing face, injury to slinger at height', cause: 'Required hook height exceeds 3.5 m gantry envelope with spreader beam fitted', controls: 'Lift plan review; spotter at Level 3', s: 9, o: 5, d: 5, recommendedAction: 'Re-plan lift with low-headroom round slings or lower the landing level; re-run the hook-height stack-up in Tab 4.', owner: 'Lifting Appointed Person', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: ['K1', 'L2', 'S1'] },
      { id: 'P9', fpdId: 'F5', opId: 'F5-090', failureMode: 'Closure head sealing face damaged on landing', effect: 'Seal leak found at hydro test; closure head removal and re-lap', cause: 'Head lowered out of level; no soft-landing packers', controls: 'Level check on spreader; landing packers in kit', s: 8, o: 2, d: 3, recommendedAction: 'Add packer check to the lift plan sign-off sheet.', owner: 'Manufacturing Engineer', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: ['L2', 'S1'] },
      { id: 'P2', fpdId: 'F5', opId: 'F5-010', failureMode: 'Base frame lift at >90% of gantry SWL', effect: 'Overload trip mid-lift, load left suspended over stand', cause: 'Frame 2,180 kg plus 85 kg spreader beam against 2,500 kg SWL', controls: 'Load-cell shackle read-out; calibrated SWL limiter', s: 8, o: 3, d: 3, recommendedAction: 'Confirm weighed mass of base frame at goods-in; remove transit fittings before lift.', owner: 'Manufacturing Engineer', status: 'In Progress', controlDocForced: false, controlDocRef: 'LP-PMA-014 Base Frame Lift Plan', resourceIds: ['K1', 'L2'] },
      { id: 'P3', fpdId: 'F4', opId: 'F4-020', failureMode: 'Orbital weld lack of fusion on spool butt joint', effect: 'Weld rejected at radiography; cut-out and re-weld delays pipework install', cause: 'Purge gas contamination or incorrect weld schedule selected', controls: 'Weld procedure qualification; purge oxygen monitor; coupon per shift', s: 7, o: 4, d: 3, recommendedAction: 'Add weld-schedule barcode interlock on rig.', owner: 'Welding Engineer', status: 'Open', controlDocForced: false, controlDocRef: 'WPS-ORB-007', resourceIds: ['R1'] },
      { id: 'P4', fpdId: 'F5', opId: 'F5-070', failureMode: 'Primary joint under-torqued', effect: 'Joint leak at hydro test; re-work on stand', cause: 'Nutrunner channel out of calibration', controls: 'Daily torque verification; angle monitoring', s: 8, o: 2, d: 2, recommendedAction: 'None — controls adequate.', owner: 'Quality Engineer', status: 'Closed', controlDocForced: false, controlDocRef: 'WI-5070 Torque Procedure', resourceIds: ['R2'] },
      { id: 'P5', fpdId: 'F7', opId: 'F7-020', failureMode: 'UMA misaligned to PMA dowels during mate', effect: 'Dowel damage and interface re-machining', cause: 'Load swing; inadequate guide pins; poor visibility for crane operator', controls: 'Guide pins; 5-person lift team with dedicated signaller', s: 8, o: 4, d: 4, recommendedAction: 'Introduce laser-tracker live alignment during final 50 mm of lowering.', owner: 'Manufacturing Engineer', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: ['K1', 'L3', 'S1'] },
      { id: 'P6', fpdId: 'F3', opId: 'F3-020', failureMode: 'Jib crane loaded near SWL with core barrel', effect: 'Jib deflection, uncontrolled slew', cause: 'Barrel 920 kg plus sling tare on 1.0 t jib', controls: 'Pre-use check; no side loading', s: 7, o: 3, d: 4, recommendedAction: 'Assess move of this lift to PMA gantry or uprate jib.', owner: 'Lifting Appointed Person', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: ['K3', 'L1'] },
      { id: 'P7', fpdId: 'F8', opId: 'F8-020', failureMode: 'Hydro test pressure not held', effect: 'Test repeat (4 days); programme slip on critical path', cause: 'Seal damage during integration', controls: 'In-stand pre-test (F5-100)', s: 6, o: 3, d: 2, recommendedAction: 'Trend pre-test leak rates build to build.', owner: 'Test Engineer', status: 'In Progress', controlDocForced: false, controlDocRef: '', resourceIds: ['R3'] },
      { id: 'P8', fpdId: 'F1', opId: 'F1-020', failureMode: 'Non-conforming component accepted at receipt', effect: 'Defect found on build stand; strip-down', cause: 'Sampling inspection misses dimensional non-conformance', controls: 'Supplier CofC; first-article inspection', s: 7, o: 3, d: 5, recommendedAction: 'Extend 100% dimensional check to core barrel and base frame.', owner: 'Quality Engineer', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: ['R4'] },
    ],
    holdPoints: [
      { id: 'H1', fpdId: 'F3', opId: 'F3-050', type: 'Hold', title: 'Core barrel dimensional buy-off', notes: 'Survey report signed by QA before barrel leaves fixture.', status: 'Released' },
      { id: 'H2', fpdId: 'F4', opId: 'F4-030', type: 'Hold', title: 'Weld radiography acceptance', notes: 'All spool butt welds accepted to procedure before capping.', status: 'Released' },
      { id: 'H3', fpdId: 'F5', opId: 'F5-090', type: 'Witness', title: 'Closure head lift — customer witness', notes: 'Customer representative and Lifting Appointed Person present. Lift plan must be re-issued once hook-height breach is closed.', status: 'Planned' },
      { id: 'H4', fpdId: 'F5', opId: 'F5-100', type: 'Hold', title: 'In-stand pressure pre-test result', notes: 'Leak rate within limit before UMA mate.', status: 'Planned' },
      { id: 'H5', fpdId: 'F7', opId: 'F7-050', type: 'Hold', title: 'Integration QA buy-off', notes: 'Interface torque records and alignment report complete.', status: 'Planned' },
      { id: 'H6', fpdId: 'F8', opId: 'F8-020', type: 'Witness', title: 'High-pressure hydro test witness', notes: 'Regulator / customer witness of hold period.', status: 'Planned' },
    ],
    assumptions: [
      { id: 'A1', text: 'Two-shift pattern (2 × 7.5 h) is available in every cell for the full build.', owner: 'Operations', confirmed: true },
      { id: 'A2', text: 'Component weights are drawing nominal; base frame and UMA sub-build to be weighed at first build.', owner: 'Manufacturing Engineering', confirmed: false },
      { id: 'A3', text: 'PMA overhead gantry hook height of 3.5 m is measured to the hook saddle at upper limit.', owner: 'Facilities', confirmed: true },
      { id: 'A4', text: 'Learning curve of 130% → 110% over four step reductions is carried over from the previous programme.', owner: 'Industrial Engineering', confirmed: true },
      { id: 'A5', text: 'Radiography slot is shared with another programme — queue time of 16 h per build assumed.', owner: 'Quality', confirmed: false },
    ],
    gateSignoffs: {},
    mitigations: {
      S1: 'Single 3-tier stand is locked for the whole build (Full-Build Dwell). Options: (1) second stand set before peak rate, (2) move integration QA and pre-test off-stand to release it earlier.',
    },
    layout: {
      snapM: 0.5,
      image: null,
      floors: [],
      floorAreaOverrideM2: null,
      shapes: [
        { id: 'sh1', target: 'cell:C1', label: 'Cell 1', points: rect(2, 2, 14, 20) },
        { id: 'sh2', target: 'stores', label: 'Main Stores Input', points: rect(2, 22, 14, 38) },
        { id: 'sh3', target: 'cell:C2', label: 'Cell 2', points: rect(16, 22, 32, 38) },
        { id: 'sh4', target: 'cell:C3', label: 'Cell 3', points: rect(16, 2, 32, 20) },
        { id: 'sh5', target: 'cell:C4', label: 'Cell 4', points: rect(34, 2, 58, 24) },
        { id: 'sh6', target: 'stand', label: 'Large Multi-Tier Build Stand', points: rect(40, 6, 52, 18) },
        { id: 'sh7', target: 'cell:C5', label: 'Cell 5', points: rect(34, 26, 58, 38) },
        { id: 'sh8', target: 'cell:C6', label: 'Cell 6', points: rect(60, 2, 78, 26) },
        { id: 'sh9', target: 'dispatch', label: 'Final Dispatch Bay', points: rect(60, 28, 78, 38) },
      ],
    },
  };
}

/** A blank activity row for the given FPD. */
export function blankRow(fpdId: string, opId: string, zoneId = ''): BopRow {
  return { ...row(fpdId, opId, '', { to: zoneId, run: 0, act: 'Fitting' }), id: uid('row') };
}
export function blankResource(kind: ResourceKind, id: string): Resource {
  return res(id, kind, '', '');
}
export function blankAncillary(kind: AncillaryKind = 'other'): Ancillary {
  return { id: uid('anc'), name: 'New ancillary', kind, cellId: '', floorLevel: 0, lengthM: null, widthM: null, qty: 1, notes: '' };
}
