// Registry types: Fpd, Cell, Zone, Component, Resource and their helpers.
import type { Id, Rag } from './constants';
import type { Pt } from './layout';

export interface Fpd {
  fpdId: Id; fpdCode: string; title: string; subAssemblyBomRef: string;
  assignedCellId: Id;
  /** Additional cells this FPD spans — metadata only, not used for analysis filtering. */
  assignedCellIds?: Id[];
  /** How activities in this FPD are sequenced across the schedule. */
  sequenceMode?: 'explicit' | 'chain';
  revision: string; active: boolean;
}

export interface Cell { id: Id; number: number; name: string; crewPerShift: number; notes: string; }

export interface Zone {
  id: Id; cellId: Id;
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
  id: Id; bomRef: string; name: string;
  weightKg: number | null; lengthM: number | null; widthM: number | null; heightM: number | null;
  qtyPerBuild: number; notes: string;
}

export type ResourceKind = 'rig' | 'crane' | 'rigging' | 'vehicle' | 'stand';
export type ResourceField = 'rigIds' | 'craneIds' | 'riggingIds' | 'vehicleIds' | 'standIds';
export const RESOURCE_KINDS: { kind: ResourceKind; label: string; plural: string; field: ResourceField }[] = [
  { kind: 'rig', label: 'Tooling & Equipment', plural: 'Tooling & Equipment', field: 'rigIds' },
  { kind: 'crane', label: 'Crane', plural: 'Cranes', field: 'craneIds' },
  { kind: 'rigging', label: 'Rigging & Lifting Gear', plural: 'Rigging & Lifting Gear (L2/L3)', field: 'riggingIds' },
  { kind: 'vehicle', label: 'Transport Vehicle', plural: 'Transport Vehicles', field: 'vehicleIds' },
  { kind: 'stand', label: 'Build / Storage Stand', plural: 'Build & Storage Stands', field: 'standIds' },
];

export type Complexity = 'Simple' | 'Medium' | 'Complex';
export const COMPLEXITY_CRITERIA: { label: string; levels: [string, string, string] }[] = [
  { label: 'Technical / Controls', levels: ['Passive or manual', 'Powered, simple controls', 'Programmed, multi-axis or interlocked'] },
  { label: 'Operator Skill & Certification', levels: ['General operative', 'Trained and authorised', 'Certified specialist'] },
  { label: 'Set-Up & Changeover', levels: ['Ready to use', 'Adjust and verify', 'Configure, prove out and sign off'] },
  { label: 'Upkeep, Calibration & Statutory Exam', levels: ['Visual check', 'Periodic calibration or exam', 'Frequent calibration and thorough examination'] },
];
export const UTILITY_SERVICES = ['415 V 3-phase', '230 V single-phase', 'Compressed air', 'Argon / shield gas', 'Helium', 'Demineralised water', 'Extraction (LEV)', 'Data / network', 'Hydraulic power'] as const;
export type DwellMode = 'Per-Op' | 'Full-Build';

export interface Resource {
  id: Id; kind: ResourceKind; name: string; qty: number; cellId: Id | '';
  swlKg: number | null; hookHeightM: number | null; headroomM: number | null; tareKg: number | null;
  tiers: number | null; tierHeightM: number | null;
  complexity: number[]; footprintLM: number | null; footprintWM: number | null;
  utilities: string[]; dwellMode: DwellMode; notes: string;
  floorLevel?: number; hoistWell?: boolean;
}

export const complexityScore = (r: Pick<Resource, 'complexity'>): number =>
  COMPLEXITY_CRITERIA.reduce((a, _c, i) => a + Math.min(3, Math.max(1, Math.round(r.complexity?.[i] ?? 1))), 0);

/** 4–6 Simple · 7–9 Medium · 10–12 Complex */
export const complexityOf = (r: Pick<Resource, 'complexity'>): Complexity => {
  const s = complexityScore(r);
  return s <= 6 ? 'Simple' : s <= 9 ? 'Medium' : 'Complex';
};

export const floorClaimM2 = (r: Resource): number => (r.footprintLM ?? 0) * (r.footprintWM ?? 0) * Math.max(1, r.qty);

export type AncillaryKind = 'pc-station' | 'storage-cabinet' | 'kitting-bench' | 'other';
export const ANCILLARY_KINDS: { value: AncillaryKind; label: string }[] = [
  { value: 'pc-station', label: 'PC / Engineering Station' },
  { value: 'storage-cabinet', label: 'Tooling Storage Cabinet' },
  { value: 'kitting-bench', label: 'Kitting Bench' },
  { value: 'other', label: 'Other Ancillary' },
];
export interface Ancillary {
  id: Id; name: string; kind: AncillaryKind; cellId: Id | ''; floorLevel: number;
  lengthM: number | null; widthM: number | null; qty: number; notes: string;
}

export type { Rag };
