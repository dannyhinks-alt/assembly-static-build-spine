// Reusable UI primitives used on all nine tabs:
//   EngineeringTooltip · ExpandableTextCell · TagPicker · HowItWorks · inputs · cards · RAG badges
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GUIDES, type GuideId } from '../data/guides';
import type { Rag } from '../types';
import { RAG_HEX, RAG_LABEL, fmt } from '../lib/format';

// ---------------------------------------------------------------- EngineeringTooltip
interface TipPos { left: number; top: number; above: boolean }

/** Hover / focus micro-guide badge. Every KPI card, column header, threshold, CPM badge and gate has one. */
export function EngineeringTooltip({ id, glyph = '?', className = '' }: { id: GuideId; glyph?: '?' | 'i'; className?: string }) {
  const guide = GUIDES[id];
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<TipPos | null>(null);
  const timer = useRef<number>();
  const W = 340;

  const open = () => {
    window.clearTimeout(timer.current);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8);
    const above = r.bottom + 260 > window.innerHeight && r.top > 260;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = () => {
    timer.current = window.setTimeout(() => setPos(null), 90);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Guide: ${guide.title}`}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => { e.stopPropagation(); pos ? setPos(null) : open(); }}
        onKeyDown={(e) => e.key === 'Escape' && setPos(null)}
        className={`inline-flex h-[15px] w-[15px] shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 bg-white align-middle text-[9.5px] font-bold normal-case leading-none text-slate-500 hover:border-slate-700 hover:bg-slate-800 hover:text-white ${className}`}
      >
        {glyph}
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={close}
            style={{ left: pos.left, top: pos.top, width: W, transform: pos.above ? 'translateY(-100%)' : undefined }}
            className="fixed z-[80] rounded-lg border border-slate-200 bg-white p-3 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-slate-700 shadow-xl"
          >
            <div className="mb-1.5 text-[12.5px] font-semibold text-slate-900">{guide.title}</div>
            <TipRow label="What it measures & formula" text={guide.what} />
            <TipRow label="How it works in the engine" text={guide.how} />
            <TipRow label="What action to take" text={guide.action} last />
          </div>,
          document.body,
        )}
    </>
  );
}
function TipRow({ label, text, last }: { label: string; text: string; last?: boolean }) {
  return (
    <div className={last ? '' : 'mb-1.5'}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="whitespace-normal">{text}</div>
    </div>
  );
}
export const Tip = EngineeringTooltip;

// ---------------------------------------------------------------- Drawer / Modal
export function Drawer({ title, subtitle, onClose, children, footer, width = 560 }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="flex h-full max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
            {subtitle && <div className="truncate text-xs text-slate-500">{subtitle}</div>}
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="scroll-thin flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Modal({ title, onClose, children, footer, width = 640 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-slate-900/30 p-6" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="card mt-10 max-w-full" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="p-4 text-[13px]">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-slate-200 bg-slate-50 px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- ExpandableTextCell
/** Free-text cell for dense tables: never clips mid-word, grows when focused, ⤢ opens a pop-out editor. */
export function ExpandableTextCell({
  value, onChange, placeholder = '—', label = 'Notes', context, minWidth = 180, readOnly = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; context?: string; minWidth?: number; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [pop, setPop] = useState(false);
  const [popDraft, setPopDraft] = useState(value);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    const full = el.scrollHeight;
    el.style.height = `${focused ? full : Math.min(full, 58)}px`;
  }, [draft, focused]);
  const commit = () => { if (draft !== value) onChange(draft); };
  const clipped = !focused && (draft.length > 90 || draft.split('\n').length > 3);

  return (
    <div className="group relative" style={{ minWidth }}>
      <textarea
        ref={ta}
        rows={1}
        value={draft}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        className={`inp-cell block resize-none overflow-hidden whitespace-pre-wrap break-words pr-6 leading-snug ${focused ? 'relative z-10 shadow-md' : ''}`}
      />
      {clipped && <span className="pointer-events-none absolute bottom-0.5 right-6 rounded bg-white/90 px-0.5 text-[10px] text-slate-400">…more</span>}
      <button
        type="button"
        title="Open pop-out editor"
        aria-label={`Expand ${label}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setPopDraft(draft); setPop(true); }}
        className="absolute right-0.5 top-0.5 z-20 rounded px-1 text-[12px] leading-5 text-slate-400 opacity-60 hover:bg-slate-100 hover:text-slate-800 group-hover:opacity-100"
      >
        ⤢
      </button>
      {pop && (
        <Drawer
          title={label}
          subtitle={context}
          onClose={() => setPop(false)}
          footer={
            <>
              <span className="mr-auto text-xs tabular-nums text-slate-500">{fmt(popDraft.length, 0)} characters · {fmt(popDraft.split('\n').length, 0)} line(s)</span>
              <button className="btn" onClick={() => setPop(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { setDraft(popDraft); if (popDraft !== value) onChange(popDraft); setPop(false); }}>Save &amp; close</button>
            </>
          }
        >
          <textarea
            autoFocus
            readOnly={readOnly}
            value={popDraft}
            onChange={(e) => setPopDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { setDraft(popDraft); if (popDraft !== value) onChange(popDraft); setPop(false); } }}
            className="inp h-[60vh] resize-none whitespace-pre-wrap text-[13.5px] leading-relaxed"
            placeholder="Type multi-line engineering notes…"
          />
          <p className="mt-2 text-xs text-slate-500">Ctrl + Enter to save · Esc to cancel</p>
        </Drawer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Inputs
export function NumInput({
  value, onChange, cell = false, min, max, step, className = '', nullable = false, disabled = false, ariaLabel, width,
}: { value: number | null; onChange: (v: number | null) => void; cell?: boolean; min?: number; max?: number; step?: number; className?: string; nullable?: boolean; disabled?: boolean; ariaLabel?: string; width?: number }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setTxt(value == null ? '' : String(value)); }, [value, focused]);
  const commit = () => {
    const t = txt.trim().replace(/,/g, '');
    if (t === '') {
      if (nullable) { if (value !== null) onChange(null); } else setTxt(value == null ? '' : String(value));
      return;
    }
    let n = parseFloat(t);
    if (!Number.isFinite(n)) { setTxt(value == null ? '' : String(value)); return; }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    setTxt(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={txt}
      step={step}
      style={width ? { width } : undefined}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cell ? 'inp-cell' : 'inp'} text-right ${disabled ? 'bg-slate-50 text-slate-400' : ''} ${className}`}
    />
  );
}

export function TextInput({ value, onChange, cell = false, placeholder, className = '', ariaLabel, mono = false }: { value: string; onChange: (v: string) => void; cell?: boolean; placeholder?: string; className?: string; ariaLabel?: string; mono?: boolean }) {
  const [txt, setTxt] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setTxt(value); }, [value, focused]);
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={txt}
      placeholder={placeholder}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (txt !== value) onChange(txt); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cell ? 'inp-cell' : 'inp'} ${mono ? 'font-mono text-[12px]' : ''} ${className}`}
    />
  );
}

