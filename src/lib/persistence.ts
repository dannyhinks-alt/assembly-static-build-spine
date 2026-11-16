// Local-first persistence: File System Access API auto-save with localStorage fallback.
import { defaultSettings, seedWorkspace } from '../data/seed';
import type { BopRow, Workspace } from '../types';
import { APP_VERSION, WORKSPACE_SCHEMA } from '../types';

export const LS_KEY = 'asbcs.workspace.v1';
export const LS_SCOPE = 'asbcs.scope.v1';
export const LS_TAB = 'asbcs.tab.v1';

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const merge = <T extends object>(base: T, over: unknown): T => {
  const out = { ...base } as Record<string, unknown>;
  if (over && typeof over === 'object')
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[k];
      out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b as object, v) : v ?? b;
    }
  return out as T;
};

function normRow(r: Partial<BopRow>): BopRow {
  const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const row: BopRow = {
    id: String(r.id ?? `row_${Math.random().toString(36).slice(2)}`),
    fpdId: String(r.fpdId ?? ''),
    opId: String(r.opId ?? ''),
    description: String(r.description ?? ''),
    taskType: r.taskType === 'Parallel' ? 'Parallel' : 'Sequential',
    predecessors: arr<string>(r.predecessors).map(String),
    originZoneId: String(r.originZoneId ?? ''),
    destZoneId: String(r.destZoneId ?? ''),
    floorLevel: Math.min(3, Math.max(0, Math.round(n(r.floorLevel)))),
    componentIds: arr<string>(r.componentIds),
    crewSize: Math.max(1, n(r.crewSize, 1)),
    runHrs: n(r.runHrs),
    touchHrs: n(r.touchHrs),
    manningHrs: n(r.manningHrs),
    classification: r.classification === 'NNVA' || r.classification === 'NVA' ? r.classification : 'VA',
    actionType: (r.actionType ?? 'Fitting') as BopRow['actionType'],
    rigIds: arr<string>(r.rigIds),
    craneIds: arr<string>(r.craneIds),
    riggingIds: arr<string>(r.riggingIds),
    vehicleIds: arr<string>(r.vehicleIds),
    standIds: arr<string>(r.standIds),
    liftCount: Math.max(0, Math.round(n(r.liftCount))),
    moveCount: Math.max(0, Math.round(n(r.moveCount))),
    notes: String(r.notes ?? ''),
  };
  const kids = arr<Partial<BopRow>>(r.children);
  if (kids.length) row.children = kids.map((k) => ({ ...normRow(k), children: undefined }));
  return row;
}

/** Validate and upgrade anything that claims to be a workspace. Throws on a file that is not one. */
export function normaliseWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') throw new Error('File is not a JSON object.');
  const o = raw as Record<string, unknown>;
  if (o.schema === 'summary@V2') throw new Error('This is a summary@V2 export for the Master Hub, not a workspace file.');
  if (typeof o.schema !== 'string' || !o.schema.startsWith('asbcs-workspace@')) throw new Error('Not an Assembly & Static Build Central Spine workspace (missing "asbcs-workspace@1" schema tag).');
  if (!Array.isArray(o.rows) || !Array.isArray(o.fpds)) throw new Error('Workspace is missing its FPD or BOP tables.');
  const base = seedWorkspace();
  const now = new Date().toISOString();
  const layout = (o.layout ?? {}) as Partial<Workspace['layout']>;
  return {
    schema: WORKSPACE_SCHEMA,
    meta: merge({ ...base.meta, name: 'Imported workspace', createdAt: now, updatedAt: now, appVersion: APP_VERSION }, o.meta),
    settings: merge(defaultSettings(), o.settings),
    cells: arr(o.cells),
    zones: arr(o.zones),
    fpds: arr(o.fpds),
    components: arr(o.components),
    resources: arr(o.resources),
    rows: arr<Partial<BopRow>>(o.rows).map(normRow),
    pfmea: arr(o.pfmea),
    holdPoints: arr(o.holdPoints),
    assumptions: arr(o.assumptions),
    gateSignoffs: (o.gateSignoffs && typeof o.gateSignoffs === 'object' ? o.gateSignoffs : {}) as Workspace['gateSignoffs'],
    mitigations: (o.mitigations && typeof o.mitigations === 'object' ? o.mitigations : {}) as Workspace['mitigations'],
    layout: { shapes: arr(layout.shapes), image: layout.image ?? null, snapM: typeof layout.snapM === 'number' ? layout.snapM : 0.5 },
  };
}

export function loadLocal(): Workspace | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? normaliseWorkspace(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

/** Returns a warning string when the browser store could not take the full workspace. */
export function saveLocal(ws: Workspace): string | null {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws));
    return null;
  } catch {
    try {
      // Floor-plan images are the usual cause of a quota overflow — keep everything else.
      localStorage.setItem(LS_KEY, JSON.stringify({ ...ws, layout: { ...ws.layout, image: null } }));
      return 'Browser storage is full: saved without the floor-plan image. Link a .json file to keep everything.';
    } catch {
      return 'Browser storage unavailable — link a .json file or export to keep your work.';
    }
  }
}

export const serialise = (ws: Workspace): string => JSON.stringify(ws, null, 2);

// ---- File System Access API (Chromium). Typed locally so no extra lib is needed. ----
export interface FileHandle {
  name: string;
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  getFile: () => Promise<File>;
}
type Picker = (opts: unknown) => Promise<FileHandle & FileHandle[]>;
const w = () => window as unknown as { showSaveFilePicker?: Picker; showOpenFilePicker?: Picker };
export const fsaSupported = (): boolean => typeof window !== 'undefined' && typeof w().showSaveFilePicker === 'function';
const TYPES = [{ description: 'Central Spine workspace (.json)', accept: { 'application/json': ['.json'] } }];

export async function pickSaveFile(suggestedName: string): Promise<FileHandle | null> {
  try {
    return await w().showSaveFilePicker!({ suggestedName, types: TYPES });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}
export async function pickOpenFile(): Promise<FileHandle | null> {
  try {
    const hs = await w().showOpenFilePicker!({ types: TYPES, multiple: false });
    return hs[0] ?? null;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}
export async function writeHandle(h: FileHandle, text: string): Promise<void> {
  const s = await h.createWritable();
  await s.write(text);
  await s.close();
}

export function download(name: string, data: string | Blob, mime = 'application/json'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fileSafe = (s: string) => s.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workspace';
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/-/g, '');
