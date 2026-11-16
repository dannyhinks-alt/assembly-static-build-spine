import { DataTable, type Col } from '../components/DataTable';
import { Card, ExpandableTextCell, HowItWorks, Kpi, Meter, NumInput, RagBadge, Select, TextInput } from '../components/primitives';
import { blankResource } from '../data/seed';
import { dutyRag } from '../engine/model';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import type { Resource, ResourceKind } from '../types';
import { RESOURCE_KINDS, uid } from '../types';

export default function Tab4Resources() {
  const { ws, mutate, model: m, setTab } = useStore();
  const upd = (id: string, fn: (r: Resource) => void) => mutate((d) => { const r = d.resources.find((x) => x.id === id); if (r) fn(r); });
  const cellOpts = [{ value: '', label: 'Shared / none' }, ...ws.cells.map((c) => ({ value: c.id, label: `Cell ${c.number}` }))];
  const load = (id: string) => m.resources.find((x) => x.resource.id === id);
  const t = ws.settings.thresholds;

  const nameCol: Col<Resource> = { key: 'name', label: 'Name', minWidth: 260, render: (r) => <TextInput cell value={r.name} onChange={(v) => upd(r.id, (x) => { x.name = v; })} ariaLabel="Resource name" placeholder="Name…" /> };
  const qtyCol: Col<Resource> = { key: 'qty', label: 'Qty', guide: 'resQty', right: true, width: 56, render: (r) => <NumInput cell value={r.qty} min={1} onChange={(v) => upd(r.id, (x) => { x.qty = Math.max(1, Math.round(v ?? 1)); })} ariaLabel="Quantity" /> };
  const cellCol: Col<Resource> = { key: 'cell', label: 'Home Cell', guide: 'resCell', minWidth: 150, render: (r) => <Select cell value={r.cellId} options={cellOpts} onChange={(v) => upd(r.id, (x) => { x.cellId = v; })} ariaLabel="Home cell" /> };
  const swlCol = (label: string): Col<Resource> => ({ key: 'swl', label, guide: 'resSwl', right: true, width: 96, render: (r) => <NumInput cell nullable value={r.swlKg} min={0} onChange={(v) => upd(r.id, (x) => { x.swlKg = v; })} ariaLabel={label} /> });
  const classCol: Col<Resource> = { key: 'class', label: 'Tooling Class', guide: 'resClass', width: 116, render: (r) => <Select cell value={r.toolingClass} options={[{ value: 'Standard', label: 'Standard' }, { value: 'Complex', label: 'Complex' }]} onChange={(v) => upd(r.id, (x) => { x.toolingClass = v; })} ariaLabel="Tooling class" /> };
  const dwellCol: Col<Resource> = { key: 'dwell', label: 'Dwell Mode', guide: 'resDwell', width: 150, render: (r) => <Select cell value={r.dwellMode} options={[{ value: 'Per-Op', label: 'Per-Op' }, { value: 'Full-Build', label: 'Full-Build Dwell' }]} onChange={(v) => upd(r.id, (x) => { x.dwellMode = v; })} ariaLabel="Dwell mode" /> };
  const numCol = (key: 'hookHeightM' | 'headroomM' | 'tareKg' | 'tiers' | 'tierHeightM', label: string, guide: Col<Resource>['guide']): Col<Resource> => ({ key, label, guide, right: true, width: 92, render: (r) => <NumInput cell nullable value={r[key]} min={0} onChange={(v) => upd(r.id, (x) => { x[key] = v; })} ariaLabel={label} /> });
  const usageCols: Col<Resource>[] = [
    { key: 'ops', label: 'Ops', right: true, ro: true, render: (r) => { const l = load(r.id); return <span title={l?.ops.join(', ')}>{fmtInt(l?.opCount ?? 0)}</span>; } },
    { key: 'duty', label: 'Duty cycle', guide: 'duty', ro: true, minWidth: 170, render: (r) => { const l = load(r.id); return l && l.opCount ? <span className="flex items-center gap-2"><span className="w-12 text-right tabular-nums">{fmtPct(l.dutyPct, 0)}</span><Meter pct={l.dutyPct} rag={dutyRag(l.dutyPct, ws.settings)} ticks={[t.dutyAmberPct]} /></span> : <span className="text-slate-400">not tagged</span>; } },
    { key: 'rag', label: 'Status', ro: true, render: (r) => { const l = load(r.id); return l && l.opCount ? <RagBadge rag={l.rag} label={l.conflicts ? `${l.conflicts} conflict${l.conflicts > 1 ? 's' : ''}` : undefined} /> : null; } },
    { key: 'notes', label: 'Notes', guide: 'notes', minWidth: 190, render: (r) => <ExpandableTextCell value={r.notes} onChange={(v) => upd(r.id, (x) => { x.notes = v; })} label="Resource notes" context={r.name} /> },
  ];
  const colsFor: Record<ResourceKind, Col<Resource>[]> = {
    rig: [nameCol, qtyCol, cellCol, classCol, dwellCol, ...usageCols],
    crane: [nameCol, qtyCol, cellCol, swlCol('SWL kg'), numCol('hookHeightM', 'Hook height m', 'resHook'), classCol, ...usageCols],
    rigging: [nameCol, qtyCol, swlCol('WLL kg'), numCol('headroomM', 'Headroom m', 'resHeadroom'), numCol('tareKg', 'Tare kg', 'resTare'), classCol, ...usageCols],
    vehicle: [nameCol, qtyCol, cellCol, swlCol('Payload kg'), dwellCol, ...usageCols],
    stand: [nameCol, qtyCol, cellCol, swlCol('SWL kg'), numCol('tiers', 'Tiers', 'resTiers'), numCol('tierHeightM', 'Tier height m', 'resTiers'), classCol, dwellCol, ...usageCols],
  };
  const del = (r: Resource) => {
    const field = RESOURCE_KINDS.find((k) => k.kind === r.kind)!.field;
    const n = load(r.id)?.opCount ?? 0;
    if (n && !window.confirm(`${r.name} is tagged on ${n} activit${n === 1 ? 'y' : 'ies'} in the current filter. Delete it and remove the tags?`)) return;
    mutate((d) => {
      d.resources = d.resources.filter((x) => x.id !== r.id);
      for (const row of d.rows) for (const x of [row, ...(row.children ?? [])]) x[field] = x[field].filter((i) => i !== r.id);
      delete d.mitigations[r.id];
    });
  };
  const used = m.resources.filter((r) => r.opCount > 0);
  const top = [...used].sort((a, b) => b.dutyPct - a.dutyPct)[0];

  return (
    <div>
      <HowItWorks
        tab="4"
        title="Equipment & Resource Registry"
        steps={[
          'These five registers feed the five tag pickers on every BOP row in Tab 2.',
          'Cranes: enter SWL and hook height from the thorough-examination certificate; they override the Tab 1 primary values on tagged rows.',
          'Rigging: WLL can govern lift capacity, tare is added to the load, and headroom is used in the hook-height check.',
          'Stands: enter tiers and tier height so Stand Floor Level converts to a landing elevation.',
          'Set Dwell Mode to Full-Build for anything the product occupies from first to last operation — it is then locked for the whole critical path.',
          'Duty cycle shown here is for the current Spine Filter and build #; full analysis and conflicts are in Tab 8.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Resources registered" guide="resQty" value={fmtInt(ws.resources.length)} sub={`${fmtInt(used.length)} tagged in the current filter`} />
        <Kpi label="Highest duty cycle" guide="duty" value={top ? fmtPct(top.dutyPct, 0) : '—'} sub={top?.resource.name ?? 'No resources tagged'} rag={top?.rag} />
        <Kpi label="Full-Build Dwell resources" guide="resDwell" value={fmtInt(ws.resources.filter((r) => r.dwellMode === 'Full-Build').length)} sub={`Locked for ${fmt(m.durationMonths, 1)} months per build`} />
        <Kpi label="Complex-class items" guide="resClass" value={fmtInt(ws.resources.filter((r) => r.toolingClass === 'Complex').length)} sub="Any one on a lift row flags it Complex" />
      </div>
      <div className="space-y-4">
        {RESOURCE_KINDS.map((k) => {
          const rows = ws.resources.filter((r) => r.kind === k.kind);
          return (
            <Card key={k.kind} title={<>{k.plural} <span className="font-normal tabular-nums text-slate-500">· {rows.length}</span></>} pad={false}
              right={<><button className="btn-ghost" onClick={() => setTab(8)}>Load analysis →</button><button className="btn-primary" onClick={() => mutate((d) => { d.resources.push({ ...blankResource(k.kind, uid('res')), name: `New ${k.label.toLowerCase()}` }); })}>＋ Add {k.label.toLowerCase()}</button></>}>
              <DataTable cols={colsFor[k.kind]} rows={rows} rowKey={(r) => r.id} onDelete={del} onClone={(r) => mutate((d) => { d.resources.push({ ...r, id: uid('res'), name: `${r.name} (copy)` }); })} empty={`No ${k.plural.toLowerCase()} registered.`} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
