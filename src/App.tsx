import { useEffect, useRef, useState } from 'react';
import { Modal, Pill, RagBadge, Select, TagPicker, TextInput, Tip } from './components/primitives';
import { buildSummary } from './engine/gates';
import { buildImport, exportWorkbook, parseWorkbook, type ParsedWorkbook } from './lib/excel';
import { fmtDate, fmtInt } from './lib/format';
import { download, fileSafe, fsaSupported, stamp } from './lib/persistence';
import { useStore } from './store';
import Tab1Targets from './tabs/Tab1Targets';
import Tab2Bop from './tabs/Tab2Bop';
import Tab3Fpds from './tabs/Tab3Fpds';
import Tab4Resources from './tabs/Tab4Resources';
import Tab5Cells from './tabs/Tab5Cells';
import Tab6Pfmea from './tabs/Tab6Pfmea';
import Tab7Cpm from './tabs/Tab7Cpm';
import Tab8Lifts from './tabs/Tab8Lifts';
import Tab9Governance from './tabs/Tab9Governance';
import { APP_VERSION, type ScopeMode } from './types';

export const TABS: { n: number; label: string; short: string; group: 'input' | 'analysis' }[] = [
  { n: 1, label: 'Targets & Pre-Requisites', short: 'Targets', group: 'input' },
  { n: 2, label: 'Bill of Process — KTP Spine', short: 'Bill of Process', group: 'input' },
  { n: 3, label: 'FPD Registry & Components', short: 'FPDs & BOM', group: 'input' },
  { n: 4, label: 'Equipment & Resource Registry', short: 'Resources', group: 'input' },
  { n: 5, label: 'Cells, Zones & Crew', short: 'Cells & Crew', group: 'input' },
  { n: 6, label: 'PFMEA & Quality Hold Points', short: 'PFMEA & Quality', group: 'input' },
  { n: 7, label: 'CPM Schedule & Critical Path', short: 'CPM Schedule', group: 'analysis' },
  { n: 8, label: 'Lift, Crane & Resource Load', short: 'Lifts & Load', group: 'analysis' },
  { n: 9, label: 'Governance & Release Gates', short: 'Governance', group: 'analysis' },
];

