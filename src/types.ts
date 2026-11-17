// Domain model for Assembly & Static Build Central Spine v1.0
export type Id = string;
export type Rag = 'green' | 'amber' | 'serious' | 'red';

export const APP_NAME = 'Assembly & Static Build Central Spine';
export const APP_VERSION = '1.0';
export const WORKSPACE_SCHEMA = 'asbcs-workspace@1';
export const SUMMARY_SCHEMA = 'summary@V2';

// ---------- Registry ----------
export interface Fpd {
  fpdId: Id;
  fpdCode: string;
  title: string;
  subAssemblyBomRef: string;
  assignedCellId: Id;
  /** Additional cells this FPD spans — metadata only, not used for analysis filtering. */
  assignedCellIds?: Id[];
  /** How activities in this FPD are sequenced across the schedule. */
  sequenceMode?: 'explicit' | 'chain';
  revision: string;
  active: boolean;
}

export interface Cell {
  id: Id;
  number: number;
  name: string;
  crewPerShift: number;
  notes: string;
}

export interface Zone {
  id: Id;
  cellId: Id;
  /** Short letter/code (e.g. "A", "B"). Optional; legacy zones without it fall back to parsing the name. */
  code?: string;
  name: string;
  /** Station point on the floor plan (m). Falls back to the cell shape centroid. */
  pos: Pt | null;
  /** Proposed future-state station point (m); null = unchanged. */
  futurePos: Pt | null;
  /** Maximum crew that can work safely on one stand floor level of this zone at once. */
  maxCrewPerLevel: number | null;
}

/** Returns the display label for a zone: "Zone A · Name" or just the name if no code. */
export const zoneLabel = (z: Pick<Zone, 'code' | 'name'>): string =>
  z.code ? `Zone ${z.code} · ${z.name}` : z.name;

export interface Component {
  id: Id;
  bomRef: string;
  name: string;
  weightKg: number | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  qtyPerBuild: number;
  notes: string;
}

export type ResourceKind = 'rig' | 'crane' | 'rigging' | 'vehicle' | 'stand';
export const RESOURCE_KINDS: { kind: ResourceKind; label: string; plural: string; field: ResourceField }[] = [
  { kind: 'rig', label: 'Tooling & Equipment', plural: 'Tooling & Equipment', field: 'rigIds' },
  { kind: 'crane', label: 'Crane', plural: 'Cranes', field: 'craneIds' },
  { kind: 'rigging', label: 'Rigging & Lifting Gear', plural: 'Rigging & Lifting Gear (L2/L3)', field: 'riggingIds' },
  { kind: 'vehicle', label: 'Transport Vehicle', plural: 'Transport Vehicles', field: 'vehicleIds' },
  { kind: 'stand', label: 'Build / Storage Stand', plural: 'Build & Storage Stands', field: 'standIds' },
];
export type ResourceField = 'rigIds' | 'craneIds' | 'riggingIds' | 'vehicleIds' | 'standIds';
export type Complexity = 'Simple' | 'Medium' | 'Complex';
/** 1–3 Complexity Scoring Matrix: four criteria, each scored 1 (low) to 3 (high). */
export const COMPLEXITY_CRITERIA: { label: string; levels: [string, string, string] }[] = [
  { label: 'Technical / Controls', levels: ['Passive or manual', 'Powered, simple controls', 'Programmed, multi-axis or interlocked'] },
  { label: 'Operator Skill & Certification', levels: ['General operative', 'Trained and authorised', 'Certified specialist'] },
  { label: 'Set-Up & Changeover', levels: ['Ready to use', 'Adjust and verify', 'Configure, prove out and sign off'] },
  { label: 'Upkeep, Calibration & Statutory Exam', levels: ['Visual check', 'Periodic calibration or exam', 'Frequent calibration and thorough examination'] },
];
export const UTILITY_SERVICES = [
  '415 V 3-phase', '230 V single-phase', 'Compressed air', 'Argon / shield gas', 'Helium', 'Demineralised water', 'Extraction (LEV)', 'Data / network', 'Hydraulic power',
] as const;
export type DwellMode = 'Per-Op' | 'Full-Build';

