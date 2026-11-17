// Workspace store: immutable state with undo/redo, derived engine model, scope filter and persistence.
import { produce, type Draft } from 'immer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { blankWorkspace, seedWorkspace } from './data/seed';
import { runIntegrity, type IntegrityReport } from './engine/integrity';
import { buildModel, type Model } from './engine/model';
import {
  LS_SCOPE, LS_TAB, download, fileSafe, fsaSupported, loadLocal, normaliseWorkspace, pickOpenFile, pickSaveFile, saveLocal, serialise, stamp, writeHandle,
  type FileHandle,
} from './lib/persistence';
import type { Scope, Workspace } from './types';
import { FACTORY_SCOPE } from './types';

export interface Toast { id: number; kind: 'ok' | 'warn' | 'error'; text: string }
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Store {
  ws: Workspace;
  mutate: (recipe: (d: Draft<Workspace>) => void) => void;
  replace: (ws: Workspace, opts?: { keepLink?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  scope: Scope;
  setScope: (s: Scope) => void;
  tab: number;
  setTab: (t: number) => void;
  model: Model;
  integrity: IntegrityReport;
  // persistence
  dirty: boolean;
  fileName: string | null;
  saveState: SaveState;
  lastSaved: string | null;
  storageWarning: string | null;
  linkFile: () => Promise<void>;
  openFile: () => Promise<void>;
  unlinkFile: () => void;
  exportJson: () => void;
  importJsonText: (text: string, name: string) => void;
  resetToSeed: () => void;
  resetToBlank: () => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const HISTORY = 60;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [hist, setHist] = useState<{ past: Workspace[]; ws: Workspace; future: Workspace[] }>(() => ({ past: [], ws: loadLocal() ?? blankWorkspace(), future: [] }));
  const [scope, setScopeState] = useState<Scope>(() => ({ ...FACTORY_SCOPE, ...readJson<Partial<Scope>>(LS_SCOPE, {}) }));
  const [tab, setTabState] = useState<number>(() => Math.min(9, Math.max(1, readJson<number>(LS_TAB, 1))));
  const [dirty, setDirty] = useState(false);
  const [handle, setHandle] = useState<FileHandle | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ws = hist.ws;

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'ok' ? 4000 : 8000);
  }, []);

  const mutate = useCallback((recipe: (d: Draft<Workspace>) => void) => {
    setHist((h) => {
      const next = produce(h.ws, (d) => {
        recipe(d);
        d.meta.updatedAt = new Date().toISOString();
      });
      if (next === h.ws) return h;
      return { past: [...h.past.slice(-HISTORY + 1), h.ws], ws: next, future: [] };
    });
    setDirty(true);
  }, []);

  const replace = useCallback((next: Workspace, opts?: { keepLink?: boolean }) => {
    setHist((h) => ({ past: [...h.past.slice(-HISTORY + 1), h.ws], ws: next, future: [] }));
    if (!opts?.keepLink) setHandle(null);
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), ws: h.past[h.past.length - 1], future: [h.ws, ...h.future] } : h));
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    setHist((h) => (h.future.length ? { past: [...h.past, h.ws], ws: h.future[0], future: h.future.slice(1) } : h));
    setDirty(true);
  }, []);

  const setScope = useCallback((s: Scope) => {
    setScopeState(s);
    try { localStorage.setItem(LS_SCOPE, JSON.stringify(s)); } catch { /* ignore */ }
  }, []);
  const setTab = useCallback((t: number) => {
    setTabState(t);
    try { localStorage.setItem(LS_TAB, JSON.stringify(t)); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, []);

  // Keep the scope valid when FPDs / cells / zones are deleted.
  useEffect(() => {
    const fp = new Set(ws.fpds.map((f) => f.fpdId));
    const ce = new Set(ws.cells.map((c) => c.id));
    const fixed: Scope = {
      ...scope,
      fpdIds: scope.fpdIds.filter((i) => fp.has(i)),
      cellIds: scope.cellIds.filter((i) => ce.has(i)),
      zoneId: scope.zoneId && ws.zones.some((z) => z.id === scope.zoneId) ? scope.zoneId : '',
    };
    if (fixed.fpdIds.length !== scope.fpdIds.length || fixed.cellIds.length !== scope.cellIds.length || fixed.zoneId !== scope.zoneId) setScope(fixed);
  }, [ws.fpds, ws.cells, ws.zones, scope, setScope]);

  const integrity = useMemo(() => runIntegrity(ws), [ws]);
  const model = useMemo(
    () => (scope.mode === 'factory' && !scope.zoneId ? integrity.factory : buildModel(ws, scope)),
    [ws, scope, integrity],
  );

  // --- localStorage auto-save (always) ---
  useEffect(() => {
    const t = window.setTimeout(() => setStorageWarning(saveLocal(ws)), 400);
    return () => window.clearTimeout(t);
  }, [ws]);

  // --- linked-file auto-save ---
  const latest = useRef(ws);
  latest.current = ws;
  useEffect(() => {
    if (!handle || !dirty) return;
    setSaveState('saving');
    const t = window.setTimeout(async () => {
      try {
        await writeHandle(handle, serialise(latest.current));
        setSaveState('saved');
        setLastSaved(new Date().toISOString());
        setDirty(false);
      } catch (e) {
        setSaveState('error');
        toast('error', `Auto-save to ${handle.name} failed: ${(e as Error).message}. Re-link the file.`);
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [ws, handle, dirty, toast]);

  // --- dirty-state warning on close ---
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const suggested = () => `${fileSafe(ws.meta.name)}.spine.json`;
  const exportJson = useCallback(() => {
    download(`${fileSafe(latest.current.meta.name)}_${stamp()}.spine.json`, serialise(latest.current));
    setDirty(false);
    setLastSaved(new Date().toISOString());
    toast('ok', 'Workspace exported as .json');
  }, [toast]);

  const linkFile = useCallback(async () => {
    if (!fsaSupported()) {
      toast('warn', 'This browser has no File System Access API, so a live file link is not possible. Your work is kept in browser storage — use Export JSON to save a file.');
      return;
    }
    try {
      const h = await pickSaveFile(suggested());
      if (!h) return;
      await writeHandle(h, serialise(latest.current));
      setHandle(h);
      setSaveState('saved');
      setLastSaved(new Date().toISOString());
      setDirty(false);
      toast('ok', `Auto-save linked to ${h.name}`);
    } catch (e) {
      toast('error', `Could not link file: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, ws.meta.name]);

  const importJsonText = useCallback((text: string, name: string) => {
    try {
      const next = normaliseWorkspace(JSON.parse(text));
      replace(next);
      toast('ok', `Loaded ${name}: ${next.fpds.length} FPDs, ${next.rows.length} Baseline work blocks. Undo restores the previous workspace.`);
    } catch (e) {
      toast('error', `Import failed — ${(e as Error).message}`);
    }
  }, [replace, toast]);

  const openFile = useCallback(async () => {
    try {
      const h = await pickOpenFile();
      if (!h) return;
      const text = await (await h.getFile()).text();
      const next = normaliseWorkspace(JSON.parse(text));
      setHist((x) => ({ past: [...x.past.slice(-HISTORY + 1), x.ws], ws: next, future: [] }));
      setHandle(h);
      setDirty(false);
      setSaveState('saved');
      setLastSaved(new Date().toISOString());
      toast('ok', `Opened and linked ${h.name}`);
    } catch (e) {
      toast('error', `Open failed — ${(e as Error).message}`);
    }
  }, [toast]);

  const unlinkFile = useCallback(() => {
    setHandle(null);
    setSaveState('idle');
  }, []);
  const resetToSeed = useCallback(() => {
    replace(seedWorkspace());
    setScope(FACTORY_SCOPE);
    toast('ok', 'PMA / UMA baseline dataset restored. Undo brings your previous workspace back.');
  }, [replace, setScope, toast]);

  const resetToBlank = useCallback(() => {
    replace(blankWorkspace());
    setScope(FACTORY_SCOPE);
    toast('ok', 'Workspace cleared. Undo brings your previous workspace back.');
  }, [replace, setScope, toast]);

  const value: Store = {
    ws, mutate, replace, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, scope, setScope, tab, setTab, model, integrity,
    dirty, fileName: handle?.name ?? null, saveState, lastSaved, storageWarning, linkFile, openFile, unlinkFile, exportJson, importJsonText, resetToSeed, resetToBlank, toasts, toast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
