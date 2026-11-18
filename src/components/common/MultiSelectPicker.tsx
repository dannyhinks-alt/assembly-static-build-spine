// Multi-item tag picker with search, pill display, and optional inline create.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TagOption { id: string; label: string; sub?: string }

export function TagPicker({
  value, options, onChange, placeholder = 'Add…', label, minWidth = 150, tone = 'slate', readOnly = false, onCreate,
}: {
  value: string[]; options: TagOption[]; onChange: (v: string[]) => void;
  placeholder?: string; label: string; minWidth?: number; tone?: 'slate' | 'blue';
  readOnly?: boolean; onCreate?: (name: string) => string | null;
}) {
  const [open, setOpen] = useState<{ left: number; top: number; width: number } | null>(null);
  const [query, setQuery] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handleOutsideClick = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || anchorRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    // Ignore scroll events caused by bringing the picker cell into view.
    const handleScroll = (e: Event) => { if (Date.now() - openedAt > 250 && !popRef.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (readOnly) return;
    if (open) return setOpen(null);
    const rect = anchorRef.current!.getBoundingClientRect();
    const width = Math.max(260, rect.width);
    const top = rect.bottom + 300 > window.innerHeight ? Math.max(8, rect.top - 296) : rect.bottom + 4;
    setOpen({ left: Math.min(rect.left, window.innerWidth - width - 8), top, width });
    setQuery('');
  };

  const byId = new Map(options.map((o) => [o.id, o]));
  const filteredOptions = options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const pillClass = tone === 'blue' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-slate-200 bg-slate-100 text-slate-700';

  return (
    <div ref={anchorRef} style={{ minWidth }} className="flex flex-wrap items-center gap-1 px-0.5 py-1">
      {value.map((id) => (
        <span key={id} className={`inline-flex max-w-[190px] items-center gap-1 rounded-full border px-1.5 py-[1px] text-[11px] leading-4 ${pillClass}`} title={byId.get(id)?.label ?? id}>
          <span className="truncate">{byId.get(id)?.label ?? `⚠ ${id}`}</span>
          {!readOnly && <button type="button" aria-label={`Remove ${byId.get(id)?.label ?? id}`} onClick={() => onChange(value.filter((v) => v !== id))} className="text-slate-400 hover:text-slate-900">×</button>}
        </span>
      ))}
      {!readOnly && (
        <button type="button" onClick={toggle} aria-label={`Edit ${label}`} className="rounded-full border border-dashed border-slate-300 px-1.5 text-[11px] leading-4 text-slate-500 hover:border-slate-500 hover:text-slate-800">
          {value.length ? '+' : placeholder}
        </button>
      )}
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label={`${label} picker`} style={{ left: open.left, top: open.top, width: open.width }} className="fixed z-[75] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="lbl">{label}</span>
              <span className="text-[11px] tabular-nums text-slate-500">{value.length} selected</span>
            </div>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="inp" />
          </div>
          <div className="scroll-thin max-h-56 overflow-auto py-1">
            {filteredOptions.length === 0 && !onCreate && <div className="px-3 py-2 text-xs text-slate-500">No matches. Add items in the registry tabs.</div>}
            {query.trim() && onCreate && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) && (
              <button type="button" className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px] text-sky-800 hover:bg-sky-50"
                onClick={() => { const newId = onCreate(query.trim()); if (newId) { onChange([...value, newId]); setQuery(''); } }}>
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">+</span>
                Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
            {filteredOptions.map((option) => {
              const isSelected = value.includes(option.id);
              return (
                <label key={option.id} className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-[12.5px] hover:bg-slate-50">
                  <input type="checkbox" className="mt-0.5 accent-slate-800" checked={isSelected} onChange={() => onChange(isSelected ? value.filter((v) => v !== option.id) : [...value, option.id])} />
                  <span className="min-w-0">
                    <span className="block truncate text-slate-800">{option.label}</span>
                    {option.sub && <span className="block truncate text-[11px] text-slate-500">{option.sub}</span>}
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
