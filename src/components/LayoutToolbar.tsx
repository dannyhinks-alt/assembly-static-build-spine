// Toolbar, tool selector, image controls and geometry import for the LayoutEditor.
import { useRef } from 'react';
import { fitToBoundary, importGeometry, LAYOUT_TARGETS } from '../lib/geometry';
import { rotateDataUrl90 } from '../lib/imageProcessing';
import { download, fileSafe } from '../lib/persistence';
import { fmt } from '../lib/format';
import { NumInput, Select, Tip } from './primitives';
import { useStore } from '../store';
import type { FloorPlan, LayoutImage, LayoutShape, Pt } from '../types';

type Tool = 'select' | 'box' | 'polygon' | 'calibrate' | 'pan';

const DRAW_TOOLS: { v: Tool; label: string; hint: string }[] = [
  { v: 'select', label: 'Select / edit', hint: 'Click a shape to select it; drag its corner handles to adjust.' },
  { v: 'box', label: 'Box', hint: 'Drag a rectangle. It snaps to the grid and is assigned to the target chosen on the right.' },
  { v: 'polygon', label: 'Polygon', hint: 'Click each corner; click the first point again or double-click to close. Esc cancels.' },
  { v: 'calibrate', label: '2-point scale', hint: 'Click two points on the image a known distance apart, enter the distance and Apply scale.' },
  { v: 'pan', label: 'Pan', hint: 'Drag to pan the view. Use scroll wheel to zoom.' },
];

interface LayoutToolbarProps {
  img: LayoutImage | null;
  mutateFl: (fn: (fl: FloorPlan) => void) => void;
  ingestImage: (f: File) => Promise<void>;
  replaceOnImport: boolean;
  setReplaceOnImport: (v: boolean) => void;
  fit: boolean;
  setFit: (v: boolean) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  setDraft: (pts: Pt[]) => void;
  setBoxStart: (p: Pt | null) => void;
  target: string;
  setTarget: (t: string) => void;
  targets: ReturnType<typeof LAYOUT_TARGETS>;
  calibDist: number | null;
  setCalibDist: (v: number | null) => void;
  draft: Pt[];
  applyCalibration: () => void;
  zoom: number;
  resetView: () => void;
  snapM: number;
  shapes: LayoutShape[];
  imgOpacity: number;
  setImgOpacity: (v: number) => void;
  workspaceName: string;
  L: number;
  W: number;
}

/**
 * Purpose: Renders the layout editor toolbar — geometry import, floor-plan image
 *   upload/rotate/remove, drawing tool selector, calibration controls, snap, zoom,
 *   image opacity, and geometry export.
 *
 * Downstream impact: tool/target/draft/calibration changes directly affect the
 *   drawing state in LayoutEditor, which feeds ws.layout.shapes and ws.layout.image.
 */
