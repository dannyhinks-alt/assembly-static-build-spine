import { useMemo, useState } from 'react';
import { DataTable, type Col } from '../components/DataTable';
import { Card, Empty, ExpandableTextCell, HowItWorks, Kpi, NumInput, Pill, RagBadge, Select, TagPicker, TextInput, Th } from '../components/primitives';
import { controlDocMissing, controlDocRequired, isBlindSpot, rpnOf, rpnRag } from '../engine/gates';
import { leavesOf } from '../engine/model';
import { fmtInt, worstRag } from '../lib/format';
import { useStore } from '../store';
import type { HoldPoint, PfmeaItem, Rag } from '../types';
import { RESOURCE_KINDS, uid } from '../types';

export default function Tab5Pfmea() {
  const { ws, mutate, model: m } = useStore();
  const [cellFilter, setCellFilter] = useState('');
  const s = ws.settings;
  const watch = s.thresholds.blindSpotSeverity;
  const inScope = useMemo(() => new Set(m.fpds.map((f) => f.fpdId)), [m.fpds]);
  const ops = useMemo(() => ws.rows.flatMap((r) => leavesOf(r)).map((l) => ({ opId: l.opId, fpdId: l.fpdId, description: l.description, cellId: ws.zones.find((z) => z.id === l.destZoneId)?.cellId ?? '', tags: [...l.rigIds, ...l.craneIds, ...l.riggingIds, ...l.vehicleIds, ...l.standIds] })), [ws.rows, ws.zones]);
  const opOf = (opId: string) => ops.find((o) => o.opId === opId);
  const cellOf = (p: { opId: string; fpdId: string }) => opOf(p.opId)?.cellId || ws.fpds.find((f) => f.fpdId === p.fpdId)?.assignedCellId || '';
  const cellLabel = (id: string) => { const c = ws.cells.find((x) => x.id === id); return c ? `Cell ${c.number}` : '—'; };

  const scoped = ws.pfmea.filter((p) => !p.fpdId || inScope.has(p.fpdId));
  const items = scoped.filter((p) => !cellFilter || cellOf(p) === cellFilter);
  const holds = ws.holdPoints.filter((h) => (!h.fpdId || inScope.has(h.fpdId)) && (!cellFilter || cellOf(h) === cellFilter));
  const upd = (id: string, fn: (p: PfmeaItem) => void) => mutate((d) => { const p = d.pfmea.find((x) => x.id === id); if (p) fn(p); });
  const updH = (id: string, fn: (h: HoldPoint) => void) => mutate((d) => { const h = d.holdPoints.find((x) => x.id === id); if (h) fn(h); });
  const fpdOpts = [{ value: '', label: 'Factory-wide' }, ...ws.fpds.map((f) => ({ value: f.fpdId, label: f.fpdCode }))];
  const opOpts = (fpdId: string, current: string) => {
    const list = ops.filter((o) => !fpdId || o.fpdId === fpdId).map((o) => ({ value: o.opId, label: o.opId }));
    return [{ value: '', label: '—' }, ...(current && !list.some((o) => o.value === current) ? [{ value: current, label: `${current} (not found)` }] : []), ...list];
  };
  const resOpts = ws.resources.map((r) => ({ id: r.id, label: r.name || '(unnamed)', sub: RESOURCE_KINDS.find((k) => k.kind === r.kind)!.label }));
  const sod = (p: PfmeaItem, k: 's' | 'o' | 'd', label: string) => <NumInput cell value={p[k]} min={1} max={10} onChange={(v) => upd(p.id, (x) => { x[k] = Math.min(10, Math.max(1, Math.round(v ?? 1))); })} ariaLabel={label} className={k === 's' && p.s >= watch ? 'font-bold' : ''} />;
  const ctx = (p: PfmeaItem) => `${p.opId || 'Factory-wide'} · ${p.failureMode.slice(0, 60)}`;
  const modesOn = (opId: string) => (opId ? scoped.filter((p) => p.opId === opId).length : 0);
  const addMode = (p: PfmeaItem) => mutate((d) => {
    const at = d.pfmea.findIndex((x) => x.id === p.id);
    d.pfmea.splice(at + 1, 0, { id: uid('pf'), fpdId: p.fpdId, opId: p.opId, failureMode: '', effect: '', cause: '', controls: '', s: 5, o: 5, d: 5, recommendedAction: '', owner: p.owner, status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: [...p.resourceIds] });
  });

  // Group by activity: activities ordered by their worst open RPN, failure modes inside an activity by RPN.
  const score = (p: PfmeaItem) => (p.status === 'Closed' ? -1 : rpnOf(p));
  const groupScore = (opId: string) => Math.max(...items.filter((x) => x.opId === opId).map(score));
  const sorted = [...items].sort((a, b) => (a.opId === b.opId ? score(b) - score(a) : groupScore(b.opId) - groupScore(a.opId) || a.opId.localeCompare(b.opId)));
  const firstOfGroup = (p: PfmeaItem, i: number) => i === 0 || sorted[i - 1].opId !== p.opId;

  const cols: Col<PfmeaItem>[] = [
    { key: 'op', label: 'BOP Activity', guide: 'pfmeaMulti', minWidth: 150, render: (p) => (
      <span className="flex items-center gap-1">
        <Select cell value={p.opId} options={opOpts(p.fpdId, p.opId)} ariaLabel="Operation" className="font-mono !text-[12px]"
          onChange={(v) => upd(p.id, (x) => { x.opId = v; const o = opOf(v); if (o) { x.fpdId = o.fpdId; if (!x.resourceIds.length) x.resourceIds = [...new Set(o.tags)]; } })} />
        {modesOn(p.opId) > 1 && <Pill tone="blue" title={`${modesOn(p.opId)} failure modes recorded against ${p.opId}`}>{modesOn(p.opId)}×</Pill>}
      </span>
    ) },
    { key: 'fpd', label: 'FPD', guide: 'fpdRef', minWidth: 120, render: (p) => <Select cell value={p.fpdId} options={fpdOpts} onChange={(v) => upd(p.id, (x) => { x.fpdId = v; })} ariaLabel="FPD" /> },
    { key: 'cell', label: 'Cell', guide: 'pfmeaCell', ro: true, render: (p) => <span className="whitespace-nowrap text-slate-600">{cellLabel(cellOf(p))}</span> },
    { key: 'fm', label: 'Failure Mode', guide: 'pfmeaText', minWidth: 220, render: (p) => <ExpandableTextCell value={p.failureMode} onChange={(v) => upd(p.id, (x) => { x.failureMode = v; })} label="PFMEA — Failure Mode" context={ctx(p)} minWidth={210} placeholder="How can it go wrong?" /> },
    { key: 'eff', label: 'Effect', guide: 'pfmeaText', minWidth: 210, render: (p) => <ExpandableTextCell value={p.effect} onChange={(v) => upd(p.id, (x) => { x.effect = v; })} label="PFMEA — Effect" context={ctx(p)} minWidth={200} /> },
    { key: 'cause', label: 'Cause', guide: 'pfmeaText', minWidth: 210, render: (p) => <ExpandableTextCell value={p.cause} onChange={(v) => upd(p.id, (x) => { x.cause = v; })} label="PFMEA — Cause" context={ctx(p)} minWidth={200} /> },
    { key: 'ctrl', label: 'Controls', guide: 'pfmeaText', minWidth: 200, render: (p) => <ExpandableTextCell value={p.controls} onChange={(v) => upd(p.id, (x) => { x.controls = v; })} label="PFMEA — Current Controls" context={ctx(p)} minWidth={190} /> },
    { key: 's', label: 'S', guide: 'pfmeaS', right: true, width: 46, render: (p) => sod(p, 's', 'Severity') },
    { key: 'o', label: 'O', guide: 'pfmeaO', right: true, width: 46, render: (p) => sod(p, 'o', 'Occurrence') },
    { key: 'd', label: 'D', guide: 'pfmeaD', right: true, width: 46, render: (p) => sod(p, 'd', 'Detection') },
    { key: 'rpn', label: 'RPN', guide: 'rpn', ro: true, right: true, render: (p) => <span className="flex items-center justify-end gap-1.5 whitespace-nowrap"><span className="font-semibold tabular-nums text-slate-900">{fmtInt(rpnOf(p))}</span><RagBadge rag={p.status === 'Closed' ? 'green' : rpnRag(rpnOf(p), s)} label={p.status === 'Closed' ? 'Closed' : undefined} />{isBlindSpot(p, s) && <Pill tone="dark" title={`Severity ${p.s} behind a Green RPN`}>Blind spot</Pill>}</span> },
    { key: 'doc', label: 'Control Doc Required', guide: 'controlDoc', minWidth: 250, render: (p) => {
      const auto = p.s >= watch || rpnOf(p) >= s.thresholds.rpnSerious;
      const req = controlDocRequired(p, s);
      return (
        <span className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-slate-800" checked={req} disabled={auto} title={auto ? `Required automatically (Severity ≥ ${watch} or RPN ≥ ${s.thresholds.rpnSerious})` : 'Tick to require a control document'} onChange={(e) => upd(p.id, (x) => { x.controlDocForced = e.target.checked; })} aria-label="Control document required" />
          <TextInput cell value={p.controlDocRef} onChange={(v) => upd(p.id, (x) => { x.controlDocRef = v; })} ariaLabel="Control document reference" placeholder={req ? 'Document reference…' : 'Not required'} className={controlDocMissing(p, s) ? '!border-red-400' : ''} />
          {controlDocMissing(p, s) ? <RagBadge rag="red" label="MISSING" /> : req ? <RagBadge rag="green" label="OK" /> : null}
        </span>
      );
    } },
    { key: 'res', label: 'Assigned Tooling / Rig / Vehicle / Stand', guide: 'pfmeaResources', minWidth: 240, render: (p) => <TagPicker label="Assigned equipment" value={p.resourceIds} options={resOpts} onChange={(v) => upd(p.id, (x) => { x.resourceIds = v; })} minWidth={220} /> },
    { key: 'act', label: 'Recommended Action', guide: 'pfmeaText', minWidth: 230, render: (p) => <ExpandableTextCell value={p.recommendedAction} onChange={(v) => upd(p.id, (x) => { x.recommendedAction = v; })} label="PFMEA — Recommended Action" context={ctx(p)} minWidth={220} /> },
    { key: 'own', label: 'Owner', minWidth: 150, render: (p) => <TextInput cell value={p.owner} onChange={(v) => upd(p.id, (x) => { x.owner = v; })} ariaLabel="Owner" /> },
    { key: 'st', label: 'Status', guide: 'pfmeaStatus', minWidth: 120, render: (p) => <Select cell value={p.status} options={(['Open', 'In Progress', 'Closed'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => upd(p.id, (x) => { x.status = v; })} ariaLabel="Status" /> },
  ];
  const holdRag: Record<HoldPoint['status'], Rag> = { Planned: 'amber', Released: 'green', Rejected: 'red' };
  const hCols: Col<HoldPoint>[] = [
    { key: 'op', label: 'Op #', guide: 'opId', minWidth: 120, render: (h) => <Select cell value={h.opId} options={opOpts(h.fpdId, h.opId)} onChange={(v) => updH(h.id, (x) => { x.opId = v; const o = opOf(v); if (o) x.fpdId = o.fpdId; })} ariaLabel="Operation" className="font-mono !text-[12px]" /> },
    { key: 'fpd', label: 'FPD', guide: 'fpdRef', minWidth: 120, render: (h) => <Select cell value={h.fpdId} options={fpdOpts} onChange={(v) => updH(h.id, (x) => { x.fpdId = v; })} ariaLabel="FPD" /> },
    { key: 'type', label: 'Type', guide: 'holdType', width: 110, render: (h) => <Select cell value={h.type} options={(['Hold', 'Witness', 'Review'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => updH(h.id, (x) => { x.type = v; })} ariaLabel="Hold point type" /> },
    { key: 'title', label: 'Hold Point', minWidth: 260, render: (h) => <TextInput cell value={h.title} onChange={(v) => updH(h.id, (x) => { x.title = v; })} ariaLabel="Hold point title" /> },
    { key: 'notes', label: 'Quality Hold Point Notes', guide: 'holdNotes', minWidth: 360, render: (h) => <ExpandableTextCell value={h.notes} onChange={(v) => updH(h.id, (x) => { x.notes = v; })} label="Quality Hold Point Notes" context={`${h.opId} · ${h.title}`} minWidth={340} /> },
    { key: 'crit', label: 'On critical path', ro: true, guide: 'badgeCritical', render: (h) => (m.cpm.criticalOps.includes(h.opId) ? <span className="font-medium text-slate-800">Yes</span> : <span className="text-slate-400">No</span>) },
    { key: 'st', label: 'Status', guide: 'holdStatus', minWidth: 200, render: (h) => <span className="flex items-center gap-1.5"><Select cell value={h.status} options={(['Planned', 'Released', 'Rejected'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => updH(h.id, (x) => { x.status = v; })} ariaLabel="Hold point status" /><RagBadge rag={holdRag[h.status]} /></span> },
  ];

  const open = items.filter((p) => p.status !== 'Closed');
  const band = (r: Rag) => open.filter((p) => rpnRag(rpnOf(p), s) === r).length;
  const maxRpn = open.reduce((a, p) => Math.max(a, rpnOf(p)), 0);
  const watchList = open.filter((p) => p.s >= watch).sort((a, b) => b.s - a.s || rpnOf(b) - rpnOf(a));
  const blind = open.filter((p) => isBlindSpot(p, s));
  const noDoc = open.filter((p) => controlDocMissing(p, s));
  const multi = [...new Set(items.map((p) => p.opId).filter(Boolean))].filter((op) => items.filter((p) => p.opId === op).length > 1).length;
  const firstFpd = m.fpds[0]?.fpdId ?? '';
  const cells = [...ws.cells].sort((a, b) => a.number - b.number);

  return (
    <div>
      <HowItWorks
        tab="5"
        title="Cell & Process PFMEA"
        steps={[
          'Link each failure mode to a BOP activity. An activity can carry as many failure modes as it needs — use ＋ on a line to add another to the same activity.',
          'Score Severity, Occurrence and Detection 1–10. RPN = S × O × D, banded by the Tab 1 thresholds.',
          `High-Severity Blind-Spot Watch lists every open item with Severity ≥ ${watch}, whatever its RPN. "Blind spot" marks high severity hidden behind a Green RPN.`,
          `A control document is required when Severity ≥ ${watch} or RPN is Serious or worse (or when ticked). Required with no reference shows MISSING and holds Gate 5.`,
          'Assigned Tooling / Rig / Vehicle / Stand is pre-filled from the activity’s BOP tags when you pick an Op #, and can be edited.',
          'Use the cell summary to see where risk concentrates; click a cell to filter the register and hold points.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Open failure modes" guide="pfmeaStatus" value={`${fmtInt(open.length)} of ${fmtInt(items.length)}`} sub={`${band('red')} Red · ${band('serious')} Serious · ${band('amber')} Amber · ${band('green')} Green`} />
        <Kpi label="Highest open RPN" guide="rpn" value={fmtInt(maxRpn)} sub={`Bands ≥ ${s.thresholds.rpnAmber} / ${s.thresholds.rpnSerious} / ${s.thresholds.rpnRed}`} rag={rpnRag(maxRpn, s)} />
        <Kpi label={`High severity (S ≥ ${watch})`} guide="blindSpot" value={fmtInt(watchList.length)} sub={`${fmtInt(blind.length)} blind spot(s) behind a Green RPN`} rag={blind.length ? 'serious' : watchList.length ? 'amber' : 'green'} />
        <Kpi label="Control docs missing" guide="controlDoc" value={fmtInt(noDoc.length)} sub={`${fmtInt(open.filter((p) => controlDocRequired(p, s)).length)} required on open items`} rag={noDoc.length ? 'red' : 'green'} />
        <Kpi label="Activities with 2+ modes" guide="pfmeaMulti" value={fmtInt(multi)} sub={`${fmtInt(new Set(items.map((p) => p.opId).filter(Boolean)).size)} activities assessed`} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={`High-Severity Blind-Spot Watch — Severity ≥ ${watch}`} guide="blindSpot" pad={false}>
          {watchList.length === 0 ? <div className="p-4"><Empty>No open failure modes at or above Severity {watch}.</Empty></div> : (
            <div className="scroll-thin overflow-auto" style={{ maxHeight: 300 }}>
              <table className="w-full min-w-max border-separate border-spacing-0">
                <thead className="sticky top-0 z-10"><tr><Th guide="opId">Op #</Th><Th>Failure mode</Th><Th right guide="pfmeaS">S</Th><Th right guide="rpn">RPN</Th><Th>Watch status</Th><Th guide="controlDoc">Control doc</Th></tr></thead>
                <tbody>
                  {watchList.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{p.opId || '—'}</td>
                      <td className="td-ro max-w-[360px] truncate text-slate-700" title={p.failureMode}>{p.failureMode || '—'}</td>
                      <td className="td-ro text-right font-bold text-slate-900">{p.s}</td>
                      <td className="td-ro text-right"><span className="flex items-center justify-end gap-1.5"><span className="tabular-nums">{rpnOf(p)}</span><RagBadge rag={rpnRag(rpnOf(p), s)} /></span></td>
                      <td className="td-ro">{isBlindSpot(p, s) ? <Pill tone="dark" title="An RPN-sorted review would not reach this item">Blind spot — Green RPN</Pill> : <span className="text-slate-600">Visible in RPN ranking</span>}</td>
                      <td className="td-ro">{controlDocMissing(p, s) ? <RagBadge rag="red" label="MISSING" /> : <span className="text-slate-700">{p.controlDocRef}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Risk by Cell" guide="pfmeaCell" pad={false} right={cellFilter ? <button className="btn-ghost" onClick={() => setCellFilter('')}>Clear cell filter</button> : undefined}>
          <table className="w-full">
            <thead><tr><Th>Cell</Th><Th right>Open</Th><Th right>Max RPN</Th><Th right>S ≥ {watch}</Th><Th right>Docs missing</Th><Th>Status</Th></tr></thead>
            <tbody>
              {cells.map((c) => {
                const mine = scoped.filter((p) => p.status !== 'Closed' && cellOf(p) === c.id);
                const mx = mine.reduce((a, p) => Math.max(a, rpnOf(p)), 0);
                const nd = mine.filter((p) => controlDocMissing(p, s)).length;
                return (
                  <tr key={c.id} onClick={() => setCellFilter(cellFilter === c.id ? '' : c.id)} className={`cursor-pointer hover:bg-slate-50 ${cellFilter === c.id ? 'bg-sky-50' : ''}`} title="Click to filter the register by this cell">
                    <td className="td-ro whitespace-nowrap"><b className="text-slate-900">Cell {c.number}</b> <span className="text-[11.5px] text-slate-500">{c.name}</span></td>
                    <td className="td-ro text-right">{mine.length}</td>
                    <td className="td-ro text-right">{mx || '—'}</td>
                    <td className="td-ro text-right">{mine.filter((p) => p.s >= watch).length}</td>
                    <td className="td-ro text-right">{nd}</td>
                    <td className="td-ro">{mine.length ? <RagBadge rag={worstRag([rpnRag(mx, s), nd ? 'amber' : 'green'])} /> : <span className="text-slate-400">no open items</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={<>Process FMEA Register {cellFilter && <Pill tone="blue">{cellLabel(cellFilter)} only</Pill>}</>} pad={false}
        right={<button className="btn-primary" onClick={() => mutate((d) => { d.pfmea.push({ id: uid('pf'), fpdId: firstFpd, opId: '', failureMode: '', effect: '', cause: '', controls: '', s: 5, o: 5, d: 5, recommendedAction: '', owner: '', status: 'Open', controlDocForced: false, controlDocRef: '', resourceIds: [] }); })}>＋ Add PFMEA line</button>}>
        <DataTable cols={cols} rows={sorted} rowKey={(p) => p.id} maxHeight={640}
          rowClass={(p) => (firstOfGroup(p, sorted.indexOf(p)) && sorted.indexOf(p) > 0 ? '[&>td]:border-t-2 [&>td]:border-t-slate-200' : '')}
          onClone={addMode} cloneGlyph="＋" cloneTitle="Add another failure mode to this activity"
          onDelete={(p) => mutate((d) => { d.pfmea = d.pfmea.filter((x) => x.id !== p.id); })}
          empty="No PFMEA items for the current filter. Add a failure mode with '＋ Add failure mode', or import from an Excel file containing a 'PFMEA' sheet (columns: Op #, Failure Mode, Effect, Severity, Cause, Occurrence, Detection)." />
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Grouped by BOP activity; activities are ordered by their highest open RPN. ＋ at the end of a line adds another failure mode to the same activity.</div>
      </Card>
      <Card className="mt-4" title="Quality Hold Points" pad={false} right={<button className="btn-primary" onClick={() => mutate((d) => { d.holdPoints.push({ id: uid('hp'), fpdId: firstFpd, opId: '', type: 'Hold', title: 'New hold point', notes: '', status: 'Planned' }); })}>＋ Add hold point</button>}>
        <DataTable cols={hCols} rows={holds} rowKey={(h) => h.id} onDelete={(h) => mutate((d) => { d.holdPoints = d.holdPoints.filter((x) => x.id !== h.id); })} empty="No hold points for the current filter. Add one with '＋ Add hold point', or import from BOP.xlsx (column: Quality Gate Sign-off — each non-blank value creates a Hold Point automatically)." />
      </Card>
    </div>
  );
}
