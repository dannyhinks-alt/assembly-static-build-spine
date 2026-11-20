// Onboarding strip shown to first-time users until FPDs or BOP rows exist.
import { useStore } from '../store';

export default function QuickStartStrip() {
  const { ws, setTab } = useStore();
  if (ws.fpds.length > 0 || ws.rows.length > 0) return null;
  const steps: { n: number; title: string; desc: string; action?: () => void; label: string; hint?: string }[] = [
    { n: 1, title: 'Import BOP.xlsx', desc: 'Import your Bill of Process Excel (.xlsx) or CSV file to populate FPDs, route steps, components, and tooling.', label: 'Import Excel (.xlsx)', hint: 'Use the Import Excel (.xlsx) button in the top bar.' },
    { n: 2, title: 'Upload & Calibrate Floor Plan', desc: 'Add a floor-plan image in Tab 1, trace cell boundaries, then review footprint in Tab 7.', action: () => setTab(1), label: 'Go to Tab 1 →' },
    { n: 3, title: 'Review Release Gates', desc: 'Check the 10-point integrity panel and confirm all assumptions before submission.', action: () => setTab(9), label: 'Go to Tab 9 →' },
  ];
  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[14px] font-semibold text-sky-900">Get started in 3 steps</span>
        <span className="text-[12px] text-sky-600">— this strip disappears once you have FPDs or activities.</span>
      </div>
      <div className="flex flex-wrap gap-4">
        {steps.map((s) => (
          <div key={s.n} className="flex min-w-[200px] flex-1 items-start gap-3 rounded-md border border-sky-200 bg-white px-4 py-3 shadow-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[13px] font-bold text-white">{s.n}</span>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[13px] font-semibold text-slate-900">{s.title}</div>
              <div className="mb-2 text-[12px] leading-snug text-slate-600">{s.desc}</div>
              {s.action
                ? <button className="btn-primary text-[12px]" onClick={s.action}>{s.label}</button>
                : <span className="inline-flex items-center gap-1.5 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11.5px] text-sky-700">↑ {s.hint}</span>
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
