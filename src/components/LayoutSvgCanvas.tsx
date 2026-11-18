// Interactive SVG canvas for the LayoutEditor — grid, shapes, drawing overlays.
import type React from 'react';
import { polygonArea } from '../lib/geometry';
import { fmt } from '../lib/format';
import type { LayoutImage, LayoutShape, Pt } from '../types';

type Tool = 'select' | 'box' | 'polygon' | 'calibrate' | 'pan';

const TONE: Record<string, { fill: string; stroke: string }> = {
  cell: { fill: '#0ea5e91a', stroke: '#0369a1' },
  stores: { fill: '#64748b22', stroke: '#475569' },
  stand: { fill: '#0f172a26', stroke: '#0f172a' },
  dispatch: { fill: '#7c3aed1c', stroke: '#6d28d9' },
  '': { fill: '#94a3b814', stroke: '#94a3b8' },
};
const toneOf = (target: string) => TONE[target.startsWith('cell:') ? 'cell' : target] ?? TONE[''];

interface LayoutSvgCanvasProps {
  svgRef: React.RefObject<SVGSVGElement>;
  vx: number; vy: number; vw: number; vh: number;
  baseVW: number; baseVH: number;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  ingestImage: (f: File) => Promise<void>;
  tool: Tool;
  panStart: { clientXY: [number, number]; initPan: [number, number] } | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onMouseLeave: () => void;
  img: LayoutImage | null;
  mPerPx: number;
  imgOpacity: number;
  L: number; W: number;
  px: number;
  gridStep: number;
  shapes: LayoutShape[];
  drag: { id: string; i: number; pts: Pt[] } | null;
  setDrag: (v: { id: string; i: number; pts: Pt[] } | null) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  hover: Pt | null;
  boxStart: Pt | null;
  draft: Pt[];
  allocated: number;
  total: number;
}

/**
 * Purpose: Renders the interactive SVG canvas: floor-plan image backdrop, grid,
 *   polygonal shapes with handles, drawing overlays for box/polygon/calibrate tools,
 *   and a status bar showing boundary area and cursor co-ordinates.
 *
 * Downstream impact: shapes drawn here populate ws.layout.shapes (via mutateFl),
 *   which feed Tab 7 cell-area calculations and the spaghetti layout diagram.
 */
export function LayoutSvgCanvas({ svgRef, vx, vy, vw, vh, baseVW, baseVH, isDragOver, setIsDragOver, ingestImage, tool, panStart, onMouseDown, onMouseMove, onMouseUp, onClick, onDoubleClick, onWheel, onMouseLeave, img, mPerPx, imgOpacity, L, W, px, gridStep, shapes, drag, setDrag, selected, setSelected, hover, boxStart, draft, allocated, total }: LayoutSvgCanvasProps) {
  return (
    <div
      className={`overflow-hidden rounded border bg-white ${isDragOver ? 'border-sky-500 ring-2 ring-sky-200' : 'border-slate-300'}`}
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const file = [...e.dataTransfer.files].find((f) => /image\/(png|jpeg|webp)/.test(f.type)); if (file) void ingestImage(file); }}
    >
      <svg
        ref={svgRef}
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        className={`block w-full select-none ${tool === 'pan' ? (panStart ? 'cursor-grabbing' : 'cursor-grab') : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
        style={{ maxHeight: 520, aspectRatio: `${baseVW} / ${baseVH}` }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onClick={onClick} onDoubleClick={onDoubleClick}
        onMouseLeave={onMouseLeave} onWheel={onWheel}
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
              <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={t.fill} stroke={t.stroke} strokeWidth={px * (sel ? 2.4 : 1.3)} strokeDasharray={s.target ? undefined : `${px * 4} ${px * 3}`}
                pointerEvents={tool === 'select' ? 'all' : 'none'} className={tool === 'select' ? 'cursor-pointer' : ''}
                onClick={(e) => { if (tool === 'select') { e.stopPropagation(); setSelected(s.id); } }} />
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
  );
}
