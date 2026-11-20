// Modal for previewing and applying an Excel / CSV workbook import.
import { useMemo, useState } from 'react';
import { Modal } from './primitives';
import { buildImport, type ParsedWorkbook } from '../lib/excel';
import { fmtInt } from '../lib/format';
import { useStore } from '../store';

interface Props {
  parsed: ParsedWorkbook;
  onClose: () => void;
}

export default function ExcelImportModal({ parsed, onClose }: Props) {
  const st = useStore();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const { result: res, error: importError } = useMemo(() => {
    try {
      return { result: buildImport(parsed, st.ws, mode), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [parsed, st.ws, mode]);
  const nothing = !res || res.sheetsRead.length === 0;
  return (
    <Modal
      title={`Import Excel — ${parsed.fileName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={nothing || !!importError} onClick={() => { if (!res) return; st.replace(res.ws, { keepLink: true }); st.toast(res.warnings.length ? 'warn' : 'ok', `Excel import applied${res.warnings.length ? ` with ${res.warnings.length} warning(s)` : ''}. Undo reverts it.`); onClose(); }}>Apply import</button>
        </>
      }
    >
      {importError && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          <div className="mb-1 font-semibold">Import error — no changes applied</div>
          <p>{importError}</p>
        </div>
      )}
      {!importError && (
        <>
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
          <div className="mb-3 text-xs text-slate-500">
            Sheets recognised: {res?.sheetsRead.length ? res.sheetsRead.join(', ') : 'none'}
            {parsed.bopSheetName && (
              <span className="ml-2 font-medium text-slate-700">
                · Matched sheet &ldquo;{parsed.bopSheetName}&rdquo; · headers at Row {parsed.bopHeaderRow}
              </span>
            )}
          </div>
          {(res?.skippedRows ?? 0) > 0 && (
            <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              {res!.skippedRows} repeated header / helper row{res!.skippedRows !== 1 ? 's were' : ' was'} detected mid-sheet and skipped automatically.
            </div>
          )}
          <table className="mb-3 w-full">
            <thead><tr><th className="th">Table</th><th className="th text-right">Added</th><th className="th text-right">Updated</th></tr></thead>
            <tbody>
              {(res?.counts ?? []).map((c) => (<tr key={c.label}><td className="td-ro">{c.label}</td><td className="td-ro text-right">{fmtInt(c.added)}</td><td className="td-ro text-right">{fmtInt(c.updated)}</td></tr>))}
              {!res?.counts.length && <tr><td className="td-ro text-slate-500" colSpan={3}>Nothing to import.</td></tr>}
            </tbody>
          </table>
          {parsed.bopSheetName && res && res.counts.reduce((s, c) => s + c.added + c.updated, 0) === 0 && (
            <div className="mb-3 rounded border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
              <div className="mb-1 font-semibold">No rows imported — column layout may not match</div>
              <p className="mb-1">Sheet: <span className="font-mono font-medium">{parsed.bopSheetName}</span> · headers at row {parsed.bopHeaderRow}</p>
              {parsed.bopDetectedHeaders?.length && (
                <p className="mb-1">Detected columns: <span className="font-mono">{parsed.bopDetectedHeaders.join(' · ')}</span></p>
              )}
              {parsed.bopFirstDataRow && (
                <p className="break-all">First data row: <span className="font-mono">{Object.entries(parsed.bopFirstDataRow).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</span></p>
              )}
              <p className="mt-1 text-orange-700">Download the template for the exact column layout expected by the importer.</p>
            </div>
          )}
          {(res?.warnings.length ?? 0) > 0 && (
            <div className="scroll-thin max-h-48 overflow-auto rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
              <div className="mb-1 font-semibold">{res!.warnings.length} warning(s)</div>
              <ul className="list-disc space-y-0.5 pl-4">{res!.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
