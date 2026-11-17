import type {
  Ancillary, AncillaryKind, BopRow, Resource, ResourceKind, Settings, Workspace,
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
  return blankWorkspace();
}

/** A blank activity row for the given FPD. */
export function blankRow(fpdId: string, opId: string, zoneId = ''): BopRow {
  return {
    id: uid('row'), fpdId, opId, description: '',
    taskType: 'Sequential', predecessors: [],
    originZoneId: zoneId, destZoneId: zoneId, floorLevel: 0,
    componentIds: [], crewSize: 2,
    runHrs: 0, touchHrs: 0, manningHrs: 0,
    classification: 'VA', actionType: 'Fitting',
    rigIds: [], craneIds: [], riggingIds: [], vehicleIds: [], standIds: [],
    liftCount: 0, moveCount: 0, notes: '',
  };
}
export function blankResource(kind: ResourceKind, id: string): Resource {
  return {
    id, kind, name: '', qty: 1, cellId: '',
    swlKg: null, hookHeightM: null, headroomM: null, tareKg: null,
    tiers: null, tierHeightM: null,
    complexity: [1, 1, 1, 1], footprintLM: null, footprintWM: null,
    utilities: [], dwellMode: 'Per-Op', notes: '',
  };
}
export function blankAncillary(kind: AncillaryKind = 'other'): Ancillary {
  return { id: uid('anc'), name: 'New ancillary', kind, cellId: '', floorLevel: 0, lengthM: null, widthM: null, qty: 1, notes: '' };
}
