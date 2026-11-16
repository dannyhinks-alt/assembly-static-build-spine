import { useState } from 'react';
import { Card, Empty, ExpandableTextCell, HowItWorks, Kpi, Meter, Pill, RagBadge, Select, Th, Tip } from '../components/primitives';
import { dutyRag, type LiftRecord } from '../engine/model';
import { fmt, fmtInt, fmtPct, ragRank } from '../lib/format';
import { useStore } from '../store';
import { FLOOR_LEVELS, RESOURCE_KINDS, type Rag, type ResourceKind } from '../types';

export default function Tab8Lifts() {
  const { ws, mutate, model: m, setTab } = useStore();
  const [liftView, setLiftView] = useState<'all' | 'flagged' | 'red'>('all');
  const [kind, setKind] = useState<'' | ResourceKind>('');
  const [showIdle, setShowIdle] = useState(false);
  const t = ws.settings.thresholds;
  const hpd = m.cal.hoursPerDay || 1;
  const fpdCode = (id: string) => ws.fpds.find((f) => f.fpdId === id)?.fpdCode ?? '';
  const day = (h: number) => `d${fmt(h / hpd, 1)}`;

  const lifts = [...m.lifts].filter((l) => (liftView === 'all' ? true : liftView === 'red' ? l.rag === 'red' : l.rag !== 'green')).sort((a, b) => ragRank(b.rag) - ragRank(a.rag) || a.startHrs - b.startHrs);
  const res = m.resources.filter((r) => (showIdle || r.opCount > 0) && (!kind || r.resource.kind === kind)).sort((a, b) => b.dutyPct - a.dutyPct);
  const used = m.resources.filter((r) => r.opCount > 0);
  const top = [...used].sort((a, b) => b.dutyPct - a.dutyPct)[0];
  const redLifts = m.lifts.filter((l) => l.rag === 'red').length;
  const hard = m.conflicts.filter((c) => c.hard);
  const liftRag: Rag = m.lifts.reduce<Rag>((w, l) => (ragRank(l.rag) > ragRank(w) ? l.rag : w), 'green');
  const maxCell = Math.max(1, ...m.cells.map((c) => c.labourHrs));

  const why = (l: LiftRecord) =>
    l.missingWeight ? 'No component weight — SWL check cannot run'
      : l.utilPct != null && l.utilPct > 100 ? `Over capacity by ${fmtInt((l.loadKg ?? 0) - l.capacityKg)} kg`
      : l.hookBreach ? `Hook-height breach of ${fmt(-l.hookMarginM, 2)} m`
      : l.utilPct != null && l.utilPct > 90 ? 'Above 90% of governing capacity'
      : l.flagCount >= 3 ? 'Three or more lift-risk flags'
      : l.flagCount >= 1 ? `${l.flagCount} lift-risk flag(s)` : 'Routine lift';

  return (
    <div>
      <HowItWorks
        tab="8"
        title="Lift, Crane & Resource Load"
        steps={[
          'Lift Register: every activity with a Lift Count is tested for SWL utilisation and hook height, then flagged Heavy, Multi-Person, 3D or Complex against the Tab 1 thresholds.',
          'Required hook height = landing elevation + component height + rigging headroom + clearance margin. A shortfall is a Red hook-height breach.',
          'Duty Cycle = busy hours per build × annual demand ÷ (quantity × annual hours). Amber above the Tab 1 limit (65% by default).',
          'Full-Build Dwell resources are locked for the entire critical-path duration, not just their tagged operations.',
          'Spatial Conflicts are found by sweeping the early-start schedule for more simultaneous users than units available.',
          'For each bottleneck, record a Mitigation Strategy: re-time within float first, then add capacity such as a secondary jib crane.',
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Lifts per build" guide="kpiLifts" value={fmtInt(m.totals.lifts)} sub={`${fmtInt(m.lifts.length)} lift operation(s)`} />
        <Kpi label="Heavy lifts" guide="flagHeavy" value={fmtInt(m.lifts.filter((l) => l.heavy).length)} sub={`Load > ${fmtInt(t.heavyLiftKg)} kg`} />
        <Kpi label="Red lifts" guide="liftRag" value={fmtInt(redLifts)} sub={`${fmtInt(m.lifts.filter((l) => l.rag === 'serious').length)} Serious · ${fmtInt(m.lifts.filter((l) => l.hookBreach).length)} hook breach`} rag={m.lifts.length ? liftRag : undefined} />
        <Kpi label="Highest duty cycle" guide="duty" value={top ? fmtPct(top.dutyPct, 0) : '—'} sub={top?.resource.name ?? '—'} rag={top?.rag} />
        <Kpi label="Spatial conflicts" guide="spatialConflict" value={fmtInt(m.conflicts.length)} sub={`${fmtInt(hard.length)} hard · ${fmtInt(m.conflicts.filter((c) => !c.resolvable).length)} not resolvable in float`} rag={hard.some((c) => !c.resolvable) ? 'red' : m.conflicts.length ? 'amber' : 'green'} />
        <Kpi label="Peak concurrent crew" guide="kpiPeakCrew" value={fmtInt(m.peakCrew)} sub={`${fmtInt(ws.cells.reduce((a, c) => a + c.crewPerShift, 0))} established per shift`} />
      </div>

      <Card
        title="Lift Register"
        guide="liftRag"
        pad={false}
        right={<div className="w-44"><Select value={liftView} onChange={setLiftView} ariaLabel="Lift filter" options={[{ value: 'all', label: 'All lift ops' }, { value: 'flagged', label: 'Flagged (not Green)' }, { value: 'red', label: 'Red only' }]} /></div>}
      >
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 520 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <Th guide="opId">Op #</Th><Th guide="description">Activity</Th><Th guide="liftRag">RAG</Th><Th>Finding</Th><Th guide="fpdRef">FPD</Th><Th right guide="liftCount">Lifts</Th>
                <Th right guide="liftLoad">Load kg</Th><Th right guide="liftCapacity">Capacity kg</Th><Th guide="liftUtil">SWL utilisation</Th>
                <Th guide="floorLevel">Landing</Th><Th right guide="hookCheck">Hook req. / avail. m</Th><Th right guide="hookCheck">Margin m</Th><Th right guide="crew">Crew</Th>
                <Th>Risk flags <Tip id="flagHeavy" /><Tip id="flagMulti" /><Tip id="flag3d" /><Tip id="flagComplex" /></Th>
              </tr>
            </thead>
            <tbody>
              {lifts.map((l) => {
                const uRag: Rag = l.utilPct == null ? 'red' : l.utilPct > 100 ? 'red' : l.utilPct > 90 ? 'serious' : l.utilPct > 75 ? 'amber' : 'green';
                return (
                  <tr key={l.leafId} className="hover:bg-slate-50">
                    <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{l.opId}</td>
                    <td className="td-ro max-w-[250px] truncate text-slate-700" title={l.description}>{l.description || '—'}</td>
                    <td className="td-ro"><RagBadge rag={l.rag} /></td>
                    <td className="td-ro whitespace-nowrap text-slate-700">{why(l)}</td>
                    <td className="td-ro text-slate-600">{fpdCode(l.fpdId)}</td>
                    <td className="td-ro text-right">{fmtInt(l.lifts)}</td>
                    <td className="td-ro text-right font-medium text-slate-900">{l.loadKg == null ? '—' : fmtInt(l.loadKg)}</td>
                    <td className="td-ro text-right"><span className="block">{fmtInt(l.capacityKg)}</span><span className="block max-w-[190px] truncate text-[10.5px] text-slate-500" title={l.capacitySource}>{l.capacitySource}</span></td>
                    <td className="td-ro" style={{ minWidth: 150 }}><span className="flex items-center gap-2"><span className="w-11 text-right">{fmtPct(l.utilPct, 0)}</span><Meter pct={l.utilPct ?? 0} rag={uRag} ticks={[90, 100]} /></span></td>
                    <td className="td-ro whitespace-nowrap text-slate-700">{FLOOR_LEVELS[l.floorLevel]} <span className="text-slate-500">· {fmt(l.elevationM, 1)} m</span></td>
                    <td className="td-ro text-right">{fmt(l.requiredHookM, 2)} / {fmt(l.availableHookM, 2)}</td>
                    <td className="td-ro text-right">{l.hookBreach ? <RagBadge rag="red" label={fmt(l.hookMarginM, 2)} title="Hook-height breach" /> : <span className={l.hookMarginM < 0.15 ? 'font-semibold text-slate-900' : 'text-slate-700'}>{fmt(l.hookMarginM, 2)}</span>}</td>
                    <td className="td-ro text-right">{fmtInt(l.crew)}</td>
                    <td className="td-ro"><span className="flex flex-wrap gap-1">
                      {l.heavy && <Pill>Heavy</Pill>}{l.multiPerson && <Pill>Multi-person</Pill>}{l.highElevation && <Pill>3D / high</Pill>}{l.complex && <Pill>{l.tandem ? 'Tandem' : 'Complex'}</Pill>}
                      {l.flagCount === 0 && <span className="text-slate-400">none</span>}
                    </span></td>
                  </tr>
                );
              })}
              {!lifts.length && <tr><td colSpan={14} className="td-ro py-6 text-center text-slate-500">{m.lifts.length ? 'No lifts match this view.' : 'No lift operations in the current Spine Filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          Thresholds: Heavy &gt; {fmtInt(t.heavyLiftKg)} kg · Multi-person crew ≥ {t.multiPersonCrew} · 3D ≥ {fmt(t.highElevationM, 1)} m or ≥ Level {t.highElevationFloors} · Complex ≥ {t.multiToolItems} items — <button className="underline hover:text-slate-800" onClick={() => setTab(1)}>edit in Tab 1</button>
        </div>
      </Card>

      <Card
        className="mt-4"
        title="Resource Duty Cycle & Bottlenecks"
        guide="duty"
        pad={false}
        right={
          <>
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />Show untagged</label>
            <div className="w-52"><Select value={kind} onChange={setKind} ariaLabel="Resource kind" options={[{ value: '', label: 'All resource kinds' }, ...RESOURCE_KINDS.map((k) => ({ value: k.kind, label: k.plural }))]} /></div>
          </>
        }
      >
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 560 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <Th>Resource</Th><Th>Kind</Th><Th guide="dwell">Dwell</Th><Th right>Ops</Th><Th right>Busy h / build</Th>
                <Th guide="duty">Duty cycle</Th><Th right guide="peakConcurrent">Peak / qty</Th><Th right guide="requiredQty">Need</Th><Th guide="spatialConflict">Conflicts</Th><Th>RAG</Th>
                <Th guide="mitigation">Bottleneck Mitigation Strategy</Th>
              </tr>
            </thead>
            <tbody>
              {res.map((r) => (
                <tr key={r.resource.id} className="hover:bg-slate-50">
                  <td className="td-ro max-w-[260px] truncate font-medium text-slate-900" title={r.ops.join(', ')}>{r.resource.name}</td>
                  <td className="td-ro text-slate-600">{RESOURCE_KINDS.find((k) => k.kind === r.resource.kind)!.label}</td>
                  <td className="td-ro">{r.resource.dwellMode === 'Full-Build' ? <Pill tone="dark">Full-Build</Pill> : <Pill tone="outline">Per-Op</Pill>}</td>
                  <td className="td-ro text-right">{fmtInt(r.opCount)}</td>
                  <td className="td-ro text-right">{fmtInt(r.busyHrs)}</td>
                  <td className="td-ro" style={{ minWidth: 190 }}>{r.opCount ? <span className="flex items-center gap-2"><span className="w-11 text-right font-medium text-slate-900">{fmtPct(r.dutyPct, 0)}</span><Meter pct={r.dutyPct} rag={dutyRag(r.dutyPct, ws.settings)} ticks={[t.dutyAmberPct, t.dutySeriousPct]} /></span> : <span className="text-slate-400">not tagged</span>}</td>
                  <td className="td-ro text-right">{r.opCount ? `${r.peakConcurrent} / ${r.resource.qty}` : '—'}</td>
                  <td className="td-ro text-right">{r.opCount ? (r.requiredQty > r.resource.qty ? <b className="text-slate-900">{r.requiredQty}</b> : r.resource.qty) : '—'}</td>
                  <td className="td-ro">{r.conflicts ? <RagBadge rag="amber" label={`${r.conflicts}`} /> : <span className="text-slate-400">0</span>}</td>
                  <td className="td-ro">{r.opCount ? <RagBadge rag={r.rag} /> : null}</td>
                  <td className="td"><ExpandableTextCell value={ws.mitigations[r.resource.id] ?? ''} onChange={(v) => mutate((d) => { if (v.trim()) d.mitigations[r.resource.id] = v; else delete d.mitigations[r.resource.id]; })} label="Bottleneck Mitigation Strategy" context={`${r.resource.name} · duty ${fmtPct(r.dutyPct, 0)}`} placeholder={r.rag !== 'green' ? 'Record the mitigation…' : '—'} minWidth={280} /></td>
                </tr>
              ))}
              {!res.length && <tr><td colSpan={11} className="td-ro py-6 text-center text-slate-500">No resources tagged in the current Spine Filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          Ticks mark the Amber ({t.dutyAmberPct}%) and Serious ({t.dutySeriousPct}%) limits. Duty uses {ws.settings.programme.demandCase.toLowerCase()} demand of {fmt(m.demandActive, 1)} / yr and {fmtInt(m.cal.annualHrs)} available h per unit per year.
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Spatial Conflicts" guide="spatialConflict" pad={false}>
          {m.conflicts.length === 0 ? <div className="p-4"><Empty>No two operations need the same resource at the same time beyond its quantity.</Empty></div> : (
            <div className="scroll-thin overflow-auto" style={{ maxHeight: 420 }}>
              <table className="w-full min-w-max border-separate border-spacing-0">
                <thead className="sticky top-0 z-10"><tr><Th>Resource</Th><Th>Operation A</Th><Th>Operation B</Th><Th right>Overlap h</Th><Th guide="spatialConflict">Type</Th><Th guide="resolvable">Resolvable within float</Th></tr></thead>
                <tbody>
                  {m.conflicts.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="td-ro max-w-[220px] truncate font-medium text-slate-900" title={c.resourceName}>{c.resourceName}</td>
                      {[c.a, c.b].map((o) => (
                        <td key={o.opId} className="td-ro whitespace-nowrap"><span className="font-mono text-[12px] text-slate-900">{o.opId}</span> <span className="text-[11.5px] text-slate-500">{day(o.start)}–{day(o.end)} · float {fmt(o.float, 0)} h</span></td>
                      ))}
                      <td className="td-ro text-right">{fmt(c.overlapHrs, 1)}</td>
                      <td className="td-ro">{c.hard ? <Pill tone="dark">Hard</Pill> : <Pill tone="outline" title="Crane tagged on long operations that only lift occasionally">Soft</Pill>}</td>
                      <td className="td-ro whitespace-nowrap">
                        {c.resolvable ? <span className="flex items-center gap-1.5"><RagBadge rag="green" label="Yes" /><span className="text-slate-700">delay <span className="font-mono text-[12px]">{c.shiftOp}</span> by {fmt(c.shiftHrs, 1)} h</span></span>
                          : <span className="flex items-center gap-1.5"><RagBadge rag={c.hard ? 'red' : 'amber'} label="No" /><span className="text-slate-700">{c.hard ? 'add a unit or re-sequence' : 'plan crane slots inside the ops'}</span></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Labour Load by Cell" guide="cellLoad">
          <div className="space-y-2">
            {ws.cells.map((c) => {
              const l = m.cells.find((x) => x.cellId === c.id)!;
              return (
                <div key={c.id} title={`Cell ${c.number} · ${c.name}: ${fmtInt(l.labourHrs)} labour h per build, ${l.lifts} lift(s)`}>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="truncate text-slate-700"><b className="text-slate-900">Cell {c.number}</b> {c.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-600">{fmtInt(l.labourHrs)} h · {l.utilPct == null ? '—' : fmtPct(l.utilPct, 0)}</span>
                  </div>
                  <div className="mt-0.5 h-2 w-full rounded-sm bg-slate-100"><div className="h-2 rounded-sm bg-slate-600" style={{ width: `${(l.labourHrs / maxCell) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] leading-snug text-slate-500">Bar length = labour hours per build; percentage = utilisation of the cell&apos;s established crew at {ws.settings.programme.demandCase.toLowerCase()} demand. Crew is set in <button className="underline hover:text-slate-800" onClick={() => setTab(5)}>Tab 5</button>.</p>
        </Card>
      </div>
    </div>
  );
}
