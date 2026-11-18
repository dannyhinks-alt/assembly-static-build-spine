// Card, Kpi, Th, HowItWorks, and Empty layout components.
import { useState, type ReactNode, type CSSProperties } from 'react';
import type { GuideId } from '../../data/guides';
import type { Rag } from '../../types';
import { RAG_HEX } from '../../lib/format';
import { EngineeringTooltip as Tip } from './EngineeringTooltip';
import { RagBadge } from './RagBadge';

export function Card({
  title, guide, right, children, className = '', pad = true, collapseKey, defaultOpen = true,
}: {
  title?: ReactNode; guide?: GuideId; right?: ReactNode; children: ReactNode;
  className?: string; pad?: boolean; collapseKey?: string; defaultOpen?: boolean;
}) {
  const storageKey = `asbcs.card.${collapseKey}`;
  const [open, setOpen] = useState(() => {
    if (!collapseKey) return true;
    try { const v = localStorage.getItem(storageKey); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => setOpen((prev) => {
    try { localStorage.setItem(storageKey, prev ? '0' : '1'); } catch { /* storage unavailable */ }
    return !prev;
  });
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${open ? 'border-b border-slate-200' : ''}`}>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
            {collapseKey && (
              <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse section' : 'Expand section'} className="-ml-1 w-5 rounded text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                {open ? '▾' : '▸'}
              </button>
            )}
            {title}{guide && <Tip id={guide} />}
          </h2>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
      )}
      {open && <div className={pad ? 'p-4' : ''}>{children}</div>}
    </section>
  );
}

export function Kpi({ label, value, unit, sub, guide, rag }: { label: string; value: string; unit?: string; sub?: ReactNode; guide: GuideId; rag?: Rag }) {
  return (
    <div className="card relative overflow-hidden px-3.5 py-3">
      {rag && <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: RAG_HEX[rag] }} aria-hidden />}
      <div className="flex items-center justify-between gap-2">
        <span className="lbl truncate">{label}</span>
        <Tip id={guide} />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold tabular-nums leading-7 text-slate-900">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
        {rag && <span className="ml-auto"><RagBadge rag={rag} /></span>}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{sub}</div>}
    </div>
  );
}

/** Column header with an optional hover guide. */
export function Th({ children, guide, className = '', right = false, style }: { children?: ReactNode; guide?: GuideId; className?: string; right?: boolean; style?: CSSProperties }) {
  return (
    <th className={`th ${right ? 'text-right' : ''} ${className}`} style={style}>
      <span className={`inline-flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
        {children}{guide && <Tip id={guide} />}
      </span>
    </th>
  );
}

/** Collapsible "How This Tab Works" banner shown at the top of each tab. */
export function HowItWorks({ tab, title, steps, children }: { tab: string; title: string; steps: string[]; children?: ReactNode }) {
  const storageKey = `asbcs.how.${tab}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen((prev) => {
    try { localStorage.setItem(storageKey, prev ? '0' : '1'); } catch { /* storage unavailable */ }
    return !prev;
  });
  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/70">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3.5 py-2 text-left">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-700 text-[10px] font-bold text-white">i</span>
        <span className="text-[12.5px] font-semibold text-sky-950">How This Tab Works — {title}</span>
        <span className="ml-auto text-[11.5px] text-sky-800">{open ? 'Hide ▴' : 'Show ▾'}</span>
      </button>
      {open && (
        <div className="border-t border-sky-200 px-3.5 pb-3 pt-2 text-[12.5px] leading-relaxed text-slate-700">
          <ol className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {steps.map((stepText, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-white text-[10px] font-semibold tabular-nums text-sky-800">{index + 1}</span>
                <span>{stepText}</span>
              </li>
            ))}
          </ol>
          {children}
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-[12.5px] text-slate-500">{children}</div>;
}
