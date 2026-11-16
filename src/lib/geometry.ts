// Propel floor-layout geometry: JSON / SVG / DXF polygon import and area maths.
import type { LayoutShape, Pt } from '../types';
import { uid } from '../types';

export const polygonArea = (pts: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
export const centroid = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
export const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export const LAYOUT_TARGETS = (cells: { id: string; number: number }[]) => [
  ...cells.map((c) => ({ value: `cell:${c.id}`, label: `Cell ${c.number}` })),
  { value: 'stores', label: 'Main Stores Input' },
  { value: 'stand', label: 'Large Multi-Tier Build Stand' },
  { value: 'dispatch', label: 'Final Dispatch Bay' },
  { value: '', label: 'Unassigned' },
];

/** Guess a layout target from a label / layer name such as "CELL_4", "Stores", "Dispatch Bay". */
export function guessTarget(label: string, cells: { id: string; number: number }[]): string {
  const s = label.toLowerCase();
  const m = s.match(/cell[\s_\-]*(\d+)/);
  if (m) {
    const c = cells.find((x) => x.number === Number(m[1]));
    if (c) return `cell:${c.id}`;
  }
  if (/store|goods|intake/.test(s)) return 'stores';
  if (/stand|tier/.test(s)) return 'stand';
  if (/dispatch|despatch|ship/.test(s)) return 'dispatch';
  return '';
}

export interface GeometryImport { shapes: LayoutShape[]; warnings: string[]; format: string }
const shape = (label: string, points: Pt[], cells: { id: string; number: number }[]): LayoutShape => ({ id: uid('sh'), label, target: guessTarget(label, cells), points });
const clean = (pts: Pt[]): Pt[] => {
  const out = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
};

function fromJson(text: string, cells: { id: string; number: number }[]): GeometryImport {
  const raw = JSON.parse(text);
  const list: unknown[] = Array.isArray(raw) ? raw : raw.shapes ?? raw.zones ?? raw.polygons ?? raw.features ?? [];
  const warnings: string[] = [];
  const shapes: LayoutShape[] = [];
  list.forEach((it, i) => {
    const o = it as Record<string, unknown>;
    const props = (o.properties ?? {}) as Record<string, unknown>;
    const label = String(o.label ?? o.name ?? o.id ?? props.name ?? props.label ?? `Shape ${i + 1}`);
    let pts: unknown = o.points ?? o.polygon ?? o.vertices ?? o.coordinates;
    const geom = o.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (geom?.coordinates) pts = geom.type === 'Polygon' ? (geom.coordinates as unknown[])[0] : geom.coordinates;
    if (!pts && ['x', 'y', 'width', 'height'].every((k) => typeof o[k] === 'number')) {
      const { x, y, width, height } = o as unknown as Record<string, number>;
      pts = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    }
    const poly = clean(
      (Array.isArray(pts) ? pts : []).map((p): Pt => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number((p as { x: number }).x), Number((p as { y: number }).y)])),
    );
    if (poly.length < 3) warnings.push(`"${label}" skipped — fewer than 3 valid vertices.`);
    else {
      const s = shape(label, poly, cells);
      if (typeof o.target === 'string') s.target = o.target;
      shapes.push(s);
    }
  });
  return { shapes, warnings, format: 'JSON' };
}

function fromSvg(text: string, cells: { id: string; number: number }[]): GeometryImport {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('SVG could not be parsed.');
  const warnings: string[] = [];
  const shapes: LayoutShape[] = [];
  const nameOf = (el: Element, i: number) => el.getAttribute('data-label') || el.getAttribute('inkscape:label') || el.getAttribute('id') || el.querySelector('title')?.textContent || `Shape ${i + 1}`;
  const nums = (s: string | null) => (s ?? '').trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  let i = 0;
  doc.querySelectorAll('rect, polygon, polyline, path').forEach((el) => {
    let pts: Pt[] = [];
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      const x = Number(el.getAttribute('x') ?? 0), y = Number(el.getAttribute('y') ?? 0), w = Number(el.getAttribute('width')), h = Number(el.getAttribute('height'));
      pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    } else if (tag === 'polygon' || tag === 'polyline') {
      const n = nums(el.getAttribute('points'));
      for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]]);
    } else {
      // Straight-segment paths only: M/L/H/V/Z (absolute or relative).
      const d = el.getAttribute('d') ?? '';
      if (/[cCsSqQtTaA]/.test(d)) { warnings.push(`Path "${nameOf(el, i)}" skipped — curves are not supported; export as polygons.`); return; }
      let cx = 0, cy = 0;
      for (const seg of d.match(/[MLHVZmlhvz][^MLHVZmlhvz]*/g) ?? []) {
        const c = seg[0];
        const n = nums(seg.slice(1));
        if (c === 'M' || c === 'L') for (let k = 0; k + 1 < n.length; k += 2) pts.push([(cx = n[k]), (cy = n[k + 1])]);
        else if (c === 'm' || c === 'l') for (let k = 0; k + 1 < n.length; k += 2) pts.push([(cx += n[k]), (cy += n[k + 1])]);
        else if (c === 'H') for (const v of n) pts.push([(cx = v), cy]);
        else if (c === 'h') for (const v of n) pts.push([(cx += v), cy]);
        else if (c === 'V') for (const v of n) pts.push([cx, (cy = v)]);
        else if (c === 'v') for (const v of n) pts.push([cx, (cy += v)]);
      }
    }
    pts = clean(pts);
    if (pts.length >= 3) shapes.push(shape(nameOf(el, i), pts, cells));
    i++;
  });
  return { shapes, warnings, format: 'SVG' };
}

