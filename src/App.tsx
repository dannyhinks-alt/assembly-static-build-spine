import { useEffect, useRef, useState } from 'react';
import { Modal, Pill, RagBadge, Select, TagPicker, TextInput, Tip } from './components/primitives';
import { buildSummary } from './engine/gates';
import { buildImport, exportWorkbook, parseWorkbook, type ParsedWorkbook } from './lib/excel';
import { fmtDate, fmtInt } from './lib/format';
import { download, fileSafe, fsaSupported, stamp } from './lib/persistence';
import { useStore } from './store';
import Tab1Targets from './tabs/Tab1Targets';
import Tab2Bop from './tabs/Tab2Bop';
import Tab3Equipment from './tabs/Tab3Equipment';
import Tab4Lifts from './tabs/Tab4Lifts';
import Tab5Pfmea from './tabs/Tab5Pfmea';
import Tab6Labour from './tabs/Tab6Labour';
import Tab7Footprint from './tabs/Tab7Footprint';
import Tab8Utilisation from './tabs/Tab8Utilisation';
import Tab9Executive from './tabs/Tab9Executive';
import { APP_VERSION, type ScopeMode } from './types';

export const TABS: { n: number; label: string; short: string; group: 'input' | 'analysis' }[] = [
  { n: 1, label: 'Targets & Pre-Requisites', short: 'Targets', group: 'input' },
  { n: 2, label: 'Bill of Process', short: 'Bill of Process', group: 'input' },
  { n: 3, label: 'Equipment, Tooling, Vehicles & Stands', short: 'Equipment', group: 'input' },
  { n: 4, label: 'Component, Lift & Movement Analysis', short: 'Lift & Movement', group: 'input' },
  { n: 5, label: 'Cell & Process PFMEA', short: 'PFMEA', group: 'input' },
  { n: 6, label: 'Labour Load & Spatial Balancing', short: 'Labour & Spatial', group: 'input' },
  { n: 7, label: 'Footprint, Space & Dual-View Layout', short: 'Footprint & Layout', group: 'analysis' },
  { n: 8, label: 'Resource Utilisation & Concurrency', short: 'Utilisation', group: 'analysis' },
  { n: 9, label: 'Executive Summary', short: 'Executive Summary', group: 'analysis' },
];
export const OFFLINE_FILE_NAME = 'Assembly_Spine_v1.html';

/**
 * Rebuild the pristine single-file app from the running page: the inlined <script> and <style> are kept verbatim,
 * the React root is emptied and anything React portalled into <body> is dropped. Works from file:// where fetch() cannot.
 */
