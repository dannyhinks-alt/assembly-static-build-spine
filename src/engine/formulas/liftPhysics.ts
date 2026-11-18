// Lift-safety physics: component weight resolution, hook-height geometry, and RAG rating.
// Pure functions — no React, no DOM.
import type { BopRow, Id, Rag, Resource, Settings, Workspace } from '../../types';
import { complexityOf } from '../../types';
import { worstRag } from '../../lib/format';
import type { LeafCalc } from './activityMetrics';

export interface LiftRecord {
  rowId: Id; leafId: Id; fpdId: Id; opId: string; description: string; lifts: number;
  loadKg: number | null; missingWeight: boolean;
  capacityKg: number; capacitySource: string; utilPct: number | null;
  tandem: boolean; elevationM: number; floorLevel: number;
  requiredHookM: number; availableHookM: number; hookMarginM: number; hookBreach: boolean;
  compHeightM: number; headroomM: number; clearanceM: number;
  zoneId: Id; craneIds: Id[]; standIds: Id[]; crew: number;
  heavy: boolean; multiPerson: boolean; highElevation: boolean; complex: boolean; multiTool: boolean;
  flagCount: number; rag: Rag; startHrs: number;
}

type ResolvedResources = { cranes: Resource[]; rigging: Resource[]; stands: Resource[]; rigs: Resource[] };

/** Looks up resources by ID array, filtering out any missing entries. */
function resolveResources(ids: { craneIds: Id[]; riggingIds: Id[]; standIds: Id[]; rigIds: Id[] }, ws: Workspace): ResolvedResources {
  const res = (idList: Id[]) => idList.map((id) => ws.resources.find((r) => r.id === id)).filter((r): r is Resource => !!r);
  return { cranes: res(ids.craneIds), rigging: res(ids.riggingIds), stands: res(ids.standIds), rigs: res(ids.rigIds) };
}

/** Calculates the gross payload and tare weight for a lift. */
function resolveLoadKg(
  leaf: BopRow,
  comps: (NonNullable<Workspace['components'][0]>)[],
  rigging: Resource[],
): { loadKg: number | null; missingWeight: boolean } {
  const missingWeight = comps.length === 0 || comps.some((c) => c.weightKg == null || c.weightKg <= 0);
  if (missingWeight) return { loadKg: null, missingWeight };
  const weights = comps.map((c) => c.weightKg!);
  const tare = rigging.reduce((acc, r) => acc + (r.tareKg ?? 0), 0);
  const payload = leaf.liftCount >= weights.length ? Math.max(...weights) : weights.reduce((a, b) => a + b, 0);
  return { loadKg: payload + tare, missingWeight };
}

/** Resolves the governing crane or rigging capacity for the lift. */
function resolveCapacityKg(
  cranes: Resource[],
  rigging: Resource[],
  s: Settings,
): { capacityKg: number; capacitySource: string; tandem: boolean } {
  const tandem = cranes.length >= 2;
  let capacityKg = s.crane.primarySwlKg;
  let capacitySource = 'Primary crane SWL (Tab 1)';
  if (cranes.length === 1) {
    capacityKg = cranes[0].swlKg ?? s.crane.primarySwlKg;
    capacitySource = cranes[0].name;
  } else if (tandem) {
    capacityKg = cranes.reduce((acc, c) => acc + (c.swlKg ?? 0), 0) * (1 - s.crane.tandemDeratePct / 100);
    capacitySource = `Tandem (${cranes.length} cranes, −${s.crane.tandemDeratePct}%)`;
  }
  for (const r of rigging) {
    if (r.swlKg != null && r.swlKg < capacityKg) { capacityKg = r.swlKg; capacitySource = `${r.name} (WLL)`; }
  }
  return { capacityKg, capacitySource, tandem };
}

/** Calculates the required hook height and available margin for a lift at a given stand level. */
function resolveHookGeometry(
  leaf: BopRow,
  comps: (NonNullable<Workspace['components'][0]>)[],
  cranes: Resource[],
  rigging: Resource[],
  stands: Resource[],
  s: Settings,
): { elevationM: number; compHeightM: number; headroomM: number; requiredHookM: number; availableHookM: number; hookMarginM: number } {
  const tierH = stands.find((x) => x.tierHeightM != null)?.tierHeightM ?? s.crane.defaultTierHeightM;
  const elevationM = leaf.floorLevel * tierH;
  const compHeightM = Math.max(0, ...comps.map((c) => c.heightM ?? 0));
  // Sum all rigging headroom values (additive stack-up), falling back to the global default.
  const headroomM = rigging.length
    ? rigging.reduce((acc, r) => acc + (r.headroomM ?? s.crane.defaultRiggingHeadroomM), 0)
    : s.crane.defaultRiggingHeadroomM;
  const requiredHookM = elevationM + compHeightM + headroomM + s.crane.clearanceMarginM;
  const availableHookM = cranes.length
    ? Math.min(...cranes.map((c) => c.hookHeightM ?? s.crane.hookHeightM))
    : s.crane.hookHeightM;
  const hookMarginM = availableHookM - requiredHookM;
  return { elevationM, compHeightM, headroomM, requiredHookM, availableHookM, hookMarginM };
}

