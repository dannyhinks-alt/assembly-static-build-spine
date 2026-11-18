// Controlled form inputs: NumInput, TextInput, Select, Field, ExpandableTextCell.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GuideId } from '../../data/guides';
import { fmt } from '../../lib/format';
import { EngineeringTooltip as Tip } from './EngineeringTooltip';
import { Drawer } from './SlideOverDrawer';

export function NumInput({
  value, onChange, cell = false, min, max, step, className = '', nullable = false, disabled = false, ariaLabel, width,
}: {
  value: number | null; onChange: (v: number | null) => void; cell?: boolean; min?: number; max?: number;
  step?: number; className?: string; nullable?: boolean; disabled?: boolean; ariaLabel?: string; width?: number;
}) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setTxt(value == null ? '' : String(value)); }, [value, focused]);
  const commit = () => {
    const trimmed = txt.trim().replace(/,/g, '');
    if (trimmed === '') {
      if (nullable) { if (value !== null) onChange(null); } else setTxt(value == null ? '' : String(value));
      return;
    }
    let parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) { setTxt(value == null ? '' : String(value)); return; }
    if (min != null) parsed = Math.max(min, parsed);
    if (max != null) parsed = Math.min(max, parsed);
    setTxt(String(parsed));
    if (parsed !== value) onChange(parsed);
  };
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} value={txt} step={step}
      style={width ? { width } : undefined}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cell ? 'inp-cell' : 'inp'} text-right ${disabled ? 'bg-slate-50 text-slate-400' : ''} ${className}`}
    />
  );
}

export function TextInput({
  value, onChange, cell = false, placeholder, className = '', ariaLabel, mono = false,
}: {
  value: string; onChange: (v: string) => void; cell?: boolean; placeholder?: string;
  className?: string; ariaLabel?: string; mono?: boolean;
}) {
  const [txt, setTxt] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setTxt(value); }, [value, focused]);
  return (
    <input
      type="text" aria-label={ariaLabel} value={txt} placeholder={placeholder}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (txt !== value) onChange(txt); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${cell ? 'inp-cell' : 'inp'} ${mono ? 'font-mono text-[12px]' : ''} ${className}`}
    />
  );
}

export function Select<T extends string | number>({
  value, onChange, options, cell = false, className = '', ariaLabel,
}: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; group?: string }[];
  cell?: boolean; className?: string; ariaLabel?: string;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const isNumeric = typeof value === 'number';
  return (
    <select
      aria-label={ariaLabel} value={String(value)}
      onChange={(e) => onChange((isNumeric ? Number(e.target.value) : e.target.value) as T)}
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

/** Labelled field with an optional hover guide, used in settings panels. */
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

/** Free-text cell for dense tables: auto-grows when focused, pop-out editor via ⤢ button. */
export function ExpandableTextCell({
  value, onChange, placeholder = '—', label = 'Notes', context, minWidth = 180, readOnly = false,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string;
  context?: string; minWidth?: number; readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [popDraft, setPopDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const scrollHeight = el.scrollHeight;
    el.style.height = `${focused ? scrollHeight : Math.min(scrollHeight, 58)}px`;
  }, [draft, focused]);
  const commit = () => { if (draft !== value) onChange(draft); };
  const isClipped = !focused && (draft.length > 90 || draft.split('\n').length > 3);

  return (
    <div className="group relative" style={{ minWidth }}>
      <textarea
        ref={textareaRef} rows={1} value={draft} readOnly={readOnly} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        className={`inp-cell block resize-none overflow-hidden whitespace-pre-wrap break-words pr-6 leading-snug ${focused ? 'relative z-10 shadow-md' : ''}`}
      />
      {isClipped && <span className="pointer-events-none absolute bottom-0.5 right-6 rounded bg-white/90 px-0.5 text-[10px] text-slate-400">…more</span>}
      <button
        type="button" title="Open pop-out editor" aria-label={`Expand ${label}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setPopDraft(draft); setPopOpen(true); }}
        className="absolute right-0.5 top-0.5 z-20 rounded px-1 text-[12px] leading-5 text-slate-400 opacity-60 hover:bg-slate-100 hover:text-slate-800 group-hover:opacity-100"
      >
        ⤢
      </button>
      {popOpen && (
        <Drawer
          title={label} subtitle={context} onClose={() => setPopOpen(false)}
          footer={
            <>
              <span className="mr-auto text-xs tabular-nums text-slate-500">{fmt(popDraft.length, 0)} characters · {fmt(popDraft.split('\n').length, 0)} line(s)</span>
              <button className="btn" onClick={() => setPopOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { setDraft(popDraft); if (popDraft !== value) onChange(popDraft); setPopOpen(false); }}>Save &amp; close</button>
            </>
          }
        >
          <textarea
            autoFocus readOnly={readOnly} value={popDraft}
            onChange={(e) => setPopDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { setDraft(popDraft); if (popDraft !== value) onChange(popDraft); setPopOpen(false); } }}
            className="inp h-[60vh] resize-none whitespace-pre-wrap text-[13.5px] leading-relaxed"
            placeholder="Type multi-line engineering notes…"
          />
          <p className="mt-2 text-xs text-slate-500">Ctrl + Enter to save · Esc to cancel</p>
        </Drawer>
      )}
    </div>
  );
}
