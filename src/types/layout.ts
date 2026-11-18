// Layout types: floor plan shapes, images and the Layout container.
import type { Id } from './constants';

export type Pt = [number, number];

export interface LayoutShape {
  id: Id;
  /** e.g. 'cell:C1', 'stores', 'stand', 'despatch' or '' for unassigned imports */
  target: string;
  label: string;
  /** Polygon vertices in metres, origin top-left of the factory boundary. */
  points: Pt[];
}

export interface LayoutImage {
  dataUrl: string; widthPx: number; heightPx: number;
  /** Metres per pixel after 2-point calibration (null until calibrated). */
  mPerPx: number | null;
  calib: { a: Pt; b: Pt; distanceM: number } | null;
}

export interface FloorPlan {
  id: Id; name: string;
  /** Floor elevation above ground datum (m). */
  elevationM: number;
  image: LayoutImage | null;
  shapes: LayoutShape[];
}

export interface Layout {
  shapes: LayoutShape[]; image: LayoutImage | null; snapM: number;
  /** Additional floor levels above ground (each with their own image and polygons). */
  floors?: FloorPlan[];
  /** Manual override for total factory floor area (m²). Null = use envelope L × W. */
  floorAreaOverrideM2?: number | null;
  /** Data-URL for a side-view reference photograph shown in the Side-Elevation card. */
  sideElevationImage?: string | null;
}
