import { useState } from 'react';
import { ComponentRegisterCard } from '../components/FpdRegistry';
import { Card, HowItWorks, Kpi, Meter, Pill, RagBadge, Select, Th, Tip } from '../components/primitives';
import type { LiftRecord } from '../engine/model';
import { fmt, fmtInt, fmtPct, ragRank } from '../lib/format';
import { useStore } from '../store';
import { FLOOR_LEVELS, type Rag } from '../types';

type FlagKey = 'heavy' | 'multiPerson' | 'complex' | 'multiTool' | 'highElevation';

/** Hook-height stack-up drawn to scale against the available hook height. */
export function StackUpBar({ l, width = 190 }: { l: LiftRecord; width?: number }) {
  const max = Math.max(l.requiredHookM, l.availableHookM) * 1.06 || 1;
  const seg = [
    { v: l.elevationM, c: '#cbd5e1', n: 'Landing elevation' },
    { v: l.compHeightM, c: '#334155', n: 'Component height' },
    { v: l.headroomM, c: '#64748b', n: 'Rigging headroom' },
    { v: l.clearanceM, c: '#e2e8f0', n: 'Clearance margin' },
  ];
  const title = `${seg.map((s) => `${s.n} ${fmt(s.v, 2)} m`).join(' + ')} = ${fmt(l.requiredHookM, 2)} m required · ${fmt(l.availableHookM, 2)} m available`;
  return (
    <span className="relative block h-3 rounded-sm bg-slate-50" style={{ width }} title={title}>
      <span className="flex h-3">
        {seg.map((s) => s.v > 0 && <span key={s.n} className="h-3 border-r border-white last:border-r-0" style={{ width: `${(s.v / max) * 100}%`, backgroundColor: s.c }} />)}
      </span>
      <span className="absolute -top-1 h-5 border-l-2 border-dashed" style={{ left: `${(l.availableHookM / max) * 100}%`, borderColor: l.hookBreach ? '#d03b3b' : '#0f172a' }} />
    </span>
  );
}

