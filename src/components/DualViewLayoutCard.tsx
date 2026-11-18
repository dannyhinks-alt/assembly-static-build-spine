// Dual-View spaghetti layout card for Tab 7 — Full Factory and Single Cell modes.
import { useMemo, useState } from 'react';
import { Card, Empty, NumInput, Select, Th, Tip } from './primitives';
import { intraZoneAllowanceM, zonePoint } from '../engine/space';
import { RAG_HEX, fmt, fmtInt } from '../lib/format';
import { useStore } from '../store';
import type { Cell, Pt, Rag, Zone } from '../types';

const CUR = '#334155';
const FUT = '#0369a1';

interface PinchPoint { zone: Zone; count: number; rag: Rag; lines: string[] }

interface DualViewLayoutCardProps {
  cells: Cell[];
  view: 'factory' | 'cell';
  setView: (v: 'factory' | 'cell') => void;
  cellId: string;
  setCellId: (id: string) => void;
  showElev: boolean;
  setShowElev: (v: boolean) => void;
  pinch: PinchPoint[];
}

/**
 * Purpose: Renders the Dual-View spaghetti layout card, unpositioned zone warning,
 *   and zone/flow co-ordinate table for Tab 7.
 *
 * Formula: spaghetti distance = Σ(moves × one-way distance between zone station points).
 *
 * Downstream impact: surfaces movement data from m.space and ws.zones; future positions
 *   written here feed Tab 9's movement saving KPI.
 */
