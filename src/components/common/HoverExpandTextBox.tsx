// Floating auto-expanding free-text box for BOP step descriptions.
// At rest: compact 1–2 line summary with optional 📄 Method badge.
// On click: elevated floating card with auto-growing textarea (max 10 lines).
// Saves on blur or Ctrl+Enter.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  hasMethod?: boolean;
  placeholder?: string;
}

/** Safe two-line summary for the at-rest display. */
function summaryOf(v: string): { text: string; clipped: boolean } {
  const lines = v.split('\n');
  const text = lines.slice(0, 2).join(' ').slice(0, 80);
  const clipped = v.length > 80 || lines.length > 2;
  return { text, clipped };
}

/**
 * Purpose: Provides an inline floating popup textarea for dense BOP table description cells.
 *   Keeps the table row compact at rest and expands into a card overlay on interaction.
 *
 * Downstream impact: drives the Operation Phase Title cell in Tab 2 BOP.
 */
export default function HoverExpandTextBox({ value, onChange, hasMethod = false, placeholder = 'Describe the activity…' }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const anchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 380 });

  useEffect(() => { if (!open) setDraft(value); }, [value, open]);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const cardWidth = Math.max(380, rect.width);
    const leftPos = Math.min(rect.left, window.innerWidth - cardWidth - 8);
    setPos({ top: rect.bottom + 4, left: Math.max(4, leftPos), width: cardWidth });
  }, [open]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !open) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 20 * 10)}px`;
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
  }, [open]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !open) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 20 * 10)}px`;
  }, [draft, open]);

  const commit = () => { if (draft !== value) onChange(draft); setOpen(false); };
  const cancel = () => { setDraft(value); setOpen(false); };

  const { text: summary, clipped } = summaryOf(value);

  return (
    <>
      <div
        ref={anchorRef}
        className="group cursor-text px-1.5 py-1 leading-snug text-sm text-slate-700 hover:bg-slate-50 rounded"
        onClick={() => setOpen(true)}
        role="button"
        aria-label="Edit description"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
      >
        {hasMethod && (
          <span className="mr-1 inline-block rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">📄 Method</span>
        )}
        {value ? (
          <>
            <span>{summary}</span>
            {clipped && <span className="ml-0.5 text-[10px] text-slate-400">…</span>}
          </>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={commit} />
          <div
            className="fixed z-50 rounded-lg border border-slate-200 bg-white shadow-xl"
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <textarea
              ref={textareaRef}
              className="block w-full resize-none rounded-t-lg border-0 p-3 text-sm leading-relaxed text-slate-700 outline-none focus:ring-0"
              style={{ minHeight: 60 }}
              value={draft}
              placeholder={placeholder}
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
            />
            <div className="flex items-center justify-between rounded-b-lg border-t border-slate-100 bg-slate-50 px-3 py-1.5">
              <span className="text-[11px] text-slate-400">Ctrl+Enter to save · Esc to cancel</span>
              <button className="btn-primary text-xs" onMouseDown={(e) => e.preventDefault()} onClick={commit}>Save</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
