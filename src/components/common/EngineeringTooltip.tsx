// Hover / focus micro-guide badge used on every KPI card, column header, threshold, CPM badge and gate.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GUIDES, type GuideId } from '../../data/guides';

interface TipPosition { left: number; top: number; above: boolean }

function TipRow({ label, text, last }: { label: string; text: string; last?: boolean }) {
  return (
    <div className={last ? '' : 'mb-1.5'}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="whitespace-normal">{text}</div>
    </div>
  );
}

export function EngineeringTooltip({ id, glyph = '?', className = '' }: { id: GuideId; glyph?: '?' | 'i'; className?: string }) {
  const guide = GUIDES[id];
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<TipPosition | null>(null);
  const timer = useRef<number>();
  const TIP_WIDTH = 340;

  const openTip = () => {
    window.clearTimeout(timer.current);
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - TIP_WIDTH / 2), window.innerWidth - TIP_WIDTH - 8);
    const above = rect.bottom + 260 > window.innerHeight && rect.top > 260;
    setPos({ left, top: above ? rect.top - 6 : rect.bottom + 6, above });
  };
  const closeTip = () => { timer.current = window.setTimeout(() => setPos(null), 90); };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Guide: ${guide.title}`}
        onMouseEnter={openTip}
        onMouseLeave={closeTip}
        onFocus={openTip}
        onBlur={closeTip}
        onClick={(e) => { e.stopPropagation(); pos ? setPos(null) : openTip(); }}
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
            onMouseLeave={closeTip}
            style={{ left: pos.left, top: pos.top, width: TIP_WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
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

export const Tip = EngineeringTooltip;
