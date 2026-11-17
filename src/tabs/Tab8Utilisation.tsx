import { useState } from 'react';
import { Card, Empty, ExpandableTextCell, HowItWorks, Kpi, Meter, Pill, RagBadge, Select, Th } from '../components/primitives';
import { dutyRag } from '../engine/model';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import { RESOURCE_KINDS, type ResourceKind } from '../types';
import { ComplexityPill } from './Tab3Equipment';

const UNDER_PCT = 15; // flag resources below this duty threshold

function UnderUtilisationPanel() {
  const { ws, model: m } = useStore();
  const spd = ws.settings.calendar.hoursPerShift || 1;
  const windowShifts = m.resources[0] ? (m.resources[0].programmeShifts / Math.max(1, m.resources[0].resource.qty)) : 0;
  const idleWindowH = windowShifts * spd;

  const under = m.resources.filter((r) => r.opCount > 0 && r.dutyPct < UNDER_PCT && r.dutyPct >= 0)
    .sort((a, b) => a.dutyPct - b.dutyPct);

  if (!under.length) return null;

  return (
    <Card className="mt-4" title={<>Under-Utilisation Waste Assessment <span className="ml-1 text-[12px] font-normal text-amber-700">· {under.length} asset{under.length > 1 ? 's' : ''} below {UNDER_PCT}% duty</span></>} pad={false}>
      <div className="scroll-thin overflow-auto" style={{ maxHeight: 400 }}>
        <table className="w-full min-w-max border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              <Th>Asset</Th><Th>Kind</Th><Th right>Duty Cycle %</Th><Th right>Idle Window h</Th><Th right>Under-Utilisation %</Th><Th>Recommendation</Th>
            </tr>
          </thead>
          <tbody>
            {under.map((r) => {
              const idleH = idleWindowH * (1 - r.dutyPct / 100);
              const underPct = 100 - r.dutyPct;
              const rec = r.dutyPct < 5
                ? 'Consider removing or sharing — asset is effectively idle for this programme.'
                : r.dutyPct < 10
                  ? 'Review whether asset is required or can serve another cell / FPD.'
                  : 'Assess shared-use opportunity or reduced-quantity procurement.';
              return (
                <tr key={r.resource.id} className="hover:bg-slate-50">
                  <td className="td-ro font-medium text-slate-900">{r.resource.name}</td>
                  <td className="td-ro text-slate-600">{RESOURCE_KINDS.find((k) => k.kind === r.resource.kind)?.label ?? r.resource.kind}</td>
                  <td className="td-ro text-right tabular-nums">
                    <span className="font-semibold text-amber-700">{r.dutyPct.toFixed(1)}%</span>
                  </td>
                  <td className="td-ro text-right tabular-nums text-slate-700">{idleH.toFixed(0)} h</td>
                  <td className="td-ro text-right tabular-nums text-slate-700">{underPct.toFixed(1)}%</td>
                  <td className="td-ro text-[12px] text-slate-700" style={{ minWidth: 300 }}>{rec}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">
        Assets below {UNDER_PCT}% duty cycle are flagged as potential waste sources. Idle Window Hours = Programme Window × (1 − Duty %). Review shared-use or procurement scope before the design freeze gate.
      </div>
    </Card>
  );
}

export default function Tab8Utilisation() {
  const { ws, mutate, model: m, setTab } = useStore();
  const [kind, setKind] = useState<'' | ResourceKind>('');
  const [showIdle, setShowIdle] = useState(false);
  const [onlyRisk, setOnlyRisk] = useState(false);
  const t = ws.settings.thresholds;
  const hpd = m.cal.hoursPerDay || 1;
  const day = (h: number) => `d${fmt(h / hpd, 1)}`;
  const used = m.resources.filter((r) => r.opCount > 0);
  const res = m.resources.filter((r) => (showIdle || r.opCount > 0) && (!kind || r.resource.kind === kind) && (!onlyRisk || r.highRisk)).sort((a, b) => Number(b.highRisk) - Number(a.highRisk) || b.dutyPct - a.dutyPct);
  const top = [...used].sort((a, b) => b.dutyPct - a.dutyPct)[0];
  const high = used.filter((r) => r.highRisk);
  const noPlan = high.filter((r) => !(ws.mitigations[r.resource.id] ?? '').trim());
  const hard = m.conflicts.filter((c) => c.hard);
  const windowShifts = used[0] ? used[0].programmeShifts / Math.max(1, used[0].resource.qty) : 0;

  return (
    <div>
      <HowItWorks
        tab="8"
        title="Resource Utilisation & Concurrency"
        steps={[
          'Duty Cycle % = Shifts Used ÷ Programme Shifts. Shifts Used is the time the resource is occupied in one build; Programme Shifts is the Max Production Window for one unit × quantity.',
          'Full-Build Dwell resources are occupied for the whole critical path, so they sit near 100% whenever the build fills the window.',
          'Amber and Serious limits come from Tab 1 (65% and 85% by default); above 100% is Red.',
          'HIGH RISK is raised when duty is above the Serious limit, or when operations that genuinely hold the resource overlap beyond its quantity.',
          'Concurrency conflicts list each overlap and whether delaying one operation inside its float clears it.',
          'Record a Bottleneck Mitigation Strategy against every HIGH RISK resource — the cell grows on focus and ⤢ opens the full editor.',
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Highest duty cycle" guide="duty" value={top ? fmtPct(top.dutyPct, 0) : '—'} sub={top?.resource.name ?? '—'} rag={top ? dutyRag(top.dutyPct, ws.settings) : undefined} />
        <Kpi label="HIGH RISK resources" guide="highRisk" value={fmtInt(high.length)} sub={`${fmtInt(noPlan.length)} without a mitigation strategy`} rag={noPlan.length ? 'serious' : high.length ? 'amber' : 'green'} />
        <Kpi label="Concurrency conflicts" guide="spatialConflict" value={fmtInt(m.conflicts.length)} sub={`${fmtInt(hard.length)} hard · ${fmtInt(m.conflicts.filter((c) => !c.resolvable).length)} not resolvable in float`} rag={hard.some((c) => !c.resolvable) ? 'red' : m.conflicts.length ? 'amber' : 'green'} />
        <Kpi label="Programme shifts / unit" guide="programmeShifts" value={fmtInt(windowShifts)} sub={`${fmt(m.windowActive, 1)}-month ${ws.settings.programme.demandCase.toLowerCase()} window`} />
        <Kpi label="Resources above Amber" guide="thDutyAmber" value={fmtInt(used.filter((r) => r.dutyPct > t.dutyAmberPct).length)} sub={`of ${fmtInt(used.length)} tagged · limit ${t.dutyAmberPct}%`} />
      </div>

      <Card
        title="Duty Cycle & Concurrency"
        guide="duty"
        pad={false}
        right={
          <>
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} />HIGH RISK only</label>
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />Show untagged</label>
            <div className="w-56"><Select value={kind} onChange={setKind} ariaLabel="Resource kind" options={[{ value: '', label: 'All resource kinds' }, ...RESOURCE_KINDS.map((k) => ({ value: k.kind, label: k.plural }))]} /></div>
          </>
        }
      >
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 620 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <Th>Resource</Th><Th guide="highRisk">Concurrency flag</Th><Th guide="resClass">Class</Th><Th guide="dwell">Dwell</Th><Th right>Ops</Th>
                <Th right guide="shiftsUsed">Shifts used</Th><Th right guide="programmeShifts">Programme shifts</Th><Th guide="duty">Duty cycle %</Th>
                <Th right guide="peakConcurrent">Peak / qty</Th><Th right guide="requiredQty">Need</Th><Th guide="mitigation">Bottleneck Mitigation Strategy</Th>
              </tr>
            </thead>
            <tbody>
              {res.map((r) => (
                <tr key={r.resource.id} className="hover:bg-slate-50">
                  <td className="td-ro"><span className="block max-w-[250px] truncate font-medium text-slate-900" title={r.ops.join(', ')}>{r.resource.name}</span><span className="block text-[11px] text-slate-500">{RESOURCE_KINDS.find((k) => k.kind === r.resource.kind)!.label}</span></td>
                  <td className="td-ro whitespace-nowrap">{!r.opCount ? <span className="text-slate-400">not tagged</span> : r.highRisk ? <RagBadge rag={r.dutyPct > 100 ? 'red' : 'serious'} label="HIGH RISK" title={r.dutyPct > t.dutySeriousPct ? `Duty above the ${t.dutySeriousPct}% Serious limit` : 'Over-subscribed by operations that hold it'} /> : r.conflicts ? <RagBadge rag="amber" label={`${r.conflicts} soft overlap${r.conflicts > 1 ? 's' : ''}`} /> : <RagBadge rag="green" label="Clear" />}</td>
                  <td className="td-ro"><ComplexityPill r={r.resource} /></td>
                  <td className="td-ro">{r.resource.dwellMode === 'Full-Build' ? <Pill tone="dark">Full-Build</Pill> : <Pill tone="outline">Per-Op</Pill>}</td>
                  <td className="td-ro text-right">{fmtInt(r.opCount)}</td>
                  <td className="td-ro text-right font-medium text-slate-900">{r.opCount ? fmt(r.shiftsUsed, 1) : '—'}</td>
                  <td className="td-ro text-right">{fmtInt(r.programmeShifts)}</td>
                  <td className="td-ro" style={{ minWidth: 200 }}>{r.opCount ? <span className="flex items-center gap-2"><span className="w-11 text-right font-medium text-slate-900">{fmtPct(r.dutyPct, 0)}</span><Meter pct={r.dutyPct} rag={dutyRag(r.dutyPct, ws.settings)} ticks={[t.dutyAmberPct, t.dutySeriousPct]} /></span> : <span className="text-slate-400">—</span>}</td>
                  <td className="td-ro text-right">{r.opCount ? <span className={r.peakConcurrent > r.resource.qty ? 'font-bold text-slate-900' : ''}>{r.peakConcurrent} / {r.resource.qty}</span> : '—'}</td>
                  <td className="td-ro text-right">{r.opCount ? (r.requiredQty > r.resource.qty ? <b className="text-slate-900">{r.requiredQty}</b> : r.resource.qty) : '—'}</td>
                  <td className="td"><ExpandableTextCell value={ws.mitigations[r.resource.id] ?? ''} onChange={(v) => mutate((d) => { if (v.trim()) d.mitigations[r.resource.id] = v; else delete d.mitigations[r.resource.id]; })} label="Bottleneck Mitigation Strategy" context={`${r.resource.name} · duty ${fmtPct(r.dutyPct, 0)}`} placeholder={r.highRisk ? 'Required — record the mitigation…' : '—'} minWidth={320} /></td>
                </tr>
              ))}
              {!res.length && <tr><td colSpan={11} className="td-ro py-6 text-center text-slate-500">No resources match the current filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          Ticks mark the Amber ({t.dutyAmberPct}%) and Serious ({t.dutySeriousPct}%) limits. One shift = {fmt(ws.settings.calendar.hoursPerShift, 1)} h. Complexity and dwell mode are set in <button className="underline hover:text-slate-800" onClick={() => setTab(3)}>Tab 3</button>.
        </div>
      </Card>

      <UnderUtilisationPanel />

      <Card className="mt-4" title="Concurrency Conflicts — Resource Double-Booking" guide="spatialConflict" pad={false}>
        {m.conflicts.length === 0 ? <div className="p-4"><Empty>No two operations need the same resource at the same time beyond its quantity.</Empty></div> : (
          <div className="scroll-thin overflow-auto" style={{ maxHeight: 420 }}>
            <table className="w-full min-w-max border-separate border-spacing-0">
              <thead className="sticky top-0 z-10"><tr><Th>Resource</Th><Th>Operation A</Th><Th>Operation B</Th><Th right>Overlap h</Th><Th guide="spatialConflict">Type</Th><Th guide="resolvable">Resolvable within float</Th></tr></thead>
              <tbody>
                {m.conflicts.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="td-ro max-w-[260px] truncate font-medium text-slate-900" title={c.resourceName}>{c.resourceName}</td>
                    {[c.a, c.b].map((o) => (
                      <td key={o.opId} className="td-ro whitespace-nowrap"><span className="font-mono text-[12px] text-slate-900">{o.opId}</span> <span className="text-[11.5px] text-slate-500">{day(o.start)}–{day(o.end)} · float {fmt(o.float, 0)} h</span></td>
                    ))}
                    <td className="td-ro text-right">{fmt(c.overlapHrs, 1)}</td>
                    <td className="td-ro">{c.hard ? <RagBadge rag="serious" label="HIGH RISK · hard" /> : <Pill tone="outline" title="Crane tagged on long operations that only lift occasionally">Soft</Pill>}</td>
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
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Work-face and lift clashes by Cell / Zone / Stand Level are in <button className="underline hover:text-slate-800" onClick={() => setTab(6)}>Tab 6</button>.</div>
      </Card>
    </div>
  );
}
