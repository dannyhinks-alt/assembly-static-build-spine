# Architecture — Assembly & Static Build Central Spine

*Last updated: 2026-11-18*

---

## Stack at a Glance

| Concern | Technology |
|---|---|
| UI framework | React 18 + TypeScript |
| Build tool | Vite 5 + `vite-plugin-singlefile` |
| Styling | Tailwind CSS (utility classes, no component library) |
| State | Zustand store with Immer `produce` mutations |
| Spreadsheet I/O | SheetJS (`xlsx`) — bundled locally, never CDN |
| Testing | Vitest (unit); no browser-automation tests |
| Output artefact | Zero-dependency single-file offline HTML |

---

## Module Map

```
src/
├── types.ts              Domain types, constants, uid helpers, schema tags
├── store.tsx             Zustand store + mutate() — all state mutations live here
├── App.tsx               Root shell: tab routing, file I/O, keyboard shortcuts
│
├── engine/               Pure domain calculations — no React, no DOM
│   ├── formulas/         Sub-modules (≤250 lines each)
│   │   ├── calendarAndLearning.ts  Calendar maths, learning curve, production window
│   │   ├── activityMetrics.ts      Per-leaf elapsed/labour calculations
│   │   ├── cpmScheduler.ts         CPM topology, forward/backward pass, float
│   │   ├── liftPhysics.ts          Lift record classification and RAG
│   │   ├── resourceDuty.ts         Resource duty cycle and concurrency conflicts
│   │   └── index.ts                Barrel re-export
│   ├── model.ts          Thin orchestrator — buildModel(), FpdRoll, CellLoad, Model
│   ├── validation/       Governance and export sub-modules
│   │   ├── releaseGates.ts   G1–G7 governance gate evaluation
│   │   ├── routeToGreen.ts   Per-gate corrective action steps
│   │   ├── summaryExport.ts  summary@V2 JSON payload builder
│   │   └── index.ts          Barrel re-export
│   ├── gates.ts          Thin re-exporter from validation/
│   ├── integrity.ts      Workspace self-test (10 numerical checks, 0.001 % tolerance)
│   └── space.ts          Factory floor-plan space calculations
│
├── lib/                  Stateless helpers — no React, no Zustand
│   ├── excel.ts          SheetJS import/export (BOP-only round-trip, resources; PFMEA never imported from Excel)
│   ├── persistence.ts    JSON workspace serialisation, localStorage, FSA API
│   ├── format.ts         Number/date formatting, RAG hex/label maps
│   └── geometry.ts       Layout geometry utilities (zone bounding boxes, overlaps)
│
├── components/           React UI — thin and declarative; no domain arithmetic
│   ├── common/           Shared primitives (≤250 lines each)
│   │   ├── EngineeringTooltip.tsx  Hover guide badge
│   │   ├── SlideOverDrawer.tsx     Drawer and Modal portals
│   │   ├── RagBadge.tsx            RAG badges, Pill, Meter
│   │   ├── FormInputs.tsx          NumInput, TextInput, Select, Field, ExpandableTextCell
│   │   ├── MultiSelectPicker.tsx   TagOption, TagPicker
│   │   ├── Cards.tsx               Card, Kpi, Th, HowItWorks, Empty
│   │   └── index.ts                Barrel re-export
│   ├── primitives.tsx    Single-line barrel re-export from common/ (backward compat)
│   ├── CellsZones.tsx    Cell & Zone editor
│   ├── FpdRegistry.tsx   FPD registry card
│   ├── LayoutEditor.tsx  Floor-plan canvas editor
│   └── DataTable.tsx     Generic sortable table
│
├── tabs/                 Nine tab views — purely declarative, call engine/lib
│   ├── Tab1Targets.tsx   Programme targets & learning curve
│   ├── Tab2Bop.tsx       Bill of Process (BOP) central spine; per-FPD collapse/expand
│   ├── OperationMethodDrawer.tsx  Slide-over for full operation edit (extracted from Tab2)
│   ├── Tab3Equipment.tsx Tooling & equipment registry
│   ├── Tab4Lifts.tsx     Lift & move analysis
│   ├── Tab5Pfmea.tsx     PFMEA risk register
│   ├── Tab6Labour.tsx    Labour & attendance analysis
│   ├── Tab7Footprint.tsx Factory floor-plan & footprint
│   ├── Tab8Utilisation.tsx  Resource utilisation
│   └── Tab9Executive.tsx Executive summary
│
└── data/
    ├── seed.ts           blankRow / blankResource / seedWorkspace factories
    └── guides.ts         In-app guidance text (GuideId → title/what/how/action)
```

---

## Data Flow

```
User action
    │
    ▼
Tab / Component
    │  calls mutate(fn) — never touches workspace directly
    ▼
store.tsx  mutate(fn)
    │  Immer produce(workspace, fn)
    ▼
Workspace (immutable snapshot)
    │
    ▼
buildModel(ws, settings)        — src/engine/model.ts
    │  calls formulas/* sub-modules
    ▼
Model { totals, cpm, lifts, resources, fpdRoll, cells, … }
    │
    ▼
Tabs read Model via useStore() → re-render declaratively
```

---

## Schema Contracts

| Contract | Location | Breaking change? |
|---|---|---|
| Workspace schema tag | `types.ts` `WORKSPACE_SCHEMA = 'asbcs-workspace@1'` | Yes — needs migration in `persistence.ts` `normaliseWorkspace()` |
| Summary export tag | `types.ts` `SUMMARY_SCHEMA = 'summary@V2'` | Yes — Master Hub consumes this; coordinator sign-off required |
| BOP column order | `lib/excel.ts` `exportBop()` | Yes — round-trip contract; reordering breaks re-import |
| Test fixture baseline | `engine/testFixture.ts` | Yes — locked figures; change requires explicit sign-off |

---

## Build Targets

| Command | Output | Purpose |
|---|---|---|
| `npm run build:offline` | `dist-offline/index.html` | Zero-CDN single-file for offline use |
| `npm run build:pages` | `docs/index.html` + `Assembly_Spine_v1.html` | GitHub Pages + release artefact |
| `npm test` | Vitest console | 19 unit tests covering engine calculations |
| `npm run typecheck` | TypeScript console | Must report 0 errors before every push |

---

## Key Invariants

1. **No domain logic in tabs or components.** All arithmetic lives in `src/engine/` or `src/lib/`. Tabs call functions; they do not contain formulae.
2. **No direct state mutation.** Only `mutate()` from `useStore` may alter workspace state.
3. **Zero CDN imports at runtime.** `vite-plugin-singlefile` inlines everything; SheetJS is a local bundle import.
4. **British English throughout.** `despatch`, `analyse`, `utilisation`, `organisation`, `£` — never US equivalents.
5. **Self-test tolerance is 0.001 %.** `src/engine/integrity.ts` checks 10 derived figures against `buildModel()`. Do not widen the tolerance to pass a failing check.
