import { useMemo, useState } from 'react';
import { DataTable, type Col } from '../components/DataTable';
import { Card, ExpandableTextCell, HowItWorks, Kpi, Pill, RagBadge, TextInput, Th, Tip } from '../components/primitives';
import { buildSummary, computeGates, overallRag, type Gate } from '../engine/gates';
import { RAG_HEX, RAG_LABEL, fmt, fmtDate, fmtGbp, fmtInt, fmtPct } from '../lib/format';
import { download, fileSafe, stamp } from '../lib/persistence';
import { useStore } from '../store';
import type { Assumption, Rag } from '../types';
import { uid } from '../types';
import { ClassBar } from './Tab2Bop';

const VERDICT: Record<Rag, string> = {
  green: 'All gates Green — ready to release to the Master Control Hub.',
  amber: 'Releasable with noted Amber items — record sign-off comments against each.',
  serious: 'Serious findings open — release only with documented concession.',
  red: 'Not releasable — at least one gate is Red.',
};

export default function Tab9Governance() {
  const { ws, mutate, model: m, integrity, scope, setTab, toast } = useStore();
  const gates = useMemo(() => computeGates(ws, m, integrity), [ws, m, integrity]);
  const overall = overallRag(gates);
  const [preview, setPreview] = useState(false);
  const summary = useMemo(() => (preview ? buildSummary(ws, integrity) : null), [preview, ws, integrity]);
  const wholeFactory = scope.mode === 'factory' && !scope.zoneId;
  const t = m.totals;
  const signed = gates.filter((g) => ws.gateSignoffs[g.id]).length;
  const hpd = m.cal.hoursPerDay || 1;

  const exportSummary = () => {
    download(`${fileSafe(ws.meta.factoryId || 'factory')}_summary-V2_${stamp()}.json`, JSON.stringify(buildSummary(ws, integrity), null, 2));
    toast('ok', 'summary@V2 exported (whole factory, all active FPDs).');
  };
  const updA = (id: string, fn: (a: Assumption) => void) => mutate((d) => { const a = d.assumptions.find((x) => x.id === id); if (a) fn(a); });
  const aCols: Col<Assumption>[] = [
    { key: 'ok', label: 'Confirmed', width: 84, render: (a) => <span className="flex justify-center pt-1.5"><input type="checkbox" className="accent-slate-800" checked={a.confirmed} onChange={(e) => updA(a.id, (x) => { x.confirmed = e.target.checked; })} aria-label="Confirmed" /></span> },
    { key: 'text', label: 'Assumption', guide: 'assumptions', minWidth: 520, render: (a) => <ExpandableTextCell value={a.text} onChange={(v) => updA(a.id, (x) => { x.text = v; })} label="Planning assumption" context={a.owner} minWidth={500} /> },
    { key: 'owner', label: 'Owner', minWidth: 200, render: (a) => <TextInput cell value={a.owner} onChange={(v) => updA(a.id, (x) => { x.owner = v; })} ariaLabel="Owner" /> },
    { key: 'st', label: 'Status', ro: true, render: (a) => <RagBadge rag={a.confirmed ? 'green' : 'amber'} label={a.confirmed ? 'Confirmed' : 'Unconfirmed'} /> },
  ];

  return (
    <div>
      <HowItWorks
        tab="9"
        title="Governance & Release Gates"
        steps={[
          'Seven gates summarise the model: integrity, schedule, lift safety, resource capacity, PFMEA risk, hold points and assumptions.',
          'Gate 1 is always factory-wide. Gates 2–6 follow the Spine Filter so a single FPD or cell can be reviewed; return to Whole Factory before releasing.',
          'Each gate links to the tab where its findings are fixed. The overall status is the worst gate.',
          'Record a sign-off (name and comment) against each gate once its status is accepted; sign-offs travel with the workspace and the export.',
          'Keep the Assumptions Register current — unconfirmed entries hold Gate 7 and integrity check 10.',
          'Export summary@V2 hands the factory roll-up to Multi-Factory Master Control Hub. It always exports all active FPDs.',
        ]}
      />

      <div className="mb-4 rounded-lg border bg-white p-3.5 shadow-sm" style={{ borderColor: RAG_HEX[overall], borderLeftWidth: 5 }}>
        <div className="flex flex-wrap items-center gap-3">
          <RagBadge rag={overall} label={`Overall release status: ${RAG_LABEL[overall]}`} />
          <span className="text-[13px] font-medium text-slate-900">{VERDICT[overall]}</span>
          <span className="ml-auto flex items-center gap-2">
            {!wholeFactory && <Pill tone="outline" title="Gates 2–6 are evaluated on the filtered scope">Filtered view — {m.fpds.length} of {ws.fpds.length} FPDs</Pill>}
            <Pill tone="outline">{signed} of {gates.length} gates signed</Pill>
            <button className="btn-primary" onClick={exportSummary}>Export summary@V2 for Master Hub</button><Tip id="summaryExport" />
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total labour hours" guide="kpiLabour" value={fmtInt(t.labourHrs)} unit="h / build" sub={`Build #${ws.settings.learning.selectedBuild} at ${fmtPct(m.lc * 100, 0)}`} />
        <Kpi label="Labour cost per build" guide="kpiCost" value={fmtGbp(t.labourCost)} sub={`at ${fmtGbp(ws.settings.programme.labourRateGbp)} / h`} />
        <Kpi label="Value-add ratio" guide="kpiVa" value={fmtPct(t.labourHrs ? (t.va / t.labourHrs) * 100 : 0, 0)} sub={<span className="flex items-center gap-2"><ClassBar byClass={{ VA: t.va, NNVA: t.nnva, NVA: t.nva }} width={70} />NVA {fmtPct(t.labourHrs ? (t.nva / t.labourHrs) * 100 : 0, 1)}</span>} />
        <Kpi label="Critical-path duration" guide="kpiCp" value={fmt(m.durationMonths, 1)} unit="months" sub={`${fmtPct(m.windowRatio * 100, 0)} of ${fmt(m.windowActive, 1)}-month window`} rag={m.rows.length ? m.scheduleRag : undefined} />
        <Kpi label="Operator-locked ops" guide="kpiAr" value={fmtInt(t.arRedCount)} sub={`${fmtInt(t.opportunityHrs)} h in-station opportunity`} />
        <Kpi label="Peak concurrent crew" guide="kpiPeakCrew" value={fmtInt(m.peakCrew)} sub={`${fmtInt(m.concurrentBuilds)} concurrent build(s) in WIP`} />
      </div>

      <Card title="Release Gates" pad={false}>
        <div className="divide-y divide-slate-100">
          {gates.map((g) => <GateRow key={g.id} gate={g} onOpen={() => setTab(g.tab)} />)}
        </div>
      </Card>

      <Card
        className="mt-4"
        title="Assumptions Register"
        guide="assumptions"
        pad={false}
        right={<><Pill tone="outline">{ws.assumptions.filter((a) => !a.confirmed).length} unconfirmed</Pill><button className="btn-primary" onClick={() => mutate((d) => { d.assumptions.push({ id: uid('as'), text: '', owner: '', confirmed: false }); })}>＋ Add assumption</button></>}
      >
        <DataTable cols={aCols} rows={ws.assumptions} rowKey={(a) => a.id} onDelete={(a) => mutate((d) => { d.assumptions = d.assumptions.filter((x) => x.id !== a.id); })} empty="No assumptions recorded." />
      </Card>

      <Card className="mt-4" title="Per-FPD Roll-Up" guide="fpdRoll" pad={false}>
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 520 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr><Th guide="fpdCode">FPD</Th><Th>Title</Th><Th guide="assignedCell">Cell</Th><Th guide="revision">Rev</Th><Th right>Work blocks</Th><Th right guide="kpiLabour">Labour h</Th><Th guide="vaSplit">VA / NNVA / NVA</Th><Th right guide="esEf">Start day</Th><Th right guide="esEf">Finish day</Th><Th right guide="fpdRoll">Span days</Th><Th right guide="kpiLifts">Lifts</Th><Th right guide="badgeCritical">Critical ops</Th></tr>
            </thead>
            <tbody>
              {m.fpdRoll.map((f) => (
                <tr key={f.fpd.fpdId} className="hover:bg-slate-50">
                  <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{f.fpd.fpdCode}</td>
                  <td className="td-ro max-w-[340px] truncate text-slate-700">{f.fpd.title}</td>
                  <td className="td-ro text-slate-600">Cell {ws.cells.find((c) => c.id === f.fpd.assignedCellId)?.number ?? '—'}</td>
                  <td className="td-ro text-slate-600">{f.fpd.revision}</td>
                  <td className="td-ro text-right">{fmtInt(f.rows)}</td>
                  <td className="td-ro text-right font-medium text-slate-900">{fmtInt(f.labourHrs)}</td>
                  <td className="td-ro"><ClassBar byClass={{ VA: f.va, NNVA: f.nnva, NVA: f.nva }} width={110} /></td>
                  <td className="td-ro text-right">{fmt(f.startHrs / hpd, 1)}</td>
                  <td className="td-ro text-right">{fmt(f.finishHrs / hpd, 1)}</td>
                  <td className="td-ro text-right">{fmt(f.spanHrs / hpd, 1)}</td>
                  <td className="td-ro text-right">{fmtInt(f.lifts)}</td>
                  <td className="td-ro text-right">{fmtInt(f.criticalOps)}</td>
                </tr>
              ))}
              {m.fpdRoll.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td className="td-ro" colSpan={4}>Total — {m.fpds.length} FPD(s)</td>
                  <td className="td-ro text-right">{fmtInt(t.workBlocks)}</td><td className="td-ro text-right">{fmtInt(t.labourHrs)}</td>
                  <td className="td-ro"><ClassBar byClass={{ VA: t.va, NNVA: t.nnva, NVA: t.nva }} width={110} /></td>
                  <td className="td-ro text-right">0.0</td><td className="td-ro text-right">{fmt(m.durationDays, 1)}</td><td className="td-ro text-right">{fmt(m.durationDays, 1)}</td>
                  <td className="td-ro text-right">{fmtInt(t.lifts)}</td><td className="td-ro text-right">{fmtInt(m.cpm.criticalOps.length)}</td>
                </tr>
              )}
              {!m.fpdRoll.length && <tr><td colSpan={12} className="td-ro py-6 text-center text-slate-500">No FPDs in the current Spine Filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        className="mt-4"
        title="summary@V2 Hand-Off to Master Control Hub"
        guide="summaryExport"
        right={<><button className="btn" onClick={() => setPreview((p) => !p)}>{preview ? 'Hide preview' : 'Preview JSON'}</button><button className="btn-primary" onClick={exportSummary}>Export summary@V2</button></>}
      >
        <p className="text-[12.5px] leading-relaxed text-slate-700">
          The export contains the factory identity, calculation basis (build #, learning factor, calendar, demand case), headline KPIs, per-cell and per-FPD roll-ups, resource duty, the critical path, integrity results and gate status with sign-offs.
          It is always produced for the <b>whole factory</b> ({integrity.factory.fpds.length} active FPDs), whatever the Spine Filter shows.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="lbl mb-1 block">Factory ID (key used by the Hub)</span><TextInput value={ws.meta.factoryId} onChange={(v) => mutate((d) => { d.meta.factoryId = v; })} ariaLabel="Factory ID" mono /></label>
          <label className="block"><span className="lbl mb-1 block">Factory name</span><TextInput value={ws.meta.factoryName} onChange={(v) => mutate((d) => { d.meta.factoryName = v; })} ariaLabel="Factory name" /></label>
        </div>
        {summary && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="lbl">Preview</span>
              <button className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(summary, null, 2)).then(() => toast('ok', 'summary@V2 copied to clipboard.'), () => toast('warn', 'Clipboard not available — use Export instead.')); }}>Copy</button>
            </div>
            <pre className="scroll-thin max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11.5px] leading-relaxed text-slate-800">{JSON.stringify(summary, null, 2)}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}

