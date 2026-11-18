// Slide-over drawer for editing the full Operation Phase record and method detail.
import type { Draft } from 'immer';
import { Drawer, ExpandableTextCell, NumInput, Select, TagPicker, type TagOption } from '../components/primitives';
import { useStore } from '../store';
import type { BopRow, ResourceField, ResourceKind } from '../types';
import { FLOOR_LEVELS, RESOURCE_KINDS } from '../types';

export interface OpDrawerProps {
  row: BopRow;
  topId: string;
  childId: string | null;
  onEdit: (fn: (r: Draft<BopRow>) => void) => void;
  onClose: () => void;
  zoneOpts: { value: string; label: string; group?: string }[];
  cmpOpts: TagOption[];
  resOpts: Record<ResourceField, TagOption[]>;
  onCreateRes: (kind: ResourceKind) => (name: string) => string | null;
  onCreateCmp: (name: string) => string | null;
}

export function OperationDrawer({ row: r, onEdit, onClose, zoneOpts, cmpOpts, resOpts, onCreateRes, onCreateCmp }: OpDrawerProps) {
  const { ws } = useStore();
  const linkedPfmea = ws.pfmea.filter((p) => p.opId === r.opId);
  const fpd = ws.fpds.find((f) => f.fpdId === r.fpdId);

  return (
    <Drawer
      title="Edit Full Operation & Method"
      subtitle={`${r.opId}${fpd ? ` · ${fpd.fpdCode}` : ''}`}
      onClose={onClose}
      width={640}
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="space-y-5">
        <section>
          <label className="lbl mb-1 block">Operation Phase Title</label>
          <ExpandableTextCell value={r.description} onChange={(v) => onEdit((d) => { d.description = v; })} label="Operation Phase Title" context={r.opId} placeholder="Describe the activity…" minWidth={560} />
        </section>

        <section>
          <label className="lbl mb-1 flex items-center gap-1.5">
            Detailed Method &amp; Work Instruction Steps
            {r.methodDetail && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-[1px] text-[10px] font-medium text-emerald-800">📄 Populated</span>}
          </label>
          <ExpandableTextCell value={r.methodDetail ?? ''} onChange={(v) => onEdit((d) => { d.methodDetail = v || undefined; })} label="Detailed Method & Work Instruction Steps" context={r.opId} placeholder="Step-by-step work instructions, tolerances and safety precautions…" minWidth={560} />
        </section>

        <section>
          <label className="lbl mb-1 block">Engineering Rationale</label>
          <ExpandableTextCell value={r.rationale ?? ''} onChange={(v) => onEdit((d) => { d.rationale = v || undefined; })} label="Engineering Rationale" context={r.opId} placeholder="Why this operation is required, design intent…" minWidth={560} />
        </section>

        <section>
          <label className="lbl mb-1 block">Consumables</label>
          <textarea
            rows={2}
            value={r.consumables ?? ''}
            onChange={(e) => onEdit((d) => { d.consumables = e.target.value || undefined; })}
            className="inp block w-full resize-none"
            placeholder="Consumables used in this operation (e.g. M10 bolts × 24, Loctite 243)…"
          />
        </section>

        <section>
          <label className="lbl mb-1 block">Comments / Engineering Notes</label>
          <ExpandableTextCell value={r.notes} onChange={(v) => onEdit((d) => { d.notes = v; })} label="Engineering Notes" context={r.opId} placeholder="Notes, assumptions, issues…" minWidth={560} />
        </section>

        <hr className="border-slate-200" />

        <section>
          <div className="lbl mb-2">Three-Way Time Split</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Crew Size</span>
              <NumInput value={r.crewSize} min={1} max={99} ariaLabel="Crew size" onChange={(v) => onEdit((d) => { d.crewSize = Math.max(1, Math.round(v ?? 1)); })} />
            </label>
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Bay Run Time (h)</span>
              <NumInput value={r.runHrs} min={0} ariaLabel="Run time hours" onChange={(v) => onEdit((d) => { d.runHrs = v ?? 0; })} />
            </label>
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Touch Time (h)</span>
              <NumInput value={r.touchHrs} min={0} ariaLabel="Touch time hours" onChange={(v) => onEdit((d) => { d.touchHrs = v ?? 0; })} />
            </label>
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Manning Time (h)</span>
              <NumInput value={r.manningHrs} min={0} ariaLabel="Manning time hours" onChange={(v) => onEdit((d) => { d.manningHrs = v ?? 0; })} />
            </label>
          </div>
        </section>

        <section>
          <div className="lbl mb-2">Zone &amp; Floor Level</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Origin Zone</span>
              <Select value={r.originZoneId} options={zoneOpts} ariaLabel="Origin zone" onChange={(v) => onEdit((d) => { d.originZoneId = v; })} />
            </label>
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Destination Zone</span>
              <Select value={r.destZoneId} options={zoneOpts} ariaLabel="Destination zone" onChange={(v) => onEdit((d) => { if (d.originZoneId === d.destZoneId || !d.originZoneId) d.originZoneId = v; d.destZoneId = v; })} />
            </label>
            <label className="block">
              <span className="lbl mb-0.5 block text-[11px]">Stand Floor Level</span>
              <Select value={r.floorLevel} options={FLOOR_LEVELS.map((l, i) => ({ value: i, label: l }))} ariaLabel="Stand floor level" onChange={(v) => onEdit((d) => { d.floorLevel = v; })} />
            </label>
          </div>
        </section>

        <section>
          <div className="lbl mb-2">Equipment Tags</div>
          <div className="space-y-2">
            {RESOURCE_KINDS.map((k) => (
              <div key={k.kind} className="flex items-start gap-2">
                <span className="mt-1 w-36 shrink-0 text-[11.5px] text-slate-600">{k.plural}</span>
                <TagPicker label={k.plural} value={r[k.field]} options={resOpts[k.field]} onChange={(v) => onEdit((d) => { d[k.field] = v; })} onCreate={onCreateRes(k.kind)} minWidth={350} />
              </div>
            ))}
            <div className="flex items-start gap-2">
              <span className="mt-1 w-36 shrink-0 text-[11.5px] text-slate-600">Components</span>
              <TagPicker label="Components" value={r.componentIds} options={cmpOpts} onChange={(v) => onEdit((d) => { d.componentIds = v; })} onCreate={onCreateCmp} minWidth={350} />
            </div>
          </div>
        </section>

        {linkedPfmea.length > 0 && (
          <section>
            <div className="lbl mb-2">Linked PFMEA Failure Modes ({linkedPfmea.length})</div>
            <div className="space-y-1.5">
              {linkedPfmea.map((p) => (
                <div key={p.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{p.failureMode}</span>
                    <span className="text-[11px] text-slate-500">S{p.s} × O{p.o} × D{p.d} = RPN {p.s * p.o * p.d}</span>
                    <span className={`ml-auto text-[11px] font-semibold ${p.status === 'Closed' ? 'text-green-700' : p.status === 'In Progress' ? 'text-amber-700' : 'text-red-700'}`}>{p.status}</span>
                  </div>
                  {p.effect && <div className="mt-0.5 text-slate-600">Effect: {p.effect}</div>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

