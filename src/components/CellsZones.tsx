// Cells, zones and crew establishment, plus the Assumptions Register — the structural pre-requisites.
import { useState } from 'react';
import { leavesOf } from '../engine/model';
import { polygonArea } from '../lib/geometry';
import { fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import type { Assumption, Cell, Zone } from '../types';
import { uid, zoneLabel } from '../types';
import { DataTable, type Col } from './DataTable';
import { Card, ExpandableTextCell, Meter, NumInput, Pill, RagBadge, Select, TextInput } from './primitives';

export function CellsZonesCards() {
  const { ws, mutate, model: m } = useStore();
  const upd = (id: string, fn: (c: Cell) => void) => mutate((d) => { const c = d.cells.find((x) => x.id === id); if (c) fn(c); });
  const updZ = (id: string, fn: (z: Zone) => void) => mutate((d) => { const z = d.zones.find((x) => x.id === id); if (z) fn(z); });
  const load = (id: string) => m.cells.find((c) => c.cellId === id);
  const area = (id: string) => ws.layout.shapes.filter((s) => s.target === `cell:${id}`).reduce((a, s) => a + polygonArea(s.points), 0);
  const zoneUse = (id: string) => ws.rows.flatMap((r) => leavesOf(r)).filter((l) => l.originZoneId === id || l.destZoneId === id).length;
  const cellOpts = ws.cells.map((c) => ({ value: c.id, label: `Cell ${c.number} · ${c.name}` }));
  const setPos = (z: Zone, key: 'pos' | 'futurePos', axis: 0 | 1, v: number | null) => updZ(z.id, (x) => {
    const cur = x[key];
    if (v == null && (!cur || cur[1 - axis] == null)) { x[key] = null; return; }
    const next: [number, number] = cur ? [cur[0], cur[1]] : [0, 0];
    next[axis] = v ?? 0;
    x[key] = next;
  });

  const cellCols: Col<Cell>[] = [
    { key: 'n', label: 'Cell', right: true, width: 56, render: (c) => <NumInput cell value={c.number} min={1} onChange={(v) => upd(c.id, (x) => { x.number = Math.round(v ?? x.number); })} ariaLabel="Cell number" /> },
    { key: 'name', label: 'Name', minWidth: 240, render: (c) => <TextInput cell value={c.name} onChange={(v) => upd(c.id, (x) => { x.name = v; })} ariaLabel="Cell name" /> },
    { key: 'crew', label: 'Crew / shift', guide: 'cellCrew', right: true, width: 90, render: (c) => <NumInput cell value={c.crewPerShift} min={0} onChange={(v) => upd(c.id, (x) => { x.crewPerShift = v ?? 0; })} ariaLabel="Crew per shift" /> },
    { key: 'zones', label: 'Zones', guide: 'cellZones', ro: true, minWidth: 200, render: (c) => <span className="text-slate-600">{ws.zones.filter((z) => z.cellId === c.id).map((z) => zoneLabel(z)).join(' · ') || <span className="text-slate-400">none</span>}</span> },
    { key: 'fpds', label: 'FPDs', right: true, ro: true, render: (c) => fmtInt(ws.fpds.filter((f) => f.assignedCellId === c.id && f.active).length) },
    { key: 'area', label: 'Layout m²', right: true, ro: true, guide: 'shapeArea', render: (c) => (area(c.id) ? fmtInt(area(c.id)) : '—') },
    { key: 'hrs', label: 'Labour h / build', right: true, ro: true, guide: 'cellLoad', render: (c) => fmtInt(load(c.id)?.labourHrs ?? 0) },
    { key: 'util', label: 'Labour utilisation', guide: 'cellUtil', ro: true, minWidth: 190, render: (c) => { const l = load(c.id); return l?.utilPct == null ? <span className="text-slate-400">no crew set</span> : <span className="flex items-center gap-2"><span className="w-12 text-right tabular-nums">{fmtPct(l.utilPct, 0)}</span><Meter pct={l.utilPct} rag={l.rag} ticks={[80, 100]} /></span>; } },
    { key: 'notes', label: 'Notes', guide: 'notes', minWidth: 220, render: (c) => <ExpandableTextCell value={c.notes} onChange={(v) => upd(c.id, (x) => { x.notes = v; })} label="Cell notes" context={`Cell ${c.number} · ${c.name}`} /> },
  ];
  const xy = (z: Zone, key: 'pos' | 'futurePos', axis: 0 | 1, label: string) => <NumInput cell nullable value={z[key]?.[axis] ?? null} onChange={(v) => setPos(z, key, axis, v)} ariaLabel={label} />;
  const zoneCols: Col<Zone>[] = [
    { key: 'code', label: 'Zone', width: 72, render: (z) => <TextInput cell value={z.code ?? ''} onChange={(v) => updZ(z.id, (x) => { x.code = v || undefined; })} ariaLabel="Zone code" placeholder="A…" /> },
    { key: 'name', label: 'Name', minWidth: 220, render: (z) => <TextInput cell value={z.name} onChange={(v) => updZ(z.id, (x) => { x.name = v; })} ariaLabel="Zone name" /> },
    { key: 'cell', label: 'Cell', guide: 'cellZones', minWidth: 240, render: (z) => <Select cell value={z.cellId} options={cellOpts} onChange={(v) => updZ(z.id, (x) => { x.cellId = v; })} ariaLabel="Zone cell" /> },
    { key: 'cap', label: 'Max crew / level', guide: 'zoneCap', right: true, width: 120, render: (z) => <NumInput cell nullable value={z.maxCrewPerLevel} min={1} onChange={(v) => updZ(z.id, (x) => { x.maxCrewPerLevel = v; })} ariaLabel="Max crew per level" /> },
    { key: 'x', label: 'Current X m', guide: 'zonePos', right: true, width: 96, render: (z) => xy(z, 'pos', 0, 'Current X') },
    { key: 'y', label: 'Current Y m', right: true, width: 96, render: (z) => xy(z, 'pos', 1, 'Current Y') },
    { key: 'fx', label: 'Future X m', guide: 'zonePos', right: true, width: 96, render: (z) => xy(z, 'futurePos', 0, 'Future X') },
    { key: 'fy', label: 'Future Y m', right: true, width: 96, render: (z) => xy(z, 'futurePos', 1, 'Future Y') },
    { key: 'use', label: 'Activities', right: true, ro: true, render: (z) => fmtInt(zoneUse(z.id)) },
  ];

  return (
    <>
      <Card className="mt-4" collapseKey="cells" title={<>Cells &amp; Crew <span className="font-normal tabular-nums text-slate-500">· {ws.cells.length}</span></>} guide="cellCrew" pad={false}
        right={<button className="btn-primary" onClick={() => mutate((d) => { const n = Math.max(0, ...d.cells.map((c) => c.number)) + 1; d.cells.push({ id: uid('cell'), number: n, name: `Cell ${n}`, crewPerShift: 2, notes: '' }); })}>＋ Add cell</button>}>
        <DataTable
          cols={cellCols} rows={ws.cells} rowKey={(c) => c.id}
          empty="No cells yet. Add a cell for each physical work area in the factory (e.g. Main Build Bay, Final Assembly). Each cell groups zones, resources and FPDs, and drives the per-cell space and crew analysis in Tabs 7–9."
          onDelete={(c) => {
            const z = ws.zones.filter((x) => x.cellId === c.id).length;
            const f = ws.fpds.filter((x) => x.assignedCellId === c.id).length;
            if ((z || f) && !window.confirm(`Cell ${c.number} has ${z} zone(s) and ${f} FPD(s) assigned. Delete the cell and its zones? Rows keep their data but lose the zone link.`)) return;
            mutate((d) => {
              const gone = new Set(d.zones.filter((x) => x.cellId === c.id).map((x) => x.id));
              d.cells = d.cells.filter((x) => x.id !== c.id);
              d.zones = d.zones.filter((x) => x.cellId !== c.id);
              for (const r of d.rows) for (const x of [r, ...(r.children ?? [])]) { if (gone.has(x.originZoneId)) x.originZoneId = ''; if (gone.has(x.destZoneId)) x.destZoneId = ''; }
              d.fpds.forEach((x) => { if (x.assignedCellId === c.id) x.assignedCellId = d.cells[0]?.id ?? ''; });
            });
          }}
        />
      </Card>
      <Card className="mt-4" collapseKey="zones" title={<>Zones <span className="font-normal tabular-nums text-slate-500">· {ws.zones.length}</span></>} guide="cellZones" pad={false}
        right={<button className="btn-primary" disabled={!ws.cells.length} onClick={() => mutate((d) => { d.zones.push({ id: uid('zone'), cellId: d.cells[0].id, name: 'New zone', pos: null, futurePos: null, maxCrewPerLevel: null }); })}>＋ Add zone</button>}>
        <DataTable
          cols={zoneCols} rows={ws.zones} rowKey={(z) => z.id}
          empty="No zones yet. Zones are named station points inside a cell (e.g. 'Station 10 · Wing Build'). Set their (X, Y) coordinates or draw cell polygons in the floor plan — Tab 7 uses them to calculate spaghetti travel distances between activities."
          onDelete={(z) => {
            const n = zoneUse(z.id);
            if (n && !window.confirm(`${z.name} is used by ${n} activit${n === 1 ? 'y' : 'ies'}. Delete it and clear those zone links?`)) return;
            mutate((d) => {
              d.zones = d.zones.filter((x) => x.id !== z.id);
              for (const r of d.rows) for (const x of [r, ...(r.children ?? [])]) { if (x.originZoneId === z.id) x.originZoneId = ''; if (x.destZoneId === z.id) x.destZoneId = ''; }
            });
          }}
        />
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Positions are metres from the top-left corner of the floor plan below. Blank Current uses the cell centroid; blank Future means the zone does not move.</div>
      </Card>
    </>
  );
}

export function AssumptionsCard({ className = '' }: { className?: string }) {
  const { ws, mutate } = useStore();
  const [filterCell, setFilterCell] = useState<string>('__all__');
  const updA = (id: string, fn: (a: Assumption) => void) => mutate((d) => { const a = d.assumptions.find((x) => x.id === id); if (a) fn(a); });
  const cellOpts2 = [
    { value: '__all__', label: 'All levels' },
    { value: '', label: 'Factory-Wide' },
    ...ws.cells.map((c) => ({ value: c.id, label: c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}` })),
  ];
  const visible = filterCell === '__all__' ? ws.assumptions : ws.assumptions.filter((a) => (a.cellId ?? '') === filterCell);
  const cellDisplayLabel = (a: Assumption) => {
    if (!a.cellId) return 'Factory-Wide';
    const c = ws.cells.find((x) => x.id === a.cellId);
    return c ? (c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}`) : 'Factory-Wide';
  };
  const cols: Col<Assumption>[] = [
    { key: 'ok', label: 'Confirmed', width: 84, render: (a) => <span className="flex justify-center pt-1.5"><input type="checkbox" className="accent-slate-800" checked={a.confirmed} onChange={(e) => updA(a.id, (x) => { x.confirmed = e.target.checked; })} aria-label="Confirmed" /></span> },
    { key: 'level', label: 'Cell / Factory Level', minWidth: 200, render: (a) => ws.cells.length ? <Select cell value={a.cellId ?? ''} options={[{ value: '', label: 'Factory-Wide' }, ...ws.cells.map((c) => ({ value: c.id, label: c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}` }))]} onChange={(v) => updA(a.id, (x) => { x.cellId = v; })} ariaLabel="Cell or factory level" /> : <span className="td-ro text-slate-500">{cellDisplayLabel(a)}</span> },
    { key: 'text', label: 'Assumption', guide: 'assumptions', minWidth: 400, render: (a) => <ExpandableTextCell value={a.text} onChange={(v) => updA(a.id, (x) => { x.text = v; })} label="Planning assumption" context={a.owner} minWidth={380} /> },
    { key: 'owner', label: 'Owner', minWidth: 180, render: (a) => <TextInput cell value={a.owner} onChange={(v) => updA(a.id, (x) => { x.owner = v; })} ariaLabel="Owner" /> },
    { key: 'st', label: 'Status', ro: true, render: (a) => <RagBadge rag={a.confirmed ? 'green' : 'amber'} label={a.confirmed ? 'Confirmed' : 'Unconfirmed'} /> },
  ];
  return (
    <Card className={className} title="Assumptions Register" guide="assumptions" pad={false}
      right={
        <>
          <div className="w-52"><Select value={filterCell} onChange={setFilterCell} ariaLabel="Filter by cell" options={cellOpts2} className="!py-[3px] !text-[12px]" /></div>
          <Pill tone="outline">{ws.assumptions.filter((a) => !a.confirmed).length} unconfirmed</Pill>
          <button className="btn-primary" onClick={() => mutate((d) => { d.assumptions.push({ id: uid('as'), text: '', owner: '', confirmed: false, cellId: '' }); })}>＋ Add assumption</button>
        </>
      }>
      <DataTable cols={cols} rows={visible} rowKey={(a) => a.id} onDelete={(a) => mutate((d) => { d.assumptions = d.assumptions.filter((x) => x.id !== a.id); })} empty="No assumptions recorded." />
    </Card>
  );
}