export function DualViewLayoutCard({ cells, view, setView, cellId, setCellId, showElev, setShowElev, pinch }: DualViewLayoutCardProps) {
  const { ws, mutate, model: m, setTab } = useStore();
  const sp = m.space;
  const { lengthM: L, widthM: W } = ws.settings.envelope;
  const [state, setState] = useState<'current' | 'future' | 'both'>('both');
  const [showFlows, setShowFlows] = useState(true);
  const [showPinch, setShowPinch] = useState(true);
  const zoneName = (id: string) => ws.zones.find((z) => z.id === id)?.name ?? '—';
  const zoneCell = (id: string) => ws.zones.find((z) => z.id === id)?.cellId ?? '';
  const cellShape = (id: string) => ws.layout.shapes.find((s) => s.target === `cell:${id}`);

  const flows = useMemo(() => {
    const map = new Map<string, { from: string; to: string; moves: number; dist: number | null; fut: number | null; ops: string[]; inter: boolean }>();
    for (const x of sp.moves) {
      const k = `${x.fromZoneId}>${x.toZoneId}`;
      const f = map.get(k) ?? { from: x.fromZoneId, to: x.toZoneId, moves: 0, dist: x.distM, fut: x.futureDistM, ops: [], inter: x.type === 'Inter-Cell' };
      f.moves += x.moves; f.ops.push(x.opId); map.set(k, f);
    }
    return [...map.values()].sort((a, b) => b.moves * (b.dist ?? 0) - a.moves * (a.dist ?? 0));
  }, [sp.moves]);

  const inView = (f: (typeof flows)[number]) => (view === 'factory' ? f.inter : zoneCell(f.from) === cellId && zoneCell(f.to) === cellId);
  const shown = flows.filter(inView);
  const maxMoves = Math.max(1, ...shown.map((f) => f.moves));
  const tot = (fs: typeof flows, key: 'dist' | 'fut') => fs.reduce((a, f) => a + f.moves * (f[key] ?? 0), 0);

  const shape = cellShape(cellId);
  let vb = { x: -3, y: -3, w: L + 6, h: W + 6 };
  if (view === 'cell') {
    const cellShapes = ws.layout.shapes.filter((s) => s.target === `cell:${cellId}`);
    const zonePositions = ws.zones.filter((z) => z.cellId === cellId).map((z) => pt(z.id, false)).filter((p): p is [number, number] => p !== null);
    const allPts: [number, number][] = [...cellShapes.flatMap((s) => s.points as [number, number][]), ...zonePositions];
    if (allPts.length) {
      const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
      const pad = Math.max(2, 0.12 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
      vb = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
    }
  }
  const u = vb.w / 900;
  const pt = (zoneId: string, future: boolean): Pt | null => zonePoint(ws, zoneId, future);
  const curve = (a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const k = 0.14;
    const c: Pt = [(a[0] + b[0]) / 2 - (dy / len) * len * k, (a[1] + b[1]) / 2 + (dx / len) * len * k];
    return { d: `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`, mid: [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4] as Pt };
  };
  const drawFlows = (future: boolean) => shown.map((f) => {
    const a = pt(f.from, future), b = pt(f.to, future);
    if (!a || !b) return null;
    const colour = future ? FUT : CUR;
    const wgt = u * (1.4 + 4.5 * (f.moves / maxMoves));
    const d = future ? f.fut : f.dist;
    const tip = `${zoneName(f.from)} → ${zoneName(f.to)}\n${f.moves} move(s) × ${fmt(d, 1)} m = ${fmtInt(f.moves * (d ?? 0))} m (${future ? 'future' : 'current'})\nOps: ${f.ops.join(', ')}`;
    if (f.from === f.to) {
      const r = u * (9 + 10 * (f.moves / maxMoves));
      return <g key={`${f.from}${future}`}><circle cx={a[0]} cy={a[1]} r={r} fill="none" stroke={colour} strokeWidth={wgt * 0.6} strokeDasharray={future ? `${u * 5} ${u * 4}` : undefined} opacity={0.8}><title>{tip}</title></circle></g>;
    }
    const c = curve(a, b);
    return (
      <g key={`${f.from}>${f.to}${future}`}>
        <path d={c.d} fill="none" stroke={colour} strokeWidth={wgt} strokeLinecap="round" strokeDasharray={future ? `${u * 7} ${u * 5}` : undefined} opacity={future ? 0.85 : 0.75} markerEnd={`url(#arr-${future ? 'f' : 'c'})`}><title>{tip}</title></path>
        <path d={c.d} fill="none" stroke="transparent" strokeWidth={u * 14}><title>{tip}</title></path>
        {!future && <text x={c.mid[0]} y={c.mid[1] + u * 3.5} fontSize={u * 10} textAnchor="middle" fontWeight={600} fill="#0f172a" paintOrder="stroke" stroke="#fff" strokeWidth={u * 3} pointerEvents="none">{f.moves}</text>}
      </g>
    );
  });
  const zonesInView = ws.zones.filter((z) => view === 'factory' || z.cellId === cellId);
  const setFuture = (z: Zone, axis: 0 | 1, v: number | null) => mutate((d) => {
    const x = d.zones.find((y) => y.id === z.id)!;
    const base = x.futurePos ?? zonePoint(ws, z.id, false) ?? [0, 0];
    const next: [number, number] = [base[0], base[1]];
    if (v == null) { x.futurePos = null; return; }
    next[axis] = v; x.futurePos = next;
  });
  const flowingZoneIds = useMemo(() => new Set(sp.moves.flatMap((mv) => [mv.fromZoneId, mv.toZoneId])), [sp.moves]);
  const unpositioned = useMemo(() => ws.zones.filter((z) => !zonePoint(ws, z.id, false) && flowingZoneIds.has(z.id)), [ws, flowingZoneIds]);
  const autoPlace = () => {
    const toPlace = ws.zones.filter((z) => !z.pos && !ws.layout.shapes.find((s) => s.target === `cell:${z.cellId}`));
    if (!toPlace.length) return;
    const cols = Math.ceil(Math.sqrt(toPlace.length));
    const rows = Math.ceil(toPlace.length / cols);
    mutate((d) => { toPlace.forEach((z, i) => { const col = i % cols, row = Math.floor(i / cols); const x = +(L / (cols + 1) * (col + 1)).toFixed(1); const y = +(W / (rows + 1) * (row + 1)).toFixed(1); d.zones.find((q) => q.id === z.id)!.pos = [x, y]; }); });
  };

  return (
    <>
      {unpositioned.length > 0 && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <div className="flex-1"><span className="font-semibold">Spaghetti Flow Readiness <Tip id="flowReadiness" /></span>{' — '}<span>{unpositioned.length} zone{unpositioned.length > 1 ? 's' : ''} in BOP move data have no (X, Y) station point and will be invisible on the diagram: </span><span className="font-mono">{unpositioned.map((z) => z.name.split('·')[0].trim()).join(', ')}</span><span>. Set positions in Tab 1 or use the auto-place helper.</span></div>
          <button className="btn shrink-0 border-amber-400 bg-amber-100 hover:bg-amber-200" onClick={autoPlace}>Auto-Place Unpositioned Zones on Grid</button>
        </div>
      )}
      <Card title="Dual-View Layout" guide="viewMode" pad={false} right={<>
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white" role="radiogroup" aria-label="Layout view">
          {([['factory', 'Full Factory · Inter-Cell'], ['cell', 'Single Cell · Intra-Cell']] as const).map(([v, label]) => { const disabled = v === 'cell' && cells.length === 0; return <button key={v} role="radio" aria-checked={view === v} disabled={disabled} title={disabled ? 'Add at least one Cell in Tab 1 first' : undefined} onClick={() => setView(v)} className={`border-r border-slate-300 px-2.5 py-1 text-[12px] font-medium last:border-r-0 ${view === v ? 'bg-slate-900 text-white' : disabled ? 'cursor-not-allowed text-slate-400' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>; })}
        </div>
        {view === 'cell' && <div className="w-56"><Select value={cellId} onChange={setCellId} ariaLabel="Cell" options={cells.map((c) => ({ value: c.id, label: `Cell ${c.number} · ${c.name}` }))} /></div>}
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white" role="radiogroup" aria-label="Layout state">
          {(['current', 'future', 'both'] as const).map((v) => (<button key={v} role="radio" aria-checked={state === v} onClick={() => setState(v)} className={`border-r border-slate-300 px-2.5 py-1 text-[12px] font-medium capitalize last:border-r-0 ${state === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{v}</button>))}
        </div>
        <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={showFlows} onChange={(e) => setShowFlows(e.target.checked)} />Material Flows (Spaghetti)<Tip id="flowReadiness" /></label>
        <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={showPinch} onChange={(e) => setShowPinch(e.target.checked)} />3D pinch points<Tip id="pinchOverlay" /></label>
        <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={showElev} onChange={(e) => setShowElev(e.target.checked)} />Side elevation<Tip id="sideElevation" /></label>
      </>}>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_450px]">
          <div className="border-b border-slate-200 xl:border-b-0 xl:border-r">
            {view === 'cell' && !shape && ws.zones.filter((z) => z.cellId === cellId).every((z) => !pt(z.id, false)) ? <div className="p-4"><Empty>This cell has no shape or zone positions on the floor plan yet. Draw shapes or set zone co-ordinates in Tab 1.</Empty></div> : (
              <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block w-full" style={{ maxHeight: 560, aspectRatio: `${vb.w} / ${vb.h}` }} role="img" aria-label="Floor plan with movement flows">
                <defs><marker id="arr-c" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill={CUR} /></marker><marker id="arr-f" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill={FUT} /></marker></defs>
                <rect x={0} y={0} width={L} height={W} fill="#fff" stroke="#334155" strokeWidth={u * 1.6} />
                {ws.layout.shapes.map((s) => { const mine = s.target === `cell:${cellId}`; const dim = view === 'cell' && !mine && !(s.target === 'stand' || s.target === 'stores' || s.target === 'dispatch'); const x0 = Math.min(...s.points.map((p) => p[0])), y0 = Math.min(...s.points.map((p) => p[1])); const sub = !s.target.startsWith('cell:'); return (<g key={s.id} opacity={dim ? 0.35 : 1}><polygon points={s.points.map((p) => p.join(',')).join(' ')} fill={sub ? '#0f172a0d' : '#f1f5f9'} stroke={sub ? '#64748b' : '#94a3b8'} strokeWidth={u * (mine && view === 'cell' ? 2.2 : 1.1)} strokeDasharray={sub ? `${u * 4} ${u * 3}` : undefined} /><text x={x0 + u * 5} y={y0 + u * 13} fontSize={u * 10} fontWeight={600} fill="#475569">{s.label}</text></g>); })}
                {showFlows && state !== 'future' && drawFlows(false)}
                {showFlows && state !== 'current' && drawFlows(true)}
                {zonesInView.map((z) => { const a = pt(z.id, false); const b = z.futurePos && state !== 'current' ? z.futurePos : null; if (!a) return null; return (<g key={z.id}>{b && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={FUT} strokeWidth={u * 0.9} strokeDasharray={`${u * 2} ${u * 3}`} />}{b && <circle cx={b[0]} cy={b[1]} r={u * 5} fill="#fff" stroke={FUT} strokeWidth={u * 1.8}><title>{`${z.name} — future position (${fmt(b[0], 1)}, ${fmt(b[1], 1)}) m`}</title></circle>}{state !== 'future' || !b ? <circle cx={a[0]} cy={a[1]} r={u * 5} fill={CUR} stroke="#fff" strokeWidth={u * 1.5}><title>{`${z.name} — current position (${fmt(a[0], 1)}, ${fmt(a[1], 1)}) m`}</title></circle> : null}<text x={(state === 'future' && b ? b : a)[0] + u * 8} y={(state === 'future' && b ? b : a)[1] - u * 7} fontSize={u * 10} fill="#0f172a" paintOrder="stroke" stroke="#fff" strokeWidth={u * 3}>{z.name.split('·')[0].trim()}</text></g>); })}
                {showPinch && pinch.filter((p) => view === 'factory' || p.zone.cellId === cellId).map((p) => { const a = pt(p.zone.id, state === 'future'); if (!a) return null; const cx = a[0] - u * 16, cy = a[1] + u * 16, r = u * 11; return (<g key={p.zone.id}><title>{`3D pinch points — ${p.zone.name}\n${p.lines.join('\n')}`}</title><path d={`M${cx},${cy - r} L${cx + r},${cy + r * 0.8} L${cx - r},${cy + r * 0.8} Z`} fill={RAG_HEX[p.rag]} stroke="#fff" strokeWidth={u * 2} strokeLinejoin="round" /><text x={cx} y={cy + r * 0.5} fontSize={u * 10} fontWeight={700} textAnchor="middle" fill="#fff">{p.count}</text></g>); })}
              </svg>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-600">
              <span className="flex items-center gap-1"><span className="inline-block h-0 w-6 border-t-[3px]" style={{ borderColor: CUR }} />Current flow</span>
              <span className="flex items-center gap-1"><span className="inline-block h-0 w-6 border-t-[3px] border-dashed" style={{ borderColor: FUT }} />Future flow</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CUR }} />Zone station</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: FUT }} />Future station</span>
              <span className="flex items-center gap-1"><span className="text-[13px] leading-none" style={{ color: RAG_HEX.serious }}>▲</span>Pinch point (count)</span>
              <span className="ml-auto tabular-nums">{view === 'factory' ? 'Inter-cell' : 'Intra-cell'} in view: <b className="text-slate-900">{fmtInt(tot(shown, 'dist'))} m</b> current · <b className="text-slate-900">{fmtInt(tot(shown, 'fut'))} m</b> future</span>
            </div>
          </div>
          <div className="scroll-thin max-h-[600px] overflow-auto">
            <table className="w-full"><thead className="sticky top-0 z-10"><tr><Th>Zone</Th><Th right>Current x, y</Th><Th right guide="zonePos">Future x</Th><Th right>Future y</Th><Th /></tr></thead>
              <tbody>{zonesInView.map((z) => { const a = pt(z.id, false); return (<tr key={z.id} className="hover:bg-slate-50"><td className="td-ro max-w-[130px] truncate text-slate-800" title={z.name}>{z.name}</td><td className="td-ro whitespace-nowrap text-right text-slate-600">{a ? `${fmt(a[0], 1)}, ${fmt(a[1], 1)}` : '—'}</td><td className="td w-[64px]"><NumInput cell nullable value={z.futurePos?.[0] ?? null} onChange={(v) => setFuture(z, 0, v)} ariaLabel={`${z.name} future X`} /></td><td className="td w-[64px]"><NumInput cell nullable value={z.futurePos?.[1] ?? null} onChange={(v) => setFuture(z, 1, v)} ariaLabel={`${z.name} future Y`} /></td><td className="td w-7">{z.futurePos && <button className="btn-ghost" title="Clear future position" onClick={() => mutate((d) => { d.zones.find((y) => y.id === z.id)!.futurePos = null; })}>✕</button>}</td></tr>); })}</tbody>
            </table>
            <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Type a Future X or Y to re-site a zone; the plan and distances update at once. Current positions are edited in <button className="underline hover:text-slate-800" onClick={() => setTab(1)}>Tab 1</button>.</p>
            <table className="w-full border-t border-slate-200"><thead><tr><Th>Flow</Th><Th right guide="moveCount">Moves</Th><Th right guide="spaghetti">Current m</Th><Th right guide="spaghettiFuture">Future m</Th></tr></thead>
              <tbody>{shown.map((f) => (<tr key={`${f.from}>${f.to}`} className="hover:bg-slate-50" title={`Ops: ${f.ops.join(', ')}`}><td className="td-ro text-[12px] text-slate-800">{zoneName(f.from).split('·')[0].trim()} → {zoneName(f.to).split('·')[0].trim()}</td><td className="td-ro text-right">{fmtInt(f.moves)}</td><td className="td-ro text-right font-medium text-slate-900">{fmtInt(f.moves * (f.dist ?? 0))}</td><td className="td-ro text-right">{fmtInt(f.moves * (f.fut ?? 0))}</td></tr>))}{!shown.length && <tr><td colSpan={4} className="td-ro py-5 text-center text-slate-500">No {view === 'factory' ? 'inter-cell' : 'intra-cell'} movement in this view.</td></tr>}</tbody>
            </table>
            {view === 'cell' && <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">Moves that stay inside one zone are drawn as a ring and use an allowance of {fmt(intraZoneAllowanceM(ws, cellId), 1)} m each (half the side of an equivalent square cell).</p>}
          </div>
        </div>
      </Card>
    </>
  );
}