export default function App() {
  const st = useStore();
  const { tab } = st;
  // Ctrl/Cmd+Z / Y undo-redo outside text fields
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [st]);

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <TopBar />
        <TabNav />
        <SpineFilterBar />
      </header>
      <main className="mx-auto max-w-[1680px] px-4 pb-16 pt-4">
        {tab === 1 && <Tab1Targets />}
        {tab === 2 && <Tab2Bop />}
        {tab === 3 && <Tab3Fpds />}
        {tab === 4 && <Tab4Resources />}
        {tab === 5 && <Tab5Cells />}
        {tab === 6 && <Tab6Pfmea />}
        {tab === 7 && <Tab7Cpm />}
        {tab === 8 && <Tab8Lifts />}
        {tab === 9 && <Tab9Governance />}
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-center text-[11px] text-slate-500">
        Assembly &amp; Static Build Central Spine v{APP_VERSION} · offline-first · no data leaves this device · en-GB
      </footer>
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------- Top bar
function TopBar() {
  const st = useStore();
  const { ws } = st;
  const jsonRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);

  const onJson = async (f?: File) => { if (f) st.importJsonText(await f.text(), f.name); };
  const onXlsx = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { setParsed(await parseWorkbook(f)); } catch (e) { st.toast('error', `Could not read ${f.name}: ${(e as Error).message}`); }
    setBusy(false);
  };
  const exportSummary = () => {
    download(`${fileSafe(ws.meta.factoryId || 'factory')}_summary-V2_${stamp()}.json`, JSON.stringify(buildSummary(ws, st.integrity), null, 2));
    st.toast('ok', 'summary@V2 exported (whole factory, all active FPDs) — import it into Master Control Hub.');
  };
  const exportXlsx = async (template: boolean) => {
    setMenu(false);
    try {
      download(`${fileSafe(ws.meta.name)}_${template ? 'template' : stamp()}.xlsx`, await exportWorkbook(ws, st.model, template));
    } catch (e) { st.toast('error', `Excel export failed: ${(e as Error).message}`); }
  };

  const linked = !!st.fileName;
  const saveLabel = linked
    ? st.saveState === 'saving' ? 'Saving…' : st.saveState === 'error' ? 'Save failed' : st.lastSaved ? `Saved ${fmtDate(st.lastSaved).slice(-5)}` : 'Linked'
    : st.dirty ? 'Unsaved to file' : 'Browser storage';

  return (
    <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900" aria-hidden>
          <svg viewBox="0 0 32 32" className="h-5 w-5"><path d="M16 5v22M8 10h16M8 16h16M8 22h16" stroke="#fab219" strokeWidth="2.6" strokeLinecap="round" /></svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13.5px] font-semibold text-slate-900">Assembly &amp; Static Build Central Spine <span className="font-normal text-slate-500">v{APP_VERSION}</span></div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
            <span className="w-[300px]"><TextInput cell value={ws.meta.name} onChange={(v) => st.mutate((d) => { d.meta.name = v || 'Untitled workspace'; })} ariaLabel="Workspace name" className="!py-0 !text-[11.5px] text-slate-600" /></span>
          </div>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button className="btn-ghost" onClick={st.undo} disabled={!st.canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn-ghost" onClick={st.redo} disabled={!st.canRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <input ref={xlsxRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(e) => { void onXlsx(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => xlsxRef.current?.click()} disabled={busy}>{busy ? 'Reading…' : 'Import Excel (.xlsx)'}</button>
        <input ref={jsonRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void onJson(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="inline-flex rounded shadow-sm">
          <button className="btn rounded-r-none shadow-none" onClick={() => jsonRef.current?.click()}>Import JSON</button>
          <button className="btn -ml-px rounded-l-none shadow-none" onClick={st.exportJson}>Export JSON</button>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button
            className={`btn ${linked ? '!border-slate-400' : ''}`}
            onClick={() => (linked ? st.unlinkFile() : void st.linkFile())}
            title={linked ? `Linked to ${st.fileName} — click to unlink` : fsaSupported() ? 'Choose a .json file; every change is then saved to it automatically' : 'File System Access API not available in this browser — work is kept in browser storage'}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: linked ? (st.saveState === 'error' ? '#d03b3b' : '#0ca30c') : st.dirty ? '#fab219' : '#94a3b8' }} />
            {linked ? <span className="max-w-[150px] truncate">{st.fileName}</span> : 'Auto-Save File Link'}
            <span className="text-[11px] font-normal text-slate-500">· {saveLabel}</span>
          </button>
          <Tip id="autosave" />
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button className="btn-primary" onClick={exportSummary}>Export summary@V2 for Master Hub</button>
          <Tip id="summaryExport" />
        </div>
        <div className="relative">
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>More ▾</button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div role="menu" className="card absolute right-0 z-50 mt-1 w-64 py-1 text-[12.5px]">
                <MenuItem onClick={() => void exportXlsx(false)}>Export Excel workbook (.xlsx)</MenuItem>
                <MenuItem onClick={() => void exportXlsx(true)}>Download Excel import template</MenuItem>
                {fsaSupported() && <MenuItem onClick={() => { setMenu(false); void st.openFile(); }}>Open &amp; link existing .json file…</MenuItem>}
                <MenuItem onClick={() => { setMenu(false); window.print(); }}>Print current tab</MenuItem>
                <div className="my-1 border-t border-slate-100" />
                <MenuItem onClick={() => { setMenu(false); if (window.confirm('Replace the current workspace with the PMA / UMA baseline dataset? (Undo will bring it back.)')) st.resetToSeed(); }}>Restore PMA / UMA baseline dataset</MenuItem>
              </div>
            </>
          )}
        </div>
      </div>
      {st.storageWarning && <div className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900">{st.storageWarning}</div>}
      {parsed && <ExcelImportModal parsed={parsed} onClose={() => setParsed(null)} />}
    </div>
  );
}
function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button role="menuitem" onClick={onClick} className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50">{children}</button>;
}

