// Propel Floor Layout Geometry Importer: JSON / SVG / DXF polygons, or trace over a calibrated floor-plan image.
// Supports multiple floor plans, drag-and-drop / paste image ingestion, opacity, rotation, zoom and pan.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT_TARGETS, fitToBoundary, importGeometry, polygonArea, snapTo } from '../lib/geometry';
import { fmt } from '../lib/format';
import { download, fileSafe } from '../lib/persistence';
import { useStore } from '../store';
import type { FloorPlan, LayoutImage, LayoutShape, Pt } from '../types';
import { uid } from '../types';
import { NumInput, Select, TextInput, Th, Tip } from './primitives';

type Tool = 'select' | 'box' | 'polygon' | 'calibrate' | 'pan';
const TONE: Record<string, { fill: string; stroke: string }> = {
  cell: { fill: '#0ea5e91a', stroke: '#0369a1' },
  stores: { fill: '#64748b22', stroke: '#475569' },
  stand: { fill: '#0f172a26', stroke: '#0f172a' },
  dispatch: { fill: '#7c3aed1c', stroke: '#6d28d9' },
  '': { fill: '#94a3b814', stroke: '#94a3b8' },
};
const toneOf = (target: string) => TONE[target.startsWith('cell:') ? 'cell' : target] ?? TONE[''];

/** Resize a data-URL image to max 2400px on its longest edge using an offscreen canvas. */
async function resizeDataUrl(dataUrl: string, widthPx: number, heightPx: number): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const MAX = 2400;
  if (Math.max(widthPx, heightPx) <= MAX) return { dataUrl, widthPx, heightPx };
  const scale = MAX / Math.max(widthPx, heightPx);
  const nw = Math.round(widthPx * scale);
  const nh = Math.round(heightPx * scale);
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d')!;
  await new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { ctx.drawImage(im, 0, 0, nw, nh); res(); };
    im.src = dataUrl;
  });
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), widthPx: nw, heightPx: nh };
}

