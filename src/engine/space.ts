// Spatial balancing and movement analysis: work-face congestion, suspended-load clashes across
// Cell / Zone / Stand Level, spaghetti distances (current vs future) and the crew histogram.
import { polygonArea } from '../lib/geometry';
import type { Id, Pt, Rag, Workspace } from '../types';
import type { Cpm, LeafCalc } from './model';

const EPS = 1e-6;

export type ClashKind = 'congestion' | 'lift-same-level' | 'lift-vertical';
export const CLASH_LABEL: Record<ClashKind, string> = {
  congestion: 'Work-face congestion',
  'lift-same-level': 'Lift into occupied work face',
  'lift-vertical': '3D pinch point — lift over / under occupied level',
};
export interface SpaceClash {
  kind: ClashKind;
  zoneId: Id;
  cellId: Id;
  level: number;
  otherLevel: number | null;
  ops: string[];
  start: number;
  end: number;
  overlapHrs: number;
  crew: number;
  cap: number | null;
  rag: Rag;
  resolvable: boolean;
  shiftOp: string;
  shiftHrs: number;
}
export interface MoveRecord {
  leafId: Id;
  rowId: Id;
  fpdId: Id;
  opId: string;
  description: string;
  fromZoneId: Id;
  toZoneId: Id;
  fromCellId: Id;
  toCellId: Id;
  type: 'Intra-Cell' | 'Inter-Cell';
  moves: number;
  /** One-way rectilinear distance per move (m); null when a zone has no position. */
  distM: number | null;
  futureDistM: number | null;
  vehicleIds: Id[];
}
export interface SpaceResult {
  clashes: SpaceClash[];
  moves: MoveRecord[];
  spaghettiM: number;
  spaghettiFutureM: number;
  interCellM: number;
  intraCellM: number;
  interCellMoves: number;
  intraCellMoves: number;
  unpositioned: number;
  crewProfile: { t: number; crew: number }[];
}

const centre = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/** Station point for a zone: its own position, else the centroid of its cell's layout shape. */
export function zonePoint(ws: Workspace, zoneId: Id, future = false): Pt | null {
  const z = ws.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  if (future && z.futurePos) return z.futurePos;
  if (z.pos) return z.pos;
  const shape = ws.layout.shapes.find((s) => s.target === `cell:${z.cellId}`);
  return shape ? centre(shape.points) : null;
}
/** Allowance for a move that stays inside one zone: half the side of an equivalent square cell. */
export function intraZoneAllowanceM(ws: Workspace, cellId: Id): number {
  const shape = ws.layout.shapes.find((s) => s.target === `cell:${cellId}`);
  return shape ? 0.5 * Math.sqrt(polygonArea(shape.points)) : 5;
}
const rect = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

