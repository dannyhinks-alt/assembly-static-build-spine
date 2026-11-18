// Shape-assignment table for the LayoutEditor — label, target and area per polygon.
import { polygonArea } from '../lib/geometry';
import { fmt } from '../lib/format';
import { Select, TextInput, Th } from './primitives';
import type { FloorPlan, LayoutShape } from '../types';

interface LayoutShapeTableProps {
  shapes: LayoutShape[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  targets: { value: string; label: string }[];
  targetLabel: (target: string) => string;
  mutateFl: (fn: (fl: FloorPlan) => void) => void;
}

/**
 * Purpose: Renders the scrollable shape-assignment table alongside the SVG canvas,
 *   allowing the user to rename each polygon and assign it to a cell or area target.
 *
 * Downstream impact: target assignments feed the spaghetti diagram (zone colouring),
 *   cell area calculations in Tab 7, and resource floor-claim calculations.
 */
export function LayoutShapeTable({ shapes, selected, setSelected, targets, targetLabel, mutateFl }: LayoutShapeTableProps) {
  return (
    <div className="scroll-thin max-h-[560px] overflow-auto rounded border border-slate-200">
      <table className="w-full">
        <thead className="sticky top-0 z-10">
          <tr><Th>Label</Th><Th>Assigned to</Th><Th right guide="shapeArea">Area m²</Th><Th /></tr>
        </thead>
        <tbody>
          {shapes.map((s) => (
            <tr key={s.id} className={selected === s.id ? 'bg-sky-50' : ''} onClick={() => setSelected(s.id)}>
              <td className="td">
                <TextInput cell value={s.label} onChange={(v) => mutateFl((fl) => { const x = fl.shapes.find((y) => y.id === s.id); if (x) x.label = v; })} ariaLabel="Shape label" />
              </td>
              <td className="td" style={{ minWidth: 200 }}>
                <Select cell value={s.target} options={targets} ariaLabel="Assigned to" onChange={(v) => mutateFl((fl) => {
                  const x = fl.shapes.find((y) => y.id === s.id);
                  if (!x) return;
                  x.target = v;
                  if (!x.label || targets.some((t) => t.label === x.label)) x.label = targetLabel(v);
                })} />
              </td>
              <td className="td-ro text-right">{fmt(polygonArea(s.points), 1)}</td>
              <td className="td w-7">
                <button className="btn-ghost" aria-label={`Delete ${s.label}`} onClick={(e) => { e.stopPropagation(); mutateFl((fl) => { fl.shapes = fl.shapes.filter((x) => x.id !== s.id); }); }}>✕</button>
              </td>
            </tr>
          ))}
          {!shapes.length && (
            <tr><td colSpan={4} className="td-ro py-6 text-center text-slate-500">No shapes yet — import a geometry file or draw with Box / Polygon.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
