// RAG-status badges, pills, and the utilisation meter bar.
import type { ReactNode } from 'react';
import type { Rag } from '../../types';
import { RAG_HEX, RAG_LABEL } from '../../lib/format';

const RAG_ICON: Record<Rag, string> = { green: '✓', amber: '!', serious: '▲', red: '✕' };

export function RagBadge({ rag, label, title }: { rag: Rag; label?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[11px] font-semibold leading-4 text-slate-800" style={{ borderColor: RAG_HEX[rag], backgroundColor: `${RAG_HEX[rag]}1f` }}>
      <span className="inline-flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ backgroundColor: RAG_HEX[rag] }} aria-hidden>{RAG_ICON[rag]}</span>
      {label ?? RAG_LABEL[rag]}
    </span>
  );
}

export function PassBadge({ pass }: { pass: boolean }) {
  return <RagBadge rag={pass ? 'green' : 'red'} label={pass ? 'GREEN – PASS' : 'RED – FAIL'} />;
}

export function Pill({ children, tone = 'slate', title }: { children: ReactNode; tone?: 'slate' | 'dark' | 'blue' | 'outline'; title?: string }) {
  const colourClass = {
    slate: 'border-slate-200 bg-slate-100 text-slate-700',
    dark: 'border-slate-800 bg-slate-800 text-white',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    outline: 'border-slate-300 bg-white text-slate-600',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[11px] font-medium leading-4 ${colourClass}`}>
      {children}
    </span>
  );
}

/** Thin horizontal meter with a threshold tick; value text sits beside it in ink, not in colour. */
export function Meter({ pct, rag, ticks = [] as number[], max = 120 }: { pct: number; rag: Rag; ticks?: number[]; max?: number }) {
  const fillWidth = Math.min(100, (Math.max(0, pct) / max) * 100);
  return (
    <div className="relative h-2 w-full min-w-[80px] rounded-sm bg-slate-100">
      <div className="h-2 rounded-sm" style={{ width: `${fillWidth}%`, backgroundColor: RAG_HEX[rag] }} />
      {ticks.map((tick) => (
        <span key={tick} className="absolute -top-0.5 h-3 w-px bg-slate-500" style={{ left: `${(tick / max) * 100}%` }} title={`${tick}%`} />
      ))}
    </div>
  );
}