function ExcelImportModal({ parsed, onClose }: { parsed: ParsedWorkbook; onClose: () => void }) {
  const st = useStore();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const res = buildImport(parsed, st.ws, mode);
  const nothing = res.sheetsRead.length === 0;
  return (
    <Modal
      title={`Import Excel — ${parsed.fileName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={nothing} onClick={() => { st.replace(res.ws, { keepLink: true }); st.toast(res.warnings.length ? 'warn' : 'ok', `Excel import applied${res.warnings.length ? ` with ${res.warnings.length} warning(s)` : ''}. Undo reverts it.`); onClose(); }}>Apply import</button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-4">
        {(['merge', 'replace'] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2">
            <input type="radio" className="mt-0.5 accent-slate-800" checked={mode === m} onChange={() => setMode(m)} />
            <span>
              <span className="block font-medium text-slate-800">{m === 'merge' ? 'Merge (upsert)' : 'Replace'}</span>
              <span className="block max-w-[260px] text-xs text-slate-500">{m === 'merge' ? 'Match on FPD Code, Op #, BOM Ref and resource name. Existing rows are updated; new rows added.' : 'Tables present in the workbook replace the current ones (FPDs, BOP, PFMEA). Registries are kept.'}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mb-3 text-xs text-slate-500">Sheets recognised: {res.sheetsRead.length ? res.sheetsRead.join(', ') : 'none'}</div>
      <table className="mb-3 w-full">
        <thead><tr><th className="th">Table</th><th className="th text-right">Added</th><th className="th text-right">Updated</th></tr></thead>
        <tbody>
          {res.counts.map((c) => (<tr key={c.label}><td className="td-ro">{c.label}</td><td className="td-ro text-right">{fmtInt(c.added)}</td><td className="td-ro text-right">{fmtInt(c.updated)}</td></tr>))}
          {!res.counts.length && <tr><td className="td-ro text-slate-500" colSpan={3}>Nothing to import.</td></tr>}
        </tbody>
      </table>
      {res.warnings.length > 0 && (
        <div className="scroll-thin max-h-48 overflow-auto rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
          <div className="mb-1 font-semibold">{res.warnings.length} warning(s)</div>
          <ul className="list-disc space-y-0.5 pl-4">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Tab navigation
function TabNav() {
  const { tab, setTab, integrity } = useStore();
  const group = (g: 'input' | 'analysis', title: string, range: string) => (
    <div className="flex items-center gap-1.5">
      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${g === 'input' ? 'bg-slate-200 text-slate-700' : 'bg-slate-800 text-white'}`}>{title} <span className="opacity-70">[{range}]</span></span>
      <div className="flex">
        {TABS.filter((t) => t.group === g).map((t) => (
          <button
            key={t.n}
            onClick={() => setTab(t.n)}
            title={t.label}
            aria-current={tab === t.n ? 'page' : undefined}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[12.5px] font-medium ${tab === t.n ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
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
      <div className="scroll-thin mx-auto flex max-w-[1680px] items-center gap-5 overflow-x-auto px-4">
        {group('input', 'Input Spine', '1–6')}
        <span className="h-5 w-px shrink-0 bg-slate-200" />
        {group('analysis', 'Analysis & Governance', '7–9')}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- Global Spine Filter
function SpineFilterBar() {
  const { ws, scope, setScope, model } = useStore();
  const active = ws.fpds.filter((f) => f.active);
  const modes: { v: ScopeMode; label: string }[] = [
    { v: 'factory', label: 'Whole Factory (All Active FPDs)' },
    { v: 'cell', label: 'By Cell (1–6)' },
    { v: 'fpd', label: 'Single FPD / Multi-FPD Selection' },
  ];
  const setMode = (v: ScopeMode) => {
    if (v === 'cell' && scope.cellIds.length === 0) return setScope({ ...scope, mode: v, cellIds: ws.cells.slice(0, 1).map((c) => c.id) });
    if (v === 'fpd' && scope.fpdIds.length === 0) return setScope({ ...scope, mode: v, fpdIds: active.slice(0, 1).map((f) => f.fpdId) });
    setScope({ ...scope, mode: v });
  };
  const toggleCell = (id: string) => setScope({ ...scope, cellIds: scope.cellIds.includes(id) ? scope.cellIds.filter((c) => c !== id) : [...scope.cellIds, id] });
  return (
    <div className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
        <span className="flex items-center gap-1.5"><span className="lbl">Spine Filter</span><Tip id="spineFilter" /></span>
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white" role="radiogroup" aria-label="Scope mode">
          {modes.map((m) => (
            <button key={m.v} role="radio" aria-checked={scope.mode === m.v} onClick={() => setMode(m.v)} className={`border-r border-slate-300 px-2.5 py-1 text-[12px] font-medium last:border-r-0 ${scope.mode === m.v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {m.label}
            </button>
          ))}
        </div>
        {scope.mode === 'cell' && (
          <div className="flex flex-wrap items-center gap-1">
            {ws.cells.map((c) => {
              const on = scope.cellIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggleCell(c.id)} aria-pressed={on} title={c.name} className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'}`}>
                  Cell {c.number}
                </button>
              );
            })}
          </div>
        )}
        {scope.mode === 'fpd' && (
          <div className="flex min-w-[220px] max-w-[720px] flex-1 items-center gap-1 rounded border border-slate-300 bg-white px-1">
            <div className="min-w-0 flex-1">
              <TagPicker label="FPD selection" tone="blue" placeholder="Select FPDs…" value={scope.fpdIds} options={active.map((f) => ({ id: f.fpdId, label: f.fpdCode, sub: f.title }))} onChange={(fpdIds) => setScope({ ...scope, fpdIds })} />
            </div>
            <button className="btn-ghost" onClick={() => setScope({ ...scope, fpdIds: active.map((f) => f.fpdId) })}>All</button>
            <button className="btn-ghost" onClick={() => setScope({ ...scope, fpdIds: [] })}>None</button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="lbl">Zone</span>
          <div className="w-[210px]">
            <Select
              ariaLabel="Zone refinement"
              value={scope.zoneId}
              onChange={(zoneId) => setScope({ ...scope, zoneId })}
              options={[{ value: '', label: 'All zones' }, ...ws.zones.map((z) => ({ value: z.id, label: z.name, group: `Cell ${ws.cells.find((c) => c.id === z.cellId)?.number ?? '?'}` }))]}
              className="!py-[3px] !text-[12px]"
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone="dark">
            <span className="tabular-nums">{fmtInt(model.fpds.length)} of {fmtInt(ws.fpds.length)} FPDs active · {fmtInt(model.totals.workBlocks)} work blocks</span>
          </Pill>
          <Pill tone="outline" title="Learning-curve build selected in Tab 1">Build #{ws.settings.learning.selectedBuild} · {(model.lc * 100).toFixed(0)}%</Pill>
          <RagBadge rag={model.scheduleRag} label={`${model.durationMonths.toFixed(1)} mo`} title="Critical-path duration vs production window (Tab 7)" />
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  const tone = { ok: 'border-slate-300 bg-white', warn: 'border-amber-300 bg-amber-50', error: 'border-red-300 bg-red-50' };
  return (
    <div className="no-print fixed bottom-4 right-4 z-[90] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-lg border px-3 py-2 text-[12.5px] text-slate-800 shadow-lg ${tone[t.kind]}`}>{t.text}</div>
      ))}
    </div>
  );
}
