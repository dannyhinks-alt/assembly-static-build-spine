// Tab navigation bar — input spine (1–6) and analysis/governance (7–9).
import { TABS } from '../App';
import { useStore } from '../store';

export default function TabNav() {
  const { tab, setTab, integrity } = useStore();
  const group = (g: 'input' | 'analysis', title: string, range: string) => (
    <div className="flex items-center gap-1.5">
      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${g === 'input' ? 'bg-slate-200 text-slate-700' : 'bg-slate-800 text-white'}`}>{title} <span className="opacity-70">[{range}]</span></span>
      <div className="flex flex-wrap">
        {TABS.filter((t) => t.group === g).map((t) => (
          <button
            key={t.n}
            onClick={() => setTab(t.n)}
            title={t.label}
            aria-current={tab === t.n ? 'page' : undefined}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[12.5px] font-medium ${tab === t.n ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
          >
            <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded text-[10.5px] font-bold tabular-nums ${tab === t.n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{t.n}</span>
            {t.short}
            {t.n === 1 && !integrity.allPass && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#d03b3b' }} title={`${integrity.checks.length - integrity.passed} integrity check(s) failing`} />}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <nav className="border-t border-slate-100">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-0 px-4">
        {group('input', 'Input Spine', '1–6')}
        <span className="h-5 w-px shrink-0 bg-slate-200" />
        {group('analysis', 'Analysis & Governance', '7–9')}
      </div>
    </nav>
  );
}
