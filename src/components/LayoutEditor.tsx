// Propel Floor Layout Geometry Importer: JSON / SVG / DXF polygons, or trace over a calibrated floor-plan image.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT_TARGETS, fitToBoundary, importGeometry, polygonArea, snapTo } from '../lib/geometry';
import { fmt } from '../lib/format';
import { download, fileSafe } from '../lib/persistence';
import { useStore } from '../store';
import type { LayoutShape, Pt } from '../types';
import { uid } from '../types';
import { NumInput, Select, TextInput, Th, Tip } from './primitives';

type Tool = 'select' | 'box' | 'polygon' | 'calibrate';
const TONE: Record<string, { fill: string; stroke: string }> = {
  cell: { fill: '#0ea5e91a', stroke: '#0369a1' },
  stores: { fill: '#64748b22', stroke: '#475569' },
  stand: { fill: '#0f172a26', stroke: '#0f172a' },
  dispatch: { fill: '#7c3aed1c', stroke: '#6d28d9' },
  '': { fill: '#94a3b814', stroke: '#94a3b8' },
};
const toneOf = (target: string) => TONE[target.startsWith('cell:') ? 'cell' : target] ?? TONE[''];

export default function LayoutEditor() {
  const { ws, mutate, toast } = useStore();
  const { lengthM: L, widthM: W } = ws.settings.envelope;
  const layout = ws.layout;
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
  const targets = useMemo(() => LAYOUT_TARGETS(ws.cells), [ws.cells]);
  const targetLabel = (t: string) => targets.find((x) => x.value === t)?.label ?? 'Unassigned';

  // Default the "next shape" target to the first one not yet drawn.
  useEffect(() => {
    const used = new Set(layout.shapes.map((s) => s.target));
    setTarget(targets.find((t) => t.value && !used.has(t.value))?.value ?? '');
  }, [layout.shapes, targets]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft([]); setBoxStart(null); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const img = layout.image;
  const mPerPx = img ? img.mPerPx ?? L / img.widthPx : 1;
  const px = Math.max(L, W) / 500; // one "screen unit" in metres for strokes and handles

  const toM = (e: React.MouseEvent, snap = true): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    const step = snap && tool !== 'calibrate' ? layout.snapM : 0;
    return [snapTo(q.x, step), snapTo(q.y, step)];
  };
  const addShape = (points: Pt[]) => {
    if (polygonArea(points) < 0.01) return;
    const id = uid('sh');
    mutate((d) => { d.layout.shapes.push({ id, target, label: targetLabel(target), points }); });
    setSelected(id);
  };

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toM(e);
    if (tool === 'box') setBoxStart(p);
  };
  const onMove = (e: React.MouseEvent) => {
    const p = toM(e);
    setHover(p);
    if (drag) setDrag({ ...drag, pts: drag.pts.map((q, i) => (i === drag.i ? p : q)) });
  };
  const onUp = (e: React.MouseEvent) => {
    const p = toM(e);
    if (drag) {
      const { id, pts } = drag;
      mutate((d) => { const s = d.layout.shapes.find((x) => x.id === id); if (s) s.points = pts; });
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
    const dM = Math.hypot(draft[1][0] - draft[0][0], draft[1][1] - draft[0][1]);
    const dPx = dM / mPerPx;
    if (dPx < 2) return toast('warn', 'Calibration points are too close together.');
    const scale = calibDist / dPx;
    mutate((d) => { if (d.layout.image) { d.layout.image.mPerPx = scale; d.layout.image.calib = { a: [draft[0][0] / mPerPx, draft[0][1] / mPerPx], b: [draft[1][0] / mPerPx, draft[1][1] / mPerPx], distanceM: calibDist }; } });
    setDraft([]);
    setTool('box');
    toast('ok', `Image calibrated: ${fmt(scale * 1000, 1)} mm per pixel (${fmt(img.widthPx * scale, 1)} m × ${fmt(img.heightPx * scale, 1)} m). Now trace the cells.`);
  };

  const onGeometry = async (f?: File) => {
    if (!f) return;
    try {
      const res = importGeometry(f.name, await f.text(), ws.cells);
      let shapes: LayoutShape[] = res.shapes;
      let note = '';
      if (fit) {
        const r = fitToBoundary(shapes, L, W);
        shapes = r.shapes;
        note = ` Scaled ×${fmt(r.scale, 4)} to fit the ${fmt(L, 0)} × ${fmt(W, 0)} m boundary.`;
      }
      mutate((d) => { d.layout.shapes = replaceOnImport ? shapes : [...d.layout.shapes, ...shapes]; });
      toast(res.warnings.length ? 'warn' : 'ok', `${res.format}: ${shapes.length} polygon(s) imported.${note}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''} Check the Assigned To column.`);
    } catch (e) {
      toast('error', `Geometry import failed — ${(e as Error).message}`);
    }
  };
  const onImage = (f?: File) => {
    if (!f) return;
    if (f.size > 6 * 1024 * 1024) return toast('warn', 'Image is larger than 6 MB — reduce it first so the workspace file stays manageable.');
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        mutate((d) => { d.layout.image = { dataUrl: String(reader.result), widthPx: im.naturalWidth, heightPx: im.naturalHeight, mPerPx: null, calib: null }; });
        setTool('calibrate');
        setDraft([]);
        toast('ok', 'Floor plan loaded. Click two points a known distance apart, enter the distance, then Apply scale.');
      };
      im.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const allocated = layout.shapes.filter((s) => s.target.startsWith('cell:') || s.target === 'stores' || s.target === 'dispatch').reduce((a, s) => a + polygonArea(s.points), 0);
  const total = L * W;
  const gridStep = Math.max(L, W) > 120 ? 20 : 10;
  const tools: { v: Tool; label: string; hint: string }[] = [
    { v: 'select', label: 'Select / edit', hint: 'Click a shape to select it; drag its corner handles to adjust.' },
    { v: 'box', label: 'Box', hint: 'Drag a rectangle. It snaps to the grid and is assigned to the target chosen on the right.' },
    { v: 'polygon', label: 'Polygon', hint: 'Click each corner; click the first point again or double-click to close. Esc cancels.' },
    { v: 'calibrate', label: '2-point scale', hint: 'Click two points on the image a known distance apart, enter the distance and Apply scale.' },
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input ref={geoRef} type="file" accept=".json,.svg,.dxf" className="hidden" onChange={(e) => { void onGeometry(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => geoRef.current?.click()}>Import JSON / SVG / DXF…</button>
        <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-slate-800" checked={replaceOnImport} onChange={(e) => setReplaceOnImport(e.target.checked)} />Replace existing</label>
        <label className="flex items-center gap-1 text-[12px] text-slate-600" title="Uniformly scales and moves the imported outlines to fit the factory boundary — use for mm-based DXF or unit-less SVG."><input type="checkbox" className="accent-slate-800" checked={fit} onChange={(e) => setFit(e.target.checked)} />Fit to boundary</label>
        <span className="h-5 w-px bg-slate-200" />
        <input ref={imgRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => imgRef.current?.click()}>Upload floor-plan image (PNG / JPG)…</button>
        {img && <button className="btn-ghost" onClick={() => mutate((d) => { d.layout.image = null; })}>Remove image</button>}
        <button className="btn-ghost ml-auto" onClick={() => download(`${fileSafe(ws.meta.name)}_layout.json`, JSON.stringify({ units: 'm', boundary: { lengthM: L, widthM: W }, shapes: layout.shapes }, null, 2))}>Export layout JSON</button>
        <Tip id="layoutImporter" />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
          {tools.map((t) => (
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
      <p className="mb-2 text-[11.5px] text-slate-500">{tools.find((t) => t.v === tool)!.hint}{img && !img.mPerPx ? ' Image is not yet calibrated — it is shown stretched to the boundary length.' : ''}</p>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="overflow-hidden rounded border border-slate-300 bg-white">
          <svg
            ref={svgRef}
            viewBox={`${-px * 14} ${-px * 14} ${L + px * 28} ${W + px * 28}`}
            className={`block w-full select-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
            style={{ maxHeight: 520, aspectRatio: `${L + px * 28} / ${W + px * 28}` }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={onClick} onDoubleClick={onDbl} onMouseLeave={() => { setHover(null); setBoxStart(null); }}
            role="img" aria-label="Factory floor layout"
          >
            {img && <image href={img.dataUrl} x={0} y={0} width={img.widthPx * mPerPx} height={img.heightPx * mPerPx} opacity={0.75} preserveAspectRatio="none" pointerEvents="none" />}
            <g pointerEvents="none">
              {Array.from({ length: Math.floor(L / gridStep) + 1 }, (_, i) => i * gridStep).map((x) => (
                <g key={`x${x}`}><line x1={x} y1={0} x2={x} y2={W} stroke="#e2e8f0" strokeWidth={px * 0.6} /><text x={x} y={-px * 4} fontSize={px * 8} textAnchor="middle" fill="#94a3b8">{x}</text></g>
              ))}
              {Array.from({ length: Math.floor(W / gridStep) + 1 }, (_, i) => i * gridStep).map((y) => (
                <g key={`y${y}`}><line x1={0} y1={y} x2={L} y2={y} stroke="#e2e8f0" strokeWidth={px * 0.6} /><text x={-px * 4} y={y + px * 3} fontSize={px * 8} textAnchor="end" fill="#94a3b8">{y}</text></g>
              ))}
              <rect x={0} y={0} width={L} height={W} fill="none" stroke="#334155" strokeWidth={px * 1.6} />
            </g>
            {layout.shapes.map((s) => {
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
            <span className="ml-auto">{hover ? `x ${fmt(hover[0], 1)} m · y ${fmt(hover[1], 1)} m` : 'Grid in metres'}</span>
          </div>
        </div>

        <div className="scroll-thin max-h-[560px] overflow-auto rounded border border-slate-200">
          <table className="w-full">
            <thead className="sticky top-0 z-10"><tr><Th>Label</Th><Th>Assigned to</Th><Th right guide="shapeArea">Area m²</Th><Th /></tr></thead>
            <tbody>
              {layout.shapes.map((s) => (
                <tr key={s.id} className={selected === s.id ? 'bg-sky-50' : ''} onClick={() => setSelected(s.id)}>
                  <td className="td"><TextInput cell value={s.label} onChange={(v) => mutate((d) => { d.layout.shapes.find((x) => x.id === s.id)!.label = v; })} ariaLabel="Shape label" /></td>
                  <td className="td" style={{ minWidth: 200 }}><Select cell value={s.target} options={targets} ariaLabel="Assigned to" onChange={(v) => mutate((d) => { const x = d.layout.shapes.find((y) => y.id === s.id)!; x.target = v; if (!x.label || targets.some((t) => t.label === x.label)) x.label = targetLabel(v); })} /></td>
                  <td className="td-ro text-right">{fmt(polygonArea(s.points), 1)}</td>
                  <td className="td w-7"><button className="btn-ghost" aria-label={`Delete ${s.label}`} onClick={(e) => { e.stopPropagation(); mutate((d) => { d.layout.shapes = d.layout.shapes.filter((x) => x.id !== s.id); }); }}>✕</button></td>
                </tr>
              ))}
              {!layout.shapes.length && <tr><td colSpan={4} className="td-ro py-6 text-center text-slate-500">No shapes yet — import a geometry file or draw with Box / Polygon.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
