// Application top bar: workspace name, file I/O, undo/redo, offline save, summary export.
import { useRef, useState } from 'react';
import { TextInput, Tip } from './primitives';
import ExcelImportModal from './ExcelImportModal';
import { buildSummary } from '../engine/gates';
import { exportWorkbook, parseWorkbook, type ParsedWorkbook } from '../lib/excel';
import { fmtDate } from '../lib/format';
import { download, fileSafe, fsaSupported, stamp } from '../lib/persistence';
import { useStore } from '../store';
import { APP_VERSION } from '../types';
import { OFFLINE_FILE_NAME, offlineAppHtml } from '../App';

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button role="menuitem" onClick={onClick} className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50">{children}</button>;
}

export default function TopBar() {
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
    const html = offlineAppHtml();
    if (!html && /^https?:$/.test(location.protocol)) { st.toast('warn', 'This copy is not the single-file build, so it cannot be saved as one file. Use Assembly_Spine_v1.html from the repository, or run "npm run build".'); return; }
    if (!html) { st.toast('error', 'Could not assemble the offline file from this page.'); return; }
    download(OFFLINE_FILE_NAME, new Blob([html], { type: 'text/html;charset=utf-8' }), 'text/html');
    st.toast('ok', `${OFFLINE_FILE_NAME} saved (${(html.length / 1024 / 1024).toFixed(1)} MB). It runs with no internet connection. Your workspace is not inside it — use Export JSON to move data.`);
  };
  const exportXlsx = async (template: boolean) => {
    setMenu(false);
    try { download(`${fileSafe(ws.meta.name)}_${template ? 'template' : stamp()}.xlsx`, await exportWorkbook(ws, st.model, template)); }
    catch (e) { st.toast('error', `Excel export failed: ${(e as Error).message}`); }
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
          <button className={`btn ${linked ? '!border-slate-400' : ''}`} onClick={() => (linked ? st.unlinkFile() : void st.linkFile())} title={linked ? `Linked to ${st.fileName} — click to unlink` : fsaSupported() ? 'Choose a .json file; every change is then saved to it automatically' : 'File System Access API not available in this browser — work is kept in browser storage'}>
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
          {menu && (<>
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
          </>)}
        </div>
      </div>
      {st.storageWarning && <div className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900">{st.storageWarning}</div>}
      {parsed && <ExcelImportModal parsed={parsed} onClose={() => setParsed(null)} />}
    </div>
  );
}
