// Modal for previewing and applying an Excel / CSV workbook import.
import { useState } from 'react';
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
      {res.skippedRows > 0 && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {res.skippedRows} repeated header / helper row{res.skippedRows !== 1 ? 's were' : ' was'} detected mid-sheet and skipped automatically.
        </div>
      )}
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
