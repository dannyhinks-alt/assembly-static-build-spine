// PFMEA, Hold Points, Assumptions and Gate Sign-off types.
import type { Id } from './constants';

export type PfmeaStatus = 'Open' | 'In Progress' | 'Closed';
export interface PfmeaItem {
  id: Id; fpdId: Id | ''; opId: string;
  failureMode: string; effect: string; cause: string; controls: string;
  s: number; o: number; d: number;
  recommendedAction: string; owner: string; status: PfmeaStatus;
  /** Manually require a control document even when the automatic rule does not. */
  controlDocForced: boolean;
  controlDocRef: string;
  /** Assigned tooling / rig / vehicle / stand (resource ids). */
  resourceIds: Id[];
}

export type HoldPointType = 'Hold' | 'Witness' | 'Review';
export type HoldPointStatus = 'Planned' | 'Released' | 'Rejected';
export interface HoldPoint {
  id: Id; fpdId: Id | ''; opId: string;
  type: HoldPointType; title: string; notes: string; status: HoldPointStatus;
}

export interface Assumption {
  id: Id; text: string; owner: string; confirmed: boolean;
  /** Cell ID this assumption applies to, or '' / undefined for factory-wide. */
  cellId?: Id | '';
}

export interface GateSignoff { by: string; on: string; comment: string; }
