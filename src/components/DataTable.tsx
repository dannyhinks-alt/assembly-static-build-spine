import type { ReactNode } from 'react';
import type { GuideId } from '../data/guides';
import { Th } from './primitives';

export interface Col<T> {
  key: string;
  label: ReactNode;
  guide?: GuideId;
  right?: boolean;
  minWidth?: number;
  width?: number;
  ro?: boolean;
  render: (row: T, index: number) => ReactNode;
}

/** Dense registry table with guided column headers and per-row clone / delete actions. */
export function DataTable<T>({ cols, rows, rowKey, onDelete, onClone, cloneTitle = 'Clone', cloneGlyph = '⧉', empty = 'Nothing here yet.', maxHeight, rowClass }: {
  cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; onDelete?: (r: T) => void; onClone?: (r: T) => void; cloneTitle?: string; cloneGlyph?: string; empty?: ReactNode; maxHeight?: number | string; rowClass?: (r: T) => string;
}) {
  const actions = !!(onDelete || onClone);
  return (
    <div className="scroll-thin overflow-auto" style={{ maxHeight }}>
      <table className="w-full min-w-max border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr>
            {cols.map((c) => <Th key={c.key} guide={c.guide} right={c.right} style={{ minWidth: c.minWidth, width: c.width }}>{c.label}</Th>)}
            {actions && <Th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={`hover:bg-slate-50 ${rowClass?.(r) ?? ''}`}>
              {cols.map((c) => <td key={c.key} className={c.ro ? `td-ro ${c.right ? 'text-right' : ''}` : 'td'}>{c.render(r, i)}</td>)}
              {actions && (
                <td className="td whitespace-nowrap" style={{ width: 60 }}>
                  {onClone && <button className="btn-ghost" title={cloneTitle} aria-label={cloneTitle} onClick={() => onClone(r)}>{cloneGlyph}</button>}
                  {onDelete && <button className="btn-ghost" title="Delete" onClick={() => onDelete(r)}>✕</button>}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length + (actions ? 1 : 0)} className="td-ro py-6 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
