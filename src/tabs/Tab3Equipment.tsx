import type { Draft } from 'immer';
import { DataTable, type Col } from '../components/DataTable';
import { Card, ExpandableTextCell, Field, HowItWorks, Kpi, Meter, NumInput, Pill, RagBadge, Select, TagPicker, TextInput, Th, Tip } from '../components/primitives';
import { blankAncillary, blankResource } from '../data/seed';
import { dutyRag } from '../engine/model';
import { polygonArea } from '../lib/geometry';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import type { Ancillary, Complexity, Rag, Resource, ResourceKind, Settings } from '../types';
import { ANCILLARY_KINDS, COMPLEXITY_CRITERIA, RESOURCE_KINDS, UTILITY_SERVICES, complexityOf, complexityScore, floorClaimM2, uid } from '../types';

const CX_TONE: Record<Complexity, 'outline' | 'slate' | 'dark'> = { Simple: 'outline', Medium: 'slate', Complex: 'dark' };
const SCORE_STYLE = ['', 'border-slate-200 bg-white text-slate-600', 'border-slate-300 bg-slate-200 text-slate-800', 'border-slate-800 bg-slate-800 text-white'];

export function ComplexityPill({ r }: { r: Pick<Resource, 'complexity'> }) {
  const c = complexityOf(r);
  return <Pill tone={CX_TONE[c]} title={`Complexity score ${complexityScore(r)} of 12`}>{c}</Pill>;
}