function fromDxf(text: string, cells: { id: string; number: number }[]): GeometryImport {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const warnings: string[] = [];
  const shapes: LayoutShape[] = [];
  let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[k - 1]?.[1] === 'SECTION');
  if (i < 0) i = 0;
  let n = 0;
  let skipped = 0;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0 && val === 'ENDSEC' && n + skipped > 0) break;
    if (code === 0 && val === 'LWPOLYLINE') {
      let layer = '';
      const pts: Pt[] = [];
      let x: number | null = null;
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) {
        const [c, v] = pairs[i];
        if (c === 8) layer = v;
        else if (c === 10) x = parseFloat(v);
        else if (c === 20 && x != null) { pts.push([x, parseFloat(v)]); x = null; }
        i++;
      }
      const poly = clean(pts);
      if (poly.length >= 3) shapes.push(shape(layer || `Polyline ${++n}`, poly, cells));
      continue;
    }
    if (code === 0 && val === 'POLYLINE') {
      let layer = '';
      const pts: Pt[] = [];
      i++;
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'SEQEND')) {
        if (pairs[i][0] === 8 && !layer) layer = pairs[i][1];
        if (pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') {
          let x = NaN, y = NaN;
          i++;
          while (i < pairs.length && pairs[i][0] !== 0) {
            if (pairs[i][0] === 10) x = parseFloat(pairs[i][1]);
            if (pairs[i][0] === 20) y = parseFloat(pairs[i][1]);
            i++;
          }
          pts.push([x, y]);
          continue;
        }
        i++;
      }
      const poly = clean(pts);
      if (poly.length >= 3) shapes.push(shape(layer || `Polyline ${++n}`, poly, cells));
      continue;
    }
    if (code === 0 && ['LINE', 'ARC', 'CIRCLE', 'SPLINE', 'INSERT'].includes(val)) skipped++;
    i++;
  }
  if (skipped) warnings.push(`${skipped} LINE / ARC / CIRCLE / block entities ignored — only closed (LW)POLYLINE outlines are imported.`);
  // DXF is Y-up; the canvas is Y-down. Flip about the drawing extents and move to origin.
  if (shapes.length) {
    const all = shapes.flatMap((s) => s.points);
    const minX = Math.min(...all.map((p) => p[0]));
    const maxY = Math.max(...all.map((p) => p[1]));
    for (const s of shapes) s.points = s.points.map((p): Pt => [p[0] - minX, maxY - p[1]]);
  }
  return { shapes, warnings, format: 'DXF' };
}

export function importGeometry(fileName: string, text: string, cells: { id: string; number: number }[]): GeometryImport {
  const ext = fileName.toLowerCase().split('.').pop();
  const res = ext === 'svg' ? fromSvg(text, cells) : ext === 'dxf' ? fromDxf(text, cells) : fromJson(text, cells);
  if (!res.shapes.length) throw new Error(`No closed polygons found in ${res.format} file.`);
  return res;
}

/** Uniformly scale + translate imported shapes so they fit the factory boundary (for unit-less SVG / mm DXF). */
export function fitToBoundary(shapes: LayoutShape[], lengthM: number, widthM: number): { shapes: LayoutShape[]; scale: number } {
  const all = shapes.flatMap((s) => s.points);
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min(lengthM / Math.max(1e-9, maxX - minX), widthM / Math.max(1e-9, maxY - minY));
  return { scale, shapes: shapes.map((s) => ({ ...s, points: s.points.map((p): Pt => [(p[0] - minX) * scale, (p[1] - minY) * scale]) })) };
}
