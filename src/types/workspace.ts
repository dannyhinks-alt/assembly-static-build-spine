// Workspace, Settings and Spine-filter scope types.
import type { Id } from './constants';
import type { Cell, Zone, Fpd, Component, Resource, Ancillary } from './registry';
import type { BopRow } from './bop';
import type { PfmeaItem, HoldPoint, Assumption, GateSignoff } from './pfmea';
import type { Layout } from './layout';
import { WORKSPACE_SCHEMA } from './constants';

export interface Settings {
  programme: { baselineOpMonths: number; demandNominal: number; demandPeak: number; drumbeatMonths: number; demandCase: 'Nominal' | 'Peak'; labourRateGbp: number };
  learning: { firstBuildPct: number; stabilisedPct: number; stepReductionPct: number; stepBuilds: number; selectedBuild: number };
  calendar: { shiftsPerDay: number; hoursPerShift: number; workingDaysPerYear: number; wasteMode: 'Automated' | 'Manual'; manualWastePct: number; activeTimeFactorPct: number; labourEfficiencyPct: number };
  envelope: { lengthM: number; widthM: number };
  crane: { primarySwlKg: number; hookHeightM: number; clearanceMarginM: number; avgLiftCycleHrs: number; tandemDeratePct: number; defaultTierHeightM: number; defaultRiggingHeadroomM: number };
  thresholds: { heavyLiftKg: number; multiPersonCrew: number; highElevationM: number; highElevationFloors: number; multiToolItems: number; dutyAmberPct: number; dutySeriousPct: number; arRedPct: number; arMinCycleMin: number; nearCriticalFloatHrs: number; rpnAmber: number; rpnSerious: number; rpnRed: number; blindSpotSeverity: number };
}

export interface Workspace {
  schema: typeof WORKSPACE_SCHEMA;
  meta: { name: string; factoryId: string; factoryName: string; createdAt: string; updatedAt: string; appVersion: string };
  settings: Settings;
  cells: Cell[]; zones: Zone[]; fpds: Fpd[]; components: Component[]; resources: Resource[];
  rows: BopRow[]; pfmea: PfmeaItem[]; holdPoints: HoldPoint[];
  assumptions: Assumption[]; ancillaries: Ancillary[];
  gateSignoffs: Record<string, GateSignoff>; mitigations: Record<string, string>;
  layout: Layout;
}

export type ScopeMode = 'factory' | 'cell' | 'fpd';
export interface Scope { mode: ScopeMode; cellIds: Id[]; fpdIds: Id[]; zoneId: Id | ''; }
export const FACTORY_SCOPE: Scope = { mode: 'factory', cellIds: [], fpdIds: [], zoneId: '' };