export interface Resource {
  id: Id;
  kind: ResourceKind;
  name: string;
  qty: number;
  cellId: Id | '';
  /** Safe / working load limit (cranes, rigging, vehicles, stands). */
  swlKg: number | null;
  /** Cranes: maximum hook height above finished floor. */
  hookHeightM: number | null;
  /** Rigging: headroom consumed between hook and top of load. */
  headroomM: number | null;
  /** Rigging: self-weight added to the lifted load. */
  tareKg: number | null;
  /** Stands: number of floors and height of each floor. */
  tiers: number | null;
  tierHeightM: number | null;
  /** Four 1–3 scores, in COMPLEXITY_CRITERIA order. */
  complexity: number[];
  /** Floor claim of one unit (m). */
  footprintLM: number | null;
  footprintWM: number | null;
  utilities: string[];
  dwellMode: DwellMode;
  notes: string;
  /** Cranes: installed floor level index (0 = Ground). */
  floorLevel?: number;
  /** Cranes: hoist well / cross-floor crane spanning multiple levels. */
  hoistWell?: boolean;
}
export const complexityScore = (r: Pick<Resource, 'complexity'>): number =>
  COMPLEXITY_CRITERIA.reduce((a, _c, i) => a + Math.min(3, Math.max(1, Math.round(r.complexity?.[i] ?? 1))), 0);
/** 4–6 Simple · 7–9 Medium · 10–12 Complex */
export const complexityOf = (r: Pick<Resource, 'complexity'>): Complexity => {
  const s = complexityScore(r);
  return s <= 6 ? 'Simple' : s <= 9 ? 'Medium' : 'Complex';
};
export const floorClaimM2 = (r: Resource): number => (r.footprintLM ?? 0) * (r.footprintWM ?? 0) * Math.max(1, r.qty);

// ---------- Bill of Process ----------
export type TaskType = 'Sequential' | 'Parallel';
export type Classification = 'VA' | 'NNVA' | 'NVA';
export const CLASSIFICATIONS: { value: Classification; label: string }[] = [
  { value: 'VA', label: 'Value-Add (VA)' },
  { value: 'NNVA', label: 'Necessary Non-Value-Add (NNVA)' },
  { value: 'NVA', label: 'Pure Waste (NVA)' },
];
export const ACTION_TYPES = [
  'Administrating',
  'Gathering',
  'Lifting',
  'Welding / Joining',
  'Fastening',
  'Moving',
  'Fitting',
  'Testing',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const FLOOR_LEVELS = ['Ground', 'Level 1', 'Level 2', 'Level 3'] as const;

export interface BopRow {
  id: Id;
  fpdId: Id;
  /** Route code / Op # — globally unique, used by predecessor links. */
  opId: string;
  /** Agreed Baseline Hours for this row / work block. Used to calculate Variance vs Modelled. */
  baselineHrs?: number;
  description: string;
  taskType: TaskType;
  predecessors: string[];
  originZoneId: Id | '';
  destZoneId: Id | '';
  /** 0 = Ground … 3 = Level 3 */
  floorLevel: number;
  componentIds: Id[];
  crewSize: number;
  runHrs: number;
  touchHrs: number;
  manningHrs: number;
  classification: Classification;
  actionType: ActionType;
  rigIds: Id[];
  craneIds: Id[];
  riggingIds: Id[];
  vehicleIds: Id[];
  standIds: Id[];
  liftCount: number;
  moveCount: number;
  notes: string;
  /** Present when this row is a merged Baseline Work Block. Children keep full detail. */
  children?: BopRow[];
}

// ---------- PFMEA / Quality / Governance ----------
export type PfmeaStatus = 'Open' | 'In Progress' | 'Closed';
export interface PfmeaItem {
  id: Id;
  fpdId: Id | '';
  opId: string;
  failureMode: string;
  effect: string;
  cause: string;
  controls: string;
  s: number;
  o: number;
  d: number;
  recommendedAction: string;
  owner: string;
  status: PfmeaStatus;
  /** Manually require a control document even when the automatic rule does not. */
  controlDocForced: boolean;
  controlDocRef: string;
  /** Assigned tooling / rig / vehicle / stand (resource ids). */
  resourceIds: Id[];
}

export type HoldPointType = 'Hold' | 'Witness' | 'Review';
export type HoldPointStatus = 'Planned' | 'Released' | 'Rejected';
export interface HoldPoint {
  id: Id;
  fpdId: Id | '';
  opId: string;
  type: HoldPointType;
  title: string;
  notes: string;
  status: HoldPointStatus;
}

export interface Assumption {
  id: Id;
  text: string;
  owner: string;
  confirmed: boolean;
  /** Cell ID this assumption applies to, or '' / undefined for factory-wide. */
  cellId?: Id | '';
}


export interface GateSignoff {
  by: string;
  on: string;
  comment: string;
}

// ---------- Ancillaries ----------
export type AncillaryKind = 'pc-station' | 'storage-cabinet' | 'kitting-bench' | 'other';
export const ANCILLARY_KINDS: { value: AncillaryKind; label: string }[] = [
  { value: 'pc-station', label: 'PC / Engineering Station' },
  { value: 'storage-cabinet', label: 'Tooling Storage Cabinet' },
  { value: 'kitting-bench', label: 'Kitting Bench' },
  { value: 'other', label: 'Other Ancillary' },
];
export interface Ancillary {
  id: Id;
  name: string;
  kind: AncillaryKind;
  cellId: Id | '';
  floorLevel: number;
  lengthM: number | null;
  widthM: number | null;
  qty: number;
  notes: string;
}

// ---------- Layout ----------
export type Pt = [number, number];
export interface LayoutShape {
  id: Id;
  /** e.g. 'cell:C1', 'stores', 'stand', 'dispatch' or '' for unassigned imports */
  target: string;
  label: string;
  /** Polygon vertices in metres, origin top-left of the factory boundary. */
  points: Pt[];
}
export interface LayoutImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** metres per pixel after 2-point calibration (null until calibrated) */
  mPerPx: number | null;
  calib: { a: Pt; b: Pt; distanceM: number } | null;
}
export interface FloorPlan {
  id: Id;
  name: string;
  /** Floor elevation above ground datum (m). */
  elevationM: number;
  image: LayoutImage | null;
  shapes: LayoutShape[];
}
export interface Layout {
  shapes: LayoutShape[];
  image: LayoutImage | null;
  snapM: number;
  /** Additional floor levels above ground (each with their own image and polygons). */
  floors?: FloorPlan[];
  /** Manual override for total factory floor area (m²). Null = use envelope L × W. */
  floorAreaOverrideM2?: number | null;
}

