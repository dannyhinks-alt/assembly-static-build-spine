// Bill of Process types: BopRow and its supporting enumerations.
import type { Id } from './constants';

export type TaskType = 'Sequential' | 'Parallel';
export type Classification = 'VA' | 'NNVA' | 'NVA';
export const CLASSIFICATIONS: { value: Classification; label: string }[] = [
  { value: 'VA', label: 'Value-Add (VA)' },
  { value: 'NNVA', label: 'Necessary Non-Value-Add (NNVA)' },
  { value: 'NVA', label: 'Pure Waste (NVA)' },
];
export const ACTION_TYPES = ['Administrating', 'Gathering', 'Lifting', 'Welding / Joining', 'Fastening', 'Moving', 'Fitting', 'Testing'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const FLOOR_LEVELS = ['Ground', 'Level 1', 'Level 2', 'Level 3'] as const;

export interface BopRow {
  id: Id;
  fpdId: Id;
  /** Route code / Op # — globally unique, used by predecessor links. */
  opId: string;
  /** Agreed Baseline Hours for this row / work block. */
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
  /** Step-by-step work instruction detail — multi-line, populated during method maturation. */
  methodDetail?: string;
  /** Engineering rationale for this operation. */
  rationale?: string;
  /** Consumables used in this operation. */
  consumables?: string;
  /** Present when this row is a merged Baseline Work Block. Children keep full detail. */
  children?: BopRow[];
}
