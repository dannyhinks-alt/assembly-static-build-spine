// CPM Gantt chart card for Tab 6 — Early-Start Schedule with tooltip.
import { useState } from 'react';
import { Fragment } from 'react';
import { Card, Empty } from './primitives';
import { CpmBadge } from '../tabs/Tab2Bop';
import { isBlock, type CpmNode } from '../engine/model';
import { fmt } from '../lib/format';
import type { BopRow } from '../types';
import type { Model } from '../engine/model';

const INK = '#0f172a';
const BAR = '#94a3b8';

interface LabourGanttCardProps {
  m: Model;
  near: number;
  hpd: number;
  hpm: number;
  windowHrs: number;
  maxHrs: number;
  pct: (h: number) => string;
  keep: (n: CpmNode) => boolean;
  byId: Map<string, BopRow>;
  opOf: (id: string) => string;
}

/**
 * Purpose: Renders the CPM Early-Start Gantt chart for Tab 6.
 *   Each FPD has a span bar; each operation has a solid bar (critical = dark)
 *   with a float tail, and a hover tooltip showing ES/EF/LS/LF/float.
 *
 * Downstream impact: The Gantt is the primary schedule visualisation;
 *   the same CPM data drives the Schedule Table and Critical Path Sequence below it.
 */
export function LabourGanttCard({ m, near, hpd, hpm, windowHrs, maxHrs, pct, keep, byId, opOf }: LabourGanttCardProps) {
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null);
  const months = Math.ceil(maxHrs / hpm);
  const LABEL = 300;
  const tipNode = tip ? m.cpm.nodes.get(tip.id) : undefined;
  const tipRow = tip ? byId.get(tip.id) : undefined;

  return (
    <Card
      title="CPM Gantt — Early-Start Schedule"
      guide="gantt"
      pad={false}
      right={
        <span className="flex flex-wrap items-center gap-3 text-[11.5px] text-slate-600">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: INK }} />Critical</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: BAR }} />Has float</span>
          <span className="flex items-center gap-1"><span className="inline-block h-[3px] w-5" style={{ backgroundColor: '#cbd5e1' }} />Float tail</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-0 border-l-2 border-dashed border-slate-700" />Production window</span>
        </span>
      }
    >
      {m.cpm.nodes.size === 0 ? (
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
  );
}
