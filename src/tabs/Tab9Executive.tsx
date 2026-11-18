import { useMemo, useState } from 'react';
import { Card, Empty, HowItWorks, Kpi, Pill, RagBadge, TextInput, Th, Tip } from '../components/primitives';
import { GateRow } from '../components/GateRow';
import { ExecutiveRiskCards } from '../components/ExecutiveRiskCards';
import { buildSummary, computeGates, isBlindSpot, overallRag, routeToGreen, rpnOf, rpnRag } from '../engine/gates';
import { dutyRag } from '../engine/model';
import { RAG_HEX, RAG_LABEL, fmt, fmtGbp, fmtInt, fmtPct } from '../lib/format';
import { download, fileSafe, stamp } from '../lib/persistence';
import { useStore } from '../store';
import type { Rag } from '../types';
import { ClassBar } from './Tab2Bop';

const VERDICT: Record<Rag, string> = {
  green: 'All gates Green — ready to release to the Master Control Hub.',
  amber: 'Releasable with noted Amber items — record sign-off comments against each.',
  serious: 'Serious findings open — release only with documented concession.',
  red: 'Not releasable — at least one gate is Red.',
};
const CLS = { VA: '#334155', NNVA: '#94a3b8', NVA: '#d03b3b' } as const;

export default function Tab9Executive() {
  const { ws, mutate, model: m, integrity, scope, setTab, toast } = useStore();
  const gates = useMemo(() => computeGates(ws, m, integrity), [ws, m, integrity]);
  const steps = useMemo(() => routeToGreen(ws, m, integrity, gates), [ws, m, integrity, gates]);
  const overall = overallRag(gates);
  const [preview, setPreview] = useState(false);
  const summary = useMemo(() => (preview ? buildSummary(ws, integrity) : null), [preview, ws, integrity]);
  const wholeFactory = scope.mode === 'factory' && !scope.zoneId;
  const t = m.totals;
  const th = ws.settings.thresholds;
  const signed = gates.filter((g) => ws.gateSignoffs[g.id]).length;

  const exportSummary = () => {
    download(`${fileSafe(ws.meta.factoryId || 'F4')}_summary-V2_${stamp()}.json`, JSON.stringify(buildSummary(ws, integrity), null, 2));
    toast('ok', `summary@V2 exported for Factory ${ws.meta.factoryId} with ${ws.cells.length} cells (whole factory, all active FPDs).`);
  };

  const used = m.resources.filter((r) => r.opCount > 0).sort((a, b) => b.dutyPct - a.dutyPct);
  const topRes = used[0];
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const openPf = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  const maxRpn = openPf.reduce((a, p) => Math.max(a, rpnOf(p)), 0);
  const blocks = [...m.calcs.values()].sort((a, b) => b.labourHrs - a.labourHrs);
  const topBlocks = blocks.slice(0, 12);
  const restHrs = blocks.slice(12).reduce((a, c) => a + c.labourHrs, 0);
  const maxBlock = Math.max(1, ...topBlocks.map((c) => c.labourHrs));
  const topShare = t.labourHrs ? (topBlocks.reduce((a, c) => a + c.labourHrs, 0) / t.labourHrs) * 100 : 0;
  const liftRag = m.lifts.reduce<Rag>((w, l) => (['green', 'amber', 'serious', 'red'].indexOf(l.rag) > ['green', 'amber', 'serious', 'red'].indexOf(w) ? l.rag : w), 'green');
  const nLift = (f: (l: (typeof m.lifts)[number]) => boolean) => m.lifts.filter(f).length;

  return (
    <div>
      <HowItWorks
        tab="9"
        title="Executive Summary"
        steps={[
          'Seven release gates summarise the model. The overall status is the worst gate.',
          'Route to Green lists, for every gate that is not Green, the specific change that would clear it — with the numbers — and links to the tab where it is made.',
          'The eight KPI cards and four charts follow the Spine Filter; Gate 1 and the export are always factory-wide.',
          'Record a sign-off against each gate once its status is accepted; sign-offs travel with the workspace and the export.',
          'Labour Content shows where the hours are; High-Risk Utilisation shows which resources constrain the build.',
          `Export summary@V2 hands Factory ${ws.meta.factoryId} and its ${ws.cells.length} cells to Multi-Factory Master Control Hub.`,
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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Critical-path duration" guide="kpiCp" value={fmt(m.durationMonths, 1)} unit="months" sub={`${fmt(m.durationDays, 0)} working days · Build #${ws.settings.learning.selectedBuild} at ${fmtPct(m.lc * 100, 0)}`} rag={m.rows.length ? m.scheduleRag : undefined} />
        <Kpi label="Window utilisation" guide="kpiWindow" value={fmtPct(m.windowRatio * 100, 0)} sub={`${fmt(m.windowActive, 1)}-month window · drumbeat ${fmt(ws.settings.programme.drumbeatMonths, 0)} months`} rag={m.rows.length ? m.scheduleRag : undefined} />
        <Kpi label="Total labour hours" guide="kpiLabour" value={fmtInt(t.labourHrs)} unit="h / build" sub={`${fmtInt(t.workBlocks)} Baseline work blocks · peak crew ${fmtInt(m.peakCrew)}`} />
        <Kpi label="Labour cost per build" guide="kpiCost" value={fmtGbp(t.labourCost)} sub={`at ${fmtGbp(ws.settings.programme.labourRateGbp)} / h`} />
        <Kpi label="Value-add ratio" guide="kpiVa" value={fmtPct(t.labourHrs ? (t.va / t.labourHrs) * 100 : 0, 0)} sub={<span className="flex items-center gap-2"><ClassBar byClass={{ VA: t.va, NNVA: t.nnva, NVA: t.nva }} width={70} />NVA {fmtPct(t.labourHrs ? (t.nva / t.labourHrs) * 100 : 0, 1)}</span>} />
        <Kpi label="Lifts per build" guide="kpiLifts" value={fmtInt(t.lifts)} sub={`${nLift((l) => l.heavy)} heavy op(s) · ${nLift((l) => l.rag === 'red')} Red`} rag={m.lifts.length ? liftRag : undefined} />
        <Kpi label="Highest resource duty" guide="duty" value={topRes ? fmtPct(topRes.dutyPct, 0) : '—'} sub={topRes ? `${topRes.resource.name} · ${used.filter((r) => r.highRisk).length} HIGH RISK` : '—'} rag={topRes ? dutyRag(topRes.dutyPct, ws.settings) : undefined} />
        <Kpi label="Highest open RPN" guide="rpn" value={fmtInt(maxRpn)} sub={`${openPf.length} open · ${openPf.filter((p) => isBlindSpot(p, ws.settings)).length} blind spot(s)`} rag={rpnRag(maxRpn, ws.settings)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Release Gates" pad={false}>
          <div className="divide-y divide-slate-100">{gates.map((g) => <GateRow key={g.id} gate={g} onOpen={() => setTab(g.tab)} />)}</div>
        </Card>
        <Card title="Route to Green Advisor" guide="routeToGreen" pad={false} right={<Pill tone="outline">{steps.length} action(s) across {new Set(steps.map((s) => s.gate)).size} gate(s)</Pill>}>
          {steps.length === 0 ? <div className="p-4"><Empty>Every gate is Green — nothing to do.</Empty></div> : (
            <ol className="scroll-thin max-h-[720px] divide-y divide-slate-100 overflow-auto">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 px-4 py-2">
                  <span className="mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1 text-[10.5px] font-bold tabular-nums text-slate-800" style={{ borderColor: RAG_HEX[gates[s.gate - 1].rag], backgroundColor: `${RAG_HEX[gates[s.gate - 1].rag]}1f` }} title={`Gate ${s.gate} · ${gates[s.gate - 1].title} — ${RAG_LABEL[gates[s.gate - 1].rag]}`}>G{s.gate}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-800">{s.text}</span>
                  <button className="btn-ghost shrink-0" onClick={() => setTab(s.tab)}>Tab {s.tab} →</button>
                </li>
              ))}
            </ol>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700">
            <p className="font-semibold text-slate-900 mb-1">RDC Transfer &amp; Engineering Governance Note</p>
            <p>Prior to transferring this workspace to the RDC (Release &amp; Deployment Centre) or progressing beyond the current gate, the following engineering governance checkpoints must be satisfied:</p>
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
              <li>All Red and Serious PFMEA items must carry a documented mitigation or accepted concession before RDC submission.</li>
              <li>Assumptions marked <em>Unconfirmed</em> in the Assumptions Register (Tab 1) must be formally closed or escalated to the Programme Lead.</li>
              <li>HIGH RISK resources (Tab 8) must each carry a Bottleneck Mitigation Strategy before the design freeze gate.</li>
              <li>Hook-height breaches and Ar-Red labour-locked activities (Tab 2) must be dispositioned before the first physical build commences.</li>
              <li>The exported <code>summary@V2</code> JSON must be attached to the Engineering Change Note lodged in the Master Control Hub before sign-off is recorded here.</li>
            </ul>
            <p className="mt-1.5 text-slate-500 text-[11.5px]">This note is for guidance only. Formal sign-off authority rests with the responsible Engineering Manager per the programme governance framework.</p>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Labour Content per Baseline Work Block" guide="chartLabour" right={<span className="flex items-center gap-3 text-[11.5px] text-slate-600">{(['VA', 'NNVA', 'NVA'] as const).map((k) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: CLS[k] }} />{k}</span>)}</span>}>
          {topBlocks.length === 0 ? <Empty>No Baseline work blocks in the current Spine Filter.</Empty> : (
            <div className="space-y-1.5">
              {topBlocks.map((c) => (
                <div key={c.row.id} className="grid grid-cols-[84px_minmax(0,1fr)_64px] items-center gap-2" title={`${c.row.opId} — ${c.row.description}\n${fmtInt(c.labourHrs)} labour h: VA ${fmtInt(c.byClass.VA)} · NNVA ${fmtInt(c.byClass.NNVA)} · NVA ${fmtInt(c.byClass.NVA)}\nCrew ${c.crewMax} · elapsed ${fmtInt(c.elapsedHrs)} h`}>
                  <span className="truncate font-mono text-[11.5px] text-slate-800">{c.row.opId}</span>
                  <span className="flex h-3 overflow-hidden rounded-sm bg-slate-100">
                    {(['VA', 'NNVA', 'NVA'] as const).map((k) => c.byClass[k] > 0 && <span key={k} className="h-3 border-r-2 border-white last:border-r-0" style={{ width: `${(c.byClass[k] / maxBlock) * 100}%`, backgroundColor: CLS[k] }} />)}
                  </span>
                  <span className="text-right text-[12px] tabular-nums text-slate-700">{fmtInt(c.labourHrs)} h</span>
                </div>
              ))}
              {restHrs > 0 && <div className="grid grid-cols-[84px_minmax(0,1fr)_64px] items-center gap-2 text-[12px] text-slate-500"><span>{blocks.length - 12} others</span><span className="h-3 rounded-sm bg-slate-100"><span className="block h-3 rounded-sm bg-slate-300" style={{ width: `${Math.min(100, (restHrs / maxBlock) * 100)}%` }} /></span><span className="text-right tabular-nums">{fmtInt(restHrs)} h</span></div>}
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-slate-500">The top {topBlocks.length} of {blocks.length} Baseline work blocks hold {fmtPct(topShare, 0)} of the labour hours. Hover a bar for the split.</p>
        </Card>

        <Card title="High-Risk Resource Utilisation" guide="chartUtil" right={<span className="text-[11.5px] text-slate-600">Ticks: Amber {th.dutyAmberPct}% · Serious {th.dutySeriousPct}%</span>}>
          {used.length === 0 ? <Empty>No resources tagged in the current Spine Filter.</Empty> : (
            <div className="space-y-1.5">
              {used.slice(0, 12).map((r) => (
                <div key={r.resource.id} className="grid grid-cols-[minmax(0,210px)_minmax(0,1fr)_48px_86px] items-center gap-2" title={`${r.resource.name}\n${fmt(r.shiftsUsed, 1)} of ${fmtInt(r.programmeShifts)} programme shifts = ${fmtPct(r.dutyPct, 0)}\nPeak concurrent ${r.peakConcurrent} of ${r.resource.qty}`}>
                  <span className="truncate text-[12px] text-slate-800">{r.resource.name}</span>
                  <span className="relative h-3 rounded-sm bg-slate-100">
                    <span className="block h-3 rounded-sm" style={{ width: `${Math.min(100, (r.dutyPct / 120) * 100)}%`, backgroundColor: RAG_HEX[dutyRag(r.dutyPct, ws.settings)] }} />
                    {[th.dutyAmberPct, th.dutySeriousPct].map((x) => <span key={x} className="absolute -top-0.5 h-4 w-px bg-slate-500" style={{ left: `${(x / 120) * 100}%` }} />)}
                  </span>
                  <span className="text-right text-[12px] tabular-nums text-slate-700">{fmtPct(r.dutyPct, 0)}</span>
                  <span>{r.highRisk ? <RagBadge rag={r.dutyPct > 100 ? 'red' : 'serious'} label="HIGH RISK" /> : r.conflicts ? <RagBadge rag="amber" label="Overlap" /> : null}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-slate-500">Duty Cycle % = Shifts Used ÷ Programme Shifts. {used.filter((r) => r.highRisk).length} HIGH RISK resource(s); mitigation strategies are recorded in <button className="underline hover:text-slate-800" onClick={() => setTab(8)}>Tab 8</button>.</p>
        </Card>

        <ExecutiveRiskCards ws={ws} m={m} setTab={setTab} />
      </div>

      <Card className="mt-4" collapseKey="fpdRoll" title="Per-FPD Roll-Up" guide="fpdRoll" pad={false}>
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 480 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr><Th guide="fpdCode">FPD</Th><Th>Title</Th><Th guide="assignedCell">Cell</Th><Th guide="revision">Rev</Th><Th right>Work blocks</Th><Th right guide="kpiLabour">Labour h</Th><Th guide="vaSplit">VA / NNVA / NVA</Th><Th right guide="fpdRoll">Span days</Th><Th right guide="kpiLifts">Lifts</Th><Th right guide="badgeCritical">Critical ops</Th></tr>
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
                  <td className="td-ro text-right">{fmt(f.spanHrs / (m.cal.hoursPerDay || 1), 1)}</td>
                  <td className="td-ro text-right">{fmtInt(f.lifts)}</td>
                  <td className="td-ro text-right">{fmtInt(f.criticalOps)}</td>
                </tr>
              ))}
              {!m.fpdRoll.length && <tr><td colSpan={10} className="td-ro py-6 text-center text-slate-500">No FPDs in the current Spine Filter.</td></tr>}
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
          Exports Factory <b>{ws.meta.factoryId}</b> with its <b>{ws.cells.length} discrete cells</b> ({[...ws.cells].sort((a, b) => a.number - b.number).map((c) => `${ws.meta.factoryId}-C${c.number}`).join(', ')}) nested under <code className="rounded bg-slate-100 px-1 text-[11.5px]">factory.cells</code>,
          plus the calculation basis, KPIs, lift and movement counters, PFMEA profile, per-FPD and per-resource rows, critical path, integrity results, gate status with sign-offs and the Route to Green actions.
          It is always produced for the <b>whole factory</b> ({integrity.factory.fpds.length} active FPDs), whatever the Spine Filter shows.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="lbl mb-1 block">Factory ID (key used by the Hub)</span><TextInput value={ws.meta.factoryId} onChange={(v) => mutate((d) => { d.meta.factoryId = v.trim() || 'F4'; })} ariaLabel="Factory ID" mono /></label>
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

