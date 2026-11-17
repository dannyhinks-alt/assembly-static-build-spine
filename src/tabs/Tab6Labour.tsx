import { Fragment, useMemo, useState } from 'react';
import { Card, Empty, HowItWorks, Kpi, Meter, Pill, RagBadge, Select, Th, Tip } from '../components/primitives';
import { CLASH_LABEL } from '../engine/space';
import { isBlock, type CpmNode } from '../engine/model';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { FLOOR_LEVELS } from '../types';
import { useStore } from '../store';
import { CpmBadge } from './Tab2Bop';

const INK = '#0f172a';
const BAR = '#94a3b8';

export default function Tab6Labour() {
  const { ws, model: m, scope, setTab } = useStore();
  const [unit, setUnit] = useState<'d' | 'h'>('d');
  const [show, setShow] = useState<'all' | 'critical' | 'near'>('all');
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null);
  const near = ws.settings.thresholds.nearCriticalFloatHrs;
  const hpd = m.cal.hoursPerDay || 1;
  const hpm = m.cal.hoursPerMonth || 1;
  const u = (h: number) => (unit === 'd' ? fmt(h / hpd, 1) : fmt(h, 0));
  const byId = useMemo(() => new Map(m.rows.map((r) => [r.id, r])), [m.rows]);
  const opOf = (id: string) => byId.get(id)?.opId ?? '?';

  const windowHrs = Number.isFinite(m.windowActive) ? m.windowActive * hpm : 0;
  const maxHrs = Math.max(m.cpm.durationHrs, windowHrs, 1) * 1.04;
  const months = Math.ceil(maxHrs / hpm);
  const pct = (h: number) => `${(h / maxHrs) * 100}%`;
  const keep = (n: CpmNode) => show === 'all' || (show === 'critical' ? n.critical : n.critical || n.float <= near);
  const nodes = [...m.cpm.nodes.values()];
  const table = nodes.filter(keep).sort((a, b) => a.es - b.es || a.ef - b.ef);
  const criticalChain = nodes.filter((n) => n.critical).sort((a, b) => a.es - b.es);
  const margin = ws.settings.programme.drumbeatMonths - m.durationMonths;
  const tipNode = tip ? m.cpm.nodes.get(tip.id) : undefined;
  const tipRow = tip ? byId.get(tip.id) : undefined;
  const LABEL = 300;
  const established = ws.cells.reduce((a, c) => a + c.crewPerShift, 0);
  const prof = m.space.crewProfile;
  const yMax = Math.max(m.peakCrew, established, 1) * 1.15;
  const CW = 1000, CH = 170, PL = 34, PB = 22, PT = 8;
  const px = (h: number) => PL + (h / maxHrs) * (CW - PL - 6);
  const py = (c: number) => PT + (1 - c / yMax) * (CH - PT - PB);
  const stepPath = prof.length ? `M${px(prof[0].t)},${py(0)} ` + prof.map((p, i) => `L${px(p.t)},${py(p.crew)} L${px(prof[i + 1]?.t ?? p.t)},${py(p.crew)}`).join(' ') + ` L${px(prof[prof.length - 1].t)},${py(0)} Z` : '';
  const zoneName = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '—';
  const cellNo = (id: string) => ws.cells.find((c) => c.id === id)?.number ?? '—';
  const clashes = m.space.clashes;

  return (
    <div>
      <HowItWorks
        tab="6"
        title="Labour Load & Spatial Balancing"
        steps={[
          'CPM forward pass gives Early Start / Finish; the backward pass gives Late Start / Finish and Float. Durations are Elapsed Bay Durations for the selected build #.',
          'Dark Gantt bars are critical (zero float); lighter bars have float, drawn as a thin tail. The dashed line is the Max Production Window.',
          'The Crew Histogram sums crew sizes over the early-start schedule and compares the peak with the established crew per shift.',
          'Spatial Conflict detection locates every activity by Cell, Zone and Stand Floor Level and looks for work-face congestion, lifts into an occupied work face and lifts over or under an occupied level.',
          'Each conflict shows whether delaying one activity inside its float would clear it. Apply the delay by adding a predecessor in Tab 2.',
          'Labour utilisation by cell books hours to the destination zone of each activity against the crew set in Tab 1.',
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Critical-path duration" guide="kpiCp" value={fmt(m.durationMonths, 1)} unit="months" sub={`${fmt(m.durationDays, 0)} working days · ${fmtInt(m.cpm.durationHrs)} elapsed h`} rag={m.rows.length ? m.scheduleRag : undefined} />
        <Kpi label="Window utilisation" guide="kpiWindow" value={fmtPct(m.windowRatio * 100, 0)} sub={`${ws.settings.programme.demandCase} window ${fmt(m.windowActive, 1)} months · peak ${fmt(m.windowPeak, 1)}`} rag={m.rows.length ? m.scheduleRag : undefined} />
        <Kpi label="Drumbeat margin" guide="kpiDrumbeat" value={fmt(margin, 1)} unit="months" sub={`Requirement ${fmt(ws.settings.programme.drumbeatMonths, 1)} months`} rag={margin < 0 ? 'red' : 'green'} />
        <Kpi label="Concurrent builds in WIP" guide="kpiConcurrent" value={fmtInt(m.concurrentBuilds)} sub={m.concurrentBuilds > 1 ? 'Builds overlap — duplicate Full-Build stands' : 'One build position is sufficient'} rag={m.concurrentBuilds > 1 ? 'amber' : 'green'} />
        <Kpi label="Critical operations" guide="badgeCritical" value={`${fmtInt(criticalChain.length)} of ${fmtInt(nodes.length)}`} sub={`${fmtInt(nodes.filter((n) => !n.critical && n.float <= near && n.dur > 0).length)} near-critical (float ≤ ${near} h)`} />
        <Kpi label="Peak concurrent crew" guide="kpiPeakCrew" value={fmtInt(m.peakCrew)} sub={`${fmtInt(established)} established per shift`} rag={m.peakCrew > established ? 'amber' : 'green'} />
      </div>

      {m.cpm.hasCycle && (
        <div className="mb-4 rounded-lg border px-3 py-2 text-[12.5px] text-slate-800" style={{ borderColor: '#d03b3b', backgroundColor: '#d03b3b14' }}>
          <b>Predecessor loop detected</b> through {m.cpm.cycleOps.join(', ')}. The schedule below ignores the looping links and is not valid until this is fixed in Tab 2. <button className="btn-ghost underline" onClick={() => setTab(2)}>Open Bill of Process</button>
        </div>
      )}
      {(m.cpm.external.length > 0 || m.cpm.dangling.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-700">
          {m.cpm.external.length > 0 && <span className="flex items-center gap-1.5"><Pill tone="outline">{m.cpm.external.length} out-of-scope predecessor link(s) ignored</Pill><Tip id="external" /><span className="text-slate-500">e.g. {m.cpm.external.slice(0, 3).map((e) => `${e.opId} ← ${e.ref}`).join(', ')}</span></span>}
          {m.cpm.dangling.length > 0 && <span className="flex items-center gap-1.5"><RagBadge rag="red" label={`${m.cpm.dangling.length} unresolved predecessor reference(s)`} /><span className="text-slate-500">{m.cpm.dangling.slice(0, 4).map((e) => `${e.opId} → ${e.ref}`).join(', ')}</span></span>}
        </div>
      )}

      <Card
        title="CPM Gantt — Early-Start Schedule"
        guide="gantt"
        pad={false}
        right={
          <span className="flex flex-wrap items-center gap-3 text-[11.5px] text-slate-600">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: INK }} />Critical<Tip id="badgeCritical" /></span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: BAR }} />Has float<Tip id="badgeFloat" /></span>
            <span className="flex items-center gap-1"><span className="inline-block h-[3px] w-5" style={{ backgroundColor: '#cbd5e1' }} />Float tail<Tip id="float" /></span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-0 border-l-2 border-dashed border-slate-700" />Production window<Tip id="kpiWindow" /></span>
          </span>
        }
      >
        {nodes.length === 0 ? (
          <div className="p-4"><Empty>No Baseline work blocks in the current Spine Filter.</Empty></div>
        ) : (
          <div className="scroll-thin relative overflow-auto" style={{ maxHeight: 640 }} onMouseLeave={() => setTip(null)}>
            <div className="relative min-w-[900px]">
              <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-50">
                <div className="lbl shrink-0 px-3 py-1.5" style={{ width: LABEL }}>Work block</div>
                <div className="relative h-7 flex-1">
                  {Array.from({ length: months + 1 }, (_, i) => i).filter((i) => i * hpm <= maxHrs * 0.985).map((i) => (
                    <span key={i} className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-[10.5px] tabular-nums text-slate-500" style={{ left: pct(i * hpm) }}>{i === 0 ? '0' : `${i} mo`}</span>
                  ))}
                </div>
              </div>
              {windowHrs > 0 && (
                <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: LABEL, right: 0 }}>
                  <div className="absolute bottom-0 top-7 border-l-2 border-dashed border-slate-700" style={{ left: pct(windowHrs) }}>
                    <span className={`absolute top-0.5 whitespace-nowrap rounded border border-slate-300 bg-white px-1 text-[10.5px] font-medium text-slate-700 ${windowHrs / maxHrs > 0.85 ? '-left-1.5 -translate-x-full' : 'left-1'}`}>Window {fmt(m.windowActive, 1)} mo</span>
                  </div>
                </div>
              )}
              {m.fpdRoll.map((f) => {
                const rows = m.rows.filter((r) => r.fpdId === f.fpd.fpdId).filter((r) => keep(m.cpm.nodes.get(r.id)!));
                if (!rows.length) return null;
                return (
                  <Fragment key={f.fpd.fpdId}>
                    <div className="flex border-b border-slate-200 bg-slate-100/80">
                      <div className="shrink-0 truncate px-3 py-1 text-[12px]" style={{ width: LABEL }}><b className="text-slate-900">{f.fpd.fpdCode}</b> <span className="text-slate-600">{f.fpd.title}</span></div>
                      <div className="relative flex-1">
                        <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-sm bg-slate-400/70" style={{ left: pct(f.startHrs), width: pct(f.spanHrs) }} title={`${f.fpd.fpdCode} span ${fmt(f.spanHrs / hpd, 1)} working days`} />
                      </div>
                    </div>
                    {rows.map((r) => {
                      const n = m.cpm.nodes.get(r.id)!;
                      return (
                        <div key={r.id} className="group flex border-b border-slate-100 hover:bg-slate-50" onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, id: r.id })}>
                          <div className="flex shrink-0 items-center gap-2 px-3 py-[3px]" style={{ width: LABEL }}>
                            <span className="w-[74px] shrink-0 font-mono text-[11.5px] text-slate-700">{r.opId}</span>
                            <span className="truncate text-[12px] text-slate-600">{isBlock(r) ? '⊞ ' : ''}{r.description || '—'}</span>
                          </div>
                          <div className="relative flex-1" style={{ backgroundImage: 'linear-gradient(to right, #eef2f6 1px, transparent 1px)', backgroundSize: `${(hpm / maxHrs) * 100}% 100%` }}>
                            {n.float > 0.01 && <div className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-slate-300" style={{ left: pct(n.ef), width: pct(n.float) }} />}
                            <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]" style={{ left: pct(n.es), width: `max(3px, ${pct(n.dur)})`, backgroundColor: n.critical ? INK : BAR }} />
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}
        {tip && tipNode && tipRow && (
          <div className="pointer-events-none fixed z-[60] w-[300px] rounded-lg border border-slate-200 bg-white p-2.5 text-[12px] shadow-xl" style={{ left: Math.min(tip.x + 14, window.innerWidth - 316), top: Math.min(tip.y + 14, window.innerHeight - 190) }}>
            <div className="mb-1 flex items-center gap-2"><span className="font-mono font-semibold text-slate-900">{tipRow.opId}</span><CpmBadge node={tipNode} nearHrs={near} /></div>
            <div className="mb-1.5 leading-snug text-slate-700">{tipRow.description || '—'}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-600">
              <dt>Duration</dt><dd className="text-right text-slate-900">{fmt(tipNode.dur, 1)} h · {fmt(tipNode.dur / hpd, 1)} d</dd>
              <dt>Early start → finish</dt><dd className="text-right text-slate-900">day {fmt(tipNode.es / hpd, 1)} → {fmt(tipNode.ef / hpd, 1)}</dd>
              <dt>Late start → finish</dt><dd className="text-right text-slate-900">day {fmt(tipNode.ls / hpd, 1)} → {fmt(tipNode.lf / hpd, 1)}</dd>
              <dt>Total float</dt><dd className="text-right text-slate-900">{fmt(tipNode.float, 1)} h · {fmt(tipNode.float / hpd, 1)} d</dd>
              <dt>Predecessors</dt><dd className="text-right font-mono text-[11.5px] text-slate-900">{tipNode.preds.map(opOf).join(', ') || 'None'}{tipNode.implicitPred ? ' (auto)' : ''}</dd>
            </dl>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Crew Histogram — Early-Start Schedule" guide="crewHistogram"
        right={<span className="flex flex-wrap items-center gap-3 text-[11.5px] text-slate-600"><span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm bg-slate-400" />Crew working</span><span className="flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-800" />Established crew / shift ({established})</span></span>}>
        {prof.length === 0 ? <Empty>No scheduled work in the current Spine Filter.</Empty> : (
          <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label="Crew histogram over the build">
            {[0, 0.5, 1].map((f) => { const v = Math.round((yMax / 1.15) * f); return (<g key={f}><line x1={PL} x2={CW - 6} y1={py(v)} y2={py(v)} stroke="#e2e8f0" /><text x={PL - 5} y={py(v) + 3.5} fontSize={11} textAnchor="end" fill="#64748b">{v}</text></g>); })}
            {Array.from({ length: months + 1 }, (_, i) => i).filter((i) => i * hpm <= maxHrs * 0.985).map((i) => <text key={i} x={px(i * hpm)} y={CH - 6} fontSize={11} textAnchor="middle" fill="#64748b">{i === 0 ? '0' : `${i} mo`}</text>)}
            <path d={stepPath} fill="#94a3b8" fillOpacity={0.55} stroke="#475569" strokeWidth={1.5} strokeLinejoin="round" />
            <line x1={PL} x2={CW - 6} y1={py(established)} y2={py(established)} stroke="#0f172a" strokeWidth={1.5} strokeDasharray="6 4" />
            {windowHrs > 0 && <line x1={px(windowHrs)} x2={px(windowHrs)} y1={PT} y2={CH - PB} stroke="#334155" strokeWidth={1.5} strokeDasharray="3 3" />}
            {prof.map((p, i) => i + 1 < prof.length && (
              <rect key={i} x={px(p.t)} y={PT} width={Math.max(0.5, px(prof[i + 1].t) - px(p.t))} height={CH - PT - PB} fill="transparent" className="hover:fill-slate-900/5">
                <title>{`Day ${fmt(p.t / hpd, 1)} to ${fmt(prof[i + 1].t / hpd, 1)}: ${p.crew} crew working${p.crew > established ? ` — ${p.crew - established} above establishment` : ''}`}</title>
              </rect>
            ))}
          </svg>
        )}
        <p className="mt-1 text-[11.5px] text-slate-500">Peak {fmtInt(m.peakCrew)} against {fmtInt(established)} established per shift. Hover the chart for the crew in each interval; the dotted vertical line is the production window.</p>
      </Card>

      <Card className="mt-4" title="Spatial Conflicts — Cell / Zone / Stand Level" guide="spaceClash" pad={false}
        right={<RagBadge rag={clashes.some((c) => !c.resolvable && c.rag === 'serious') ? 'serious' : clashes.length ? 'amber' : 'green'} label={`${clashes.length} conflict(s) · ${clashes.filter((c) => !c.resolvable).length} not resolvable in float`} />}>
        {clashes.length === 0 ? <div className="p-4"><Empty>No work-face congestion and no lift overlaps other work in the same zone.</Empty></div> : (
          <div className="scroll-thin overflow-auto" style={{ maxHeight: 380 }}>
            <table className="w-full min-w-max border-separate border-spacing-0">
              <thead className="sticky top-0 z-10"><tr><Th guide="spaceClash">Conflict</Th><Th>Cell</Th><Th>Zone</Th><Th guide="floorLevel">Stand level</Th><Th guide="opId">Activities</Th><Th right guide="esEf">Window (day)</Th><Th right>Overlap h</Th><Th right guide="zoneCap">Crew / limit</Th><Th>RAG</Th><Th guide="resolvable">Resolvable within float</Th></tr></thead>
              <tbody>
                {clashes.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="td-ro whitespace-nowrap font-medium text-slate-900">{CLASH_LABEL[c.kind]}</td>
                    <td className="td-ro whitespace-nowrap">Cell {cellNo(c.cellId)}</td>
                    <td className="td-ro max-w-[220px] truncate text-slate-700">{zoneName(c.zoneId)}</td>
                    <td className="td-ro whitespace-nowrap">{FLOOR_LEVELS[c.level]}{c.otherLevel != null && <span className="text-slate-500"> ↕ {FLOOR_LEVELS[c.otherLevel]}</span>}</td>
                    <td className="td-ro font-mono text-[12px] text-slate-800">{c.ops.join(', ')}</td>
                    <td className="td-ro whitespace-nowrap text-right">{fmt(c.start / hpd, 1)}–{fmt(c.end / hpd, 1)}</td>
                    <td className="td-ro text-right">{fmt(c.overlapHrs, 1)}</td>
                    <td className="td-ro text-right">{c.cap != null ? `${c.crew} / ${c.cap}` : c.crew}</td>
                    <td className="td-ro"><RagBadge rag={c.rag} /></td>
                    <td className="td-ro whitespace-nowrap">{c.resolvable ? <span className="flex items-center gap-1.5"><RagBadge rag="green" label="Yes" /><span className="text-slate-700">delay <span className="font-mono text-[12px]">{c.shiftOp}</span> by {fmt(c.shiftHrs, 1)} h</span></span> : <span className="flex items-center gap-1.5"><RagBadge rag="amber" label="No" /><span className="text-slate-700">{c.kind === 'congestion' ? 'stagger the work or review the limit' : 'plan exclusion windows per lift'}</span></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Resource double-booking (cranes, vehicles, rigs) is analysed separately in <button className="underline hover:text-slate-800" onClick={() => setTab(8)}>Tab 8</button>. Crew limits per level are set on each zone in <button className="underline hover:text-slate-800" onClick={() => setTab(1)}>Tab 1</button>.</div>
      </Card>

      <Card className="mt-4" title="Labour Load by Cell" guide="cellLoad" pad={false}>
        <table className="w-full">
          <thead><tr><Th>Cell</Th><Th right guide="cellCrew">Crew / shift</Th><Th right>Activities</Th><Th right guide="kpiLabour">Labour h / build</Th><Th right guide="kpiLifts">Lifts</Th><Th guide="cellUtil">Labour utilisation</Th><Th>Status</Th></tr></thead>
          <tbody>
            {[...ws.cells].sort((a, b) => a.number - b.number).map((c) => {
              const l = m.cells.find((x) => x.cellId === c.id)!;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td-ro"><b className="text-slate-900">Cell {c.number}</b> <span className="text-slate-600">{c.name}</span></td>
                  <td className="td-ro text-right">{fmtInt(c.crewPerShift)}</td><td className="td-ro text-right">{fmtInt(l.rows)}</td>
                  <td className="td-ro text-right font-medium text-slate-900">{fmtInt(l.labourHrs)}</td><td className="td-ro text-right">{fmtInt(l.lifts)}</td>
                  <td className="td-ro" style={{ minWidth: 220 }}>{l.utilPct == null ? <span className="text-slate-400">no crew set</span> : <span className="flex items-center gap-2"><span className="w-11 text-right tabular-nums">{fmtPct(l.utilPct, 0)}</span><Meter pct={l.utilPct} rag={l.rag} ticks={[80, 100]} /></span>}</td>
                  <td className="td-ro">{l.utilPct == null ? null : <RagBadge rag={l.rag} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4" title="Critical Path Sequence" guide="badgeCritical">
        {criticalChain.length === 0 ? <Empty>No critical operations.</Empty> : (
          <div className="flex flex-wrap items-center gap-y-1.5">
            {criticalChain.map((n, i) => (
              <span key={n.rowId} className="flex items-center">
                <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11.5px]" title={byId.get(n.rowId)?.description}>
                  <span className="font-mono font-semibold text-slate-900">{n.opId}</span> <span className="tabular-nums text-slate-500">{fmt(n.dur / hpd, 1)} d</span>
                </span>
                {i < criticalChain.length - 1 && <span className="px-1 text-slate-400">→</span>}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-slate-500">Longest five: {[...criticalChain].sort((a, b) => b.dur - a.dur).slice(0, 5).map((n) => `${n.opId} (${fmt(n.dur / hpd, 1)} d)`).join(' · ') || '—'}. Shortening anything else will not shorten the build.</p>
      </Card>

      <Card
        className="mt-4"
        title="Schedule Table"
        pad={false}
        right={
          <>
            <div className="w-44"><Select value={show} onChange={setShow} ariaLabel="Rows shown" options={[{ value: 'all', label: 'All Baseline work blocks' }, { value: 'near', label: 'Critical + near-critical' }, { value: 'critical', label: 'Critical only' }]} /></div>
            <div className="w-36"><Select value={unit} onChange={setUnit} ariaLabel="Time unit" options={[{ value: 'd', label: 'Working days' }, { value: 'h', label: 'Elapsed hours' }]} /></div>
          </>
        }
      >
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 560 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <Th guide="opId">Op #</Th><Th guide="description">Work block</Th><Th guide="fpdRef">FPD</Th><Th guide="cpmBadge">Badge</Th>
                <Th right guide="elapsed">Duration</Th><Th right guide="esEf">ES</Th><Th right guide="esEf">EF</Th><Th right guide="lsLf">LS</Th><Th right guide="lsLf">LF</Th><Th right guide="float">Float</Th>
                <Th guide="predecessors">Predecessors</Th><Th>Successors</Th>
              </tr>
            </thead>
            <tbody>
              {table.map((n) => {
                const r = byId.get(n.rowId)!;
                return (
                  <tr key={n.rowId} className="hover:bg-slate-50">
                    <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{n.opId}</td>
                    <td className="td-ro max-w-[360px] truncate text-slate-700" title={r.description}>{isBlock(r) ? '⊞ ' : ''}{r.description || '—'}</td>
                    <td className="td-ro text-slate-600">{ws.fpds.find((f) => f.fpdId === r.fpdId)?.fpdCode}</td>
                    <td className="td-ro"><CpmBadge node={n} nearHrs={near} /></td>
                    <td className="td-ro text-right">{u(n.dur)}</td><td className="td-ro text-right">{u(n.es)}</td><td className="td-ro text-right">{u(n.ef)}</td>
                    <td className="td-ro text-right text-slate-500">{u(n.ls)}</td><td className="td-ro text-right text-slate-500">{u(n.lf)}</td>
                    <td className="td-ro text-right font-medium text-slate-900">{u(n.float)}</td>
                    <td className="td-ro font-mono text-[11.5px] text-slate-600">{n.preds.map(opOf).join(', ') || 'None'}{n.implicitPred && <span className="ml-1 inline-flex items-center gap-1 font-sans"><Pill tone="outline">auto</Pill><Tip id="badgeImplicit" /></span>}</td>
                    <td className="td-ro font-mono text-[11.5px] text-slate-600">{n.succs.map(opOf).join(', ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          {unit === 'd' ? `Working days of ${fmt(hpd, 1)} h (${ws.settings.calendar.shiftsPerDay} × ${fmt(ws.settings.calendar.hoursPerShift, 1)} h)` : 'Elapsed working hours from build start'} · Build #{ws.settings.learning.selectedBuild} · {scope.mode === 'factory' && !scope.zoneId ? 'whole factory' : 'filtered scope'}.
        </div>
      </Card>
    </div>
  );
}
