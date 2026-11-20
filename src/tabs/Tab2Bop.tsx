import type { Draft } from 'immer';
import { Fragment, useMemo, useState } from 'react';
import { Empty, ExpandableTextCell, HowItWorks, Kpi, NumInput, Pill, RagBadge, Select, TagPicker, TextInput, Th, Tip, type TagOption } from '../components/primitives';
import HoverExpandTextBox from '../components/common/HoverExpandTextBox';
import { OperationDrawer } from './OperationMethodDrawer';
import { FpdRegistryCard } from '../components/FpdRegistry';
import { blankAncillary, blankResource, blankRow } from '../data/seed';
import { isBlock, leavesOf, opIndex, rollUpBlock, type CpmNode, type LeafCalc, type RowCalc } from '../engine/model';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { exportBop } from '../lib/excel';
import { download, fileSafe } from '../lib/persistence';
import { useStore } from '../store';
import type { BopRow, Classification, ResourceField, ResourceKind, Workspace } from '../types';
import { ACTION_TYPES, CLASSIFICATIONS, FLOOR_LEVELS, RESOURCE_KINDS, complexityOf, uid } from '../types';

void blankAncillary; // imported for side-effects of tree-shaking guard

const CLASS_HEX: Record<Classification, string> = { VA: '#334155', NNVA: '#94a3b8', NVA: '#d03b3b' };
const CLASS_SHORT: Record<Classification, string> = { VA: 'VA', NNVA: 'NNVA', NVA: 'NVA' };
const CLASS_LONG: Record<Classification, string> = { VA: 'VA · Value-Add', NNVA: 'NNVA · Necessary', NVA: 'NVA · Pure Waste' };

