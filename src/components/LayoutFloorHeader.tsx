// Floor-plan tab strip and floor name / elevation editor for the LayoutEditor.
import { useStore } from '../store';
import { uid } from '../types';
import type { FloorPlan } from '../types';

interface LayoutFloorHeaderProps {
  floors: FloorPlan[];
  safeIdx: number;
  setActiveFloorIdx: (idx: number) => void;
  activeFloor: FloorPlan | undefined;
}

/**
 * Purpose: Renders the multi-floor tab strip and the name / elevation editor
 *   for the active floor plan in the LayoutEditor.
 *
 * Downstream impact: floor additions / deletions directly affect the
 *   ws.layout.floors array, which the LayoutEditor and Tab 7 consume.
 */
export function LayoutFloorHeader({ floors, safeIdx, setActiveFloorIdx, activeFloor }: LayoutFloorHeaderProps) {
  const { mutate, toast } = useStore();
  return (
    <>
      {/* Floor plan tabs */}
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
            mutate((d) => {
              const fl = d.layout.floors ?? [];
              fl.push({ id: uid('fp'), name: `Floor ${fl.length}`, elevationM: nextElev, image: null, shapes: [] });
              if (!d.layout.floors) d.layout.floors = fl;
            });
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

      {/* Floor name and elevation editor */}
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
    </>
  );
}
