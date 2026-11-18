// Barrel re-export — all domain types from the types/ directory.
export type { Id, Rag } from './constants';
export { APP_NAME, APP_VERSION, WORKSPACE_SCHEMA, SUMMARY_SCHEMA, uid } from './constants';
export type { Fpd, Cell, Zone, Component, ResourceKind, ResourceField, Complexity, DwellMode, Resource, AncillaryKind, Ancillary } from './registry';
export { zoneLabel, RESOURCE_KINDS, COMPLEXITY_CRITERIA, UTILITY_SERVICES, complexityScore, complexityOf, floorClaimM2, ANCILLARY_KINDS } from './registry';
export type { TaskType, Classification, ActionType, BopRow } from './bop';
export { CLASSIFICATIONS, ACTION_TYPES, FLOOR_LEVELS } from './bop';
export type { PfmeaStatus, PfmeaItem, HoldPointType, HoldPointStatus, HoldPoint, Assumption, GateSignoff } from './pfmea';
export type { Pt, LayoutShape, LayoutImage, FloorPlan, Layout } from './layout';
export type { Settings, Workspace, ScopeMode, Scope } from './workspace';
export { FACTORY_SCOPE } from './workspace';