export default function Tab3Equipment() {
  const { ws, mutate, model: m, setTab } = useStore();
  const upd = (id: string, fn: (r: Resource) => void) => mutate((d) => { const r = d.resources.find((x) => x.id === id); if (r) fn(r); });
  const set = (fn: (d: Draft<Settings>) => void) => mutate((d) => fn(d.settings));
  const n = (v: number | null, fallback = 0) => v ?? fallback;
  const s = ws.settings;
  const cellOpts = [{ value: '', label: 'Shared / none' }, ...ws.cells.map((c) => ({ value: c.id, label: c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}` }))];
  const load = (id: string) => m.resources.find((x) => x.resource.id === id);
  const t = ws.settings.thresholds;
  const utilOpts = [...new Set([...UTILITY_SERVICES, ...ws.resources.flatMap((r) => r.utilities)])].map((u) => ({ id: u, label: u }));

  const nameCol: Col<Resource> = { key: 'name', label: 'Name', minWidth: 250, render: (r) => <TextInput cell value={r.name} onChange={(v) => upd(r.id, (x) => { x.name = v; })} ariaLabel="Resource name" placeholder="Name…" /> };
  const qtyCol: Col<Resource> = { key: 'qty', label: 'Qty', guide: 'resQty', right: true, width: 56, render: (r) => <NumInput cell value={r.qty} min={1} onChange={(v) => upd(r.id, (x) => { x.qty = Math.max(1, Math.round(v ?? 1)); })} ariaLabel="Quantity" /> };
  const cellCol: Col<Resource> = { key: 'cell', label: 'Home Cell', guide: 'resCell', minWidth: 150, render: (r) => <Select cell value={r.cellId} options={cellOpts} onChange={(v) => upd(r.id, (x) => { x.cellId = v; })} ariaLabel="Home cell" /> };
  const swlCol = (label: string): Col<Resource> => ({ key: 'swl', label, guide: 'resSwl', right: true, width: 92, render: (r) => <NumInput cell nullable value={r.swlKg} min={0} onChange={(v) => upd(r.id, (x) => { x.swlKg = v; })} ariaLabel={label} /> });
  const dwellCol: Col<Resource> = { key: 'dwell', label: 'Dwell Mode', guide: 'resDwell', width: 150, render: (r) => <Select cell value={r.dwellMode} options={[{ value: 'Per-Op', label: 'Per-Op' }, { value: 'Full-Build', label: 'Full-Build Dwell' }]} onChange={(v) => upd(r.id, (x) => { x.dwellMode = v; })} ariaLabel="Dwell mode" /> };
  const numCol = (key: 'hookHeightM' | 'headroomM' | 'tareKg' | 'tiers' | 'tierHeightM' | 'footprintLM' | 'footprintWM', label: string, guide: Col<Resource>['guide'], width = 86): Col<Resource> => ({ key, label, guide, right: true, width, render: (r) => <NumInput cell nullable value={r[key]} min={0} onChange={(v) => upd(r.id, (x) => { x[key] = v; })} ariaLabel={label} /> });
  const cxCol: Col<Resource> = {
    key: 'cx', minWidth: 236, guide: 'cxMatrix',
    label: <span title={COMPLEXITY_CRITERIA.map((c, i) => `${i + 1}. ${c.label}`).join('\n')}>Complexity Matrix 1–3</span>,
    render: (r) => (
      <span className="flex items-center gap-1 px-1 py-1">
        {COMPLEXITY_CRITERIA.map((c, i) => {
          const v = Math.min(3, Math.max(1, Math.round(r.complexity?.[i] ?? 1)));
          return (
            <button key={c.label} type="button" aria-label={`${c.label}: ${v} of 3`} title={`${c.label}\n${v} — ${c.levels[v - 1]}\nClick to change`}
              onClick={() => upd(r.id, (x) => { const next = COMPLEXITY_CRITERIA.map((_c, k) => x.complexity?.[k] ?? 1); next[i] = (v % 3) + 1; x.complexity = next; })}
              className={`h-[22px] w-[22px] rounded border text-[11.5px] font-semibold tabular-nums ${SCORE_STYLE[v]}`}>{v}</button>
          );
        })}
        <span className="ml-1 w-7 text-right text-[11.5px] tabular-nums text-slate-500">Σ{complexityScore(r)}</span>
        <ComplexityPill r={r} />
      </span>
    ),
  };
  const claimCol: Col<Resource> = { key: 'claim', label: 'Floor claim m²', guide: 'floorClaim', right: true, ro: true, render: (r) => (floorClaimM2(r) ? fmt(floorClaimM2(r), 1) : <span className="text-slate-400">—</span>) };
  const utilCol: Col<Resource> = { key: 'util', label: 'Utility Services', guide: 'utilities', minWidth: 220, render: (r) => <TagPicker label="Utility services" value={r.utilities} options={utilOpts} onChange={(v) => upd(r.id, (x) => { x.utilities = v; })} minWidth={200} /> };
  const fp = [numCol('footprintLM', 'Footprint L m', 'floorClaim', 92), numCol('footprintWM', 'W m', undefined, 64), claimCol];
  const usageCols: Col<Resource>[] = [
    { key: 'ops', label: 'Ops', right: true, ro: true, render: (r) => { const l = load(r.id); return <span title={l?.ops.join(', ')}>{fmtInt(l?.opCount ?? 0)}</span>; } },
    { key: 'duty', label: 'Duty cycle', guide: 'duty', ro: true, minWidth: 160, render: (r) => { const l = load(r.id); return l && l.opCount ? <span className="flex items-center gap-2"><span className="w-11 text-right tabular-nums">{fmtPct(l.dutyPct, 0)}</span><Meter pct={l.dutyPct} rag={dutyRag(l.dutyPct, ws.settings)} ticks={[t.dutyAmberPct]} /></span> : <span className="text-slate-400">not tagged</span>; } },
    { key: 'notes', label: 'Notes', guide: 'notes', minWidth: 180, render: (r) => <ExpandableTextCell value={r.notes} onChange={(v) => upd(r.id, (x) => { x.notes = v; })} label="Resource notes" context={r.name} /> },
  ];
  const colsFor: Record<ResourceKind, Col<Resource>[]> = {
    rig: [nameCol, qtyCol, cellCol, cxCol, ...fp, utilCol, dwellCol, ...usageCols],
    crane: [nameCol, qtyCol, cellCol, swlCol('SWL kg'), numCol('hookHeightM', 'Hook height m', 'resHook', 104), { key: 'fl', label: 'Floor Level', right: true, width: 80, render: (r) => <NumInput cell nullable value={r.floorLevel ?? null} min={0} max={3} onChange={(v) => upd(r.id, (x) => { x.floorLevel = v == null ? undefined : Math.min(3, Math.max(0, Math.round(v))); })} ariaLabel="Floor level" /> }, { key: 'hw', label: 'Hoist Well', width: 80, render: (r) => <span className="flex justify-center pt-1.5"><input type="checkbox" className="accent-slate-800" checked={!!r.hoistWell} onChange={(e) => upd(r.id, (x) => { x.hoistWell = e.target.checked; })} aria-label="Hoist well / cross-floor crane" /></span> }, cxCol, ...fp, utilCol, ...usageCols],
    rigging: [nameCol, qtyCol, swlCol('WLL kg'), numCol('headroomM', 'Headroom m', 'resHeadroom', 96), numCol('tareKg', 'Tare kg', 'resTare', 76), cxCol, utilCol, ...usageCols],
    vehicle: [nameCol, qtyCol, cellCol, swlCol('Payload kg'), cxCol, ...fp, utilCol, dwellCol, ...usageCols],
    stand: [nameCol, qtyCol, cellCol, swlCol('SWL kg'), numCol('tiers', 'Tiers', 'resTiers', 60), numCol('tierHeightM', 'Tier height m', 'resTiers', 104), cxCol, ...fp, utilCol, dwellCol, ...usageCols],
  };
  const del = (r: Resource) => {
    const field = RESOURCE_KINDS.find((k) => k.kind === r.kind)!.field;
    const n = load(r.id)?.opCount ?? 0;
    if (n && !window.confirm(`${r.name} is tagged on ${n} activit${n === 1 ? 'y' : 'ies'} in the current filter. Delete it and remove the tags?`)) return;
    mutate((d) => {
      d.resources = d.resources.filter((x) => x.id !== r.id);
      for (const row of d.rows) for (const x of [row, ...(row.children ?? [])]) x[field] = x[field].filter((i) => i !== r.id);
      d.pfmea.forEach((p) => { p.resourceIds = p.resourceIds.filter((i) => i !== r.id); });
      delete d.mitigations[r.id];
    });
  };

  const byClass = (c: Complexity) => ws.resources.filter((r) => complexityOf(r) === c).length;
  const totalClaim = ws.resources.reduce((a, r) => a + floorClaimM2(r), 0);
  const cellArea = (id: string) => ws.layout.shapes.filter((s) => s.target === `cell:${id}`).reduce((a, s) => a + polygonArea(s.points), 0);
  const groups = [...ws.cells.map((c) => ({ id: c.id, label: `Cell ${c.number}`, name: c.name })), { id: '', label: 'Shared', name: 'No home cell' }];
  const usedUtils = utilOpts.map((u) => u.id).filter((u) => ws.resources.some((r) => r.utilities.includes(u)));
  const claimRag = (pct: number): Rag => (pct > 80 ? 'red' : pct > 60 ? 'amber' : 'green');

  return (
    <div>
      <Card className="mb-4" title="Crane Envelope & Lifting Defaults" guide="craneSwl">
        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Primary Crane SWL" guide="craneSwl" unit="kg" hint={`${fmt(s.crane.primarySwlKg / 1000, 1)} t`}><NumInput value={s.crane.primarySwlKg} min={0} onChange={(v) => set((d) => { d.crane.primarySwlKg = n(v); })} /></Field>
          <Field label="Default Vertical Hook Height" guide="hookHeight" unit="m"><NumInput value={s.crane.hookHeightM} min={0} onChange={(v) => set((d) => { d.crane.hookHeightM = n(v); })} /></Field>
          <Field label="Safety Lift Clearance Margin" guide="clearance" unit="m"><NumInput value={s.crane.clearanceMarginM} min={0} onChange={(v) => set((d) => { d.crane.clearanceMarginM = n(v); })} /></Field>
          <Field label="Average Lift Cycle" guide="avgLiftCycle" unit="h"><NumInput value={s.crane.avgLiftCycleHrs} min={0} onChange={(v) => set((d) => { d.crane.avgLiftCycleHrs = n(v); })} /></Field>
          <Field label="Default Stand Floor Height" guide="tierHeight" unit="m"><NumInput value={s.crane.defaultTierHeightM} min={0} onChange={(v) => set((d) => { d.crane.defaultTierHeightM = n(v); })} /></Field>
          <Field label="Default Rigging Headroom (additive per item)" guide="riggingHeadroom" unit="m"><NumInput value={s.crane.defaultRiggingHeadroomM} min={0} onChange={(v) => set((d) => { d.crane.defaultRiggingHeadroomM = n(v); })} /></Field>
          <Field label="Tandem Lift Derate" guide="tandemDerate" unit="%"><NumInput value={s.crane.tandemDeratePct} min={0} max={90} onChange={(v) => set((d) => { d.crane.tandemDeratePct = n(v); })} /></Field>
        </div>
        <p className="mt-2 text-[11.5px] text-slate-500">
          Per-crane hook heights are entered in the <b>Cranes</b> register below. Rigging headroom values are summed additively across all tagged items (additive stack-up). Thresholds are set in <button className="underline hover:text-slate-800" onClick={() => setTab(1)}>Tab 1</button>.
        </p>
      </Card>

      <HowItWorks
        tab="3"
        title="Equipment, Tooling, Vehicles & Stands"
        steps={[
          'Five registers — Tooling & Equipment, Cranes, Rigging, Vehicles, and Stands — feed the five tag pickers on every BOP row in Tab 2.',
          'Score each item on the 1–3 Complexity Matrix (click a score to change it). The four scores are summed: 4–6 Simple, 7–9 Medium, 10–12 Complex.',
          'A Complex-class item tagged on a lift raises the Complex Lift flag in Tab 4.',
          'Enter footprint length and width; floor claims are totalled by home cell and compared with the cell area from the Tab 1 layout.',
          'Tag the utility services each item needs to build the services-by-cell matrix for Facilities.',
          'Cranes need SWL and hook height per crane row; rigging headroom values are SUMMED (additive stack-up) across all tagged items on a lift — enter each item\'s true consumed height.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Resources registered" guide="resQty" value={fmtInt(ws.resources.length)} sub={`${fmtInt(m.resources.filter((r) => r.opCount > 0).length)} tagged in the current filter`} />
        <Kpi label="Complexity mix" guide="cxMatrix" value={`${byClass('Simple')} · ${byClass('Medium')} · ${byClass('Complex')}`} sub="Simple · Medium · Complex" />
        <Kpi label="Total floor claim" guide="floorClaim" value={fmtInt(totalClaim)} unit="m²" sub={`${fmtPct((totalClaim / Math.max(1, ws.settings.envelope.lengthM * ws.settings.envelope.widthM)) * 100, 0)} of the factory boundary`} />
        <Kpi label="Utility services in use" guide="utilities" value={fmtInt(usedUtils.length)} sub={`${fmtInt(ws.resources.filter((r) => r.utilities.length).length)} resources need a connection`} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card title="Floor Claims by Cell" guide="floorClaim" pad={false} right={<button className="btn-ghost" onClick={() => setTab(7)}>Footprint view →</button>}>
          <table className="w-full">
            <thead><tr><Th>Cell</Th><Th right>Resources</Th><Th right guide="shapeArea">Cell area m²</Th><Th right guide="floorClaim">Floor claim m²</Th><Th>Share of cell</Th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const rs = ws.resources.filter((r) => r.cellId === g.id);
                const claim = rs.reduce((a, r) => a + floorClaimM2(r), 0);
                const area = g.id ? cellArea(g.id) : 0;
                const pct = area ? (claim / area) * 100 : null;
                return (
                  <tr key={g.id || 'shared'} className="hover:bg-slate-50">
                    <td className="td-ro"><b className="text-slate-900">{g.label}</b> <span className="text-slate-600">{g.name}</span></td>
                    <td className="td-ro text-right">{fmtInt(rs.reduce((a, r) => a + r.qty, 0))}</td>
                    <td className="td-ro text-right">{area ? fmtInt(area) : '—'}</td>
                    <td className="td-ro text-right font-medium text-slate-900">{fmt(claim, 1)}</td>
                    <td className="td-ro" style={{ minWidth: 170 }}>{pct == null ? <span className="text-slate-400">{g.id ? 'no layout shape' : 'located where used'}</span> : <span className="flex items-center gap-2"><span className="w-10 text-right tabular-nums">{fmtPct(pct, 0)}</span><Meter pct={pct} rag={claimRag(pct)} ticks={[60]} max={100} /></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Utility Services by Cell" guide="utilMatrix" pad={false}>
          <div className="scroll-thin overflow-auto">
            <table className="w-full min-w-max">
              <thead><tr><Th>Service</Th>{groups.map((g) => <Th key={g.id || 's'} right>{g.label}</Th>)}<Th right>Total</Th></tr></thead>
              <tbody>
                {usedUtils.map((u) => {
                  const n = (cid: string) => ws.resources.filter((r) => r.cellId === cid && r.utilities.includes(u)).reduce((a, r) => a + r.qty, 0);
                  return (
                    <tr key={u} className="hover:bg-slate-50">
                      <td className="td-ro text-slate-800">{u}</td>
                      {groups.map((g) => <td key={g.id || 's'} className="td-ro text-right">{n(g.id) ? <b className="text-slate-900">{n(g.id)}</b> : <span className="text-slate-300">·</span>}</td>)}
                      <td className="td-ro text-right font-medium text-slate-900">{groups.reduce((a, g) => a + n(g.id), 0)}</td>
                    </tr>
                  );
                })}
                {!usedUtils.length && <tr><td colSpan={groups.length + 2} className="td-ro py-5 text-center text-slate-500">No utility services tagged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11.5px] text-slate-600">
        <span className="flex items-center gap-1.5"><span className="lbl">Complexity Scoring Matrix</span><Tip id="cxMatrix" /></span>
        {COMPLEXITY_CRITERIA.map((c, i) => <span key={c.label}><b className="tabular-nums text-slate-800">{i + 1}</b> {c.label}</span>)}
        <span className="ml-auto flex items-center gap-1.5">Σ 4–6 <Pill tone="outline">Simple</Pill> 7–9 <Pill tone="slate">Medium</Pill> 10–12 <Pill tone="dark">Complex</Pill></span>
      </div>

      <div className="space-y-4">
        {RESOURCE_KINDS.map((k) => {
          const rows = ws.resources.filter((r) => r.kind === k.kind);
          const high = rows.filter((r) => load(r.id)?.highRisk).length;
          return (
            <Card key={k.kind} collapseKey={`res.${k.kind}`} title={<>{k.plural} <span className="font-normal tabular-nums text-slate-500">· {rows.length}</span></>} pad={false}
              right={<>{high > 0 && <RagBadge rag="serious" label={`${high} HIGH RISK`} />}<button className="btn-ghost" onClick={() => setTab(8)}>Utilisation →</button><button className="btn-primary" onClick={() => mutate((d) => { d.resources.push({ ...blankResource(k.kind, uid('res')), name: `New ${k.label.toLowerCase()}` }); })}>＋ Add {k.label.toLowerCase()}</button></>}>
              <DataTable cols={colsFor[k.kind]} rows={rows} rowKey={(r) => r.id} onDelete={del} onClone={(r) => mutate((d) => { d.resources.push({ ...r, id: uid('res'), name: `${r.name} (copy)`, complexity: [...r.complexity], utilities: [...r.utilities] }); })} empty={`No ${k.plural.toLowerCase()} registered.`} />
            </Card>
          );
        })}
      </div>

      <AncillariesCard className="mt-4" />
    </div>
  );
}

function AncillariesCard({ className = '' }: { className?: string }) {
  const { ws, mutate } = useStore();
  const cellOpts = [{ value: '', label: 'Shared / none' }, ...ws.cells.map((c) => ({ value: c.id, label: c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}` }))];
  const upd = (id: string, fn: (a: Ancillary) => void) => mutate((d) => { const a = d.ancillaries.find((x) => x.id === id); if (a) fn(a); });
  const cols: Col<Ancillary>[] = [
    { key: 'name', label: 'Name / Ref', minWidth: 200, render: (a) => <TextInput cell value={a.name} onChange={(v) => upd(a.id, (x) => { x.name = v; })} ariaLabel="Ancillary name" /> },
    { key: 'kind', label: 'Type', minWidth: 200, render: (a) => <Select cell value={a.kind} options={ANCILLARY_KINDS} onChange={(v) => upd(a.id, (x) => { x.kind = v as Ancillary['kind']; })} ariaLabel="Ancillary type" /> },
    { key: 'cell', label: 'Home Cell', minWidth: 160, render: (a) => <Select cell value={a.cellId} options={cellOpts} onChange={(v) => upd(a.id, (x) => { x.cellId = v; })} ariaLabel="Home cell" /> },
    { key: 'fl', label: 'Floor Level', right: true, width: 80, render: (a) => <NumInput cell value={a.floorLevel} min={0} max={3} onChange={(v) => upd(a.id, (x) => { x.floorLevel = Math.round(v ?? 0); })} ariaLabel="Floor level" /> },
    { key: 'l', label: 'L m', right: true, width: 68, render: (a) => <NumInput cell nullable value={a.lengthM} min={0} onChange={(v) => upd(a.id, (x) => { x.lengthM = v; })} ariaLabel="Length m" /> },
    { key: 'w', label: 'W m', right: true, width: 68, render: (a) => <NumInput cell nullable value={a.widthM} min={0} onChange={(v) => upd(a.id, (x) => { x.widthM = v; })} ariaLabel="Width m" /> },
    { key: 'qty', label: 'Qty', right: true, width: 56, render: (a) => <NumInput cell value={a.qty} min={1} onChange={(v) => upd(a.id, (x) => { x.qty = Math.max(1, Math.round(v ?? 1)); })} ariaLabel="Quantity" /> },
    { key: 'claim', label: 'Claim m²', right: true, ro: true, render: (a) => a.lengthM && a.widthM ? <span className="tabular-nums">{fmt(a.lengthM * a.widthM * a.qty, 1)}</span> : <span className="text-slate-400">—</span> },
    { key: 'notes', label: 'Notes', minWidth: 180, render: (a) => <ExpandableTextCell value={a.notes} onChange={(v) => upd(a.id, (x) => { x.notes = v; })} label="Ancillary notes" context={a.name} /> },
  ];
  return (
    <Card className={className} collapseKey="ancillaries" defaultOpen={false} title={<>Ancillaries &amp; Storage <span className="font-normal tabular-nums text-slate-500">· {fmtInt(ws.ancillaries.length)}</span></>} pad={false}
      right={<button className="btn-primary" onClick={() => mutate((d) => { d.ancillaries.push(blankAncillary()); })}>＋ Add ancillary</button>}>
      <DataTable cols={cols} rows={ws.ancillaries} rowKey={(a) => a.id}
        onDelete={(a) => mutate((d) => { d.ancillaries = d.ancillaries.filter((x) => x.id !== a.id); })}
        onClone={(a) => mutate((d) => { d.ancillaries.push({ ...a, id: uid('anc'), name: `${a.name} (copy)` }); })}
        empty="No ancillaries registered." />
    </Card>
  );
}
