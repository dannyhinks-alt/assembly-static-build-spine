// Multi-FPD Registry (30+ FPDs) and the Component / BOM register.
import { leavesOf, rollUpBlock } from '../engine/model';
import { fmt, fmtInt } from '../lib/format';
import { useStore } from '../store';
import type { BopRow, Component, Fpd } from '../types';
import { uid } from '../types';
import { DataTable, type Col } from './DataTable';
import { Card, ExpandableTextCell, NumInput, Pill, RagBadge, Select, TextInput } from './primitives';

export function FpdRegistryCard({ className = '' }: { className?: string }) {
  const { ws, mutate, integrity, scope, setScope, toast } = useStore();
  const fm = integrity.factory;
  const cellOpts = ws.cells.map((c) => ({ value: c.id, label: `Cell ${c.number} · ${c.name}` }));
  const upd = (id: string, fn: (f: Fpd) => void) => mutate((d) => { const f = d.fpds.find((x) => x.fpdId === id); if (f) fn(f); });
  const nextCode = () => {
    const nums = ws.fpds.map((f) => parseInt(f.fpdCode.replace(/\D+/g, ''), 10)).filter(Number.isFinite);
    return `FPD-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  };
  const addFpd = () => mutate((d) => { d.fpds.push({ fpdId: uid('fpd'), fpdCode: nextCode(), title: 'New Fixed Process Document', subAssemblyBomRef: '', assignedCellId: d.cells[0]?.id ?? '', revision: 'A', active: true }); });
  const cloneFpd = (src: Fpd) => {
    const fpdId = uid('fpd');
    const code = nextCode();
    const n = ws.fpds.length + 1;
    mutate((d) => {
      d.fpds.push({ ...src, fpdId, fpdCode: code, title: `${src.title} (clone)`, revision: 'A' });
      const taken = new Set(d.rows.flatMap((r) => [r.opId, ...(r.children ?? []).map((c) => c.opId)]));
      const map = new Map<string, string>();
      const rename = (op: string) => {
        const m = op.match(/^(WB-)?F\d+-(.*)$/);
        let next = m ? `${m[1] ?? ''}F${n}-${m[2]}` : `${op}-C`;
        while (taken.has(next)) next += "'";
        taken.add(next);
        map.set(op, next);
        return next;
      };
      const copies: BopRow[] = d.rows.filter((r) => r.fpdId === src.fpdId).map((r) => JSON.parse(JSON.stringify(r)) as BopRow);
      for (const r of copies) for (const x of [r, ...(r.children ?? [])]) { x.id = uid('row'); x.fpdId = fpdId; x.opId = rename(x.opId); }
      for (const r of copies) {
        for (const x of [r, ...(r.children ?? [])]) x.predecessors = x.predecessors.map((p) => map.get(p) ?? p);
        if (r.children?.length) rollUpBlock(r);
      }
      d.rows.push(...copies);
    });
    toast('ok', `${src.fpdCode} cloned to ${code} with its work blocks. Internal predecessor links were re-pointed to the copies.`);
  };
  const deleteFpd = (f: Fpd) => {
    const n = ws.rows.filter((r) => r.fpdId === f.fpdId).length;
    if (!window.confirm(`Delete ${f.fpdCode} and its ${n} work block(s)? PFMEA items and hold points are kept but unlinked.`)) return;
    mutate((d) => {
      d.fpds = d.fpds.filter((x) => x.fpdId !== f.fpdId);
      d.rows = d.rows.filter((r) => r.fpdId !== f.fpdId);
      d.pfmea.forEach((p) => { if (p.fpdId === f.fpdId) p.fpdId = ''; });
      d.holdPoints.forEach((h) => { if (h.fpdId === f.fpdId) h.fpdId = ''; });
    });
  };
  const cols: Col<Fpd>[] = [
    { key: 'active', label: 'Active', guide: 'fpdActive', width: 60, render: (f) => <span className="flex justify-center pt-1.5"><input type="checkbox" className="accent-slate-800" checked={f.active} onChange={(e) => upd(f.fpdId, (x) => { x.active = e.target.checked; })} aria-label={`${f.fpdCode} active`} /></span> },
    { key: 'code', label: 'FPD Code', guide: 'fpdCode', minWidth: 110, render: (f) => <TextInput cell mono value={f.fpdCode} onChange={(v) => upd(f.fpdId, (x) => { x.fpdCode = v; })} ariaLabel="FPD code" /> },
    { key: 'title', label: 'Title', guide: 'fpdTitle', minWidth: 300, render: (f) => <TextInput cell value={f.title} onChange={(v) => upd(f.fpdId, (x) => { x.title = v; })} ariaLabel="FPD title" /> },
    { key: 'bom', label: 'Sub-Assembly BOM Ref', guide: 'bomRef', minWidth: 250, render: (f) => <TextInput cell mono value={f.subAssemblyBomRef} onChange={(v) => upd(f.fpdId, (x) => { x.subAssemblyBomRef = v; })} ariaLabel="BOM ref" /> },
    { key: 'cell', label: 'Assigned Cell', guide: 'assignedCell', minWidth: 230, render: (f) => <Select cell value={f.assignedCellId} options={cellOpts} onChange={(v) => upd(f.fpdId, (x) => { x.assignedCellId = v; })} ariaLabel="Assigned cell" /> },
    { key: 'rev', label: 'Rev', guide: 'revision', width: 60, render: (f) => <TextInput cell value={f.revision} onChange={(v) => upd(f.fpdId, (x) => { x.revision = v; })} ariaLabel="Revision" /> },
    { key: 'rows', label: 'Work blocks', right: true, ro: true, render: (f) => fmtInt(ws.rows.filter((r) => r.fpdId === f.fpdId).length) },
    { key: 'hrs', label: 'Labour h / build', right: true, ro: true, guide: 'kpiLabour', render: (f) => (f.active ? fmtInt(fm.fpdRoll.find((x) => x.fpd.fpdId === f.fpdId)?.labourHrs ?? 0) : '—') },
    { key: 'crit', label: 'Critical ops', right: true, ro: true, guide: 'badgeCritical', render: (f) => (f.active ? fmtInt(fm.fpdRoll.find((x) => x.fpd.fpdId === f.fpdId)?.criticalOps ?? 0) : '—') },
    { key: 'go', label: '', ro: true, render: (f) => <button className="btn-ghost" disabled={!f.active} onClick={() => setScope({ ...scope, mode: 'fpd', fpdIds: [f.fpdId], zoneId: '' })}>Isolate ↓</button> },
  ];
  const active = ws.fpds.filter((f) => f.active).length;
  return (
    <Card
      className={className}
      collapseKey="fpdRegistry"
      defaultOpen={false}
      title={<>Multi-FPD Registry <span className="font-normal tabular-nums text-slate-500">· {fmtInt(ws.fpds.length)} registered, capacity 30+</span></>}
      guide="fpdCode"
      pad={false}
      right={
        <>
          <Pill tone="outline">{fmtInt(active)} active · {fmtInt(ws.fpds.length - active)} inactive</Pill>
          <button className="btn-ghost" onClick={() => mutate((d) => { d.fpds.forEach((f) => { f.active = true; }); })}>Activate all</button>
          <button className="btn-primary" onClick={addFpd}>＋ Add FPD</button>
        </>
      }
    >
      <DataTable cols={cols} rows={ws.fpds} rowKey={(f) => f.fpdId} onClone={cloneFpd} cloneTitle="Clone FPD with its work blocks" onDelete={deleteFpd} maxHeight={420} rowClass={(f) => (f.active ? '' : 'opacity-55')} empty="No FPDs — add one or import from Excel." />
    </Card>
  );
}

export function ComponentRegisterCard({ className = '' }: { className?: string }) {
  const { ws, mutate } = useStore();
  const updC = (id: string, fn: (c: Component) => void) => mutate((d) => { const c = d.components.find((x) => x.id === id); if (c) fn(c); });
  const usedBy = (cmpId: string) => ws.rows.flatMap((r) => leavesOf(r)).filter((l) => l.componentIds.includes(cmpId));
  const cols: Col<Component>[] = [
    { key: 'bom', label: 'BOM Ref', guide: 'bomRef', minWidth: 250, render: (c) => <TextInput cell mono value={c.bomRef} onChange={(v) => updC(c.id, (x) => { x.bomRef = v; })} ariaLabel="BOM ref" /> },
    { key: 'name', label: 'Component Name / Description', minWidth: 220, render: (c) => <TextInput cell value={c.name} onChange={(v) => updC(c.id, (x) => { x.name = v; })} ariaLabel="Component name" /> },
    { key: 'w', label: 'Weight kg', guide: 'cmpWeight', right: true, width: 90, render: (c) => <NumInput cell nullable value={c.weightKg} min={0} onChange={(v) => updC(c.id, (x) => { x.weightKg = v; })} ariaLabel="Weight kg" className={c.weightKg == null && usedBy(c.id).some((l) => l.liftCount > 0) ? '!border-red-400' : ''} /> },
    { key: 'l', label: 'L m', guide: 'cmpDims', right: true, width: 64, render: (c) => <NumInput cell nullable value={c.lengthM} min={0} onChange={(v) => updC(c.id, (x) => { x.lengthM = v; })} ariaLabel="Length m" /> },
    { key: 'wd', label: 'W m', right: true, width: 64, render: (c) => <NumInput cell nullable value={c.widthM} min={0} onChange={(v) => updC(c.id, (x) => { x.widthM = v; })} ariaLabel="Width m" /> },
    { key: 'h', label: 'H m', right: true, width: 64, render: (c) => <NumInput cell nullable value={c.heightM} min={0} onChange={(v) => updC(c.id, (x) => { x.heightM = v; })} ariaLabel="Height m" /> },
    { key: 'q', label: 'Qty / build', guide: 'cmpQty', right: true, width: 80, render: (c) => <NumInput cell value={c.qtyPerBuild} min={0} onChange={(v) => updC(c.id, (x) => { x.qtyPerBuild = v ?? 1; })} ariaLabel="Quantity per build" /> },
    { key: 'heavy', label: 'Flag', ro: true, render: (c) => (c.weightKg == null ? <RagBadge rag="red" label="No weight" /> : c.weightKg > ws.settings.thresholds.heavyLiftKg ? <RagBadge rag="amber" label="Heavy" title={`Above the ${fmtInt(ws.settings.thresholds.heavyLiftKg)} kg Heavy Lift threshold`} /> : <span className="text-slate-400">—</span>) },
    { key: 'used', label: 'Used by', ro: true, minWidth: 150, render: (c) => { const u = usedBy(c.id); return u.length ? <span className="font-mono text-[11.5px] text-slate-600" title={u.map((l) => l.opId).join(', ')}>{u.slice(0, 3).map((l) => l.opId).join(', ')}{u.length > 3 ? ` +${u.length - 3}` : ''}</span> : <span className="text-slate-400">unused</span>; } },
    { key: 'notes', label: 'Notes', guide: 'notes', minWidth: 200, render: (c) => <ExpandableTextCell value={c.notes} onChange={(v) => updC(c.id, (x) => { x.notes = v; })} label="Component notes" context={c.name} /> },
  ];
  return (
    <Card
      className={className}
      collapseKey="componentRegister"
      title={<>Component / BOM Register <span className="font-normal tabular-nums text-slate-500">· {fmtInt(ws.components.length)}</span></>}
      guide="cmpWeight"
      pad={false}
      right={<button className="btn-primary" onClick={() => mutate((d) => { d.components.push({ id: uid('cmp'), bomRef: 'BOM-', name: 'New component', weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' }); })}>＋ Add component</button>}
    >
      <DataTable
        cols={cols} rows={ws.components} rowKey={(c) => c.id} maxHeight={520}
        onClone={(c) => mutate((d) => { d.components.push({ ...c, id: uid('cmp'), bomRef: `${c.bomRef}-COPY` }); })}
        onDelete={(c) => {
          const u = usedBy(c.id).length;
          if (u && !window.confirm(`${c.name} is linked to ${u} activit${u === 1 ? 'y' : 'ies'}. Delete it and remove those links?`)) return;
          mutate((d) => {
            d.components = d.components.filter((x) => x.id !== c.id);
            for (const r of d.rows) for (const x of [r, ...(r.children ?? [])]) x.componentIds = x.componentIds.filter((i) => i !== c.id);
          });
        }}
      />
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Weight and height feed every lift check above. Tallest component {fmt(Math.max(0, ...ws.components.map((c) => c.heightM ?? 0)), 2)} m against a {fmt(ws.settings.crane.hookHeightM, 1)} m primary hook height.</div>
    </Card>
  );
}