/**
 * Purpose: Derives the RAG safety rating for a lift operation from its physical flags,
 *   SWL utilisation, and hook-height compliance.
 *
 * Formula:
 *   flagCount = count of (heavy, multiPerson, highElevation, complex, multiTool)
 *   base RAG: green (0 flags) → amber (≥1) → serious (≥3) → red (breach or over SWL)
 *
 * Inputs:
 *   @param flags        — boolean risk flags
 *   @param utilPct      — SWL utilisation % (null if weight unknown)
 *   @param missingWeight — true when no component weight is registered
 *   @param hookBreach   — true when required hook height exceeds available
 *
 * Downstream impact: drives Tab 4 Lift register RAG, Gate 3, and Tab 9 lift KPIs.
 *
 * @returns Rag
 */
function classifyLiftRag(
  flags: boolean[],
  utilPct: number | null,
  missingWeight: boolean,
  hookBreach: boolean,
): { flagCount: number; rag: Rag } {
  const flagCount = flags.filter(Boolean).length;
  let rag: Rag = flagCount >= 3 ? 'serious' : flagCount >= 1 ? 'amber' : 'green';
  if (utilPct != null && utilPct > 90) rag = worstRag([rag, 'serious']);
  if (missingWeight || hookBreach || (utilPct != null && utilPct > 100)) rag = 'red';
  return { flagCount, rag };
}

/**
 * Purpose: Assembles a full lift-safety record for a leaf activity that has at least
 *   one registered lift, combining component weight resolution, crane capacity,
 *   hook-height geometry, and risk classification.
 *
 * Inputs:
 *   @param leafCalc — activity metrics bundle (leaf BOP row + timing)
 *   @param ws       — workspace (components, resources, settings)
 *
 * Downstream impact: drives Tab 4 Lift register, Gate 3 (Lift & Crane Safety),
 *   and the route-to-green lift actions in Tab 9.
 *
 * @returns LiftRecord, or null when the activity has no registered lifts
 */
export function liftRecord(leafCalc: LeafCalc, ws: Workspace): LiftRecord | null {
  const leaf = leafCalc.leaf;
  if (leaf.liftCount <= 0) return null;
  const { cranes, rigging, stands, rigs } = resolveResources(leaf, ws);
  const comps = leaf.componentIds.map((id) => ws.components.find((c) => c.id === id)).filter((c) => !!c) as NonNullable<Workspace['components'][0]>[];
  const { loadKg, missingWeight } = resolveLoadKg(leaf, comps, rigging);
  const { capacityKg, capacitySource, tandem } = resolveCapacityKg(cranes, rigging, ws.settings);
  const utilPct = loadKg != null && capacityKg > 0 ? (loadKg / capacityKg) * 100 : null;
  const { elevationM, compHeightM, headroomM, requiredHookM, availableHookM, hookMarginM } =
    resolveHookGeometry(leaf, comps, cranes, rigging, stands, ws.settings);
  const hookBreach = hookMarginM < -1e-6;
  const t = ws.settings.thresholds;
  const heavy = loadKg != null && loadKg > t.heavyLiftKg;
  const multiPerson = leaf.crewSize >= t.multiPersonCrew;
  const highElevation = elevationM >= t.highElevationM || leaf.floorLevel >= t.highElevationFloors;
  const multiTool = tandem || rigging.length + rigs.length >= t.multiToolItems;
  const complex = [...rigging, ...rigs, ...cranes, ...stands].some((r) => complexityOf(r) === 'Complex');
  const { flagCount, rag } = classifyLiftRag([heavy, multiPerson, highElevation, complex, multiTool], utilPct, missingWeight, hookBreach);
  return {
    rowId: leafCalc.parentId, leafId: leaf.id, fpdId: leaf.fpdId, opId: leaf.opId, description: leaf.description, lifts: leaf.liftCount,
    loadKg, missingWeight, capacityKg, capacitySource, utilPct, tandem, elevationM, floorLevel: leaf.floorLevel,
    requiredHookM, availableHookM, hookMarginM, hookBreach, compHeightM, headroomM, clearanceM: ws.settings.crane.clearanceMarginM,
    zoneId: leaf.destZoneId, craneIds: leaf.craneIds, standIds: leaf.standIds, crew: leaf.crewSize,
    heavy, multiPerson, highElevation, complex, multiTool, flagCount, rag, startHrs: leafCalc.startHrs,
  };
}
