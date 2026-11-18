// Global Spine Filter bar — scope mode selector (factory / cell / FPD) and zone refinement.
import { Pill, RagBadge, Select, TagPicker, Tip } from './primitives';
import { fmtInt } from '../lib/format';
import { useStore } from '../store';
import type { ScopeMode } from '../types';

export default function SpineFilterBar() {
  const { ws, scope, setScope, model } = useStore();
  const active = ws.fpds.filter((f) => f.active);
  const modes: { v: ScopeMode; label: string }[] = [
    { v: 'factory', label: 'Whole Factory (All Active FPDs)' },
    { v: 'cell', label: 'By Cell (1–6)' },
    { v: 'fpd', label: 'Single FPD / Multi-FPD Selection' },
  ];
  const setMode = (v: ScopeMode) => {
    if (v === 'cell' && scope.cellIds.length === 0) return setScope({ ...scope, mode: v, cellIds: ws.cells.slice(0, 1).map((c) => c.id) });
    if (v === 'fpd' && scope.fpdIds.length === 0) return setScope({ ...scope, mode: v, fpdIds: active.slice(0, 1).map((f) => f.fpdId) });
    setScope({ ...scope, mode: v });
  };
  const toggleCell = (id: string) => setScope({ ...scope, cellIds: scope.cellIds.includes(id) ? scope.cellIds.filter((c) => c !== id) : [...scope.cellIds, id] });
  return (
    <div className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
        <span className="flex items-center gap-1.5"><span className="lbl">Spine Filter</span><Tip id="spineFilter" /></span>
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white" role="radiogroup" aria-label="Scope mode">
          {modes.map((m) => (
            <button key={m.v} role="radio" aria-checked={scope.mode === m.v} onClick={() => setMode(m.v)} className={`border-r border-slate-300 px-2.5 py-1 text-[12px] font-medium last:border-r-0 ${scope.mode === m.v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {m.label}
            </button>
          ))}
        </div>
        {scope.mode === 'cell' && (
          <div className="flex flex-wrap items-center gap-1">
            {ws.cells.map((c) => {
              const on = scope.cellIds.includes(c.id);
              return <button key={c.id} onClick={() => toggleCell(c.id)} aria-pressed={on} title={c.name} className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'}`}>{c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}`}</button>;
            })}
          </div>
        )}
        {scope.mode === 'fpd' && (
          <div className="flex min-w-[220px] max-w-[720px] flex-1 items-center gap-1 rounded border border-slate-300 bg-white px-1">
            <div className="min-w-0 flex-1">
              <TagPicker label="FPD selection" tone="blue" placeholder="Select FPDs…" value={scope.fpdIds} options={active.map((f) => ({ id: f.fpdId, label: f.fpdCode, sub: f.title }))} onChange={(fpdIds) => setScope({ ...scope, fpdIds })} />
            </div>
            <button className="btn-ghost" onClick={() => setScope({ ...scope, fpdIds: active.map((f) => f.fpdId) })}>All</button>
            <button className="btn-ghost" onClick={() => setScope({ ...scope, fpdIds: [] })}>None</button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="lbl">Zone</span>
          <div className="w-[210px]">
            <Select ariaLabel="Zone refinement" value={scope.zoneId} onChange={(zoneId) => setScope({ ...scope, zoneId })} options={[{ value: '', label: 'All zones' }, ...ws.zones.map((z) => { const c = ws.cells.find((x) => x.id === z.cellId); return { value: z.id, label: z.code ? `Zone ${z.code} · ${z.name}` : z.name, group: c ? (c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}`) : '?' }; })]} className="!py-[3px] !text-[12px]" />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone="dark"><span className="tabular-nums">{fmtInt(model.fpds.length)} of {fmtInt(ws.fpds.length)} FPDs active · {fmtInt(model.totals.workBlocks)} Baseline work blocks</span></Pill>
          <Pill tone="outline" title="Learning-curve build selected in Tab 1">Build #{ws.settings.learning.selectedBuild} · {(model.lc * 100).toFixed(0)}%</Pill>
          <RagBadge rag={model.scheduleRag} label={`${model.durationMonths.toFixed(1)} mo`} title="Critical-path duration vs production window (Tab 7)" />
        </div>
      </div>
    </div>
  );
}
