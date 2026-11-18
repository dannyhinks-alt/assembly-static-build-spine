// Slide-over Drawer and centred Modal portal components.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Drawer({ title, subtitle, onClose, children, footer, width = 560 }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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

export function Modal({ title, onClose, children, footer, width = 640 }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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