// ---------- Settings ----------
export interface Settings {
  programme: {
    baselineOpMonths: number;
    demandNominal: number;
    demandPeak: number;
    drumbeatMonths: number;
    demandCase: 'Nominal' | 'Peak';
    labourRateGbp: number;
  };
  learning: {
    firstBuildPct: number;
    stabilisedPct: number;
    stepReductionPct: number;
    stepBuilds: number;
    selectedBuild: number;
  };
  calendar: {
    shiftsPerDay: number;
    hoursPerShift: number;
    workingDaysPerYear: number;
    wasteMode: 'Automated' | 'Manual';
    manualWastePct: number;
    activeTimeFactorPct: number;
    labourEfficiencyPct: number;
  };
  envelope: { lengthM: number; widthM: number };
  crane: {
    primarySwlKg: number;
    hookHeightM: number;
    clearanceMarginM: number;
    avgLiftCycleHrs: number;
    tandemDeratePct: number;
    defaultTierHeightM: number;
    defaultRiggingHeadroomM: number;
  };
  thresholds: {
    heavyLiftKg: number;
    multiPersonCrew: number;
    highElevationM: number;
    highElevationFloors: number;
    multiToolItems: number;
    dutyAmberPct: number;
    dutySeriousPct: number;
    arRedPct: number;
    arMinCycleMin: number;
    nearCriticalFloatHrs: number;
    rpnAmber: number;
    rpnSerious: number;
    rpnRed: number;
    blindSpotSeverity: number;
  };
}

export interface Workspace {
  schema: typeof WORKSPACE_SCHEMA;
  meta: { name: string; factoryId: string; factoryName: string; createdAt: string; updatedAt: string; appVersion: string };
  settings: Settings;
  cells: Cell[];
  zones: Zone[];
  fpds: Fpd[];
  components: Component[];
  resources: Resource[];
  rows: BopRow[];
  pfmea: PfmeaItem[];
  holdPoints: HoldPoint[];
  assumptions: Assumption[];
  ancillaries: Ancillary[];
  gateSignoffs: Record<string, GateSignoff>;
  mitigations: Record<string, string>;
  layout: Layout;
}

// ---------- Spine filter (UI scope) ----------
export type ScopeMode = 'factory' | 'cell' | 'fpd';
export interface Scope {
  mode: ScopeMode;
  cellIds: Id[];
  fpdIds: Id[];
  zoneId: Id | '';
}
export const FACTORY_SCOPE: Scope = { mode: 'factory', cellIds: [], fpdIds: [], zoneId: '' };

let _seq = 0;
export const uid = (p = 'id'): Id =>
  `${p}_${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