export function Select<T extends string | number>({ value, onChange, options, cell = false, className = '', ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; group?: string }[]; cell?: boolean; className?: string; ariaLabel?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const isNum = typeof value === 'number';
  return (
    <select
      aria-label={ariaLabel}
      value={String(value)}
      onChange={(e) => onChange((isNum ? Number(e.target.value) : e.target.value) as T)}
      className={`${cell ? 'inp-cell' : 'inp'} cursor-pointer pr-5 ${className}`}
    >
      {groups.map((grp) =>
        grp === '' ? (
          options.filter((o) => !o.group).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)
        ) : (
          <optgroup key={grp} label={grp}>
            {options.filter((o) => o.group === grp).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
          </optgroup>
        ),
      )}
    </select>
  );
}

/** Labelled field with a hover guide, used in settings panels. */
export function Field({ label, guide, unit, children, hint }: { label: string; guide?: GuideId; unit?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5">
        <span className="lbl">{label}</span>
        {guide && <Tip id={guide} />}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1">{children}</span>
        {unit && <span className="w-12 shrink-0 text-[11.5px] text-slate-500">{unit}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- TagPicker (unlimited multi-item pills)
export interface TagOption { id: string; label: string; sub?: string }
export function TagPicker({
  value, options, onChange, placeholder = 'Add…', label, minWidth = 150, tone = 'slate', readOnly = false, onCreate,
}: { value: string[]; options: TagOption[]; onChange: (v: string[]) => void; placeholder?: string; label: string; minWidth?: number; tone?: 'slate' | 'blue'; readOnly?: boolean; onCreate?: (name: string) => string | null }) {
  const [open, setOpen] = useState<{ left: number; top: number; width: number } | null>(null);
  const [q, setQ] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const openedAt = Date.now();
    // Scroll events are delivered a frame late, so ignore the one caused by bringing the cell into view.
    const scroll = (e: Event) => { if (Date.now() - openedAt > 250 && !pop.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  const toggle = () => {
    if (readOnly) return;
    if (open) return setOpen(null);
    const r = anchor.current!.getBoundingClientRect();
    const width = Math.max(260, r.width);
    const top = r.bottom + 300 > window.innerHeight ? Math.max(8, r.top - 296) : r.bottom + 4;
    setOpen({ left: Math.min(r.left, window.innerWidth - width - 8), top, width });
    setQ('');
  };
  const byId = new Map(options.map((o) => [o.id, o]));
  const shown = options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const pill = tone === 'blue' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <div ref={anchor} style={{ minWidth }} className="flex flex-wrap items-center gap-1 px-0.5 py-1">
      {value.map((id) => (
        <span key={id} className={`inline-flex max-w-[190px] items-center gap-1 rounded-full border px-1.5 py-[1px] text-[11px] leading-4 ${pill}`} title={byId.get(id)?.label ?? id}>
          <span className="truncate">{byId.get(id)?.label ?? `⚠ ${id}`}</span>
          {!readOnly && (
            <button type="button" aria-label={`Remove ${byId.get(id)?.label ?? id}`} onClick={() => onChange(value.filter((v) => v !== id))} className="text-slate-400 hover:text-slate-900">×</button>
          )}
        </span>
      ))}
      {!readOnly && (
        <button type="button" onClick={toggle} aria-label={`Edit ${label}`} className="rounded-full border border-dashed border-slate-300 px-1.5 text-[11px] leading-4 text-slate-500 hover:border-slate-500 hover:text-slate-800">
          {value.length ? '+' : placeholder}
        </button>
      )}
      {open &&
        createPortal(
          <div ref={pop} role="dialog" aria-label={`${label} picker`} style={{ left: open.left, top: open.top, width: open.width }} className="fixed z-[75] rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="lbl">{label}</span>
                <span className="text-[11px] tabular-nums text-slate-500">{value.length} selected</span>
              </div>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="inp" />
            </div>
            <div className="scroll-thin max-h-56 overflow-auto py-1">
              {shown.length === 0 && !onCreate && <div className="px-3 py-2 text-xs text-slate-500">No matches. Add items in the registry tabs.</div>}
              {q.trim() && onCreate && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px] text-sky-800 hover:bg-sky-50"
                  onClick={() => {
                    const newId = onCreate(q.trim());
                    if (newId) { onChange([...value, newId]); setQ(''); }
                  }}
                >
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">+</span>
                  Create &ldquo;{q.trim()}&rdquo;
                </button>
              )}
              {shown.map((o) => {
                const on = value.includes(o.id);
                return (
                  <label key={o.id} className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-[12.5px] hover:bg-slate-50">
                    <input type="checkbox" className="mt-0.5 accent-slate-800" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])} />
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">{o.label}</span>
                      {o.sub && <span className="block truncate text-[11px] text-slate-500">{o.sub}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between border-t border-slate-100 p-1.5">
              <button className="btn-ghost" onClick={() => onChange([])} disabled={!value.length}>Clear all</button>
              <button className="btn-ghost" onClick={() => setOpen(null)}>Done</button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------- Cards, badges, KPIs
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
  const c = { slate: 'border-slate-200 bg-slate-100 text-slate-700', dark: 'border-slate-800 bg-slate-800 text-white', blue: 'border-sky-200 bg-sky-50 text-sky-900', outline: 'border-slate-300 bg-white text-slate-600' }[tone];
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[11px] font-medium leading-4 ${c}`}>{children}</span>;
}

export function Card({ title, guide, right, children, className = '', pad = true, collapseKey, defaultOpen = true }: { title?: ReactNode; guide?: GuideId; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; collapseKey?: string; defaultOpen?: boolean }) {
  const key = `asbcs.card.${collapseKey}`;
  const [open, setOpen] = useState(() => {
    if (!collapseKey) return true;
    try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const flip = () => setOpen((o) => { try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* storage unavailable */ } return !o; });
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${open ? 'border-b border-slate-200' : ''}`}>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
            {collapseKey && <button type="button" onClick={flip} aria-expanded={open} aria-label={open ? 'Collapse section' : 'Expand section'} className="-ml-1 w-5 rounded text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-900">{open ? '▾' : '▸'}</button>}
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

/** Column header with a hover guide. */
export function Th({ children, guide, className = '', right = false, style }: { children?: ReactNode; guide?: GuideId; className?: string; right?: boolean; style?: React.CSSProperties }) {
  return (
    <th className={`th ${right ? 'text-right' : ''} ${className}`} style={style}>
      <span className={`inline-flex items-center gap-1 ${right ? 'justify-end' : ''}`}>{children}{guide && <Tip id={guide} />}</span>
    </th>
  );
}

// ---------------------------------------------------------------- "How This Tab Works" banner
export function HowItWorks({ tab, title, steps, children }: { tab: string; title: string; steps: string[]; children?: ReactNode }) {
  const key = `asbcs.how.${tab}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '0'; } catch { return true; }
  });
  const flip = () => {
    setOpen((o) => {
      try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* storage unavailable */ }
      return !o;
    });
  };
  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/70">
      <button type="button" onClick={flip} aria-expanded={open} className="flex w-full items-center gap-2 px-3.5 py-2 text-left">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-700 text-[10px] font-bold text-white">i</span>
        <span className="text-[12.5px] font-semibold text-sky-950">How This Tab Works — {title}</span>
        <span className="ml-auto text-[11.5px] text-sky-800">{open ? 'Hide ▴' : 'Show ▾'}</span>
      </button>
      {open && (
        <div className="border-t border-sky-200 px-3.5 pb-3 pt-2 text-[12.5px] leading-relaxed text-slate-700">
          <ol className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-white text-[10px] font-semibold tabular-nums text-sky-800">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {children}
        </div>
      )}
    </div>
  );
}

/** Thin horizontal meter with a threshold tick; value text sits beside it in ink, not in colour. */
export function Meter({ pct, rag, ticks = [] as number[], max = 120 }: { pct: number; rag: Rag; ticks?: number[]; max?: number }) {
  const w = Math.min(100, (Math.max(0, pct) / max) * 100);
  return (
    <div className="relative h-2 w-full min-w-[80px] rounded-sm bg-slate-100">
      <div className="h-2 rounded-sm" style={{ width: `${w}%`, backgroundColor: RAG_HEX[rag] }} />
      {ticks.map((t) => (
        <span key={t} className="absolute -top-0.5 h-3 w-px bg-slate-500" style={{ left: `${(t / max) * 100}%` }} title={`${t}%`} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-[12.5px] text-slate-500">{children}</div>;
}