function GateRow({ gate: g, onOpen }: { gate: Gate; onOpen: () => void }) {
  const { ws, mutate } = useStore();
  const so = ws.gateSignoffs[g.id];
  const [by, setBy] = useState('');
  const [comment, setComment] = useState('');
  const sign = () => {
    if (!by.trim()) return;
    mutate((d) => { d.gateSignoffs[g.id] = { by: by.trim(), on: new Date().toISOString(), comment: `${comment.trim()}${comment.trim() ? ' ' : ''}[signed at ${RAG_LABEL[g.rag]}]` }; });
    setBy('');
    setComment('');
  };
  return (
    <div className="grid items-start gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-[11.5px] font-bold tabular-nums text-slate-700">{g.n}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900">Gate {g.n} · {g.title}</span>
            <Tip id={g.guide} />
            <RagBadge rag={g.rag} />
          </div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-slate-700">{g.detail}</div>
          <button className="btn-ghost -ml-1.5 mt-0.5" onClick={onOpen}>Open Tab {g.tab} →</button>
        </div>
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 p-2">
        <div className="mb-1 flex items-center gap-1.5"><span className="lbl">Sign-off</span><Tip id="signoff" /></div>
        {so ? (
          <div className="flex items-start justify-between gap-2 text-[12.5px]">
            <div className="min-w-0">
              <div className="text-slate-900"><b>{so.by}</b> <span className="text-slate-500">· {fmtDate(so.on)}</span></div>
              {so.comment && <div className="break-words text-slate-600">{so.comment}</div>}
            </div>
            <button className="btn-ghost shrink-0" onClick={() => mutate((d) => { delete d.gateSignoffs[g.id]; })}>Clear</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input className="inp w-36" placeholder="Name / role" value={by} onChange={(e) => setBy(e.target.value)} aria-label={`Gate ${g.n} signatory`} />
            <input className="inp min-w-[120px] flex-1" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sign()} aria-label={`Gate ${g.n} comment`} />
            <button className="btn" disabled={!by.trim()} onClick={sign}>Sign</button>
          </div>
        )}
      </div>
    </div>
  );
}