export function LayoutToolbar({ img, mutateFl, ingestImage, replaceOnImport, setReplaceOnImport, fit, setFit, tool, setTool, setDraft, setBoxStart, target, setTarget, targets, calibDist, setCalibDist, draft, applyCalibration, zoom, resetView, snapM, shapes, imgOpacity, setImgOpacity, workspaceName, L, W }: LayoutToolbarProps) {
  const { mutate, toast } = useStore();
  const geoRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const onGeometry = async (f?: File) => {
    if (!f) return;
    try {
      const res = importGeometry(f.name, await f.text(), []);
      let importedShapes: LayoutShape[] = res.shapes;
      let note = '';
      if (fit) {
        const r = fitToBoundary(importedShapes, L, W);
        importedShapes = r.shapes;
        note = ` Scaled ×${fmt(r.scale, 4)} to fit the ${fmt(L, 0)} × ${fmt(W, 0)} m boundary.`;
      }
      mutateFl((fl) => { fl.shapes = replaceOnImport ? importedShapes : [...fl.shapes, ...importedShapes]; });
      toast(res.warnings.length ? 'warn' : 'ok', `${res.format}: ${importedShapes.length} polygon(s) imported.${note}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''} Check the Assigned To column.`);
    } catch (e) {
      toast('error', `Geometry import failed — ${(e as Error).message}`);
    }
  };

  const rotateImage90 = async () => {
    if (!img) return;
    const result = await rotateDataUrl90(img.dataUrl, img.widthPx, img.heightPx);
    mutateFl((fl) => { fl.image = { dataUrl: result.dataUrl, widthPx: result.widthPx, heightPx: result.heightPx, mPerPx: null, calib: null }; });
    setDraft([]);
    toast('ok', 'Image rotated 90° clockwise. Recalibrate scale if needed.');
  };

  const hintText = DRAW_TOOLS.find((t) => t.v === tool)!.hint;

  return (
    <>
      {/* Main toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input ref={geoRef} type="file" accept=".json,.svg,.dxf" className="hidden" onChange={(e) => { void onGeometry(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => geoRef.current?.click()}>Import JSON / SVG / DXF…</button>
        <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={replaceOnImport} onChange={(e) => setReplaceOnImport(e.target.checked)} />Replace existing</label>
        <label className="flex items-center gap-1 text-[12px] text-slate-600" title="Uniformly scales and moves the imported outlines to fit the factory boundary."><input type="checkbox" className="accent-slate-800" checked={fit} onChange={(e) => setFit(e.target.checked)} />Fit to boundary</label>
        <span className="h-5 w-px bg-slate-200" />
        <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void ingestImage(f); e.target.value = ''; }} />
        <button className="btn" onClick={() => imgRef.current?.click()}>Upload floor-plan image…</button>
        {img && (
          <>
            <button className="btn" title="Rotate image 90° clockwise (resets calibration)" onClick={() => void rotateImage90()}>↻ Rotate 90°</button>
            <button className="btn-ghost" onClick={() => { mutateFl((fl) => { fl.image = null; }); }}>Remove image</button>
          </>
        )}
        <button className="btn-ghost ml-auto" onClick={() => download(`${fileSafe(workspaceName)}_layout.json`, JSON.stringify({ units: 'm', boundary: { lengthM: L, widthM: W }, shapes }, null, 2))}>Export layout JSON</button>
        <Tip id="layoutImporter" />
      </div>

      {/* Tool selector */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
          {DRAW_TOOLS.map((t) => (
            <button key={t.v} disabled={t.v === 'calibrate' && !img} onClick={() => { setTool(t.v); setDraft([]); setBoxStart(null); }} className={`border-r border-slate-300 px-2.5 py-1 text-[12px] font-medium last:border-r-0 disabled:opacity-40 ${tool === t.v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t.label}</button>
          ))}
        </div>
        {(tool === 'box' || tool === 'polygon') && (
          <span className="flex items-center gap-1.5 text-[12px] text-slate-600">Assign new shape to
            <span className="w-52"><Select value={target} onChange={setTarget} options={targets} ariaLabel="Target for new shape" /></span>
          </span>
        )}
        {tool === 'calibrate' && (
          <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
            Reference distance <NumInput value={calibDist} onChange={setCalibDist} min={0.01} width={70} ariaLabel="Reference distance in metres" /> m
            <button className="btn-primary" disabled={draft.length !== 2 || !calibDist} onClick={applyCalibration}>Apply scale</button>
            <Tip id="calibration" />
            {img?.calib && <span className="text-slate-500">Current: {fmt((img.mPerPx ?? 0) * 1000, 1)} mm/px from a {fmt(img.calib.distanceM, 1)} m reference</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600">Snap <NumInput value={snapM} onChange={(v) => mutate((d) => { d.layout.snapM = v ?? 0; })} min={0} max={10} width={56} ariaLabel="Snap grid in metres" /> m <Tip id="snap" /></span>
      </div>

      {/* Image / zoom controls */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
        {img && (
          <>
            <span>Opacity</span>
            <input type="range" min={15} max={100} value={Math.round(imgOpacity * 100)} onChange={(e) => setImgOpacity(Number(e.target.value) / 100)} className="w-28 accent-slate-800" aria-label="Image opacity" />
            <span className="w-8 tabular-nums">{Math.round(imgOpacity * 100)}%</span>
            <span className="ml-2 text-slate-400">|</span>
          </>
        )}
        <span>Zoom {Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={resetView}>Reset View</button>
      </div>

      <p className="mb-2 text-[11.5px] text-slate-500">{hintText}{img && !img.mPerPx ? ' Image is not yet calibrated — it is shown stretched to the boundary length.' : ''} Drag and drop an image file or paste (Ctrl+V) to load a floor plan.</p>
    </>
  );
}
