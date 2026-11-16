import { DataTable, type Col } from '../components/DataTable';
import { Card, ExpandableTextCell, HowItWorks, Kpi, Meter, NumInput, RagBadge, Select, TextInput } from '../components/primitives';
import { leavesOf } from '../engine/model';
import { polygonArea } from '../lib/geometry';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import type { Cell, Zone } from '../types';
import { uid } from '../types';

export default function Tab5Cells() {
  const { ws, mutate, model: m } = useStore();
  const upd = (id: string, fn: (c: Cell) => void) => mutate((d) => { const c = d.cells.find((x) => x.id === id); if (c) fn(c); });
  const updZ = (id: string, fn: (z: Zone) => void) => mutate((d) => { const z = d.zones.find((x) => x.id === id); if (z) fn(z); });
  const load = (id: string) => m.cells.find((c) => c.cellId === id);
  const area = (id: string) => ws.layout.shapes.filter((s) => s.target === `cell:${id}`).reduce((a, s) => a + polygonArea(s.points), 0);
  const zoneUse = (id: string) => ws.rows.flatMap((r) => leavesOf(r)).filter((l) => l.originZoneId === id || l.destZoneId === id).length;
  const cellOpts = ws.cells.map((c) => ({ value: c.id, label: `Cell ${c.number} · ${c.name}` }));

  const cellCols: Col<Cell>[] = [
    { key: 'n', label: 'Cell', right: true, width: 56, render: (c) => <NumInput cell value={c.number} min={1} onChange={(v) => upd(c.id, (x) => { x.number = Math.round(v ?? x.number); })} ariaLabel="Cell number" /> },
    { key: 'name', label: 'Name', minWidth: 240, render: (c) => <TextInput cell value={c.name} onChange={(v) => upd(c.id, (x) => { x.name = v; })} ariaLabel="Cell name" /> },
    { key: 'crew', label: 'Crew / shift', guide: 'cellCrew', right: true, width: 90, render: (c) => <NumInput cell value={c.crewPerShift} min={0} onChange={(v) => upd(c.id, (x) => { x.crewPerShift = v ?? 0; })} ariaLabel="Crew per shift" /> },
    { key: 'zones', label: 'Zones', guide: 'cellZones', ro: true, minWidth: 200, render: (c) => <span className="text-slate-600">{ws.zones.filter((z) => z.cellId === c.id).map((z) => z.name).join(' · ') || <span className="text-slate-400">none</span>}</span> },
    { key: 'fpds', label: 'FPDs', right: true, ro: true, render: (c) => fmtInt(ws.fpds.filter((f) => f.assignedCellId === c.id && f.active).length) },
    { key: 'area', label: 'Layout m²', right: true, ro: true, guide: 'shapeArea', render: (c) => (area(c.id) ? fmtInt(area(c.id)) : '—') },
    { key: 'hrs', label: 'Labour h / build', right: true, ro: true, guide: 'cellLoad', render: (c) => fmtInt(load(c.id)?.labourHrs ?? 0) },
    { key: 'lifts', label: 'Lifts', right: true, ro: true, render: (c) => fmtInt(load(c.id)?.lifts ?? 0) },
    { key: 'util', label: 'Labour utilisation', guide: 'cellUtil', ro: true, minWidth: 190, render: (c) => { const l = load(c.id); return l?.utilPct == null ? <span className="text-slate-400">no crew set</span> : <span className="flex items-center gap-2"><span className="w-12 text-right tabular-nums">{fmtPct(l.utilPct, 0)}</span><Meter pct={l.utilPct} rag={l.rag} ticks={[80, 100]} /></span>; } },
    { key: 'rag', label: 'Status', ro: true, render: (c) => { const l = load(c.id); return l?.utilPct == null ? null : <RagBadge rag={l.rag} />; } },
    { key: 'notes', label: 'Notes', guide: 'notes', minWidth: 220, render: (c) => <ExpandableTextCell value={c.notes} onChange={(v) => upd(c.id, (x) => { x.notes = v; })} label="Cell notes" context={`Cell ${c.number} · ${c.name}`} /> },
  ];
  const zoneCols: Col<Zone>[] = [
    { key: 'name', label: 'Zone name', minWidth: 280, render: (z) => <TextInput cell value={z.name} onChange={(v) => updZ(z.id, (x) => { x.name = v; })} ariaLabel="Zone name" /> },
    { key: 'cell', label: 'Cell', guide: 'cellZones', minWidth: 260, render: (z) => <Select cell value={z.cellId} options={cellOpts} onChange={(v) => updZ(z.id, (x) => { x.cellId = v; })} ariaLabel="Zone cell" /> },
    { key: 'use', label: 'Activities using it', right: true, ro: true, render: (z) => fmtInt(zoneUse(z.id)) },
  ];
  const crew = ws.cells.reduce((a, c) => a + c.crewPerShift, 0);
  const worst = [...m.cells].filter((c) => c.utilPct != null).sort((a, b) => (b.utilPct ?? 0) - (a.utilPct ?? 0))[0];
  const worstCell = ws.cells.find((c) => c.id === worst?.cellId);

  return (
    <div>
      <HowItWorks
        tab="5"
        title="Cells, Zones & Crew"
        steps={[
          'Define the cells (six in the baseline) and the crew established in each on every shift.',
          'Add zones inside each cell. BOP rows reference zones; the zone determines the cell, which is how Intra-Cell and Inter-Cell movements are told apart.',
          'Labour hours and lifts are booked to the destination zone of each activity.',
          'Labour utilisation = labour hours per build × annual demand ÷ (crew per shift × annual hours). Amber above 80%, Serious above 90%, Red above 100%.',
          'Compare total crew per shift with Peak Concurrent Crew in Tab 7 to see whether the establishment covers the busiest point of the build.',
          'Layout area comes from the shapes assigned to each cell in Tab 1.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cells · zones" guide="cellZones" value={`${fmtInt(ws.cells.length)} · ${fmtInt(ws.zones.length)}`} sub="Zones determine the cell on each BOP row" />
        <Kpi label="Crew per shift" guide="cellCrew" value={fmtInt(crew)} sub={`${fmtInt(crew * ws.settings.calendar.shiftsPerDay)} across ${ws.settings.calendar.shiftsPerDay} shift(s)`} />
        <Kpi label="Peak concurrent crew" guide="kpiPeakCrew" value={fmtInt(m.peakCrew)} sub={m.peakCrew > crew ? `Exceeds per-shift establishment by ${fmtInt(m.peakCrew - crew)}` : 'Within per-shift establishment'} rag={m.peakCrew > crew ? 'amber' : 'green'} />
        <Kpi label="Most loaded cell" guide="cellUtil" value={worst?.utilPct != null ? fmtPct(worst.utilPct, 0) : '—'} sub={worstCell ? `Cell ${worstCell.number} · ${worstCell.name}` : '—'} rag={worst?.rag} />
      </div>
      <Card title="Cells & Crew" pad={false} right={<button className="btn-primary" onClick={() => mutate((d) => { const n = Math.max(0, ...d.cells.map((c) => c.number)) + 1; d.cells.push({ id: uid('cell'), number: n, name: `Cell ${n}`, crewPerShift: 2, notes: '' }); })}>＋ Add cell</button>}>
        <DataTable
          cols={cellCols} rows={ws.cells} rowKey={(c) => c.id}
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
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Utilisation is for the current Spine Filter at Build #{ws.settings.learning.selectedBuild}, {ws.settings.programme.demandCase.toLowerCase()} demand of {fmt(m.demandActive, 1)} / yr.</div>
      </Card>
      <Card className="mt-4" title="Zones" pad={false} right={<button className="btn-primary" disabled={!ws.cells.length} onClick={() => mutate((d) => { d.zones.push({ id: uid('zone'), cellId: d.cells[0].id, name: 'New zone' }); })}>＋ Add zone</button>}>
        <DataTable
          cols={zoneCols} rows={ws.zones} rowKey={(z) => z.id}
          onDelete={(z) => {
            const n = zoneUse(z.id);
            if (n && !window.confirm(`${z.name} is used by ${n} activit${n === 1 ? 'y' : 'ies'}. Delete it and clear those zone links?`)) return;
            mutate((d) => {
              d.zones = d.zones.filter((x) => x.id !== z.id);
              for (const r of d.rows) for (const x of [r, ...(r.children ?? [])]) { if (x.originZoneId === z.id) x.originZoneId = ''; if (x.destZoneId === z.id) x.destZoneId = ''; }
            });
          }}
        />
      </Card>
    </div>
  );
}