export default function Tab4Lifts() {
  const { ws, model: m, setTab } = useStore();
  const [view, setView] = useState<'all' | 'flagged' | 'red' | FlagKey>('all');
  const [moveView, setMoveView] = useState<'all' | 'Inter-Cell' | 'Intra-Cell'>('all');
  const t = ws.settings.thresholds;
  const fpdCode = (id: string) => ws.fpds.find((f) => f.fpdId === id)?.fpdCode ?? '';
  const zoneName = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '—';
  const resName = (id: string) => ws.resources.find((r) => r.id === id)?.name ?? '';
  const cellNo = (id: string) => ws.cells.find((c) => c.id === id)?.number;
  const sp = m.space;

  const count = (f: (l: LiftRecord) => boolean) => ({ lifts: m.lifts.filter(f).reduce((a, l) => a + l.lifts, 0), ops: m.lifts.filter(f).length });
  const counters: { key: FlagKey | 'all'; label: string; guide: Parameters<typeof Kpi>[0]['guide']; sub: string; c: { lifts: number; ops: number } }[] = [
    { key: 'all', label: 'Total lifts', guide: 'kpiLifts', sub: 'per build', c: count(() => true) },
    { key: 'heavy', label: `Heavy lifts > ${fmtInt(t.heavyLiftKg)} kg`, guide: 'flagHeavy', sub: 'load above threshold', c: count((l) => l.heavy) },
    { key: 'multiPerson', label: `Multi-person lifts · crew ≥ ${t.multiPersonCrew}`, guide: 'flagMulti', sub: 'lift team required', c: count((l) => l.multiPerson) },
    { key: 'complex', label: 'Complex lifts', guide: 'flagComplex', sub: 'Complex-class equipment', c: count((l) => l.complex) },
    { key: 'multiTool', label: 'Multi-tool / tandem lifts', guide: 'flagMultiTool', sub: `≥ ${t.multiToolItems} items or tandem cranes`, c: count((l) => l.multiTool) },
    { key: 'highElevation', label: '3D elevation lifts', guide: 'flag3d', sub: `≥ ${fmt(t.highElevationM, 1)} m or ≥ Level ${t.highElevationFloors}`, c: count((l) => l.highElevation) },
  ];
  const lifts = [...m.lifts]
    .filter((l) => (view === 'all' ? true : view === 'red' ? l.rag === 'red' : view === 'flagged' ? l.rag !== 'green' : l[view]))
    .sort((a, b) => ragRank(b.rag) - ragRank(a.rag) || a.startHrs - b.startHrs);
  const why = (l: LiftRecord) =>
    l.missingWeight ? 'No component weight — SWL check cannot run'
      : l.utilPct != null && l.utilPct > 100 ? `Over capacity by ${fmtInt((l.loadKg ?? 0) - l.capacityKg)} kg`
      : l.hookBreach ? `Hook-height breach of ${fmt(-l.hookMarginM, 2)} m`
      : l.utilPct != null && l.utilPct > 90 ? 'Above 90% of governing capacity'
      : l.flagCount >= 3 ? `${l.flagCount} lift-risk flags`
      : l.flagCount >= 1 ? `${l.flagCount} lift-risk flag(s)` : 'Routine lift';
  const liftRag: Rag = m.lifts.reduce<Rag>((w, l) => (ragRank(l.rag) > ragRank(w) ? l.rag : w), 'green');

  const moves = sp.moves.filter((x) => moveView === 'all' || x.type === moveView).sort((a, b) => b.moves * (b.distM ?? 0) - a.moves * (a.distM ?? 0));
  const cells = [...ws.cells].sort((a, b) => a.number - b.number);
  const od = (from: string, to: string) => sp.moves.filter((x) => x.fromCellId === from && x.toCellId === to).reduce((a, x) => a + x.moves, 0);
  const odMax = Math.max(1, ...cells.flatMap((a) => cells.map((b) => od(a.id, b.id))));
  const vehicles = ws.resources.filter((r) => r.kind === 'vehicle').map((v) => ({ v, moves: sp.moves.filter((x) => x.vehicleIds.includes(v.id)).reduce((a, x) => a + x.moves, 0), dist: sp.moves.filter((x) => x.vehicleIds.includes(v.id)).reduce((a, x) => a + x.moves * (x.distM ?? 0), 0) }));
  const manual = sp.moves.filter((x) => x.vehicleIds.length === 0);
  const saving = sp.spaghettiM ? (1 - sp.spaghettiFutureM / sp.spaghettiM) * 100 : 0;

  return (
    <div>
      <HowItWorks
        tab="4"
        title="Component, Lift & Movement Analysis"
        steps={[
          'The six counters are automatic: every BOP activity with a Lift Count is tested against the Tab 1 thresholds. Click a counter to filter the register.',
          'Lift load = component weight + rigging tare. Governing capacity is the lowest of crane SWL and rigging WLL. Above 90% is Serious, above 100% is Red.',
          'Hook-height stack-up = landing elevation + component height + rigging headroom + clearance. The dashed marker is the available hook height; a stack that crosses it is a Red breach.',
          'Movement: every activity with a Move Count, or whose origin and destination zones differ, is measured between zone station points (rectilinear, one way).',
          'The From–To matrix shows which cells exchange most movement; Tab 7 draws the same flows on the floor plan with current and future distances.',
          'Keep the Component register at the bottom current — a lifted item with no weight turns its lift Red and fails integrity check 4.',
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {counters.map((k) => (
          <div key={k.key} role="button" tabIndex={0} aria-pressed={view === k.key} title="Click to filter the register"
            onClick={() => setView(view === k.key ? 'all' : k.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(view === k.key ? 'all' : k.key); } }}
            className={`cursor-pointer rounded-lg ${view === k.key && k.key !== 'all' ? 'ring-2 ring-slate-800' : ''}`}>
            <Kpi label={k.label} guide={k.guide} value={fmtInt(k.c.lifts)} unit="lifts" sub={`${fmtInt(k.c.ops)} lift op(s) · ${k.sub}`} />
          </div>
        ))}
      </div>

      <Card
        title="Per-Lift SWL & Hook-Height Stack-Up Checks"
        guide="liftRag"
        pad={false}
        right={
          <>
            <RagBadge rag={m.lifts.length ? liftRag : 'green'} label={`${m.lifts.filter((l) => l.rag === 'red').length} Red · ${m.lifts.filter((l) => l.rag === 'serious').length} Serious · ${m.lifts.filter((l) => l.hookBreach).length} hook breach`} />
            <div className="w-56"><Select value={view} onChange={setView} ariaLabel="Lift filter" options={[{ value: 'all', label: 'All lift ops' }, { value: 'flagged', label: 'Flagged (not Green)' }, { value: 'red', label: 'Red only' }, { value: 'heavy', label: 'Heavy' }, { value: 'multiPerson', label: 'Multi-person' }, { value: 'complex', label: 'Complex' }, { value: 'multiTool', label: 'Multi-tool / tandem' }, { value: 'highElevation', label: '3D elevation' }]} /></div>
          </>
        }
      >
        <div className="scroll-thin overflow-auto" style={{ maxHeight: 560 }}>
          <table className="w-full min-w-max border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <Th guide="opId">Op #</Th><Th guide="description">Activity</Th><Th guide="liftRag">RAG</Th><Th>Finding</Th><Th right guide="liftCount">Lifts</Th>
                <Th right guide="liftLoad">Load kg</Th><Th right guide="liftCapacity">Capacity kg</Th><Th guide="liftUtil">SWL utilisation</Th>
                <Th guide="floorLevel">Landing</Th><Th guide="stackUp">Hook-height stack-up</Th><Th right guide="hookCheck">Req. / avail. m</Th><Th right guide="hookCheck">Margin m</Th><Th right guide="crew">Crew</Th>
                <Th>Risk flags <Tip id="flagHeavy" /><Tip id="flagMulti" /><Tip id="flag3d" /><Tip id="flagComplex" /><Tip id="flagMultiTool" /></Th><Th guide="fpdRef">FPD</Th>
              </tr>
            </thead>
            <tbody>
              {lifts.map((l) => {
                const uRag: Rag = l.utilPct == null ? 'red' : l.utilPct > 100 ? 'red' : l.utilPct > 90 ? 'serious' : l.utilPct > 75 ? 'amber' : 'green';
                return (
                  <tr key={l.leafId} className="hover:bg-slate-50">
                    <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{l.opId}</td>
                    <td className="td-ro max-w-[240px] truncate text-slate-700" title={l.description}>{l.description || '—'}</td>
                    <td className="td-ro"><RagBadge rag={l.rag} /></td>
                    <td className="td-ro whitespace-nowrap text-slate-700">{why(l)}</td>
                    <td className="td-ro text-right">{fmtInt(l.lifts)}</td>
                    <td className="td-ro text-right font-medium text-slate-900">{l.loadKg == null ? '—' : fmtInt(l.loadKg)}</td>
                    <td className="td-ro text-right"><span className="block">{fmtInt(l.capacityKg)}</span><span className="block max-w-[180px] truncate text-[10.5px] text-slate-500" title={l.capacitySource}>{l.capacitySource}</span></td>
                    <td className="td-ro" style={{ minWidth: 140 }}><span className="flex items-center gap-2"><span className="w-10 text-right">{fmtPct(l.utilPct, 0)}</span><Meter pct={l.utilPct ?? 0} rag={uRag} ticks={[90, 100]} /></span></td>
                    <td className="td-ro whitespace-nowrap text-slate-700">{FLOOR_LEVELS[l.floorLevel]} <span className="text-slate-500">· {fmt(l.elevationM, 1)} m</span></td>
                    <td className="td-ro"><StackUpBar l={l} /></td>
                    <td className="td-ro whitespace-nowrap text-right">{fmt(l.requiredHookM, 2)} / {fmt(l.availableHookM, 2)}</td>
                    <td className="td-ro text-right">{l.hookBreach ? <RagBadge rag="red" label={fmt(l.hookMarginM, 2)} title="Hook-height breach" /> : <span className={l.hookMarginM < 0.15 ? 'font-semibold text-slate-900' : 'text-slate-700'}>{fmt(l.hookMarginM, 2)}</span>}</td>
                    <td className="td-ro text-right">{fmtInt(l.crew)}</td>
                    <td className="td-ro"><span className="flex gap-1">
                      {l.heavy && <Pill>Heavy</Pill>}{l.multiPerson && <Pill>Multi-person</Pill>}{l.highElevation && <Pill>3D</Pill>}{l.complex && <Pill tone="dark">Complex</Pill>}{l.multiTool && <Pill>{l.tandem ? 'Tandem' : 'Multi-tool'}</Pill>}
                      {l.flagCount === 0 && <span className="text-slate-400">none</span>}
                    </span></td>
                    <td className="td-ro text-slate-600">{fpdCode(l.fpdId)}</td>
                  </tr>
                );
              })}
              {!lifts.length && <tr><td colSpan={15} className="td-ro py-6 text-center text-slate-500">{m.lifts.length ? 'No lifts match this view.' : 'No lift operations in the current Spine Filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#cbd5e1' }} />Landing elevation</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#334155' }} />Component</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#64748b' }} />Rigging headroom</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm border border-slate-300" style={{ backgroundColor: '#e2e8f0' }} />Clearance</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-0 border-l-2 border-dashed border-slate-800" />Hook limit</span>
          <span className="ml-auto">Thresholds are set in <button className="underline hover:text-slate-800" onClick={() => setTab(1)}>Tab 1</button>; the vertical section is in <button className="underline hover:text-slate-800" onClick={() => setTab(7)}>Tab 7</button>.</span>
        </div>
      </Card>

      <div className="mb-3 mt-6 flex items-center gap-2"><h2 className="text-[13px] font-semibold text-slate-900">Movement Analysis</h2><Tip id="moveBreakdown" /></div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total moves" guide="moveCount" value={fmtInt(sp.interCellMoves + sp.intraCellMoves)} sub={`${fmtInt(sp.interCellMoves)} inter-cell · ${fmtInt(sp.intraCellMoves)} intra-cell`} />
        <Kpi label="Spaghetti distance — current" guide="spaghetti" value={fmtInt(sp.spaghettiM)} unit="m / build" sub={`${fmtInt(sp.interCellM)} m inter-cell · ${fmtInt(sp.intraCellM)} m intra-cell`} />
        <Kpi label="Spaghetti distance — future" guide="spaghettiFuture" value={fmtInt(sp.spaghettiFutureM)} unit="m / build" sub={`${fmtPct(saving, 0)} saving with future zone positions`} rag={saving >= 10 ? 'green' : undefined} />
        <Kpi label="Longest single flow" guide="moveDistance" value={fmtInt(Math.max(0, ...sp.moves.map((x) => x.moves * (x.distM ?? 0))))} unit="m" sub={(() => { const top = [...sp.moves].sort((a, b) => b.moves * (b.distM ?? 0) - a.moves * (a.distM ?? 0))[0]; return top ? `${top.opId} · ${top.moves} move(s) × ${fmt(top.distM, 0)} m` : '—'; })()} />
      </div>
      {sp.unpositioned > 0 && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">{sp.unpositioned} movement(s) have a zone with no station point and no cell shape, so their distance is counted as zero. Set zone positions in Tab 1.</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Movement Register" guide="moveDistance" pad={false} right={<div className="w-40"><Select value={moveView} onChange={setMoveView} ariaLabel="Movement filter" options={[{ value: 'all', label: 'All movements' }, { value: 'Inter-Cell', label: 'Inter-cell only' }, { value: 'Intra-Cell', label: 'Intra-cell only' }]} /></div>}>
          <div className="scroll-thin overflow-auto" style={{ maxHeight: 440 }}>
            <table className="w-full min-w-max border-separate border-spacing-0">
              <thead className="sticky top-0 z-10"><tr><Th guide="opId">Op #</Th><Th guide="origin">From</Th><Th guide="destination">To</Th><Th guide="movement">Type</Th><Th guide="tagVehicles">Vehicle</Th><Th right guide="moveCount">Moves</Th><Th right guide="moveDistance">m / move</Th><Th right guide="spaghetti">Current m</Th><Th right guide="spaghettiFuture">Future m</Th></tr></thead>
              <tbody>
                {moves.map((x) => (
                  <tr key={x.leafId} className="hover:bg-slate-50" title={x.description}>
                    <td className="td-ro font-mono text-[12px] font-medium text-slate-900">{x.opId}</td>
                    <td className="td-ro max-w-[190px] truncate text-slate-700">{zoneName(x.fromZoneId)}</td>
                    <td className="td-ro max-w-[190px] truncate text-slate-700">{zoneName(x.toZoneId)}</td>
                    <td className="td-ro"><Pill tone={x.type === 'Inter-Cell' ? 'blue' : 'outline'}>{x.type}</Pill></td>
                    <td className="td-ro max-w-[170px] truncate text-slate-600">{x.vehicleIds.map(resName).join(', ') || <span className="text-slate-400">manual</span>}</td>
                    <td className="td-ro text-right">{fmtInt(x.moves)}</td>
                    <td className="td-ro text-right">{fmt(x.distM, 1)}</td>
                    <td className="td-ro text-right font-medium text-slate-900">{fmtInt(x.moves * (x.distM ?? 0))}</td>
                    <td className="td-ro text-right">{fmtInt(x.moves * (x.futureDistM ?? 0))}</td>
                  </tr>
                ))}
                {!moves.length && <tr><td colSpan={9} className="td-ro py-6 text-center text-slate-500">No movements in the current Spine Filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="From–To Movement Matrix (moves per build)" guide="odMatrix" pad={false}>
            <div className="scroll-thin overflow-auto">
              <table className="w-full">
                <thead><tr><Th>From ↓ / To →</Th>{cells.map((c) => <Th key={c.id} right>C{c.number}</Th>)}<Th right>Out</Th></tr></thead>
                <tbody>
                  {cells.map((a) => (
                    <tr key={a.id}>
                      <td className="td-ro whitespace-nowrap"><b className="text-slate-900">C{a.number}</b> <span className="text-[11.5px] text-slate-500">{a.name}</span></td>
                      {cells.map((b) => {
                        const n = od(a.id, b.id);
                        const shade = n ? 0.08 + 0.5 * (n / odMax) : 0;
                        return <td key={b.id} className="td-ro text-right" title={`Cell ${a.number} → Cell ${b.number}: ${n} move(s)`} style={{ backgroundColor: n ? `rgba(51,65,85,${shade})` : undefined, color: shade > 0.4 ? '#fff' : undefined, outline: a.id === b.id ? '1px dashed #cbd5e1' : undefined, outlineOffset: -2 }}>{n || <span className="text-slate-300">·</span>}</td>;
                      })}
                      <td className="td-ro text-right font-medium text-slate-900">{cells.reduce((s, b) => s + od(a.id, b.id), 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Dashed diagonal = intra-cell movement. Darker = more moves.</div>
          </Card>
          <Card title="Moves by Vehicle" guide="tagVehicles">
            <div className="space-y-2">
              {[...vehicles.map((x) => ({ name: x.v.name, moves: x.moves, dist: x.dist })), { name: 'Manual / no vehicle tagged', moves: manual.reduce((a, x) => a + x.moves, 0), dist: manual.reduce((a, x) => a + x.moves * (x.distM ?? 0), 0) }].map((x) => {
                const max = Math.max(1, ...vehicles.map((v) => v.moves), manual.reduce((a, y) => a + y.moves, 0));
                return (
                  <div key={x.name} title={`${x.name}: ${x.moves} move(s), ${fmtInt(x.dist)} m`}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]"><span className="truncate text-slate-800">{x.name}</span><span className="shrink-0 tabular-nums text-slate-600">{fmtInt(x.moves)} moves · {fmtInt(x.dist)} m</span></div>
                    <div className="mt-0.5 h-2 w-full rounded-sm bg-slate-100"><div className="h-2 rounded-sm bg-slate-600" style={{ width: `${(x.moves / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11.5px] text-slate-500">A movement tagged with two vehicles is counted against both. Cell numbers: {cells.map((c) => `C${cellNo(c.id)}`).join(', ')}.</p>
          </Card>
        </div>
      </div>

      <ComponentRegisterCard className="mt-4" />
    </div>
  );
}
