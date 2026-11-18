// Floor-plan layout editor shell — owns state, viewport, and event handlers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT_TARGETS, polygonArea, snapTo } from '../lib/geometry';
import { resizeDataUrl } from '../lib/imageProcessing';
import { useStore } from '../store';
import type { FloorPlan, LayoutImage, LayoutShape, Pt } from '../types';
import { uid } from '../types';
import { LayoutFloorHeader } from './LayoutFloorHeader';
import { LayoutToolbar } from './LayoutToolbar';
import { LayoutSvgCanvas } from './LayoutSvgCanvas';
import { LayoutShapeTable } from './LayoutShapeTable';

type Tool = 'select' | 'box' | 'polygon' | 'calibrate' | 'pan';

export default function LayoutEditor() {
  const { ws, mutate, toast } = useStore();
  const { lengthM: L, widthM: W } = ws.settings.envelope;
  const layout = ws.layout;
  const floors = layout.floors ?? [];
  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const safeIdx = Math.min(activeFloorIdx, Math.max(0, floors.length - 1));
  const activeFloor: FloorPlan | undefined = floors[safeIdx];
  const img: LayoutImage | null = activeFloor?.image ?? null;
  const shapes: LayoutShape[] = activeFloor?.shapes ?? [];

  /** Mutate the active floor, keeping flat layout.shapes/image in sync for floor 0. */
  const mutateFl = useCallback((fn: (fl: FloorPlan) => void) => {
    mutate((d) => {
      const fl = (d.layout.floors ?? [])[safeIdx] as FloorPlan | undefined;
      if (!fl) return;
      fn(fl as FloorPlan);
      if (safeIdx === 0) { d.layout.shapes = (fl as FloorPlan).shapes; d.layout.image = (fl as FloorPlan).image; }
    });
  }, [mutate, safeIdx]);

  const svgRef = useRef<SVGSVGElement>(null);
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

  useEffect(() => { setSelected(null); setDraft([]); setBoxStart(null); }, [safeIdx]);

  const ingestImage = useCallback(async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('warn', 'Only PNG, JPEG and WEBP images are supported.');
    if (file.size > 20 * 1024 * 1024) return toast('warn', 'Image exceeds 20 MB — reduce it first.');
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
      const { widthPx: rawW, heightPx: rawH } = await new Promise<{ widthPx: number; heightPx: number }>((res) => { const im = new Image(); im.onload = () => res({ widthPx: im.naturalWidth, heightPx: im.naturalHeight }); im.src = dataUrl; });
      const resized = await resizeDataUrl(dataUrl, rawW, rawH);
      const wasResized = resized.widthPx < rawW || resized.heightPx < rawH;
      mutateFl((fl) => { fl.image = { dataUrl: resized.dataUrl, widthPx: resized.widthPx, heightPx: resized.heightPx, mPerPx: null, calib: null }; });
      setTool('calibrate'); setDraft([]);
      toast('ok', `Floor plan loaded${wasResized ? ` (resized from ${rawW}×${rawH} to ${resized.widthPx}×${resized.heightPx})` : ''}. Click two points a known distance apart, enter the distance, then Apply scale.`);
    } catch { toast('error', 'Failed to load image — the file may be corrupt.'); }
  }, [mutateFl, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft([]); setBoxStart(null); } };
    const onPaste = (e: ClipboardEvent) => { const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/')); if (item) { e.preventDefault(); const f = item.getAsFile(); if (f) void ingestImage(f); } };
    window.addEventListener('keydown', onKey); window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, [ingestImage]);

  const margin = useMemo(() => Math.max(L, W) / 500 * 14, [L, W]);
  const baseVW = L + margin * 2;
  const baseVH = W + margin * 2;
  const vw = baseVW / zoom;
  const vh = baseVH / zoom;
  const vx = -margin + panOffset[0] - (vw - baseVW) / 2;
  const vy = -margin + panOffset[1] - (vh - baseVH) / 2;
  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); setZoom((z) => Math.max(0.3, Math.min(10, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))); };
  const resetView = () => { setZoom(1); setPanOffset([0, 0]); };
  const px = Math.max(L, W) / 500;

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

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (tool === 'pan') { setPanStart({ clientXY: [e.clientX, e.clientY], initPan: panOffset }); return; }
    if (tool === 'box') setBoxStart(toM(e));
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (tool === 'pan' && panStart) { const dx = (e.clientX - panStart.clientXY[0]) * vw / (svgRef.current?.clientWidth ?? 1); const dy = (e.clientY - panStart.clientXY[1]) * vh / (svgRef.current?.clientHeight ?? 1); setPanOffset([panStart.initPan[0] - dx, panStart.initPan[1] - dy]); return; }
    const p = toM(e); setHover(p);
    if (drag) setDrag({ ...drag, pts: drag.pts.map((q, i) => (i === drag.i ? p : q)) });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (tool === 'pan') { setPanStart(null); return; }
    const p = toM(e);
    if (drag) { const { id, pts } = drag; mutateFl((fl) => { const s = fl.shapes.find((x) => x.id === id); if (s) s.points = pts; }); setDrag(null); return; }
    if (tool === 'box' && boxStart) { const [x1, y1] = boxStart; addShape([[Math.min(x1, p[0]), Math.min(y1, p[1])], [Math.max(x1, p[0]), Math.min(y1, p[1])], [Math.max(x1, p[0]), Math.max(y1, p[1])], [Math.min(x1, p[0]), Math.max(y1, p[1])]]); setBoxStart(null); }
  };
  const onClick = (e: React.MouseEvent) => {
    if (tool === 'pan') return;
    const p = toM(e);
    if (tool === 'polygon') { if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < px * 8) { addShape(draft); setDraft([]); } else setDraft([...draft, p]); }
    else if (tool === 'calibrate') { setDraft(draft.length >= 2 ? [p] : [...draft, p]); }
    else if (tool === 'select' && e.target === svgRef.current) setSelected(null);
  };
  const onDoubleClick = () => { if (tool === 'polygon' && draft.length >= 3) { addShape(draft.slice(0, -1).length >= 3 ? draft.slice(0, -1) : draft); setDraft([]); } };

  const applyCalibration = () => {
    if (!img || draft.length !== 2 || !calibDist || calibDist <= 0) return;
    const mPerPxCur = img.mPerPx ?? L / img.widthPx;
    const dM = Math.hypot(draft[1][0] - draft[0][0], draft[1][1] - draft[0][1]);
    const dPx = dM / mPerPxCur;
    if (dPx < 2) return toast('warn', 'Calibration points are too close together.');
    const scale = calibDist / dPx;
    mutateFl((fl) => { if (fl.image) { fl.image.mPerPx = scale; fl.image.calib = { a: [draft[0][0] / mPerPxCur, draft[0][1] / mPerPxCur], b: [draft[1][0] / mPerPxCur, draft[1][1] / mPerPxCur], distanceM: calibDist }; } });
    setDraft([]); setTool('box');
    // Note: fmt imported in LayoutSvgCanvas; use inline formatting here to avoid extra import
    toast('ok', `Image calibrated: ${((scale * 1000)).toFixed(1)} mm per pixel (${(img.widthPx * scale).toFixed(1)} m × ${(img.heightPx * scale).toFixed(1)} m). Now trace the cells.`);
  };

  const mPerPx = img ? img.mPerPx ?? L / img.widthPx : 1;
  const allocated = shapes.filter((s) => s.target.startsWith('cell:') || s.target === 'stores' || s.target === 'dispatch').reduce((a, s) => a + polygonArea(s.points), 0);
  const total = L * W;
  const gridStep = Math.max(L, W) > 120 ? 20 : 10;

  return (
    <div>
      <LayoutFloorHeader floors={floors} safeIdx={safeIdx} setActiveFloorIdx={setActiveFloorIdx} activeFloor={activeFloor} />
      <LayoutToolbar img={img} mutateFl={mutateFl} ingestImage={ingestImage} replaceOnImport={replaceOnImport} setReplaceOnImport={setReplaceOnImport} fit={fit} setFit={setFit} tool={tool} setTool={setTool} setDraft={setDraft} setBoxStart={setBoxStart} target={target} setTarget={setTarget} targets={targets} calibDist={calibDist} setCalibDist={setCalibDist} draft={draft} applyCalibration={applyCalibration} zoom={zoom} resetView={resetView} snapM={layout.snapM} shapes={shapes} imgOpacity={imgOpacity} setImgOpacity={setImgOpacity} workspaceName={ws.meta.name} L={L} W={W} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <LayoutSvgCanvas svgRef={svgRef} vx={vx} vy={vy} vw={vw} vh={vh} baseVW={baseVW} baseVH={baseVH} isDragOver={isDragOver} setIsDragOver={setIsDragOver} ingestImage={ingestImage} tool={tool} panStart={panStart} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onClick={onClick} onDoubleClick={onDoubleClick} onWheel={onWheel} onMouseLeave={() => { setHover(null); setBoxStart(null); if (panStart) setPanStart(null); }} img={img} mPerPx={mPerPx} imgOpacity={imgOpacity} L={L} W={W} px={px} gridStep={gridStep} shapes={shapes} drag={drag} setDrag={setDrag} selected={selected} setSelected={setSelected} hover={hover} boxStart={boxStart} draft={draft} allocated={allocated} total={total} />
        <LayoutShapeTable shapes={shapes} selected={selected} setSelected={setSelected} targets={targets} targetLabel={targetLabel} mutateFl={mutateFl} />
      </div>
    </div>
  );
}
