// Deep Movement & Lift Breakdown and PFMEA Risk Profile cards for the Executive Summary.
import { Card } from './primitives';
import { RagBadge } from './primitives';
import { RAG_HEX, RAG_LABEL, fmtInt, fmtPct } from '../lib/format';
import { controlDocMissing, isBlindSpot, rpnOf, rpnRag } from '../engine/gates';
import type { Model } from '../engine/model';
import type { Rag, Workspace } from '../types';

/** Horizontal proportional bar used in Executive Summary risk cards. */
function Bar({ label, value, max, text, colour = '#475569', title }: { label: string; value: number; max: number; text: string; colour?: string; title?: string }) {
  return (
    <div title={title ?? `${label}: ${text}`}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]"><span className="truncate text-slate-800">{label}</span><span className="shrink-0 tabular-nums text-slate-600">{text}</span></div>
      <div className="mt-0.5 h-2 w-full rounded-sm bg-slate-100"><div className="h-2 rounded-sm" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, backgroundColor: colour }} /></div>
    </div>
  );
}

interface ExecutiveRiskCardsProps {
  ws: Workspace;
  m: Model;
  setTab: (n: number) => void;
}

/**
 * Purpose: Renders the Deep Movement & Lift Breakdown and PFMEA Risk Profile cards
 *   for the Executive Summary tab.
 *
 * Downstream impact: consumes m.lifts, m.space, ws.pfmea, ws.resources
 *   to surface safety-critical counters that gate release decisions.
 */
export function ExecutiveRiskCards({ ws, m, setTab }: ExecutiveRiskCardsProps) {
  const sp = m.space;
  const th = ws.settings.thresholds;
  const inScope = new Set(m.fpds.map((f) => f.fpdId));
  const openPf = ws.pfmea.filter((p) => p.status !== 'Closed' && (!p.fpdId || inScope.has(p.fpdId)));
  const band = (r: Rag) => openPf.filter((p) => rpnRag(rpnOf(p), ws.settings) === r).length;
  const nLift = (f: (l: (typeof m.lifts)[number]) => boolean) => m.lifts.filter(f).length;
  const liftRows: [string, number][] = [
    ['Heavy', nLift((l) => l.heavy)], ['Multi-person', nLift((l) => l.multiPerson)],
    ['Complex', nLift((l) => l.complex)], ['Multi-tool / tandem', nLift((l) => l.multiTool)],
    ['3D elevation', nLift((l) => l.highElevation)],
    ['Above 90% SWL', nLift((l) => l.utilPct != null && l.utilPct > 90)],
    ['Hook-height breach', nLift((l) => l.hookBreach)],
  ];
  const vehicles = ws.resources
    .filter((r) => r.kind === 'vehicle')
    .map((v) => ({ name: v.name, moves: sp.moves.filter((x) => x.vehicleIds.includes(v.id)).reduce((a, x) => a + x.moves, 0) }))
    .filter((v) => v.moves > 0);
  const sev = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    .map((s) => ({ s, n: openPf.filter((p) => p.s === s).length }))
    .filter((x) => x.n > 0 || x.s >= 7);
  const saving = sp.spaghettiM ? (1 - sp.spaghettiFutureM / sp.spaghettiM) * 100 : 0;
  return (
    <>
      <Card title="Deep Movement & Lift Breakdown" guide="moveBreakdown">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="lbl mb-1.5">Lift operations by flag ({m.lifts.length} ops · {m.totals.lifts} lifts)</div>
            <div className="space-y-1.5">{liftRows.map(([label, n]) => <Bar key={label} label={label} value={n} max={Math.max(1, m.lifts.length)} text={`${n} op${n === 1 ? '' : 's'}`} colour={label === 'Hook-height breach' && n ? RAG_HEX.red : label === 'Above 90% SWL' && n ? RAG_HEX.serious : '#475569'} />)}</div>
          </div>
          <div>
            <div className="lbl mb-1.5">Movement ({fmtInt(sp.interCellMoves + sp.intraCellMoves)} moves)</div>
            <div className="space-y-1.5">
              <Bar label="Inter-cell moves" value={sp.interCellMoves} max={sp.interCellMoves + sp.intraCellMoves} text={`${fmtInt(sp.interCellMoves)} · ${fmtInt(sp.interCellM)} m`} />
              <Bar label="Intra-cell moves" value={sp.intraCellMoves} max={sp.interCellMoves + sp.intraCellMoves} text={`${fmtInt(sp.intraCellMoves)} · ${fmtInt(sp.intraCellM)} m`} />
              {vehicles.map((v) => <Bar key={v.name} label={v.name} value={v.moves} max={sp.interCellMoves + sp.intraCellMoves} text={`${fmtInt(v.moves)} moves`} colour="#94a3b8" />)}
            </div>
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] tabular-nums text-slate-700">
              Spaghetti distance <b className="text-slate-900">{fmtInt(sp.spaghettiM)} m</b> current → <b className="text-slate-900">{fmtInt(sp.spaghettiFutureM)} m</b> future ({fmtPct(saving, 0)} saving) · {sp.clashes.length} spatial clash(es)
            </div>
          </div>
        </div>
        <div className="mt-2 flex gap-2"><button className="btn-ghost" onClick={() => setTab(4)}>Lift &amp; movement detail →</button><button className="btn-ghost" onClick={() => setTab(7)}>Layout view →</button></div>
      </Card>

      <Card title="PFMEA Risk Profile" guide="pfmeaProfile">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="lbl mb-1.5">Open failure modes by RPN band ({openPf.length})</div>
            <div className="space-y-1.5">
              {(['red', 'serious', 'amber', 'green'] as Rag[]).map((r) => (
                <div key={r} className="grid grid-cols-[84px_minmax(0,1fr)_24px] items-center gap-2" title={`${RAG_LABEL[r]}: ${band(r)} open failure mode(s)`}>
                  <RagBadge rag={r} />
                  <span className="h-3 rounded-sm bg-slate-100"><span className="block h-3 rounded-sm" style={{ width: `${openPf.length ? (band(r) / openPf.length) * 100 : 0}%`, backgroundColor: RAG_HEX[r] }} /></span>
                  <span className="text-right text-[12px] tabular-nums text-slate-800">{band(r)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-[12px] text-slate-700">
              <div className="flex justify-between"><span>Closed</span><b className="tabular-nums text-slate-900">{ws.pfmea.filter((p) => p.status === 'Closed' && (!p.fpdId || inScope.has(p.fpdId))).length}</b></div>
              <div className="flex justify-between"><span>High-severity blind spots (S ≥ {th.blindSpotSeverity}, Green RPN)</span><b className="tabular-nums text-slate-900">{openPf.filter((p) => isBlindSpot(p, ws.settings)).length}</b></div>
              <div className="flex justify-between"><span>Required control documents missing</span><b className="tabular-nums text-slate-900">{openPf.filter((p) => controlDocMissing(p, ws.settings)).length}</b></div>
            </div>
          </div>
          <div>
            <div className="lbl mb-1.5">Open failure modes by Severity</div>
            <div className="space-y-1">
              {sev.map((x) => <Bar key={x.s} label={`Severity ${x.s}${x.s >= th.blindSpotSeverity ? ' · watch' : ''}`} value={x.n} max={Math.max(1, ...sev.map((y) => y.n))} text={String(x.n)} colour={x.s >= th.blindSpotSeverity ? '#0f172a' : '#94a3b8'} />)}
            </div>
          </div>
        </div>
        <div className="mt-2"><button className="btn-ghost" onClick={() => setTab(5)}>PFMEA register →</button></div>
      </Card>
    </>
  );
}