export function buildSpace(ws: Workspace, leaves: LeafCalc[], cpm: Cpm): SpaceResult {
  const zoneCell = new Map(ws.zones.map((z) => [z.id, z.cellId]));
  const floatOf = (l: LeafCalc) => cpm.nodes.get(l.parentId)?.float ?? 0;
  const timed = leaves.filter((l) => l.endHrs - l.startHrs > EPS && l.leaf.destZoneId);
  const clashes: SpaceClash[] = [];

  // --- 1. Work-face congestion: concurrent crew on one stand floor level of a zone above its cap ---
  const faces = new Map<string, LeafCalc[]>();
  for (const l of timed) {
    const k = `${l.leaf.destZoneId}|${l.leaf.floorLevel}`;
    faces.set(k, [...(faces.get(k) ?? []), l]);
  }
  for (const [k, list] of faces) {
    const [zoneId, lvl] = k.split('|');
    const cap = ws.zones.find((z) => z.id === zoneId)?.maxCrewPerLevel ?? null;
    if (cap == null || cap <= 0) continue;
    const times = [...new Set(list.flatMap((l) => [l.startHrs, l.endHrs]))].sort((a, b) => a - b);
    let over = 0, peak = 0, first = Infinity, last = 0;
    let peakOps: LeafCalc[] = [];
    for (let i = 0; i + 1 < times.length; i++) {
      const mid = (times[i] + times[i + 1]) / 2;
      const act = list.filter((l) => l.startHrs < mid && l.endHrs > mid);
      const crew = act.reduce((a, l) => a + l.leaf.crewSize, 0);
      if (crew > cap) {
        over += times[i + 1] - times[i];
        first = Math.min(first, times[i]);
        last = Math.max(last, times[i + 1]);
        if (crew > peak) { peak = crew; peakOps = act; }
      }
    }
    if (over > EPS) {
      const mover = peakOps.reduce((m, l) => (floatOf(l) > floatOf(m) ? l : m));
      const shift = last - mover.startHrs;
      clashes.push({
        kind: 'congestion', zoneId, cellId: zoneCell.get(zoneId) ?? '', level: Number(lvl), otherLevel: null, ops: peakOps.map((l) => l.leaf.opId),
        start: first, end: last, overlapHrs: over, crew: peak, cap, rag: peak > cap * 1.5 ? 'serious' : 'amber',
        resolvable: shift <= floatOf(mover) + EPS, shiftOp: mover.leaf.opId, shiftHrs: shift,
      });
    }
  }

  // --- 2. Suspended-load clashes: an activity with lifts overlaps another activity in the same zone ---
  const byZone = new Map<Id, LeafCalc[]>();
  for (const l of timed) byZone.set(l.leaf.destZoneId, [...(byZone.get(l.leaf.destZoneId) ?? []), l]);
  for (const [zoneId, list] of byZone) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = list[i].startHrs <= list[j].startHrs ? [list[i], list[j]] : [list[j], list[i]];
        if (a.parentId === b.parentId) continue;
        if (a.leaf.liftCount <= 0 && b.leaf.liftCount <= 0) continue;
        const overlap = Math.min(a.endHrs, b.endHrs) - b.startHrs;
        if (overlap <= EPS) continue;
        const vertical = a.leaf.floorLevel !== b.leaf.floorLevel;
        const dedicated = (a.leaf.liftCount > 0 && a.leaf.actionType === 'Lifting') || (b.leaf.liftCount > 0 && b.leaf.actionType === 'Lifting');
        const shiftB = a.endHrs - b.startHrs;
        const shiftA = b.endHrs - a.startHrs;
        const canB = shiftB <= floatOf(b) + EPS;
        const canA = shiftA <= floatOf(a) + EPS;
        const useB = canB || !canA;
        const lifter = a.leaf.liftCount > 0 ? a : b;
        const other = lifter === a ? b : a;
        clashes.push({
          kind: vertical ? 'lift-vertical' : 'lift-same-level', zoneId, cellId: zoneCell.get(zoneId) ?? '', level: lifter.leaf.floorLevel,
          otherLevel: vertical ? other.leaf.floorLevel : null, ops: [lifter.leaf.opId, other.leaf.opId], start: b.startHrs, end: Math.min(a.endHrs, b.endHrs),
          overlapHrs: overlap, crew: a.leaf.crewSize + b.leaf.crewSize, cap: null, rag: dedicated || vertical ? 'serious' : 'amber',
          resolvable: canA || canB, shiftOp: useB ? b.leaf.opId : a.leaf.opId, shiftHrs: useB ? shiftB : shiftA,
        });
      }
  }
  clashes.sort((x, y) => x.start - y.start);

  // --- 3. Movement & spaghetti distance ---
  const moves: MoveRecord[] = [];
  let unpositioned = 0;
  for (const l of leaves) {
    const { originZoneId: from, destZoneId: to } = l.leaf;
    if (!to) continue;
    const src = from || to;
    const n = Math.max(l.leaf.moveCount, src !== to ? 1 : 0);
    if (n <= 0) continue;
    const fromCell = zoneCell.get(src) ?? '';
    const toCell = zoneCell.get(to) ?? '';
    const dist = (future: boolean): number | null => {
      const a = zonePoint(ws, src, future);
      const b = zonePoint(ws, to, future);
      if (!a || !b) return null;
      const d = rect(a, b);
      return d > EPS ? d : intraZoneAllowanceM(ws, toCell);
    };
    const distM = dist(false);
    if (distM == null) unpositioned++;
    moves.push({
      leafId: l.leaf.id, rowId: l.parentId, fpdId: l.leaf.fpdId, opId: l.leaf.opId, description: l.leaf.description, fromZoneId: src, toZoneId: to,
      fromCellId: fromCell, toCellId: toCell, type: fromCell === toCell ? 'Intra-Cell' : 'Inter-Cell', moves: n, distM, futureDistM: dist(true), vehicleIds: l.leaf.vehicleIds,
    });
  }
  const tot = (f: (m: MoveRecord) => number) => moves.reduce((a, m) => a + f(m), 0);

  // --- 4. Crew histogram on the early-start schedule ---
  const ev: [number, number][] = [];
  for (const l of leaves) if (l.endHrs - l.startHrs > EPS) ev.push([l.startHrs, l.leaf.crewSize], [l.endHrs, -l.leaf.crewSize]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crewProfile: { t: number; crew: number }[] = [];
  let cur = 0;
  for (let i = 0; i < ev.length; i++) {
    cur += ev[i][1];
    if (i + 1 < ev.length && Math.abs(ev[i + 1][0] - ev[i][0]) < EPS) continue;
    crewProfile.push({ t: ev[i][0], crew: cur });
  }

  return {
    clashes, moves, unpositioned, crewProfile,
    spaghettiM: tot((m) => m.moves * (m.distM ?? 0)),
    spaghettiFutureM: tot((m) => m.moves * (m.futureDistM ?? 0)),
    interCellM: tot((m) => (m.type === 'Inter-Cell' ? m.moves * (m.distM ?? 0) : 0)),
    intraCellM: tot((m) => (m.type === 'Intra-Cell' ? m.moves * (m.distM ?? 0) : 0)),
    interCellMoves: tot((m) => (m.type === 'Inter-Cell' ? m.moves : 0)),
    intraCellMoves: tot((m) => (m.type === 'Intra-Cell' ? m.moves : 0)),
  };
}
