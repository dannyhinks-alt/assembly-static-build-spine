// Gate sign-off row for the Executive Summary release gates list.
import { useState } from 'react';
import { RagBadge, Tip } from './primitives';
import { RAG_LABEL, fmtDate } from '../lib/format';
import { useStore } from '../store';
import type { Gate } from '../engine/gates';

/**
 * Purpose: Renders a single release gate row with sign-off controls.
 *   Displays gate status, detail text, and allows an authorised signatory to record sign-off.
 *
 * Downstream impact: sign-offs are stored in ws.gateSignoffs and travel with the workspace
 *   export, surfaced in the summary@V2 hand-off.
 */
export function GateRow({ gate: g, onOpen }: { gate: Gate; onOpen: () => void }) {
  const { ws, mutate } = useStore();
  const so = ws.gateSignoffs[g.id];
  const [by, setBy] = useState('');
  const [comment, setComment] = useState('');
  const sign = () => {
    if (!by.trim()) return;
    mutate((d) => {
      d.gateSignoffs[g.id] = {
        by: by.trim(),
        on: new Date().toISOString(),
        comment: `${comment.trim()}${comment.trim() ? ' ' : ''}[signed at ${RAG_LABEL[g.rag]}]`,
      };
    });
    setBy('');
    setComment('');
  };
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-[11.5px] font-bold tabular-nums text-slate-700">{g.n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900">Gate {g.n} · {g.title}</span>
            <Tip id={g.guide} />
            <RagBadge rag={g.rag} />
            <button className="btn-ghost ml-auto" onClick={onOpen}>Tab {g.tab} →</button>
          </div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-slate-700">{g.detail}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="flex items-center gap-1"><span className="lbl">Sign-off</span><Tip id="signoff" /></span>
            {so ? (
              <>
                <span className="text-slate-900"><b>{so.by}</b> <span className="text-slate-500">· {fmtDate(so.on)}</span></span>
                {so.comment && <span className="break-words text-slate-600">{so.comment}</span>}
                <button className="btn-ghost" onClick={() => mutate((d) => { delete d.gateSignoffs[g.id]; })}>Clear</button>
              </>
            ) : (
              <>
                <input className="inp !w-32 !py-0.5" placeholder="Name / role" value={by} onChange={(e) => setBy(e.target.value)} aria-label={`Gate ${g.n} signatory`} />
                <input className="inp !w-auto min-w-[120px] flex-1 !py-0.5" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sign()} aria-label={`Gate ${g.n} comment`} />
                <button className="btn !py-0.5" disabled={!by.trim()} onClick={sign}>Sign</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
