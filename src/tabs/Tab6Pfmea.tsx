import { useMemo } from 'react';
import { DataTable, type Col } from '../components/DataTable';
import { Card, ExpandableTextCell, HowItWorks, Kpi, NumInput, RagBadge, Select, TextInput } from '../components/primitives';
import { rpnOf, rpnRag } from '../engine/gates';
import { leavesOf } from '../engine/model';
import { fmtInt } from '../lib/format';
import { useStore } from '../store';
import type { HoldPoint, PfmeaItem, Rag } from '../types';
import { uid } from '../types';

export default function Tab6Pfmea() {
  const { ws, mutate, model: m } = useStore();
  const inScope = useMemo(() => new Set(m.fpds.map((f) => f.fpdId)), [m.fpds]);
  const items = ws.pfmea.filter((p) => !p.fpdId || inScope.has(p.fpdId));
  const holds = ws.holdPoints.filter((h) => !h.fpdId || inScope.has(h.fpdId));
  const upd = (id: string, fn: (p: PfmeaItem) => void) => mutate((d) => { const p = d.pfmea.find((x) => x.id === id); if (p) fn(p); });
  const updH = (id: string, fn: (h: HoldPoint) => void) => mutate((d) => { const h = d.holdPoints.find((x) => x.id === id); if (h) fn(h); });
  const fpdOpts = [{ value: '', label: 'Factory-wide' }, ...ws.fpds.map((f) => ({ value: f.fpdId, label: f.fpdCode }))];
  const ops = useMemo(() => ws.rows.flatMap((r) => leavesOf(r)).map((l) => ({ opId: l.opId, fpdId: l.fpdId, description: l.description })), [ws.rows]);
  const opOpts = (fpdId: string, current: string) => {
    const list = ops.filter((o) => !fpdId || o.fpdId === fpdId).map((o) => ({ value: o.opId, label: o.opId }));
    return [{ value: '', label: '—' }, ...(current && !list.some((o) => o.value === current) ? [{ value: current, label: `${current} (not found)` }] : []), ...list];
  };
  const sod = (p: PfmeaItem, k: 's' | 'o' | 'd', label: string) => <NumInput cell value={p[k]} min={1} max={10} onChange={(v) => upd(p.id, (x) => { x[k] = Math.min(10, Math.max(1, Math.round(v ?? 1))); })} ariaLabel={label} />;
  const ctx = (p: PfmeaItem) => `${p.opId || 'Factory-wide'} · ${p.failureMode.slice(0, 60)}`;

  const cols: Col<PfmeaItem>[] = [
    { key: 'fpd', label: 'FPD', guide: 'fpdRef', minWidth: 130, render: (p) => <Select cell value={p.fpdId} options={fpdOpts} onChange={(v) => upd(p.id, (x) => { x.fpdId = v; })} ariaLabel="FPD" /> },
    { key: 'op', label: 'Op #', guide: 'opId', minWidth: 120, render: (p) => <Select cell value={p.opId} options={opOpts(p.fpdId, p.opId)} onChange={(v) => upd(p.id, (x) => { x.opId = v; const o = ops.find((y) => y.opId === v); if (o) x.fpdId = o.fpdId; })} ariaLabel="Operation" className="font-mono !text-[12px]" /> },
    { key: 'fm', label: 'Failure Mode', guide: 'pfmeaText', minWidth: 230, render: (p) => <ExpandableTextCell value={p.failureMode} onChange={(v) => upd(p.id, (x) => { x.failureMode = v; })} label="PFMEA — Failure Mode" context={ctx(p)} minWidth={220} /> },
    { key: 'eff', label: 'Effect', guide: 'pfmeaText', minWidth: 220, render: (p) => <ExpandableTextCell value={p.effect} onChange={(v) => upd(p.id, (x) => { x.effect = v; })} label="PFMEA — Effect" context={ctx(p)} minWidth={210} /> },
    { key: 'cause', label: 'Cause', guide: 'pfmeaText', minWidth: 220, render: (p) => <ExpandableTextCell value={p.cause} onChange={(v) => upd(p.id, (x) => { x.cause = v; })} label="PFMEA — Cause" context={ctx(p)} minWidth={210} /> },
    { key: 'ctrl', label: 'Controls', guide: 'pfmeaText', minWidth: 210, render: (p) => <ExpandableTextCell value={p.controls} onChange={(v) => upd(p.id, (x) => { x.controls = v; })} label="PFMEA — Current Controls" context={ctx(p)} minWidth={200} /> },
    { key: 's', label: 'S', guide: 'pfmeaS', right: true, width: 46, render: (p) => sod(p, 's', 'Severity') },
    { key: 'o', label: 'O', guide: 'pfmeaO', right: true, width: 46, render: (p) => sod(p, 'o', 'Occurrence') },
    { key: 'd', label: 'D', guide: 'pfmeaD', right: true, width: 46, render: (p) => sod(p, 'd', 'Detection') },
    { key: 'rpn', label: 'RPN', guide: 'rpn', ro: true, right: true, render: (p) => <span className="flex items-center justify-end gap-1.5"><span className="font-semibold tabular-nums text-slate-900">{fmtInt(rpnOf(p))}</span><RagBadge rag={p.status === 'Closed' ? 'green' : rpnRag(rpnOf(p), ws.settings)} label={p.status === 'Closed' ? 'Closed' : undefined} />{p.s >= 9 && p.status !== 'Closed' && <span title="Severity 9–10: action required irrespective of RPN" className="text-[11px] font-semibold text-slate-700">S≥9</span>}</span> },
    { key: 'act', label: 'Recommended Action', guide: 'pfmeaText', minWidth: 240, render: (p) => <ExpandableTextCell value={p.recommendedAction} onChange={(v) => upd(p.id, (x) => { x.recommendedAction = v; })} label="PFMEA — Recommended Action" context={ctx(p)} minWidth={230} /> },
    { key: 'own', label: 'Owner', minWidth: 150, render: (p) => <TextInput cell value={p.owner} onChange={(v) => upd(p.id, (x) => { x.owner = v; })} ariaLabel="Owner" /> },
    { key: 'st', label: 'Status', guide: 'pfmeaStatus', width: 120, render: (p) => <Select cell value={p.status} options={(['Open', 'In Progress', 'Closed'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => upd(p.id, (x) => { x.status = v; })} ariaLabel="Status" /> },
  ];
  const holdRag: Record<HoldPoint['status'], Rag> = { Planned: 'amber', Released: 'green', Rejected: 'red' };
  const hCols: Col<HoldPoint>[] = [
    { key: 'fpd', label: 'FPD', guide: 'fpdRef', minWidth: 130, render: (h) => <Select cell value={h.fpdId} options={fpdOpts} onChange={(v) => updH(h.id, (x) => { x.fpdId = v; })} ariaLabel="FPD" /> },
    { key: 'op', label: 'Op #', guide: 'opId', minWidth: 120, render: (h) => <Select cell value={h.opId} options={opOpts(h.fpdId, h.opId)} onChange={(v) => updH(h.id, (x) => { x.opId = v; const o = ops.find((y) => y.opId === v); if (o) x.fpdId = o.fpdId; })} ariaLabel="Operation" className="font-mono !text-[12px]" /> },
    { key: 'type', label: 'Type', guide: 'holdType', width: 110, render: (h) => <Select cell value={h.type} options={(['Hold', 'Witness', 'Review'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => updH(h.id, (x) => { x.type = v; })} ariaLabel="Hold point type" /> },
    { key: 'title', label: 'Hold Point', minWidth: 260, render: (h) => <TextInput cell value={h.title} onChange={(v) => updH(h.id, (x) => { x.title = v; })} ariaLabel="Hold point title" /> },
    { key: 'notes', label: 'Quality Hold Point Notes', guide: 'holdNotes', minWidth: 360, render: (h) => <ExpandableTextCell value={h.notes} onChange={(v) => updH(h.id, (x) => { x.notes = v; })} label="Quality Hold Point Notes" context={`${h.opId} · ${h.title}`} minWidth={340} /> },
    { key: 'crit', label: 'On critical path', ro: true, guide: 'badgeCritical', render: (h) => (m.cpm.criticalOps.includes(h.opId) ? <span className="font-medium text-slate-800">Yes</span> : <span className="text-slate-400">No</span>) },
    { key: 'st', label: 'Status', guide: 'holdStatus', minWidth: 200, render: (h) => <span className="flex items-center gap-1.5"><Select cell value={h.status} options={(['Planned', 'Released', 'Rejected'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => updH(h.id, (x) => { x.status = v; })} ariaLabel="Hold point status" /><RagBadge rag={holdRag[h.status]} /></span> },
  ];

  const open = items.filter((p) => p.status !== 'Closed');
  const band = (r: Rag) => open.filter((p) => rpnRag(rpnOf(p), ws.settings) === r).length;
  const maxRpn = open.reduce((a, p) => Math.max(a, rpnOf(p)), 0);
  const firstFpd = m.fpds[0]?.fpdId ?? '';

  return (
    <div>
      <HowItWorks
        tab="6"
        title="PFMEA & Quality Hold Points"
        steps={[
          'Link each risk to the FPD and Op # it belongs to; choosing an Op # fills the FPD for you.',
          'Write the Failure Mode, Effect, Cause and current Controls — every text cell grows on focus and ⤢ opens the pop-out editor.',
          'Score Severity, Occurrence and Detection from 1 to 10. RPN = S × O × D and is banded using the thresholds in Tab 1.',
          'Record a Recommended Action and owner, then move Status to Closed when it is embedded — closed items stop counting against Gate 5.',
          'Add a Quality Hold Point wherever work must stop for inspection or a witness; Planned shows Amber and Rejected shows Red on Gate 6.',
          'This tab follows the Spine Filter; factory-wide items are always shown.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open PFMEA items" guide="pfmeaStatus" value={`${fmtInt(open.length)} of ${fmtInt(items.length)}`} sub={`${band('red')} Red · ${band('serious')} Serious · ${band('amber')} Amber · ${band('green')} Green`} />
        <Kpi label="Highest open RPN" guide="rpn" value={fmtInt(maxRpn)} sub={`Bands ≥ ${ws.settings.thresholds.rpnAmber} / ${ws.settings.thresholds.rpnSerious} / ${ws.settings.thresholds.rpnRed}`} rag={rpnRag(maxRpn, ws.settings)} />
        <Kpi label="Severity 9–10 open" guide="pfmeaS" value={fmtInt(open.filter((p) => p.s >= 9).length)} sub="Safety / regulatory effects" rag={open.some((p) => p.s >= 9) ? 'serious' : 'green'} />
        <Kpi label="Hold points released" guide="holdStatus" value={`${fmtInt(holds.filter((h) => h.status === 'Released').length)} of ${fmtInt(holds.length)}`} sub={`${fmtInt(holds.filter((h) => h.status === 'Rejected').length)} rejected`} rag={holds.some((h) => h.status === 'Rejected') ? 'red' : holds.some((h) => h.status === 'Planned') ? 'amber' : 'green'} />
      </div>
      <Card title="Process FMEA Register" pad={false} right={<button className="btn-primary" onClick={() => mutate((d) => { d.pfmea.push({ id: uid('pf'), fpdId: firstFpd, opId: '', failureMode: '', effect: '', cause: '', controls: '', s: 5, o: 5, d: 5, recommendedAction: '', owner: '', status: 'Open' }); })}>＋ Add PFMEA line</button>}>
        <DataTable cols={cols} rows={[...items].sort((a, b) => Number(a.status === 'Closed') - Number(b.status === 'Closed') || rpnOf(b) - rpnOf(a))} rowKey={(p) => p.id} maxHeight={620}
          onClone={(p) => mutate((d) => { d.pfmea.push({ ...p, id: uid('pf'), status: 'Open' }); })}
          onDelete={(p) => mutate((d) => { d.pfmea = d.pfmea.filter((x) => x.id !== p.id); })}
          empty="No PFMEA items for the current filter." />
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Sorted by open RPN, highest first. Closed items sink to the bottom.</div>
      </Card>
      <Card className="mt-4" title="Quality Hold Points" pad={false} right={<button className="btn-primary" onClick={() => mutate((d) => { d.holdPoints.push({ id: uid('hp'), fpdId: firstFpd, opId: '', type: 'Hold', title: 'New hold point', notes: '', status: 'Planned' }); })}>＋ Add hold point</button>}>
        <DataTable cols={hCols} rows={holds} rowKey={(h) => h.id} onDelete={(h) => mutate((d) => { d.holdPoints = d.holdPoints.filter((x) => x.id !== h.id); })} empty="No hold points for the current filter." />
      </Card>
    </div>
  );
}
