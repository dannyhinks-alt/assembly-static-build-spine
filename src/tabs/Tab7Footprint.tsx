import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, HowItWorks, Kpi, Meter, NumInput, Pill, RagBadge, Select, Th, Tip } from '../components/primitives';
import { polygonArea } from '../lib/geometry';
import { RAG_HEX, fmt, fmtInt, fmtPct, ragRank } from '../lib/format';
import { useStore } from '../store';
import type { Rag } from '../types';
import { FLOOR_LEVELS, floorClaimM2 } from '../types';
import { DualViewLayoutCard } from '../components/DualViewLayoutCard';

export default function Tab7Footprint() {
  const { ws, mutate, model: m } = useStore();
  const { lengthM: L, widthM: W } = ws.settings.envelope;
  const cells = useMemo(() => [...ws.cells].sort((a, b) => a.number - b.number), [ws.cells]);
  const [view, setView] = useState<'factory' | 'cell'>('factory');
  const [cellId, setCellId] = useState(cells[0]?.id ?? '');
  useEffect(() => {
    if (!cellId || !cells.find((c) => c.id === cellId)) setCellId(cells[0]?.id ?? '');
  }, [cells, cellId]);
  const [showElev, setShowElev] = useState(true);
  const [elevImgMode, setElevImgMode] = useState<'behind' | 'side'>('behind');
  const elevImgRef = useRef<HTMLInputElement>(null);
  const sideElevImage = ws.layout.sideElevationImage ?? null;
  const sp = m.space;
  const saving = sp.spaghettiM ? (1 - sp.spaghettiFutureM / sp.spaghettiM) * 100 : 0;
  const cellArea = (id: string) => ws.layout.shapes.filter((s) => s.target === `cell:${id}`).reduce((a, s) => a + polygonArea(s.points), 0);

  const pinch = useMemo(() => ws.zones.map((z) => {
    const lifts = m.lifts.filter((l) => l.zoneId === z.id && (l.highElevation || l.hookBreach || l.hookMarginM < 0.15));
    const vertical = sp.clashes.filter((c) => c.zoneId === z.id && c.kind === 'lift-vertical');
    const rag: Rag = lifts.some((l) => l.hookBreach) ? 'red' : vertical.length || lifts.some((l) => l.hookMarginM < 0.15) ? 'serious' : 'amber';
    const lines = [...lifts.map((l) => `${l.opId}: ${l.hookBreach ? `hook-height breach ${fmt(-l.hookMarginM, 2)} m` : l.hookMarginM < 0.15 ? `hook margin only ${fmt(l.hookMarginM, 2)} m` : `elevated lift at ${FLOOR_LEVELS[l.floorLevel]}`}`), ...vertical.map((c) => `${c.ops.join(' + ')}: lift over / under occupied level`)];
    return { zone: z, count: lifts.length + vertical.length, rag, lines };
  }).filter((p) => p.count > 0), [ws.zones, m.lifts, sp.clashes]);
  const pinchTotal = pinch.reduce((a, p) => a + p.count, 0);
  const pinchRag = pinch.reduce<Rag>((w, p) => (ragRank(p.rag) > ragRank(w) ? p.rag : w), 'green');

  const total = ws.layout.floorAreaOverrideM2 ?? (L * W);
  const allocated = cells.reduce((a, c) => a + cellArea(c.id), 0) + ws.layout.shapes.filter((s) => s.target === 'stores' || s.target === 'dispatch').reduce((a, s) => a + polygonArea(s.points), 0);

  const stands = ws.resources.filter((r) => r.kind === 'stand' && m.lifts.some((l) => l.standIds.includes(r.id)));
  const [standSel, setStandSel] = useState('');
  const stand = stands.find((s) => s.id === standSel) ?? [...stands].sort((a, b) => m.lifts.filter((l) => l.standIds.includes(b.id)).length - m.lifts.filter((l) => l.standIds.includes(a.id)).length)[0];
  const sLifts = stand ? m.lifts.filter((l) => l.standIds.includes(stand.id)).sort((a, b) => a.startHrs - b.startHrs) : [];
  const tierH = stand?.tierHeightM ?? ws.settings.crane.defaultTierHeightM;
  const tiers = Math.max(stand?.tiers ?? 1, ...sLifts.map((l) => l.floorLevel));
  const hooksRaw = sLifts.map((l) => {
    const craneNames = l.craneIds.map((id) => ws.resources.find((r) => r.id === id)?.name ?? '').filter(Boolean).join(' + ') || 'Primary crane (Tab 1)';
    return [l.availableHookM, craneNames] as [number, string];
  });
  const hooks = [...new Map(hooksRaw).entries()];
  const zMax = Math.max(...sLifts.map((l) => Math.max(l.requiredHookM, l.availableHookM)), tiers * tierH + 1, 1) + 0.45;
  const EW = 1000, EH = 340, EL = 92, EB = 46, ET = 14;
  const ez = (z: number) => ET + (1 - z / zMax) * (EH - ET - EB);
  const colW = Math.min(70, (EW - EL - 150) / Math.max(1, sLifts.length) * 0.55);
  const ex = (i: number) => EL + 40 + ((i + 0.5) * (EW - EL - 190)) / Math.max(1, sLifts.length);

  return (
    <div>
      <HowItWorks tab="7" title="Footprint, Space & Dual-View Layout" steps={[
        'Dual view: Full Factory shows inter-cell flows between cells; Single Cell zooms to one cell and shows its intra-cell movement.',
        'Flows come from Tab 2: every activity with a Move Count or a different origin and destination zone. Line weight and the number on the line are moves per build.',
        'Spaghetti distance = Σ moves × one-way rectilinear distance between zone station points. Current uses today’s positions; Future uses the proposed positions you enter in the table.',
        'Switch between Current, Future or Both to overlay the two states; dashed blue lines and hollow markers are the future state.',
        '3D Pinch-Point overlay marks zones with elevated lifts, tight or breached hook margins, or lifts over an occupied level.',
        'The Side-Elevation X–Z window is a vertical section through a stand: floor levels, crane hook limits and every lift’s stack-up to scale.',
      ]} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Spaghetti — current" guide="spaghetti" value={fmtInt(sp.spaghettiM)} unit="m / build" sub={`${fmtInt(sp.interCellMoves + sp.intraCellMoves)} moves`} />
        <Kpi label="Spaghetti — future" guide="spaghettiFuture" value={fmtInt(sp.spaghettiFutureM)} unit="m / build" sub={`${fmtInt(ws.zones.filter((z) => z.futurePos).length)} zone(s) re-sited`} />
        <Kpi label="Future saving" guide="spaghettiFuture" value={fmtPct(saving, 0)} sub={`${fmtInt(sp.spaghettiM - sp.spaghettiFutureM)} m per build`} rag={saving >= 10 ? 'green' : saving > 0 ? 'amber' : undefined} />
        <Kpi label="Inter-cell distance" guide="moveDistance" value={fmtInt(sp.interCellM)} unit="m" sub={`${fmtInt(sp.intraCellM)} m intra-cell`} />
        <Kpi label="3D pinch points" guide="pinchOverlay" value={fmtInt(pinchTotal)} sub={`in ${fmtInt(pinch.length)} zone(s)`} rag={pinchTotal ? pinchRag : 'green'} />
        <Kpi label="Floor allocated" guide="envelope" value={fmtPct(total ? (allocated / total) * 100 : 0, 0)} sub={`${fmtInt(allocated)} of ${fmtInt(total)} m²`} />
      </div>

      <DualViewLayoutCard cells={cells} view={view} setView={setView} cellId={cellId} setCellId={setCellId} showElev={showElev} setShowElev={setShowElev} pinch={pinch} />

      {showElev && (
        <Card className="mt-4" title="2D Side-Elevation X–Z — Multi-Floor Stand & Crane Lift Window" guide="sideElevation"
          right={<>
            {stands.length > 0 && <div className="w-64"><Select value={stand?.id ?? ''} onChange={setStandSel} ariaLabel="Stand" options={stands.map((s) => ({ value: s.id, label: s.name }))} /></div>}
            <input ref={elevImgRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const reader = new FileReader();
              reader.onload = () => mutate((d) => { d.layout.sideElevationImage = reader.result as string; });
              reader.readAsDataURL(f);
              e.target.value = '';
            }} />
            <button className="btn" onClick={() => elevImgRef.current?.click()}>Upload Side-View Image (PNG / JPG)…</button>
            {sideElevImage && <>
              <button className="btn" title="Remove side-view image" onClick={() => mutate((d) => { d.layout.sideElevationImage = null; })}>Remove image</button>
              <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white" role="radiogroup" aria-label="Image display mode">
                {(['behind', 'side'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={elevImgMode === m} onClick={() => setElevImgMode(m)} className={`border-r border-slate-300 px-2 py-1 text-[12px] font-medium last:border-r-0 ${elevImgMode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{m === 'behind' ? 'Behind Chart' : 'Side-by-Side'}</button>
                ))}
              </div>
            </>}
          </>}>
          {!stand && !sideElevImage ? <Empty>No lifts are tagged to a stand in the current Spine Filter. Tag the stand on lift rows in Tab 2.</Empty> : (
            <>
              <div className={sideElevImage && elevImgMode === 'side' ? 'flex gap-4' : undefined}>
              {sideElevImage && elevImgMode === 'side' && <img src={sideElevImage} alt="Side-view reference" className="max-h-80 w-1/2 object-contain rounded border border-slate-200 self-start" />}
              {stand && <div className={`relative ${sideElevImage && elevImgMode === 'side' ? 'flex-1' : ''}`}>
              {sideElevImage && elevImgMode === 'behind' && <img src={sideElevImage} alt="Side-view reference" className="absolute inset-0 h-full w-full object-contain opacity-20 pointer-events-none" />}
              <svg viewBox={`0 0 ${EW} ${EH}`} className="w-full relative" role="img" aria-label={`Side elevation of ${stand.name}`}>
                {Array.from({ length: Math.floor(zMax) + 1 }, (_, i) => i).map((z) => (<g key={z}><line x1={EL} x2={EW - 120} y1={ez(z)} y2={ez(z)} stroke="#eef2f6" /><text x={EL - 54} y={ez(z) + 3.5} fontSize={11} textAnchor="end" fill="#94a3b8">{z} m</text></g>))}
                {Array.from({ length: tiers + 1 }, (_, k) => k).map((k) => (
                  <g key={k}>
                    <line x1={EL} x2={EW - 120} y1={ez(k * tierH)} y2={ez(k * tierH)} stroke={k === 0 ? '#0f172a' : '#64748b'} strokeWidth={k === 0 ? 2.5 : 1.5} />
                    <text x={EL - 6} y={ez(k * tierH) - 4} fontSize={11} fontWeight={600} textAnchor="end" fill="#334155">{FLOOR_LEVELS[k] ?? `L${k}`}</text>
                  </g>
                ))}
                <line x1={EL + 12} x2={EL + 12} y1={ez(0)} y2={ez(tiers * tierH)} stroke="#64748b" strokeWidth={3} />
                <line x1={EW - 132} x2={EW - 132} y1={ez(0)} y2={ez(tiers * tierH)} stroke="#64748b" strokeWidth={3} />
                {hooks.map(([h, name]) => (
                  <g key={h}>
                    <line x1={EL} x2={EW - 120} y1={ez(h)} y2={ez(h)} stroke="#0f172a" strokeWidth={1.5} strokeDasharray="7 5" />
                    <text x={EW - 116} y={ez(h) + 4} fontSize={11} fill="#0f172a" fontWeight={600}>Hook {fmt(h, 1)} m</text>
                    <text x={EW - 116} y={ez(h) + 17} fontSize={9.5} fill="#64748b">{name.length > 22 ? `${name.slice(0, 21)}…` : name}</text>
                  </g>
                ))}
                {sLifts.map((l, i) => {
                  const x = ex(i) - colW / 2;
                  const z1 = l.elevationM, z2 = z1 + l.compHeightM, z3 = z2 + l.headroomM, z4 = z3 + l.clearanceM;
                  const tip = `${l.opId} — ${l.description}\nLanding ${FLOOR_LEVELS[l.floorLevel]} at ${fmt(z1, 2)} m\n+ component ${fmt(l.compHeightM, 2)} m\n+ rigging headroom ${fmt(l.headroomM, 2)} m\n+ clearance ${fmt(l.clearanceM, 2)} m\n= ${fmt(l.requiredHookM, 2)} m required · ${fmt(l.availableHookM, 2)} m available · margin ${fmt(l.hookMarginM, 2)} m`;
                  return (
                    <g key={l.leafId}>
                      <title>{tip}</title>
                      <rect x={x} y={ez(z2)} width={colW} height={ez(z1) - ez(z2)} fill="#334155" rx={2} />
                      <rect x={x + colW * 0.3} y={ez(z3)} width={colW * 0.4} height={Math.max(0, ez(z2) - ez(z3) - 1.5)} fill="#64748b" />
                      <rect x={x} y={ez(z4)} width={colW} height={Math.max(0, ez(z3) - ez(z4) - 1.5)} fill="#e2e8f0" stroke="#cbd5e1" strokeDasharray="3 2" />
                      <line x1={x - 5} x2={x + colW + 5} y1={ez(l.requiredHookM)} y2={ez(l.requiredHookM)} stroke={l.hookBreach ? RAG_HEX.red : '#0f172a'} strokeWidth={l.hookBreach ? 3 : 1.5} />
                      {l.hookBreach && <text x={ex(i)} y={ez(l.requiredHookM) - 6} fontSize={11} fontWeight={700} textAnchor="middle" fill="#0f172a">✕ breach {fmt(-l.hookMarginM, 2)} m</text>}
                      <text x={ex(i)} y={EH - 26} fontSize={11} fontWeight={600} textAnchor="middle" fill="#0f172a" fontFamily="ui-monospace, monospace">{l.opId}</text>
                      <text x={ex(i)} y={EH - 12} fontSize={10} textAnchor="middle" fill="#64748b">{l.loadKg == null ? 'no weight' : `${fmtInt(l.loadKg)} kg`}</text>
                    </g>
                  );
                })}
              </svg>
              </div>}
              </div>
              {stand && <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-600">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: '#334155' }} />Component at landing level</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2 rounded-sm" style={{ backgroundColor: '#64748b' }} />Rigging headroom</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-200" />Clearance margin</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-slate-900" />Required hook height</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-900" />Crane hook limit</span>
                <span className="ml-auto">{stand.name}: {tiers} floor(s) at {fmt(tierH, 2)} m · {sLifts.length} lift op(s) · {sLifts.filter((l) => l.hookBreach).length} breach(es). Columns are in schedule order; hover for the stack-up.</span>
              </div>}
            </>
          )}
        </Card>
      )}

      <Card className="mt-4" title="Footprint & Space by Cell" guide="floorClaim" pad={false}>
        <div className="scroll-thin overflow-auto">
          <table className="w-full min-w-max">
            <thead><tr><Th>Cell</Th><Th right guide="shapeArea">Area m²</Th><Th right>Share of factory</Th><Th right guide="floorClaim">Equipment claim m²</Th><Th guide="floorClaim">Claimed</Th><Th right>Free m²</Th><Th right guide="cellCrew">Crew / shift</Th><Th right>m² per operator</Th><Th guide="spaceVerdict">Space verdict</Th><Th right guide="pinchOverlay">Pinch points</Th><Th>Zones</Th></tr></thead>
            <tbody>
              {cells.map((c) => {
                const area = cellArea(c.id);
                const claim = ws.resources.filter((r) => r.cellId === c.id).reduce((a, r) => a + floorClaimM2(r), 0);
                const pct = area ? (claim / area) * 100 : null;
                const pp = pinch.filter((p) => p.zone.cellId === c.id).reduce((a, p) => a + p.count, 0);
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => { setCellId(c.id); setView('cell'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} title="Click to open the single-cell view">
                    <td className="td-ro"><b className="text-slate-900">Cell {c.number}</b> <span className="text-slate-600">{c.name}</span></td>
                    <td className="td-ro text-right">{area ? fmtInt(area) : '—'}</td>
                    <td className="td-ro text-right">{area ? fmtPct((area / total) * 100, 0) : '—'}</td>
                    <td className="td-ro text-right">{fmt(claim, 1)}</td>
                    <td className="td-ro" style={{ minWidth: 150 }}>{pct == null ? <span className="text-slate-400">no shape</span> : <span className="flex items-center gap-2"><span className="w-10 text-right tabular-nums">{fmtPct(pct, 0)}</span><Meter pct={pct} rag={pct > 80 ? 'red' : pct > 60 ? 'amber' : 'green'} ticks={[60]} max={100} /></span>}</td>
                    <td className="td-ro text-right">{area ? fmtInt(area - claim) : '—'}</td>
                    <td className="td-ro text-right">{fmtInt(c.crewPerShift)}</td>
                    <td className="td-ro text-right">{area && c.crewPerShift ? fmtInt((area - claim) / c.crewPerShift) : '—'}</td>
                    <td className="td-ro">{(() => { if (!area) return <span className="text-slate-400">no shape</span>; const pct2 = (claim / area) * 100; if (pct2 > 90) return <RagBadge rag="red" label="Over-committed" />; if (pct2 > 70) return <RagBadge rag="amber" label="Tight" />; if (pct2 > 20) return <RagBadge rag="green" label="Adequate" />; return <Pill tone="outline">Under-utilised</Pill>; })()}</td>
                    <td className="td-ro text-right">{pp ? <RagBadge rag={pinch.filter((p) => p.zone.cellId === c.id).reduce<Rag>((w, p) => (ragRank(p.rag) > ragRank(w) ? p.rag : w), 'green')} label={String(pp)} /> : <span className="text-slate-400">0</span>}</td>
                    <td className="td-ro text-[12px] text-slate-600">{ws.zones.filter((z) => z.cellId === c.id).map((z) => z.name.split('·')[0].trim()).join(', ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span>Equipment claim = footprint × quantity of resources homed in the cell (Tab 3). Cell shapes are drawn or imported in Tab 1. <b>Under-utilised</b> cells (&lt;20% claimed) carry a hidden consolidation opportunity — fewer large cells reduce gangway walk distances. <Tip id="spaceVerdict" /></span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Pill tone="outline">Boundary {fmt(L, 0)} × {fmt(W, 0)} m</Pill>
            <Pill tone="outline">{fmtInt(total - allocated)} m² gangways &amp; unallocated</Pill>
            <span className="flex items-center gap-1">
              <span className="text-slate-500">Floor area override m²</span>
              <NumInput nullable value={ws.layout.floorAreaOverrideM2 ?? null} min={0} onChange={(v) => mutate((d) => { d.layout.floorAreaOverrideM2 = v; })} ariaLabel="Total factory floor area override m²" />
            </span>
          </span>
        </div>
      </Card>
    </div>
  );
}