export function offlineAppHtml(): string | null {
  if (document.querySelector('script[src]') || document.querySelector('link[rel="stylesheet"]')) return null; // dev or chunked build
  const doc = document.documentElement.cloneNode(true) as HTMLElement;
  const body = doc.querySelector('body');
  if (!body) return null;
  for (const el of [...body.children]) {
    if (el.id === 'root') el.innerHTML = '';
    else if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') el.remove();
  }
  return `<!doctype html>\n${doc.outerHTML}\n`;
}

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
        <QuickStartStrip />
        {tab === 1 && <Tab1Targets />}
        {tab === 2 && <Tab2Bop />}
        {tab === 3 && <Tab3Equipment />}
        {tab === 4 && <Tab4Lifts />}
        {tab === 5 && <Tab5Pfmea />}
        {tab === 6 && <Tab6Labour />}
        {tab === 7 && <Tab7Footprint />}
        {tab === 8 && <Tab8Utilisation />}
        {tab === 9 && <Tab9Executive />}
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-center text-[11px] text-slate-500">
        Assembly &amp; Static Build Central Spine v{APP_VERSION} · offline-first · no data leaves this device · en-GB
      </footer>
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------- Quick-start strip
function QuickStartStrip() {
  const { ws, setTab } = useStore();
  if (ws.fpds.length > 0 || ws.rows.length > 0) return null;
  const steps: { n: number; title: string; desc: string; action?: () => void; label: string; hint?: string }[] = [
    { n: 1, title: 'Import BOP.xlsx', desc: 'Load your Master BOP & PFMEA Combined Excel sheet to populate the Bill of Process.', label: 'Import Excel (.xlsx)', hint: 'Use the Import Excel (.xlsx) button in the top bar.' },
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
    download(`${fileSafe(ws.meta.factoryId || 'F4')}_summary-V2_${stamp()}.json`, JSON.stringify(buildSummary(ws, st.integrity), null, 2));
    st.toast('ok', 'summary@V2 exported (whole factory, all active FPDs) — import it into Master Control Hub.');
  };
  const downloadOffline = async () => {
    setMenu(false);
    let html = offlineAppHtml();
    if (!html && /^https?:$/.test(location.protocol)) {
      // Chunked or dev build: the page is not self-contained, so there is nothing complete to hand over.
      st.toast('warn', 'This copy is not the single-file build, so it cannot be saved as one file. Use Assembly_Spine_v1.html from the repository, or run "npm run build".');
      return;
    }
    if (!html) { st.toast('error', 'Could not assemble the offline file from this page.'); return; }
    download(OFFLINE_FILE_NAME, new Blob([html], { type: 'text/html;charset=utf-8' }), 'text/html');
    st.toast('ok', `${OFFLINE_FILE_NAME} saved (${(html.length / 1024 / 1024).toFixed(1)} MB). It runs with no internet connection. Your workspace is not inside it — use Export JSON to move data.`);
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
            <span className="w-[230px]"><TextInput cell value={ws.meta.name} onChange={(v) => st.mutate((d) => { d.meta.name = v || 'Untitled workspace'; })} ariaLabel="Workspace name" className="!py-0 !text-[11.5px] text-slate-600" /></span>
          </div>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button className="btn-ghost" onClick={st.undo} disabled={!st.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶ Undo</button>
        <button className="btn-ghost" onClick={st.redo} disabled={!st.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <input ref={xlsxRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={(e) => { void onXlsx(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => xlsxRef.current?.click()} disabled={busy}>{busy ? 'Reading…' : 'Import Excel / CSV'}</button>
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
        <div className="inline-flex items-center gap-1.5">
          <button className="btn" onClick={() => void downloadOffline()} title={`Save the whole application as one self-contained file, ${OFFLINE_FILE_NAME}`}>⤓ Download Offline App (.html)</button>
          <Tip id="downloadOffline" />
        </div>
        <div className="relative">
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>More ▾</button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div role="menu" className="card absolute right-0 z-50 mt-1 w-64 py-1 text-[12.5px]">
                <MenuItem onClick={() => void downloadOffline()}>Download Offline App (.html)</MenuItem>
                <div className="my-1 border-t border-slate-100" />
                <MenuItem onClick={() => void exportXlsx(false)}>Export Excel workbook (.xlsx)</MenuItem>
                <MenuItem onClick={() => void exportXlsx(true)}>Download Excel import template</MenuItem>
                {fsaSupported() && <MenuItem onClick={() => { setMenu(false); void st.openFile(); }}>Open &amp; link existing .json file…</MenuItem>}
                <MenuItem onClick={() => { setMenu(false); window.print(); }}>Print current tab</MenuItem>
                <div className="my-1 border-t border-slate-100" />
                <MenuItem onClick={() => { setMenu(false); if (window.confirm('Clear the workspace to a blank state? All FPDs, BOP rows, PFMEA entries, and layout data will be removed. (Undo will bring it back.)')) st.resetToBlank(); }}>Clear / Blank Workspace</MenuItem>
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
                  {c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}`}
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
              options={[{ value: '', label: 'All zones' }, ...ws.zones.map((z) => { const c = ws.cells.find((x) => x.id === z.cellId); return { value: z.id, label: z.code ? `Zone ${z.code} · ${z.name}` : z.name, group: c ? (c.name ? `${c.number} · ${c.name}` : `Cell ${c.number}`) : '?' }; })]}
              className="!py-[3px] !text-[12px]"
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone="dark">
            <span className="tabular-nums">{fmtInt(model.fpds.length)} of {fmtInt(ws.fpds.length)} FPDs active · {fmtInt(model.totals.workBlocks)} Baseline work blocks</span>
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