export default function LayoutEditor() {
  const { ws, mutate, toast } = useStore();
  const { lengthM: L, widthM: W } = ws.settings.envelope;
  const layout = ws.layout;

  // ---- Floor plan tabs ----
  const floors = layout.floors ?? [];
  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const safeIdx = Math.min(activeFloorIdx, Math.max(0, floors.length - 1));
  const activeFloor: FloorPlan | undefined = floors[safeIdx];
  const img: LayoutImage | null = activeFloor?.image ?? null;
  const shapes: LayoutShape[] = activeFloor?.shapes ?? [];

  /** Mutate the active floor's data, keeping flat layout.shapes/image in sync for floor 0. */
  const mutateFl = useCallback((fn: (fl: FloorPlan) => void) => {
    mutate((d) => {
      const fl = (d.layout.floors ?? [])[safeIdx] as FloorPlan | undefined;
      if (!fl) return;
      fn(fl as FloorPlan);
      if (safeIdx === 0) {
        d.layout.shapes = (fl as FloorPlan).shapes;
        d.layout.image = (fl as FloorPlan).image;
      }
    });
  }, [mutate, safeIdx]);

  // ---- Drawing state ----
  const svgRef = useRef<SVGSVGElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [boxStart, setBoxStart] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ id: string; i: number; pts: Pt[] } | null>(null);
  const [calibDist, setCalibDist] = useState<number | null>(40);
  const [replaceOnImport, setReplaceOnImport] = useState(true);
  const [fit, setFit] = useState(true);
  const [target, setTarget] = useState<string>('');

  // ---- New controls ----
  const [imgOpacity, setImgOpacity] = useState(0.75);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<[number, number]>([0, 0]);
  const [panStart, setPanStart] = useState<{ clientXY: [number, number]; initPan: [number, number] } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const targets = useMemo(() => LAYOUT_TARGETS(ws.cells), [ws.cells]);
  const targetLabel = (t: string) => targets.find((x) => x.value === t)?.label ?? 'Unassigned';

  useEffect(() => {
    const used = new Set(shapes.map((s) => s.target));
    setTarget(targets.find((t) => t.value && !used.has(t.value))?.value ?? '');
  }, [shapes, targets]);

  // Reset drawing state when switching floors
  useEffect(() => { setSelected(null); setDraft([]); setBoxStart(null); }, [safeIdx]);

  // ---- Image ingestion (file, drag-drop, paste) ----
  const ingestImage = useCallback(async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('warn', 'Only PNG, JPEG and WEBP images are supported.');
    if (file.size > 20 * 1024 * 1024) return toast('warn', 'Image exceeds 20 MB — reduce it first.');
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const { widthPx: rawW, heightPx: rawH } = await new Promise<{ widthPx: number; heightPx: number }>((res) => {
        const im = new Image();
        im.onload = () => res({ widthPx: im.naturalWidth, heightPx: im.naturalHeight });
        im.src = dataUrl;
      });
      const resized = await resizeDataUrl(dataUrl, rawW, rawH);
      const wasResized = resized.widthPx < rawW || resized.heightPx < rawH;
      mutateFl((fl) => { fl.image = { dataUrl: resized.dataUrl, widthPx: resized.widthPx, heightPx: resized.heightPx, mPerPx: null, calib: null }; });
      setTool('calibrate');
      setDraft([]);
      toast('ok', `Floor plan loaded${wasResized ? ` (resized from ${rawW}×${rawH} to ${resized.widthPx}×${resized.heightPx})` : ''}. Click two points a known distance apart, enter the distance, then Apply scale.`);
    } catch {
      toast('error', 'Failed to load image — the file may be corrupt.');
    }
  }, [mutateFl, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft([]); setBoxStart(null); } };
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); const f = item.getAsFile(); if (f) void ingestImage(f); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, [ingestImage]);

  // ---- Rotate 90° clockwise (re-encodes the image, resets calibration) ----
  const rotateImage90 = useCallback(async () => {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.heightPx;
    canvas.height = img.widthPx;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    await new Promise<void>((res) => {
      const im = new Image();
      im.onload = () => { ctx.drawImage(im, -img.widthPx / 2, -img.heightPx / 2); res(); };
      im.src = img.dataUrl;
    });
    const newUrl = canvas.toDataURL('image/jpeg', 0.9);
    mutateFl((fl) => { fl.image = { dataUrl: newUrl, widthPx: img.heightPx, heightPx: img.widthPx, mPerPx: null, calib: null }; });
    setDraft([]);
    toast('ok', 'Image rotated 90° clockwise. Recalibrate scale if needed.');
  }, [img, mutateFl, toast]);

  // ---- Zoom / pan viewBox ----
  const margin = useMemo(() => Math.max(L, W) / 500 * 14, [L, W]);
  const baseVW = L + margin * 2;
  const baseVH = W + margin * 2;
  const vw = baseVW / zoom;
  const vh = baseVH / zoom;
  const vx = -margin + panOffset[0] - (vw - baseVW) / 2;
  const vy = -margin + panOffset[1] - (vh - baseVH) / 2;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    setZoom((z) => Math.max(0.3, Math.min(10, z * factor)));
  };
  const resetView = () => { setZoom(1); setPanOffset([0, 0]); };

  const px = Math.max(L, W) / 500; // one screen-unit in metres for strokes/handles

  const toM = (e: React.MouseEvent, snap = true): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    const step = snap && tool !== 'calibrate' ? layout.snapM : 0;
    return [snapTo(q.x, step), snapTo(q.y, step)];
  };

  const addShape = (points: Pt[]) => {
    if (polygonArea(points) < 0.01) return;
    const id = uid('sh');
    mutateFl((fl) => { fl.shapes.push({ id, target, label: targetLabel(target), points }); });
    setSelected(id);
  };

  // ---- Mouse events ----
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (tool === 'pan') {
      setPanStart({ clientXY: [e.clientX, e.clientY], initPan: panOffset });
      return;
    }
    const p = toM(e);
    if (tool === 'box') setBoxStart(p);
  };
  const onMove = (e: React.MouseEvent) => {
    if (tool === 'pan' && panStart) {
      const dx = (e.clientX - panStart.clientXY[0]) * vw / (svgRef.current?.clientWidth ?? 1);
      const dy = (e.clientY - panStart.clientXY[1]) * vh / (svgRef.current?.clientHeight ?? 1);
      setPanOffset([panStart.initPan[0] - dx, panStart.initPan[1] - dy]);
      return;
    }
    const p = toM(e);
    setHover(p);
    if (drag) setDrag({ ...drag, pts: drag.pts.map((q, i) => (i === drag.i ? p : q)) });
  };
  const onUp = (e: React.MouseEvent) => {
    if (tool === 'pan') { setPanStart(null); return; }
    const p = toM(e);
    if (drag) {
      const { id, pts } = drag;
      mutateFl((fl) => { const s = fl.shapes.find((x) => x.id === id); if (s) s.points = pts; });
      setDrag(null);
      return;
    }
    if (tool === 'box' && boxStart) {
      const [x1, y1] = boxStart;
      addShape([[Math.min(x1, p[0]), Math.min(y1, p[1])], [Math.max(x1, p[0]), Math.min(y1, p[1])], [Math.max(x1, p[0]), Math.max(y1, p[1])], [Math.min(x1, p[0]), Math.max(y1, p[1])]]);
      setBoxStart(null);
    }
  };
  const onClick = (e: React.MouseEvent) => {
    if (tool === 'pan') return;
    const p = toM(e);
    if (tool === 'polygon') {
      if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < px * 8) { addShape(draft); setDraft([]); }
      else setDraft([...draft, p]);
    } else if (tool === 'calibrate') {
      setDraft(draft.length >= 2 ? [p] : [...draft, p]);
    } else if (tool === 'select' && e.target === svgRef.current) setSelected(null);
  };
  const onDbl = () => {
    if (tool === 'polygon' && draft.length >= 3) { addShape(draft.slice(0, -1).length >= 3 ? draft.slice(0, -1) : draft); setDraft([]); }
  };

  const applyCalibration = () => {
    if (!img || draft.length !== 2 || !calibDist || calibDist <= 0) return;
    const mPerPxCur = img.mPerPx ?? L / img.widthPx;
    const dM = Math.hypot(draft[1][0] - draft[0][0], draft[1][1] - draft[0][1]);
    const dPx = dM / mPerPxCur;
    if (dPx < 2) return toast('warn', 'Calibration points are too close together.');
    const scale = calibDist / dPx;
    mutateFl((fl) => { if (fl.image) { fl.image.mPerPx = scale; fl.image.calib = { a: [draft[0][0] / mPerPxCur, draft[0][1] / mPerPxCur], b: [draft[1][0] / mPerPxCur, draft[1][1] / mPerPxCur], distanceM: calibDist }; } });
    setDraft([]);
    setTool('box');
    toast('ok', `Image calibrated: ${fmt(scale * 1000, 1)} mm per pixel (${fmt(img.widthPx * scale, 1)} m × ${fmt(img.heightPx * scale, 1)} m). Now trace the cells.`);
  };

  const onGeometry = async (f?: File) => {
    if (!f) return;
    try {
      const res = importGeometry(f.name, await f.text(), ws.cells);
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

  const mPerPx = img ? img.mPerPx ?? L / img.widthPx : 1;
  const allocated = shapes.filter((s) => s.target.startsWith('cell:') || s.target === 'stores' || s.target === 'dispatch').reduce((a, s) => a + polygonArea(s.points), 0);
  const total = L * W;
  const gridStep = Math.max(L, W) > 120 ? 20 : 10;

  const drawTools: { v: Tool; label: string; hint: string }[] = [
    { v: 'select', label: 'Select / edit', hint: 'Click a shape to select it; drag its corner handles to adjust.' },
    { v: 'box', label: 'Box', hint: 'Drag a rectangle. It snaps to the grid and is assigned to the target chosen on the right.' },
    { v: 'polygon', label: 'Polygon', hint: 'Click each corner; click the first point again or double-click to close. Esc cancels.' },
    { v: 'calibrate', label: '2-point scale', hint: 'Click two points on the image a known distance apart, enter the distance and Apply scale.' },
    { v: 'pan', label: 'Pan', hint: 'Drag to pan the view. Use scroll wheel to zoom.' },
  ];

  return (
    <div>
      {/* ---- Floor plan tabs ---- */}
      <div className="mb-3 flex items-end overflow-x-auto border-b border-slate-200">
        {floors.map((floor, idx) => (
          <button
            key={floor.id}
            onClick={() => setActiveFloorIdx(idx)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-[12.5px] transition-colors ${idx === safeIdx ? 'border-sky-600 bg-white font-medium text-sky-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`}
          >
            {floor.name} · {floor.elevationM.toFixed(2)} m
          </button>
        ))}
        <button
          className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-1.5 text-[12.5px] text-sky-600 hover:text-sky-800"
          onClick={() => {
            const nextElev = floors.length > 0 ? floors[floors.length - 1].elevationM + 3 : 0;
            mutate((d) => { const fl = d.layout.floors ?? []; fl.push({ id: uid('fp'), name: `Floor ${fl.length}`, elevationM: nextElev, image: null, shapes: [] }); if (!d.layout.floors) d.layout.floors = fl; });
            setActiveFloorIdx(floors.length);
          }}
        >
          ＋ Add Floor Plan
        </button>
        {floors.length > 1 && (
          <button
            className="-mb-px ml-auto whitespace-nowrap border-b-2 border-transparent px-2 py-1.5 text-[11.5px] text-red-500 hover:text-red-700"
            onClick={() => {
              if (safeIdx === 0) return toast('warn', 'Cannot delete the ground floor.');
              if (!window.confirm(`Delete "${floors[safeIdx].name}"? All shapes on this floor will be lost.`)) return;
              mutate((d) => { d.layout.floors?.splice(safeIdx, 1); });
              setActiveFloorIdx(safeIdx - 1);
            }}
          >
            Delete floor
          </button>
        )}
      </div>

      {/* ---- Floor name / elevation editor ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
        <span className="font-medium text-slate-700">Floor plan:</span>
        <input
          value={activeFloor?.name ?? ''}
          onChange={(e) => mutate((d) => { const fl = (d.layout.floors ?? [])[safeIdx]; if (fl) fl.name = e.target.value; })}
          className="inp w-40"
          aria-label="Floor plan name"
        />
        <span>Elevation</span>
        <input
          type="number"
          value={activeFloor?.elevationM ?? 0}
          readOnly={safeIdx === 0}
          onChange={(e) => mutate((d) => { const fl = (d.layout.floors ?? [])[safeIdx]; if (fl && safeIdx > 0) fl.elevationM = parseFloat(e.target.value) || 0; })}
          className={`inp w-20 ${safeIdx === 0 ? 'opacity-60' : ''}`}
          aria-label="Floor elevation metres"
        />
        <span>m above datum</span>
      </div>

      {/* ---- Main toolbar ---- */}
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
        <button className="btn-ghost ml-auto" onClick={() => download(`${fileSafe(ws.meta.name)}_layout.json`, JSON.stringify({ units: 'm', boundary: { lengthM: L, widthM: W }, shapes }, null, 2))}>Export layout JSON</button>
        <Tip id="layoutImporter" />
      </div>

      {/* ---- Tool selector ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
          {drawTools.map((t) => (
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
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600">Snap <NumInput value={layout.snapM} onChange={(v) => mutate((d) => { d.layout.snapM = v ?? 0; })} min={0} max={10} width={56} ariaLabel="Snap grid in metres" /> m <Tip id="snap" /></span>
      </div>

      {/* ---- Image controls ---- */}
      {img && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
          <span>Opacity</span>
          <input type="range" min={15} max={100} value={Math.round(imgOpacity * 100)} onChange={(e) => setImgOpacity(Number(e.target.value) / 100)} className="w-28 accent-slate-800" aria-label="Image opacity" />
          <span className="w-8 tabular-nums">{Math.round(imgOpacity * 100)}%</span>
          <span className="ml-2 text-slate-400">|</span>
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <button className="btn" onClick={resetView}>Reset View</button>
        </div>
      )}
      {!img && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <button className="btn" onClick={resetView}>Reset View</button>
        </div>
      )}

      <p className="mb-2 text-[11.5px] text-slate-500">{drawTools.find((t) => t.v === tool)!.hint}{img && !img.mPerPx ? ' Image is not yet calibrated — it is shown stretched to the boundary length.' : ''} Drag and drop an image file or paste (Ctrl+V) to load a floor plan.</p>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        {/* ---- SVG Canvas ---- */}
        <div
          className={`overflow-hidden rounded border bg-white ${isDragOver ? 'border-sky-500 ring-2 ring-sky-200' : 'border-slate-300'}`}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = [...e.dataTransfer.files].find((f) => /image\/(png|jpeg|webp)/.test(f.type));
            if (file) void ingestImage(file);
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`${vx} ${vy} ${vw} ${vh}`}
            className={`block w-full select-none ${tool === 'pan' ? (panStart ? 'cursor-grabbing' : 'cursor-grab') : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
            style={{ maxHeight: 520, aspectRatio: `${baseVW} / ${baseVH}` }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={onClick} onDoubleClick={onDbl}
            onMouseLeave={() => { setHover(null); setBoxStart(null); if (panStart) setPanStart(null); }}
            onWheel={onWheel}
            role="img" aria-label="Factory floor layout"
          >
            {img && <image href={img.dataUrl} x={0} y={0} width={img.widthPx * mPerPx} height={img.heightPx * mPerPx} opacity={imgOpacity} preserveAspectRatio="none" pointerEvents="none" />}
            <g pointerEvents="none">
              {Array.from({ length: Math.floor(L / gridStep) + 1 }, (_, i) => i * gridStep).map((x) => (
                <g key={`x${x}`}><line x1={x} y1={0} x2={x} y2={W} stroke="#e2e8f0" strokeWidth={px * 0.6} /><text x={x} y={-px * 4} fontSize={px * 8} textAnchor="middle" fill="#94a3b8">{x}</text></g>
              ))}
              {Array.from({ length: Math.floor(W / gridStep) + 1 }, (_, i) => i * gridStep).map((y) => (
                <g key={`y${y}`}><line x1={0} y1={y} x2={L} y2={y} stroke="#e2e8f0" strokeWidth={px * 0.6} /><text x={-px * 4} y={y + px * 3} fontSize={px * 8} textAnchor="end" fill="#94a3b8">{y}</text></g>
              ))}
              <rect x={0} y={0} width={L} height={W} fill="none" stroke="#334155" strokeWidth={px * 1.6} />
            </g>
            {shapes.map((s) => {
              const pts = drag?.id === s.id ? drag.pts : s.points;
              const t = toneOf(s.target);
              const c: Pt = [Math.min(...pts.map((p) => p[0])) + px * 5, Math.min(...pts.map((p) => p[1])) + px * 13];
              const sel = selected === s.id;
              return (
                <g key={s.id}>
                  <polygon
                    points={pts.map((p) => p.join(',')).join(' ')} fill={t.fill} stroke={t.stroke} strokeWidth={px * (sel ? 2.4 : 1.3)} strokeDasharray={s.target ? undefined : `${px * 4} ${px * 3}`}
                    pointerEvents={tool === 'select' ? 'all' : 'none'} className={tool === 'select' ? 'cursor-pointer' : ''}
                    onClick={(e) => { if (tool === 'select') { e.stopPropagation(); setSelected(s.id); } }}
                  />
                  <text x={c[0]} y={c[1]} fontSize={px * 9.5} fontWeight={600} textAnchor="start" fill="#0f172a" pointerEvents="none" paintOrder="stroke" stroke="#ffffff" strokeWidth={px * 2.5}>{s.label}</text>
                  <text x={c[0]} y={c[1] + px * 11} fontSize={px * 8} textAnchor="start" fill="#475569" pointerEvents="none" paintOrder="stroke" stroke="#ffffff" strokeWidth={px * 2.5}>{fmt(polygonArea(pts), 0)} m²</text>
                  {sel && tool === 'select' && pts.map((p, i) => (
                    <rect key={i} x={p[0] - px * 3.5} y={p[1] - px * 3.5} width={px * 7} height={px * 7} fill="#fff" stroke="#0f172a" strokeWidth={px} className="cursor-move"
                      onMouseDown={(e) => { e.stopPropagation(); setDrag({ id: s.id, i, pts: s.points.map((q) => [...q] as Pt) }); }} />
                  ))}
                </g>
              );
            })}
            {tool === 'box' && boxStart && hover && (
              <rect x={Math.min(boxStart[0], hover[0])} y={Math.min(boxStart[1], hover[1])} width={Math.abs(hover[0] - boxStart[0])} height={Math.abs(hover[1] - boxStart[1])} fill="#0f172a14" stroke="#0f172a" strokeWidth={px} strokeDasharray={`${px * 4} ${px * 3}`} pointerEvents="none" />
            )}
            {(tool === 'polygon' || tool === 'calibrate') && draft.length > 0 && (
              <g pointerEvents="none">
                <polyline points={[...draft, ...(hover && (tool === 'polygon' || draft.length === 1) ? [hover] : [])].map((p) => p.join(',')).join(' ')} fill="none" stroke={tool === 'calibrate' ? '#b45309' : '#0f172a'} strokeWidth={px * 1.4} strokeDasharray={`${px * 4} ${px * 3}`} />
                {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={px * 3} fill="#fff" stroke={tool === 'calibrate' ? '#b45309' : '#0f172a'} strokeWidth={px} />)}
              </g>
            )}
          </svg>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11.5px] tabular-nums text-slate-600">
            <span>Boundary {fmt(L, 1)} × {fmt(W, 1)} m = <b className="text-slate-800">{fmt(total, 0)} m²</b></span>
            <span>Allocated (cells + stores + dispatch) <b className="text-slate-800">{fmt(allocated, 0)} m²</b> · {fmt(total ? (allocated / total) * 100 : 0, 0)}%</span>
            <span className="ml-auto">{hover && tool !== 'pan' ? `x ${fmt(hover[0], 1)} m · y ${fmt(hover[1], 1)} m` : 'Scroll to zoom · Pan tool to drag'}</span>
          </div>
        </div>

        {/* ---- Shape table ---- */}
        <div className="scroll-thin max-h-[560px] overflow-auto rounded border border-slate-200">
          <table className="w-full">
            <thead className="sticky top-0 z-10"><tr><Th>Label</Th><Th>Assigned to</Th><Th right guide="shapeArea">Area m²</Th><Th /></tr></thead>
            <tbody>
              {shapes.map((s) => (
                <tr key={s.id} className={selected === s.id ? 'bg-sky-50' : ''} onClick={() => setSelected(s.id)}>
                  <td className="td"><TextInput cell value={s.label} onChange={(v) => mutateFl((fl) => { const x = fl.shapes.find((y) => y.id === s.id); if (x) x.label = v; })} ariaLabel="Shape label" /></td>
                  <td className="td" style={{ minWidth: 200 }}><Select cell value={s.target} options={targets} ariaLabel="Assigned to" onChange={(v) => mutateFl((fl) => { const x = fl.shapes.find((y) => y.id === s.id); if (!x) return; x.target = v; if (!x.label || targets.some((t) => t.label === x.label)) x.label = targetLabel(v); })} /></td>
                  <td className="td-ro text-right">{fmt(polygonArea(s.points), 1)}</td>
                  <td className="td w-7"><button className="btn-ghost" aria-label={`Delete ${s.label}`} onClick={(e) => { e.stopPropagation(); mutateFl((fl) => { fl.shapes = fl.shapes.filter((x) => x.id !== s.id); }); }}>✕</button></td>
                </tr>
              ))}
              {!shapes.length && <tr><td colSpan={4} className="td-ro py-6 text-center text-slate-500">No shapes yet — import a geometry file or draw with Box / Polygon.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