/** Next free Op # for an FPD, stepping in tens (F5-110 → F5-120). */
export function nextOpId(ws: Workspace, fpdId: string): string {
  const taken = new Set(ws.rows.flatMap((r) => [r.opId, ...(r.children ?? []).map((c) => c.opId)]));
  const mine = ws.rows.filter((r) => r.fpdId === fpdId).flatMap((r) => leavesOf(r).map((l) => l.opId));
  let prefix = `F${ws.fpds.findIndex((f) => f.fpdId === fpdId) + 1}-`;
  let max = 0;
  for (const op of mine) {
    const m = op.match(/^(.*?)(\d+)$/);
    if (m) { prefix = m[1]; max = Math.max(max, parseInt(m[2], 10)); }
  }
  let n = max + 10;
  while (taken.has(`${prefix}${String(n).padStart(3, '0')}`)) n += 10;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function ClassBar({ byClass, width = 96 }: { byClass: Record<Classification, number>; width?: number }) {
  const total = byClass.VA + byClass.NNVA + byClass.NVA;
  if (total <= 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={(['VA', 'NNVA', 'NVA'] as Classification[]).map((k) => `${k} ${fmt((byClass[k] / total) * 100, 0)}%`).join(' · ')}>
      <span className="flex h-2 overflow-hidden rounded-sm bg-slate-100" style={{ width }}>
        {(['VA', 'NNVA', 'NVA'] as Classification[]).map((k) => byClass[k] > 0 && <span key={k} className="h-2 border-r-2 border-white last:border-r-0" style={{ width: `${(byClass[k] / total) * 100}%`, backgroundColor: CLASS_HEX[k] }} />)}
      </span>
    </span>
  );
}

export function CpmBadge({ node, nearHrs }: { node?: CpmNode; nearHrs: number }) {
  if (!node) return null;
  if (node.critical) return <Pill tone="dark" title="Zero float — on the critical path">Critical</Pill>;
  if (node.float <= nearHrs && node.dur > 0) return <RagBadge rag="amber" label="Near-critical" title={`Float ${fmt(node.float, 1)} h`} />;
  return <Pill tone="outline" title={`Float ${fmt(node.float, 1)} elapsed h`}>Float {fmt(node.float, 0)} h</Pill>;
}

/** Row threshold above which FPDs auto-collapse on first render (all except the first). */
const AUTO_COLLAPSE_THRESHOLD = 150;

export default function Tab2Bop() {
  const { ws, mutate, model: m, toast } = useStore();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [cls, setCls] = useState<'' | Classification>('');
  const [only, setOnly] = useState<'' | 'lift' | 'critical' | 'ar' | 'block'>('');
  // Per-FPD collapse state: Set of fpdIds that are currently collapsed.
  // When total BOP rows exceed AUTO_COLLAPSE_THRESHOLD, all FPDs except the first start collapsed.
  const [collapsedFpds, setCollapsedFpds] = useState<Set<string>>(() => {
    const totalRows = ws.rows.length;
    if (totalRows <= AUTO_COLLAPSE_THRESHOLD) return new Set<string>();
    const allFpdIds = [...new Set(ws.rows.map((r) => r.fpdId))];
    return new Set(allFpdIds.slice(1));
  });
  // Drawer state: { topId, childId | null }
  const [drawer, setDrawer] = useState<{ topId: string; childId: string | null } | null>(null);
  // Bulk edit state
  const [bulkZone, setBulkZone] = useState('');
  const [bulkFloor, setBulkFloor] = useState('');
  const [bulkClass, setBulkClass] = useState<'' | Classification>('');
  const [bulkCrew, setBulkCrew] = useState<number | null>(null);
  const [bulkRigIds, setBulkRigIds] = useState<string[]>([]);
  const [bulkBaselineHrs, setBulkBaselineHrs] = useState<number | null>(null);

  const known = useMemo(() => opIndex(ws.rows), [ws.rows]);
  const zoneOpts = useMemo(() => [{ value: '', label: '—' }, ...ws.zones.map((z) => { const c = ws.cells.find((x) => x.id === z.cellId); return { value: z.id, label: z.name, group: c ? `Cell ${c.number} · ${c.name}` : 'No cell' }; })], [ws.zones, ws.cells]);
  const fpdOpts = useMemo(() => ws.fpds.map((f) => ({ value: f.fpdId, label: f.fpdCode })), [ws.fpds]);
  const cmpOpts: TagOption[] = useMemo(() => ws.components.map((c) => ({ id: c.id, label: c.name || c.bomRef, sub: `${c.bomRef} · ${c.weightKg == null ? 'no weight' : `${fmtInt(c.weightKg)} kg`}` })), [ws.components]);
  const resOpts = useMemo(() => {
    const out = {} as Record<ResourceField, TagOption[]>;
    for (const k of RESOURCE_KINDS)
      out[k.field] = ws.resources.filter((r) => r.kind === k.kind).map((r) => ({ id: r.id, label: r.name || '(unnamed)', sub: [r.qty > 1 ? `×${r.qty}` : '', r.swlKg != null ? `${fmtInt(r.swlKg)} kg` : '', complexityOf(r), r.dwellMode === 'Full-Build' ? 'Full-Build Dwell' : ''].filter(Boolean).join(' · ') }));
    return out;
  }, [ws.resources]);

  // Inline create callbacks for TagPicker + OperationDrawer
  const createRes = (kind: ResourceKind) => (name: string): string | null => {
    const r = { ...blankResource(kind, uid('res')), name };
    mutate((d) => { d.resources.push(r); });
    return r.id;
  };
  const createCmp = (name: string): string | null => {
    const m = { id: uid('cmp'), bomRef: name, name, weightKg: null, lengthM: null, widthM: null, heightM: null, qtyPerBuild: 1, notes: '' };
    mutate((d) => { d.components.push(m); });
    return m.id;
  };

  const edit = (topId: string, childId: string | null, fn: (r: Draft<BopRow>) => void) =>
    mutate((d) => {
      const top = d.rows.find((r) => r.id === topId);
      if (!top) return;
      if (childId) {
        const c = top.children?.find((x) => x.id === childId);
        if (!c) return;
        fn(c);
        rollUpBlock(top as BopRow);
      } else fn(top);
    });

  const addRow = (fpdId: string, afterId?: string) => {
    const zone = ws.zones.find((z) => z.cellId === ws.fpds.find((f) => f.fpdId === fpdId)?.assignedCellId)?.id ?? '';
    const row = blankRow(fpdId, nextOpId(ws, fpdId), zone);
    mutate((d) => {
      let at = afterId ? d.rows.findIndex((r) => r.id === afterId) + 1 : -1;
      if (at <= 0) { const last = d.rows.map((r) => r.fpdId).lastIndexOf(fpdId); at = last >= 0 ? last + 1 : d.rows.length; }
      d.rows.splice(at, 0, row);
    });
  };
  const move = (id: string, dir: -1 | 1) =>
    mutate((d) => {
      const i = d.rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      let j = i + dir;
      while (j >= 0 && j < d.rows.length && d.rows[j].fpdId !== d.rows[i].fpdId) j += dir;
      if (j < 0 || j >= d.rows.length) return;
      [d.rows[i], d.rows[j]] = [d.rows[j], d.rows[i]];
    });
  const duplicate = (id: string) =>
    mutate((d) => {
      const i = d.rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      const src = d.rows[i];
      const copy: BopRow = JSON.parse(JSON.stringify(src));
      copy.id = uid('row');
      copy.opId = nextOpId(d as Workspace, src.fpdId);
      copy.description = `${src.description} (copy)`;
      if (copy.children) { copy.children.forEach((c, k) => { c.id = uid('row'); c.opId = `${copy.opId}.${k + 1}`; }); copy.opId = `WB-${copy.opId}`; rollUpBlock(copy); }
      d.rows.splice(i + 1, 0, copy);
    });
  const removeRows = (ids: string[]) => {
    mutate((d) => { d.rows = d.rows.filter((r) => !ids.includes(r.id)); });
    setSel(new Set());
  };

  const selected = ws.rows.filter((r) => sel.has(r.id));
  const sameFpd = selected.length > 0 && selected.every((r) => r.fpdId === selected[0].fpdId);
  const canMerge = selected.length >= 2 && sameFpd;
  const canUnmerge = selected.some(isBlock);
  const merge = () => {
    if (!canMerge) return;
    const ids = new Set(selected.map((r) => r.id));
    const blockId = uid('row');
    mutate((d) => {
      const picked = d.rows.filter((r) => ids.has(r.id));
      const kids: BopRow[] = picked.flatMap((r) => (r.children?.length ? r.children : [r])).map((k) => ({ ...(JSON.parse(JSON.stringify(k)) as BopRow), children: undefined }));
      const taken = new Set(d.rows.map((r) => r.opId));
      let opId = `WB-${kids[0].opId}`;
      for (let n = 2; taken.has(opId); n++) opId = `WB-${kids[0].opId}/${n}`;
      const block: BopRow = { ...(JSON.parse(JSON.stringify(kids[0])) as BopRow), id: blockId, opId, description: `Baseline Work Block: ${kids[0].description || kids[0].opId} → ${kids[kids.length - 1].description || kids[kids.length - 1].opId}`, taskType: picked[0].taskType, notes: '', children: kids };
      rollUpBlock(block);
      const at = d.rows.findIndex((r) => ids.has(r.id));
      d.rows = d.rows.filter((r) => !ids.has(r.id));
      d.rows.splice(at, 0, block);
    });
    setSel(new Set([blockId]));
    setOpen((o) => new Set(o).add(blockId));
    toast('ok', `${selected.length} rows merged into one Baseline Work Block. Hours, lifts, moves and tags are rolled up; expand ▸ to see or edit the detail.`);
  };
  const unmerge = () => {
    const ids = new Set(selected.filter(isBlock).map((r) => r.id));
    mutate((d) => {
      d.rows = d.rows.flatMap((r) => (ids.has(r.id) && r.children?.length ? r.children.map((c) => ({ ...c, children: undefined })) : [r]));
    });
    setSel(new Set());
  };

  const resetBulk = () => { setBulkZone(''); setBulkFloor(''); setBulkClass(''); setBulkCrew(null); setBulkRigIds([]); setBulkBaselineHrs(null); };
  const applyBulkEdit = () => {
    if (!sel.size) return;
    const ids = [...sel];
    mutate((d) => {
      for (const id of ids) {
        const r = d.rows.find((x) => x.id === id);
        if (!r || r.children?.length) continue;
        if (bulkZone) r.destZoneId = bulkZone;
        if (bulkFloor !== '') r.floorLevel = Number(bulkFloor);
        if (bulkClass) r.classification = bulkClass;
        if (bulkCrew != null) r.crewSize = Math.max(1, Math.round(bulkCrew));
        if (bulkRigIds.length > 0) r.rigIds = [...new Set([...r.rigIds, ...bulkRigIds])];
        if (bulkBaselineHrs != null) r.baselineHrs = bulkBaselineHrs;
      }
    });
    toast('ok', `Batch update applied to ${ids.length} row(s).`);
    resetBulk();
  };

  const match = (r: BopRow) => {
    const calc = m.calcs.get(r.id);
    const node = m.cpm.nodes.get(r.id);
    if (cls && !leavesOf(r).some((l) => l.classification === cls)) return false;
    if (only === 'lift' && !(calc && calc.lifts > 0)) return false;
    if (only === 'critical' && !node?.critical) return false;
    if (only === 'ar' && !calc?.arRed) return false;
    if (only === 'block' && !isBlock(r)) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      return [r, ...(r.children ?? [])].some((x) => `${x.opId} ${x.description} ${x.notes} ${x.actionType}`.toLowerCase().includes(s));
    }
    return true;
  };
  const t = m.totals;
  const manualOps = [...m.calcs.values()].flatMap((c) => c.leaves).filter((l) => l.arPct == null).length;
  const totalClass = { VA: t.va, NNVA: t.nnva, NVA: t.nva };

  // Find the row for the open drawer (look in both top-level rows and their children).
  const drawerRow = drawer
    ? (() => {
        const top = ws.rows.find((r) => r.id === drawer.topId);
        if (!top) return null;
        return drawer.childId ? top.children?.find((c) => c.id === drawer.childId) ?? null : top;
      })()
    : null;

  return (
    <div>
      <HowItWorks
        tab="2"
        title="Bill of Process — Mergeable Baseline Central Spine"
        steps={[
          'One row per Baseline activity, grouped by FPD. Use the Spine Filter above to isolate an FPD, a cell or the whole factory.',
          'Enter the three-way time split per build: Bay Run Time, Operator Touch Time and Operator Manning Time. Leave Bay Run Time at 0 for hand work — the row then reads "Manual op" rather than an Attendance Ratio.',
          'Sequential rows follow the row above in the same FPD unless you enter Predecessor # values; Parallel rows start when their listed predecessors finish.',
          'Tag every rig, crane, rigging item, vehicle and stand the activity needs — the five pickers take any number of items each. Type a new name and click + Create to add items inline.',
          'Tick two or more rows in one FPD and click Merge Selected into Baseline Work Block to roll them up. Expand ▸ to edit the folded activities; Unmerge restores them exactly.',
          'Click the ✎ Edit button on any row to open the full Operation & Method drawer — add detailed work instructions, rationale, consumables and review linked PFMEA.',
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Work blocks" guide="merge" value={fmtInt(t.workBlocks)} sub={`${fmtInt(t.activities)} underlying activities`} />
        <Kpi label="Total labour hours" guide="kpiLabour" value={fmtInt(t.labourHrs)} unit="h / build" sub={`Burden ${fmtInt(t.burdenRaw)} h × ${fmtPct(m.lc * 100, 0)} learning`} />
        <Kpi label="Value-add ratio" guide="kpiVa" value={fmtPct(t.labourHrs ? (t.va / t.labourHrs) * 100 : 0, 0)} sub={<span className="flex items-center gap-2"><ClassBar byClass={totalClass} width={70} /><span>NNVA {fmtPct(t.labourHrs ? (t.nnva / t.labourHrs) * 100 : 0, 0)} · NVA {fmtPct(t.labourHrs ? (t.nva / t.labourHrs) * 100 : 0, 1)}</span></span>} />
        <Kpi label="In-station opportunity" guide="opportunity" value={fmtInt(t.opportunityHrs)} unit="h" sub={`Manning ${fmtInt(t.manningHrs)} h − Touch ${fmtInt(t.touchHrs)} h`} />
        <Kpi label="Machine-locked labour" guide="kpiAr" value={fmtInt(t.arRedCount)} sub={`${fmtInt(manualOps)} manual op(s) with no equipment cycle`} rag={t.arRedCount ? 'red' : 'green'} />
        <Kpi label="Lifts · moves" guide="kpiLifts" value={`${fmtInt(t.lifts)} · ${fmtInt(t.moves)}`} sub={`${fmtInt(t.interCellMoves)} inter-cell Baseline work block(s)`} />
      </div>

      <FpdRegistryCard className="mb-4" />

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <button className="btn-primary" disabled={!canMerge} onClick={merge} title={selected.length >= 2 && !sameFpd ? 'Selected rows must belong to the same FPD' : 'Tick two or more rows in one FPD'}>⊞ Merge Selected into Baseline Work Block</button>
          <Tip id="merge" />
          <button className="btn" disabled={!canUnmerge} onClick={unmerge}>⊟ Unmerge / expand</button>
          <button className="btn" disabled={!sel.size} onClick={() => { if (window.confirm(`Delete ${sel.size} selected row(s)?`)) removeRows([...sel]); }}>Delete selected</button>
          <button className="btn" onClick={async () => { try { const blob = await exportBop(ws, m); download(`${fileSafe(ws.meta.name)}-BOP.xlsx`, blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } catch { toast('warn', 'BOP export failed — check the browser console for details.'); } }}>Export BOP (.xlsx)</button>
          <button className="btn" title={collapsedFpds.size > 0 ? 'Expand all FPDs' : 'Collapse all FPDs'} onClick={() => { if (collapsedFpds.size > 0) { setCollapsedFpds(new Set()); } else { setCollapsedFpds(new Set(m.fpds.map((f) => f.fpdId))); } }}>{collapsedFpds.size > 0 ? '▸ Expand all FPDs' : '▾ Collapse all FPDs'}</button>
          {sel.size > 0 && <span className="text-[12px] tabular-nums text-slate-500">{sel.size} selected <button className="btn-ghost" onClick={() => { setSel(new Set()); resetBulk(); }}>clear</button></span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Op #, description, notes…" className="inp w-56" aria-label="Search rows" />
            <div className="w-36"><Select value={cls} onChange={setCls} ariaLabel="Classification filter" options={[{ value: '', label: 'All classes' }, ...CLASSIFICATIONS.map((c) => ({ value: c.value, label: c.value }))]} /></div>
            <div className="w-40"><Select value={only} onChange={setOnly} ariaLabel="Row filter" options={[{ value: '', label: 'All rows' }, { value: 'lift', label: 'Lift ops only' }, { value: 'critical', label: 'Critical path only' }, { value: 'ar', label: 'Machine-locked only' }, { value: 'block', label: 'Baseline Work Blocks only' }]} /></div>
          </div>
        </div>

        {sel.size >= 2 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-sky-50 px-3 py-1.5">
            <span className="text-[12px] font-semibold text-sky-800">Batch update {sel.size} rows:</span>
            <span className="text-[12px] text-slate-600">Zone</span>
            <div className="w-44"><Select value={bulkZone} onChange={setBulkZone} options={[{ value: '', label: 'No change' }, ...zoneOpts.filter((o) => o.value)]} ariaLabel="Batch destination zone" /></div>
            <span className="text-[12px] text-slate-600">Floor</span>
            <div className="w-32"><Select value={bulkFloor} onChange={setBulkFloor} options={[{ value: '', label: 'No change' }, ...FLOOR_LEVELS.map((l, i) => ({ value: String(i), label: l }))]} ariaLabel="Batch floor level" /></div>
            <span className="text-[12px] text-slate-600">Class</span>
            <div className="w-40"><Select value={bulkClass} onChange={(v) => setBulkClass(v as '' | Classification)} options={[{ value: '', label: 'No change' }, ...CLASSIFICATIONS.map((c) => ({ value: c.value, label: CLASS_LONG[c.value] }))]} ariaLabel="Batch classification" /></div>
            <span className="text-[12px] text-slate-600">Crew</span>
            <NumInput value={bulkCrew} nullable min={1} onChange={setBulkCrew} width={52} ariaLabel="Batch crew size" />
            <span className="text-[12px] text-slate-600">Add Tooling</span>
            <TagPicker label="Tooling & Equipment" value={bulkRigIds} options={resOpts.rigIds} onChange={setBulkRigIds} minWidth={130} placeholder="Add tags…" />
            <span className="text-[12px] text-slate-600">Baseline h</span>
            <NumInput value={bulkBaselineHrs} nullable min={0} onChange={setBulkBaselineHrs} width={64} ariaLabel="Batch baseline hours" />
            <button className="btn-primary" onClick={applyBulkEdit} disabled={!bulkZone && bulkFloor === '' && !bulkClass && bulkCrew == null && !bulkRigIds.length && bulkBaselineHrs == null}>Apply</button>
            <button className="btn-ghost" onClick={resetBulk}>Reset</button>
          </div>
        )}
        {m.fpds.length === 0 ? (
          <div className="p-4"><Empty>No FPDs in the current Spine Filter. Widen the filter above or activate FPDs in Tab 3.</Empty></div>
        ) : (
          <div className="scroll-thin overflow-auto" style={{ maxHeight: 'calc(100vh - 215px)', minHeight: 320 }}>
            <table className="w-max min-w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-30">
                <tr>
                  <Th className="sticky left-0 z-10" style={{ width: 58, minWidth: 58, maxWidth: 58 }} />
                  <Th className="sticky left-[58px] z-10" guide="opId" style={{ width: 112, minWidth: 112, maxWidth: 112 }}>Route / Op #</Th>
                  <Th className="sticky left-[170px] z-10 border-r border-slate-200" guide="description" style={{ width: 300, minWidth: 300, maxWidth: 300 }}>Baseline Work Block / Activity Description</Th>
                  <Th guide="fpdRef">FPD Ref</Th>
                  <Th guide="cpmBadge">CPM</Th>
                  <Th guide="taskType">Task Type</Th>
                  <Th guide="predecessors">Predecessor #</Th>
                  <Th guide="origin">Origin Cell / Zone</Th>
                  <Th guide="destination">Destination Cell / Zone</Th>
                  <Th guide="movement">Movement</Th>
                  <Th guide="floorLevel">Stand Floor</Th>
                  <Th guide="component">Component Name / Description</Th>
                  <Th guide="crew" right>Crew</Th>
                  <Th guide="runTime" right>Bay Run h</Th>
                  <Th guide="touchTime" right>Touch h</Th>
                  <Th guide="manningTime" right>Manning h</Th>
                  <Th guide="burden" right>Burden h</Th>
                  <Th guide="elapsed" right>Elapsed h</Th>
                  <Th guide="ar" right>Ar %</Th>
                  <Th guide="opportunity" right>Opp. h</Th>
                  <Th guide="classification">Classification</Th>
                  <Th guide="actionType">Action Type</Th>
                  <Th guide="tagRigs">Tooling &amp; Equipment</Th>
                  <Th right guide="baselineHrs">Baseline h</Th>
                  <Th right guide="baselineHrs">Variance h</Th>
                  <Th guide="tagCranes">Cranes</Th>
                  <Th guide="tagRigging">Rigging &amp; Lifting Gear</Th>
                  <Th guide="tagVehicles">Transport Vehicles</Th>
                  <Th guide="tagStands">Build &amp; Storage Stands</Th>
                  <Th guide="liftCount" right>Lifts</Th>
                  <Th guide="moveCount" right>Moves</Th>
                  <Th guide="notes">Engineering Notes</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {m.fpds.map((f) => {
                  const rows = m.rows.filter((r) => r.fpdId === f.fpdId);
                  const shown = rows.filter(match);
                  const roll = m.fpdRoll.find((x) => x.fpd.fpdId === f.fpdId);
                  const cell = ws.cells.find((c) => c.id === f.assignedCellId);
                  // Auto-expand when a search query matches rows in this FPD
                  const isFpdCollapsed = collapsedFpds.has(f.fpdId) && !(q.trim() && shown.length > 0);
                  const toggleFpdCollapse = () => setCollapsedFpds((prev) => { const next = new Set(prev); next.has(f.fpdId) ? next.delete(f.fpdId) : next.add(f.fpdId); return next; });
                  return (
                    <Fragment key={f.fpdId}>
                      <tr>
                        <td colSpan={3} className="sticky left-0 z-20 border-b border-t border-slate-200 bg-slate-100 px-2 py-1.5" style={{ width: 470, minWidth: 470, maxWidth: 470 }}>
                          <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[12.5px]" title={`${f.fpdCode} — ${f.title}`}>
                            <button className="shrink-0 text-slate-500 hover:text-slate-900" onClick={toggleFpdCollapse} aria-expanded={!isFpdCollapsed} aria-label={isFpdCollapsed ? `Expand ${f.fpdCode}` : `Collapse ${f.fpdCode}`}>{isFpdCollapsed ? '▸' : '▾'}</button>
                            <b className="text-slate-900">{f.fpdCode}</b><span className="truncate text-slate-700">{f.title}</span><span className="text-[11px] text-slate-500">Rev {f.revision}</span>
                          </span>
                        </td>
                        <td colSpan={30} className="border-b border-t border-slate-200 bg-slate-100 px-2 py-1.5 text-[11.5px] tabular-nums text-slate-600">
                          <span className="flex items-center gap-3">
                            <span>{cell ? `Cell ${cell.number} · ${cell.name}` : 'No cell'}</span><span>{f.subAssemblyBomRef}</span>
                            <span>{fmtInt(rows.length)} Baseline work block(s){shown.length !== rows.length ? ` · ${shown.length} shown` : ''}{isFpdCollapsed ? ' · collapsed' : ''}</span>
                            <span>{fmtInt(roll?.labourHrs ?? 0)} labour h</span><span>{fmtInt(roll?.lifts ?? 0)} lift(s)</span>
                            <button className="btn-ghost !text-slate-800" onClick={() => addRow(f.fpdId)}>＋ Add activity</button>
                          </span>
                        </td>
                      </tr>
                      {!isFpdCollapsed && shown.map((r) => {
                        const calc = m.calcs.get(r.id)!;
                        const block = isBlock(r);
                        const isOpen = open.has(r.id);
                        return (
                          <Fragment key={r.id}>
                            <BopLine
                              row={r} calc={calc} node={m.cpm.nodes.get(r.id)} block={block} isOpen={isOpen} selected={sel.has(r.id)} known={known}
                              onToggleOpen={() => setOpen((o) => { const n = new Set(o); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                              onSelect={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                              onEdit={(fn) => edit(r.id, null, fn)} zoneOpts={zoneOpts} fpdOpts={fpdOpts} cmpOpts={cmpOpts} resOpts={resOpts}
                              onCreateRes={createRes} onCreateCmp={createCmp}
                              onOpenDrawer={() => setDrawer({ topId: r.id, childId: null })}
                              actions={{ up: () => move(r.id, -1), down: () => move(r.id, 1), add: () => addRow(r.fpdId, r.id), dup: () => duplicate(r.id), del: () => removeRows([r.id]) }}
                            />
                            {block && isOpen && calc.leaves.map((lc) => (
                              <BopLine
                                key={lc.leaf.id} row={lc.leaf} leaf={lc} child block={false} isOpen={false} selected={false} known={known}
                                onEdit={(fn) => edit(r.id, lc.leaf.id, fn)} zoneOpts={zoneOpts} fpdOpts={fpdOpts} cmpOpts={cmpOpts} resOpts={resOpts}
                                onCreateRes={createRes} onCreateCmp={createCmp}
                                onOpenDrawer={() => setDrawer({ topId: r.id, childId: lc.leaf.id })}
                              />
                            ))}
                          </Fragment>
                        );
                      })}
                      {!isFpdCollapsed && shown.length === 0 && (
                        <tr><td colSpan={33} className="border-b border-slate-100 px-3 py-2 text-[12px] text-slate-500">{rows.length ? 'No rows match the current search / filters.' : <span>No activities yet. Use <b>+ Add activity</b> to build manually, or <b>Import Excel / CSV</b> (Bill of Process .xlsx / .csv) to load in bulk. Column mapping: Phase = FPD, Route Code = Op, Labour Content = Manning, Crew Density = Crew, Zone = Destination Zone.</span>}</td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: CLASS_HEX.VA }} />VA</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: CLASS_HEX.NNVA }} />NNVA</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: CLASS_HEX.NVA }} />NVA (pure waste)</span>
          <span>Hours are per build at baseline; Burden, Elapsed and labour totals apply Build #{ws.settings.learning.selectedBuild} learning ({fmtPct(m.lc * 100, 0)}).</span>
        </div>
      </div>

      {drawer && drawerRow && (
        <OperationDrawer
          row={drawerRow}
          topId={drawer.topId}
          childId={drawer.childId}
          onEdit={(fn) => edit(drawer.topId, drawer.childId, fn)}
          onClose={() => setDrawer(null)}
          zoneOpts={zoneOpts}
          cmpOpts={cmpOpts}
          resOpts={resOpts}
          onCreateRes={createRes}
          onCreateCmp={createCmp}
        />
      )}
    </div>
  );
}

interface LineProps {
  row: BopRow;
  calc?: RowCalc;
  leaf?: LeafCalc;
  node?: CpmNode;
  block: boolean;
  child?: boolean;
  isOpen: boolean;
  selected: boolean;
  known: Map<string, string>;
  onToggleOpen?: () => void;
  onSelect?: () => void;
  onEdit: (fn: (r: Draft<BopRow>) => void) => void;
  zoneOpts: { value: string; label: string; group?: string }[];
  fpdOpts: { value: string; label: string }[];
  cmpOpts: TagOption[];
  resOpts: Record<ResourceField, TagOption[]>;
  onCreateRes: (kind: ResourceKind) => (name: string) => string | null;
  onCreateCmp: (name: string) => string | null;
  onOpenDrawer: () => void;
  actions?: { up: () => void; down: () => void; add: () => void; dup: () => void; del: () => void };
}

function BopLine({ row: r, calc, leaf, node, block, child, isOpen, selected, known, onToggleOpen, onSelect, onEdit, zoneOpts, fpdOpts, cmpOpts, resOpts, onCreateRes, onCreateCmp, onOpenDrawer, actions }: LineProps) {
  const { ws } = useStore();
  const t = ws.settings.thresholds;
  const ro = block;
  const bg = child ? 'bg-slate-50' : selected ? 'bg-sky-50' : 'bg-white';
  const burden = leaf ? leaf.burdenRaw : calc!.burdenRaw;
  const elapsed = leaf ? leaf.elapsedHrs : calc!.elapsedHrs;
  const arPct = leaf ? leaf.arPct : calc!.arPct;
  const arRed = leaf ? leaf.arRed : calc!.arRed;
  const opp = leaf ? leaf.opportunityHrs : calc!.opportunityHrs;
  const zc = (z: string) => ws.zones.find((x) => x.id === z)?.cellId ?? '';
  const movement = leaf ? (!zc(r.originZoneId) || !zc(r.destZoneId) ? '—' : zc(r.originZoneId) === zc(r.destZoneId) ? 'Intra-Cell' : 'Inter-Cell') : calc!.movement;
  const badPreds = r.predecessors.filter((p) => p.trim() && !known.has(p.trim()));
  const touchBad = r.touchHrs > r.manningHrs + 1e-9;
  const num = (v: number, d = 1) => <span className="block px-1.5 py-1 text-right tabular-nums text-slate-700">{fmt(v, d)}</span>;
  const hasMethod = !!(r.methodDetail?.trim());

  return (
    <tr className={`${bg} hover:bg-slate-50`}>
      <td className={`td sticky left-0 z-20 ${bg}`} style={{ width: 58, minWidth: 58, maxWidth: 58 }}>
        <span className="flex items-center gap-1 pl-1 pt-1">
          {child ? <span className="pl-5 text-slate-300">└</span> : (
            <>
              <input type="checkbox" className="accent-slate-800" checked={selected} onChange={onSelect} aria-label={`Select ${r.opId}`} />
              {block ? <button className="w-4 text-[11px] text-slate-600 hover:text-slate-900" onClick={onToggleOpen} aria-expanded={isOpen} aria-label={isOpen ? 'Collapse Baseline work block' : 'Expand Baseline work block'}>{isOpen ? '▾' : '▸'}</button> : <span className="w-4" />}
            </>
          )}
        </span>
      </td>
      <td className={`td sticky left-[58px] z-20 ${bg}`} style={{ width: 112, minWidth: 112, maxWidth: 112 }}><TextInput cell mono value={r.opId} onChange={(v) => onEdit((d) => { d.opId = v.trim(); })} ariaLabel="Op #" /></td>
      <td className={`td sticky left-[170px] z-20 border-r border-slate-200 ${bg}`} style={{ width: 300, minWidth: 300, maxWidth: 300 }}>
        <div className="flex items-start gap-1">
          {block && <span className="mt-1 shrink-0"><Pill tone="blue" title="Merged Baseline Work Block">⊞ {r.children!.length}</Pill></span>}
          <div className="min-w-0 flex-1"><HoverExpandTextBox value={r.description} onChange={(v) => onEdit((d) => { d.description = v; })} hasMethod={hasMethod && !block} placeholder="Describe the activity…" /></div>
        </div>
      </td>
      <td className="td" style={{ minWidth: 96 }}>
        {child ? <span className="block px-1.5 py-1 text-slate-400">↳ in block</span> : <Select cell value={r.fpdId} options={fpdOpts} ariaLabel="FPD Ref" onChange={(v) => onEdit((d) => { d.fpdId = v; d.children?.forEach((c) => { c.fpdId = v; }); })} />}
      </td>
      <td className="td"><span className="block px-1 py-1">{child ? null : <CpmBadge node={node} nearHrs={t.nearCriticalFloatHrs} />}</span></td>
      <td className="td" style={{ minWidth: 104 }}>
        {child ? <span className="block px-1.5 py-1 text-slate-400">Serial in block</span> : <Select cell value={r.taskType} ariaLabel="Task type" options={[{ value: 'Sequential', label: 'Sequential' }, { value: 'Parallel', label: 'Parallel' }]} onChange={(v) => onEdit((d) => { d.taskType = v; })} />}
      </td>
      <td className="td" style={{ minWidth: 130 }}>
        {ro ? <span className="block px-1.5 py-1 font-mono text-[12px] text-slate-600" title="Inherited from the folded activities">{r.predecessors.join(', ') || 'None'}</span> : (
          <>
            <TextInput cell mono value={r.predecessors.join(', ')} placeholder={node?.implicitPred ? 'None (follows above)' : 'None'} ariaLabel="Predecessors" onChange={(v) => onEdit((d) => { d.predecessors = [...new Set(v.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== 'none'))]; })} className={badPreds.length ? '!border-red-400' : ''} />
            {badPreds.length > 0 && <span className="block px-1.5 pb-0.5 text-[10.5px] text-red-700">Unknown: {badPreds.join(', ')}</span>}
          </>
        )}
      </td>
      <td className="td" style={{ minWidth: 170 }}>{ro ? <RoText>{zoneOpts.find((z) => z.value === r.originZoneId)?.label}</RoText> : <Select cell value={r.originZoneId} options={zoneOpts} ariaLabel="Origin zone" onChange={(v) => onEdit((d) => { d.originZoneId = v; })} />}</td>
      <td className="td" style={{ minWidth: 170 }}>{ro ? <RoText>{zoneOpts.find((z) => z.value === r.destZoneId)?.label}</RoText> : <Select cell value={r.destZoneId} options={zoneOpts} ariaLabel="Destination zone" onChange={(v) => onEdit((d) => { if (d.originZoneId === d.destZoneId || !d.originZoneId) d.originZoneId = v; d.destZoneId = v; })} />}</td>
      <td className="td"><span className="block px-1 py-1">{movement === '—' ? <span className="text-slate-400">—</span> : <Pill tone={movement === 'Inter-Cell' ? 'blue' : 'outline'}>{movement}</Pill>}</span></td>
      <td className="td" style={{ minWidth: 92 }}>{ro ? <RoText>{FLOOR_LEVELS[r.floorLevel]}</RoText> : <Select cell value={r.floorLevel} ariaLabel="Stand floor level" options={FLOOR_LEVELS.map((l, i) => ({ value: i, label: l }))} onChange={(v) => onEdit((d) => { d.floorLevel = v; })} />}</td>
      <td className="td"><TagPicker label="Components" value={r.componentIds} options={cmpOpts} readOnly={ro} minWidth={190} onChange={(v) => onEdit((d) => { d.componentIds = v; })} onCreate={ro ? undefined : onCreateCmp} /></td>
      <td className="td w-[52px]">{ro ? num(r.crewSize, 0) : <NumInput cell value={r.crewSize} min={1} max={99} ariaLabel="Crew size" onChange={(v) => onEdit((d) => { d.crewSize = Math.max(1, Math.round(v ?? 1)); })} />}</td>
      <td className="td w-[70px]">{ro ? num(r.runHrs) : <NumInput cell value={r.runHrs} min={0} ariaLabel="Run time hours" onChange={(v) => onEdit((d) => { d.runHrs = v ?? 0; })} />}</td>
      <td className="td w-[70px]">{ro ? num(r.touchHrs) : <NumInput cell value={r.touchHrs} min={0} ariaLabel="Touch time hours" className={touchBad ? '!border-red-400' : ''} onChange={(v) => onEdit((d) => { d.touchHrs = v ?? 0; })} />}</td>
      <td className="td w-[74px]">{ro ? num(r.manningHrs) : <NumInput cell value={r.manningHrs} min={0} ariaLabel="Manning time hours" onChange={(v) => onEdit((d) => { d.manningHrs = v ?? 0; })} />}</td>
      <td className="td-ro text-right text-slate-700" title="Manning Time × Crew Size">{fmt(burden, 1)}</td>
      <td className="td-ro text-right font-medium text-slate-900" title="Max(Run, Manning) ÷ Net Active Factor × Learning Curve">{fmt(elapsed, 1)}</td>
      <td className="td-ro whitespace-nowrap text-right">{arPct == null ? <Pill tone="outline" title="Bay Run Time is 0 — hand work with no equipment cycle">Manual op</Pill> : arRed ? <RagBadge rag="red" label={`${fmtPct(arPct, 0)} · RED – MACHINE LOCKED LABOUR`} title="Run Time > 5 min and Manning Time ≥ Run Time: the equipment cycle holds an operator for its whole duration" /> : <span className="text-slate-700">{fmtPct(arPct, 0)}</span>}</td>
      <td className="td-ro text-right text-slate-700">{fmt(opp, 1)}</td>
      <td className="td" style={{ minWidth: 150 }}>
        {ro ? <span className="flex items-center gap-1.5 px-1.5 py-1.5"><ClassBar byClass={calc!.byClass} width={64} /><span className="text-[11px] text-slate-500">{CLASS_SHORT[r.classification]}</span></span> : (
          <span className="flex items-center gap-1"><span className="ml-1 inline-block h-2.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: CLASS_HEX[r.classification] }} /><Select cell value={r.classification} ariaLabel="Action classification" options={CLASSIFICATIONS.map((c) => ({ value: c.value, label: CLASS_LONG[c.value] }))} onChange={(v) => onEdit((d) => { d.classification = v; })} /></span>
        )}
      </td>
      <td className="td" style={{ minWidth: 128 }}>{ro ? <RoText>{r.actionType}</RoText> : <Select cell value={r.actionType} ariaLabel="Specific action type" options={ACTION_TYPES.map((a) => ({ value: a, label: a }))} onChange={(v) => onEdit((d) => { d.actionType = v; if (v === 'Lifting' && d.liftCount === 0) d.liftCount = 1; })} />}</td>
      {RESOURCE_KINDS.map((k) => (
        <td key={k.kind} className="td"><TagPicker label={k.plural} value={r[k.field]} options={resOpts[k.field]} readOnly={ro} onChange={(v) => onEdit((d) => { d[k.field] = v; })} onCreate={ro ? undefined : onCreateRes(k.kind)} /></td>
      ))}
      <td className="td w-[54px]">{ro ? num(r.liftCount, 0) : <NumInput cell value={r.liftCount} min={0} ariaLabel="Lift count" onChange={(v) => onEdit((d) => { d.liftCount = Math.max(0, Math.round(v ?? 0)); })} />}</td>
      <td className="td w-[54px]">{ro ? num(r.moveCount, 0) : <NumInput cell value={r.moveCount} min={0} ariaLabel="Move count" onChange={(v) => onEdit((d) => { d.moveCount = Math.max(0, Math.round(v ?? 0)); })} />}</td>
      <td className="td"><ExpandableTextCell value={r.notes} onChange={(v) => onEdit((d) => { d.notes = v; })} label="Engineering Notes" context={`${r.opId} · ${r.description}`} minWidth={200} /></td>
      <td className="td w-[74px]">{ro ? num(r.baselineHrs ?? 0) : <NumInput cell value={r.baselineHrs ?? null} nullable min={0} ariaLabel="Baseline hours" onChange={(v) => onEdit((d) => { d.baselineHrs = v ?? undefined; })} />}</td>
      <td className="td-ro w-[74px] text-right tabular-nums" title="Baseline h minus Modelled (Manning) h">
        {r.baselineHrs != null ? (() => { const v = r.baselineHrs - r.manningHrs; return <span className={v < -0.05 ? 'text-red-700 font-semibold' : v > 0.05 ? 'text-amber-700' : 'text-green-700'}>{v >= 0 ? '+' : ''}{fmt(v, 1)}</span>; })() : <span className="text-slate-400">—</span>}
      </td>
      <td className="td">
        <span className="flex items-center whitespace-nowrap pt-0.5">
          <button className="btn-ghost" title="Edit full operation & method" onClick={onOpenDrawer}>✎</button>
          {actions && (
            <>
              <button className="btn-ghost" title="Move up within FPD" onClick={actions.up}>▲</button>
              <button className="btn-ghost" title="Move down within FPD" onClick={actions.down}>▼</button>
              <button className="btn-ghost" title="Insert activity below" onClick={actions.add}>＋</button>
              <button className="btn-ghost" title="Duplicate" onClick={actions.dup}>⧉</button>
              <button className="btn-ghost" title="Delete row" onClick={actions.del}>✕</button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}
const RoText = ({ children }: { children?: React.ReactNode }) => <span className="block truncate px-1.5 py-1 text-slate-600">{children || '—'}</span>;
