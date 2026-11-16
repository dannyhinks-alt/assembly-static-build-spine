import type { Draft } from 'immer';
import type { ReactNode } from 'react';
import { AssumptionsCard, CellsZonesCards } from '../components/CellsZones';
import LayoutEditor from '../components/LayoutEditor';
import { Card, Field, HowItWorks, NumInput, PassBadge, RagBadge, Select, Tip } from '../components/primitives';
import type { GuideId } from '../data/guides';
import { learningFactor } from '../engine/model';
import { fmt, fmtGbp, fmtInt, fmtPct } from '../lib/format';
import { useStore } from '../store';
import type { Settings } from '../types';

function Computed({ label, value, unit, guide, children }: { label: string; value: string; unit?: string; guide: GuideId; children?: ReactNode }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5"><span className="lbl">{label}</span><Tip id={guide} /><span className="ml-auto rounded bg-slate-200 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-slate-600">auto</span></div>
      <div className="mt-0.5 flex items-baseline gap-1.5"><span className="text-[17px] font-semibold tabular-nums text-slate-900">{value}</span>{unit && <span className="text-[11.5px] text-slate-500">{unit}</span>}{children}</div>
    </div>
  );
}

export default function Tab1Targets() {
  const { ws, mutate, model: m, integrity, setTab } = useStore();
  const s = ws.settings;
  const set = (fn: (d: Draft<Settings>) => void) => mutate((d) => fn(d.settings));
  const n = (v: number | null, fallback = 0) => v ?? fallback;
  const baselineModelled = m.lc > 0 ? integrity.factory.durationMonths / integrity.factory.lc : 0;
  const builds = [1, 2, 3, 4, 5, 6].map((b) => ({ b, f: learningFactor(s.learning, b) * 100 }));
  const yMax = Math.max(...builds.map((x) => x.f), 100) + 5;
  const yMin = Math.min(...builds.map((x) => x.f), 100) - 5;
  const cx = (b: number) => 48 + ((b - 1) / 5) * 222;
  const cy = (f: number) => 12 + ((yMax - f) / (yMax - yMin)) * 76;

  return (
    <div>
      <HowItWorks
        tab="1"
        title="Targets & Pre-Requisites"
        steps={[
          'Set programme cadence first: demand and waste give the Max Production Window every build has to fit inside.',
          'Pick a Build # on the learning curve — every labour hour and bay duration in all nine tabs rescales immediately.',
          'Enter the shift calendar and Active Time Factor; these convert BOP hours into working days and months.',
          'Set the crane envelope and the lift-risk thresholds; every lift in Tab 4 is tested against them.',
          'Define cells, crew, zones and zone station points, then import or trace the floor layout. Tabs 6 and 7 use them for spatial balancing and spaghetti distance.',
          'Watch the 10-point integrity panel and keep the Assumptions Register confirmed: both must be clear before release in Tab 9.',
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Programme Cadence">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Baseline Total Operational Time" guide="baselineOp" unit="months"><NumInput value={s.programme.baselineOpMonths} min={0} onChange={(v) => set((d) => { d.programme.baselineOpMonths = n(v); })} /></Field>
            <Computed label="Baseline modelled" guide="baselineOp" value={fmt(baselineModelled, 1)} unit="months">
              <span className="ml-auto"><RagBadge rag={baselineModelled <= s.programme.baselineOpMonths * 1.02 ? 'green' : baselineModelled <= s.programme.baselineOpMonths * 1.1 ? 'amber' : 'red'} label={baselineModelled <= s.programme.baselineOpMonths * 1.02 ? 'On target' : 'Over'} /></span>
            </Computed>
            <Field label="Annual Demand Nominal" guide="demandNominal" unit="/ yr"><NumInput value={s.programme.demandNominal} min={0.01} onChange={(v) => set((d) => { d.programme.demandNominal = n(v, 1); })} /></Field>
            <Computed label="Max Production Window" guide="windowNominal" value={fmt(m.windowNominal, 1)} unit="months" />
            <Field label="Annual Demand Peak" guide="demandPeak" unit="/ yr"><NumInput value={s.programme.demandPeak} min={0.01} onChange={(v) => set((d) => { d.programme.demandPeak = n(v, 1); })} /></Field>
            <Computed label="Peak Production Window" guide="windowPeak" value={fmt(m.windowPeak, 1)} unit="months" />
            <Field label="Drumbeat Requirement" guide="drumbeat" unit="months"><NumInput value={s.programme.drumbeatMonths} min={0} onChange={(v) => set((d) => { d.programme.drumbeatMonths = n(v); })} /></Field>
            <Field label="Demand Case" guide="demandCase"><Select value={s.programme.demandCase} onChange={(v) => set((d) => { d.programme.demandCase = v; })} options={[{ value: 'Nominal', label: 'Nominal' }, { value: 'Peak', label: 'Peak' }]} /></Field>
            <Field label="Labour Rate" guide="labourRate" unit="£ / h"><NumInput value={s.programme.labourRateGbp} min={0} onChange={(v) => set((d) => { d.programme.labourRateGbp = n(v); })} /></Field>
            <Computed label="Labour cost / build" guide="kpiCost" value={fmtGbp(m.totals.labourCost)} />
          </div>
        </Card>

        <Card title="Learning Curve Engine" right={<span className="flex items-center gap-1.5 text-[12px] text-slate-600">Active factor <b className="tabular-nums text-slate-900">{fmtPct(m.lc * 100, 0)}</b><Tip id="lcFactor" /></span>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="1st Build Target" guide="firstBuild" unit="%"><NumInput value={s.learning.firstBuildPct} min={1} onChange={(v) => set((d) => { d.learning.firstBuildPct = n(v, 100); })} /></Field>
            <Field label="Stabilised Target" guide="stabilised" unit="%"><NumInput value={s.learning.stabilisedPct} min={1} onChange={(v) => set((d) => { d.learning.stabilisedPct = n(v, 100); })} /></Field>
            <Field label="Step Reduction" guide="stepReduction" unit="% / build"><NumInput value={s.learning.stepReductionPct} min={0} onChange={(v) => set((d) => { d.learning.stepReductionPct = n(v); })} /></Field>
            <Field label="Stabilised after" guide="stepBuilds" unit="builds"><NumInput value={s.learning.stepBuilds} min={0} max={50} onChange={(v) => set((d) => { d.learning.stepBuilds = Math.round(n(v)); })} /></Field>
          </div>
          <div className="mt-3 flex items-center gap-1.5"><span className="lbl">Build #1 → #6 Learning Curve Selector</span><Tip id="buildSelector" /></div>
          <div className="mt-1.5 grid grid-cols-6 gap-1">
            {builds.map(({ b, f }) => (
              <button key={b} aria-pressed={s.learning.selectedBuild === b} onClick={() => set((d) => { d.learning.selectedBuild = b; })} className={`rounded border px-1 py-1 text-center ${s.learning.selectedBuild === b ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}>
                <span className="block text-[10.5px] font-semibold uppercase tracking-wide opacity-80">Build #{b}</span>
                <span className="block text-[13px] font-semibold tabular-nums">{fmt(f, 0)}%</span>
              </button>
            ))}
          </div>
          <svg viewBox="0 0 284 104" className="mt-2 w-full" role="img" aria-label="Learning curve by build number">
            {[...new Set([yMax - 5, s.learning.stabilisedPct, 100])].map((v) => (
              <g key={v}><line x1={36} x2={278} y1={cy(v)} y2={cy(v)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={v === 100 ? '3 3' : undefined} /><text x={32} y={cy(v) + 3} fontSize={8.5} textAnchor="end" fill="#64748b">{fmt(v, 0)}%</text></g>
            ))}
            <polyline fill="none" stroke="#334155" strokeWidth={2} strokeLinejoin="round" points={builds.map(({ b, f }) => `${cx(b)},${cy(f)}`).join(' ')} />
            {builds.map(({ b, f }) => {
              const on = s.learning.selectedBuild === b;
              return (
                <g key={b} className="cursor-pointer" onClick={() => set((d) => { d.learning.selectedBuild = b; })}>
                  <title>{`Build #${b}: ${fmt(f, 1)}% of baseline hours`}</title>
                  <circle cx={cx(b)} cy={cy(f)} r={10} fill="transparent" />
                  <circle cx={cx(b)} cy={cy(f)} r={on ? 5 : 3.5} fill={on ? '#0f172a' : '#fff'} stroke="#0f172a" strokeWidth={2} />
                  <text x={cx(b)} y={100} fontSize={8.5} textAnchor="middle" fill={on ? '#0f172a' : '#64748b'} fontWeight={on ? 700 : 400}>#{b}</text>
                </g>
              );
            })}
          </svg>
          <p className="text-[11.5px] leading-snug text-slate-500">At Build #{s.learning.selectedBuild}: <b className="tabular-nums text-slate-700">{fmtInt(m.totals.labourHrs)}</b> labour h · critical path <b className="tabular-nums text-slate-700">{fmt(m.durationMonths, 1)}</b> months in the current filter.</p>
        </Card>

        <Card title="Shift, Waste & Efficiency Calendar">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shifts Per Day" guide="shifts"><NumInput value={s.calendar.shiftsPerDay} min={1} max={4} onChange={(v) => set((d) => { d.calendar.shiftsPerDay = n(v, 1); })} /></Field>
            <Field label="Hours Per Shift" guide="hoursPerShift" unit="h"><NumInput value={s.calendar.hoursPerShift} min={0.5} max={12} onChange={(v) => set((d) => { d.calendar.hoursPerShift = n(v, 7.5); })} /></Field>
            <Field label="Working Days / Yr" guide="workingDays" unit="days"><NumInput value={s.calendar.workingDaysPerYear} min={1} max={366} onChange={(v) => set((d) => { d.calendar.workingDaysPerYear = n(v, 250); })} /></Field>
            <Computed label="Annual hours / unit" guide="shifts" value={fmtInt(m.cal.annualHrs)} unit="h" />
            <Field label="Waste Mode" guide="wasteMode"><Select value={s.calendar.wasteMode} onChange={(v) => set((d) => { d.calendar.wasteMode = v; })} options={[{ value: 'Automated', label: 'Automated (from NVA rows)' }, { value: 'Manual', label: 'Manual' }]} /></Field>
            <Field label="Manual Waste" guide="manualWaste" unit="%"><NumInput value={s.calendar.manualWastePct} min={0} max={95} disabled={s.calendar.wasteMode === 'Automated'} onChange={(v) => set((d) => { d.calendar.manualWastePct = n(v); })} /></Field>
            <Computed label="Applied waste" guide="wasteApplied" value={fmtPct(m.wastePct, 1)} />
            <Computed label="Hours / working month" guide="workingDays" value={fmt(m.cal.hoursPerMonth, 1)} unit="h" />
            <Field label="Active Time Factor (Net)" guide="activeFactor" unit="%"><NumInput value={s.calendar.activeTimeFactorPct} min={1} max={100} onChange={(v) => set((d) => { d.calendar.activeTimeFactorPct = n(v, 85); })} /></Field>
            <Field label="Labour Efficiency" guide="labourEff" unit="%"><NumInput value={s.calendar.labourEfficiencyPct} min={1} max={200} onChange={(v) => set((d) => { d.calendar.labourEfficiencyPct = n(v, 100); })} /></Field>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Crane Envelope & Configurable Lift / Pinch-Point Thresholds">
          <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Primary Crane SWL" guide="craneSwl" unit="kg" hint={`${fmt(s.crane.primarySwlKg / 1000, 1)} t`}><NumInput value={s.crane.primarySwlKg} min={0} onChange={(v) => set((d) => { d.crane.primarySwlKg = n(v); })} /></Field>
            <Field label="Vertical Hook Height" guide="hookHeight" unit="m"><NumInput value={s.crane.hookHeightM} min={0} onChange={(v) => set((d) => { d.crane.hookHeightM = n(v); })} /></Field>
            <Field label="Safety Lift Clearance Margin" guide="clearance" unit="m"><NumInput value={s.crane.clearanceMarginM} min={0} onChange={(v) => set((d) => { d.crane.clearanceMarginM = n(v); })} /></Field>
            <Field label="Average Lift Cycle" guide="avgLiftCycle" unit="h"><NumInput value={s.crane.avgLiftCycleHrs} min={0} onChange={(v) => set((d) => { d.crane.avgLiftCycleHrs = n(v); })} /></Field>
            <Field label="Default Stand Floor Height" guide="tierHeight" unit="m"><NumInput value={s.crane.defaultTierHeightM} min={0} onChange={(v) => set((d) => { d.crane.defaultTierHeightM = n(v); })} /></Field>
            <Field label="Default Rigging Headroom" guide="riggingHeadroom" unit="m"><NumInput value={s.crane.defaultRiggingHeadroomM} min={0} onChange={(v) => set((d) => { d.crane.defaultRiggingHeadroomM = n(v); })} /></Field>
            <Field label="Tandem Lift Derate" guide="tandemDerate" unit="%"><NumInput value={s.crane.tandemDeratePct} min={0} max={90} onChange={(v) => set((d) => { d.crane.tandemDeratePct = n(v); })} /></Field>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="mb-2 text-[12.5px] font-semibold text-slate-900">Configurable Pinch-Point &amp; Lift Risk Thresholds</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ThresholdBox title="Heavy Lift Weight Threshold" guide="thHeavy" count={m.lifts.filter((l) => l.heavy).length} total={m.lifts.length} flag="Heavy Lift">
                <span className="text-[12px] text-slate-600">Load &gt;</span><NumInput value={s.thresholds.heavyLiftKg} min={0} width={84} onChange={(v) => set((d) => { d.thresholds.heavyLiftKg = n(v); })} ariaLabel="Heavy lift threshold kg" /><span className="text-[12px] text-slate-600">kg</span>
              </ThresholdBox>
              <ThresholdBox title="Multi-Person Lift Crew Threshold" guide="thMultiPerson" count={m.lifts.filter((l) => l.multiPerson).length} total={m.lifts.length} flag="Multi-Person">
                <span className="text-[12px] text-slate-600">Crew Size ≥</span><NumInput value={s.thresholds.multiPersonCrew} min={1} width={60} onChange={(v) => set((d) => { d.thresholds.multiPersonCrew = Math.round(n(v, 2)); })} ariaLabel="Multi-person crew threshold" />
              </ThresholdBox>
              <ThresholdBox title="3D / High-Elevation Lift Threshold" guide="thElevation" count={m.lifts.filter((l) => l.highElevation).length} total={m.lifts.length} flag="3D Lift">
                <span className="text-[12px] text-slate-600">≥</span><NumInput value={s.thresholds.highElevationM} min={0} width={60} onChange={(v) => set((d) => { d.thresholds.highElevationM = n(v); })} ariaLabel="High elevation threshold metres" /><span className="text-[12px] text-slate-600">m or ≥</span>
                <NumInput value={s.thresholds.highElevationFloors} min={1} max={3} width={48} onChange={(v) => set((d) => { d.thresholds.highElevationFloors = Math.round(n(v, 2)); })} ariaLabel="High elevation stand floors" /><span className="text-[12px] text-slate-600">stand floors</span>
              </ThresholdBox>
              <ThresholdBox title="Multi-Tool / Complex Lift Threshold" guide="thMultiTool" count={m.lifts.filter((l) => l.complex).length} total={m.lifts.length} flag="Complex">
                <span className="text-[12px] text-slate-600">≥</span><NumInput value={s.thresholds.multiToolItems} min={1} width={52} onChange={(v) => set((d) => { d.thresholds.multiToolItems = Math.round(n(v, 2)); })} ariaLabel="Multi-tool item threshold" /><span className="text-[12px] text-slate-600">rigging / tool items, or Complex class, or tandem</span>
              </ThresholdBox>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="mb-2 text-[12.5px] font-semibold text-slate-900">Analysis RAG Thresholds</div>
            <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Duty Cycle — Amber above" guide="thDutyAmber" unit="%"><NumInput value={s.thresholds.dutyAmberPct} min={1} max={100} onChange={(v) => set((d) => { d.thresholds.dutyAmberPct = n(v, 65); })} /></Field>
              <Field label="Duty Cycle — Serious above" guide="thDutySerious" unit="%"><NumInput value={s.thresholds.dutySeriousPct} min={1} max={100} onChange={(v) => set((d) => { d.thresholds.dutySeriousPct = n(v, 85); })} /></Field>
              <Field label="Attendance Ratio — Red at" guide="thAr" unit="%"><NumInput value={s.thresholds.arRedPct} min={1} onChange={(v) => set((d) => { d.thresholds.arRedPct = n(v, 100); })} /></Field>
              <Field label="Ar minimum cycle" guide="thArCycle" unit="min"><NumInput value={s.thresholds.arMinCycleMin} min={0} onChange={(v) => set((d) => { d.thresholds.arMinCycleMin = n(v, 5); })} /></Field>
              <Field label="Near-Critical Float ≤" guide="thNearCritical" unit="h"><NumInput value={s.thresholds.nearCriticalFloatHrs} min={0} onChange={(v) => set((d) => { d.thresholds.nearCriticalFloatHrs = n(v); })} /></Field>
              <Field label="RPN Amber ≥" guide="thRpn"><NumInput value={s.thresholds.rpnAmber} min={1} max={1000} onChange={(v) => set((d) => { d.thresholds.rpnAmber = n(v, 80); })} /></Field>
              <Field label="RPN Serious ≥" guide="thRpn"><NumInput value={s.thresholds.rpnSerious} min={1} max={1000} onChange={(v) => set((d) => { d.thresholds.rpnSerious = n(v, 120); })} /></Field>
              <Field label="RPN Red ≥" guide="thRpn"><NumInput value={s.thresholds.rpnRed} min={1} max={1000} onChange={(v) => set((d) => { d.thresholds.rpnRed = n(v, 200); })} /></Field>
            </div>
          </div>
        </Card>

        <Card
          title="Live 10-Point Model Integrity & Independent Self-Test"
          guide="integrity"
          right={<RagBadge rag={integrity.allPass ? 'green' : 'red'} label={`${integrity.passed} / ${integrity.checks.length} pass`} />}
          pad={false}
        >
          <ul>
            {integrity.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-2 last:border-b-0">
                <span className="mt-0.5 w-4 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-slate-400">{c.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-800">{c.title}<Tip id={`int.${c.key}` as GuideId} /></div>
                  <div className={`text-[11.5px] leading-snug ${c.pass ? 'text-slate-500' : 'text-slate-800'}`}>{c.detail}</div>
                </div>
                <PassBadge pass={c.pass} />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11.5px] text-slate-500">
            <span>Always factory-wide ({fmtInt(integrity.factory.totals.activities)} activities in {fmtInt(integrity.factory.fpds.length)} active FPDs) — ignores the Spine Filter.</span>
            <button className="btn-ghost" onClick={() => setTab(9)}>Release gates →</button>
          </div>
        </Card>
      </div>

      <AssumptionsCard className="mt-4" />
      <CellsZonesCards />

      <Card className="mt-4" title="Factory Physical Envelope & Propel Geometry">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-40"><Field label="Boundary Length" guide="envelope" unit="m"><NumInput value={s.envelope.lengthM} min={1} onChange={(v) => set((d) => { d.envelope.lengthM = n(v, 1); })} /></Field></div>
          <div className="w-40"><Field label="Boundary Width" guide="envelope" unit="m"><NumInput value={s.envelope.widthM} min={1} onChange={(v) => set((d) => { d.envelope.widthM = n(v, 1); })} /></Field></div>
          <div className="w-44"><Computed label="Total floor area" guide="envelope" value={fmtInt(s.envelope.lengthM * s.envelope.widthM)} unit="m²" /></div>
        </div>
        <LayoutEditor />
      </Card>
    </div>
  );
}

function ThresholdBox({ title, guide, children, count, total, flag }: { title: string; guide: GuideId; children: ReactNode; count: number; total: number; flag: string }) {
  return (
    <div className="rounded border border-slate-200 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5"><span className="lbl">{title}</span><Tip id={guide} /></div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      <div className="mt-1.5 text-[11.5px] tabular-nums text-slate-500"><b className="text-slate-800">{count}</b> of {total} lift op(s) currently flagged <i>{flag}</i></div>
    </div>
  );
}
