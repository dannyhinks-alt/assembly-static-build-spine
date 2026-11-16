# Assembly & Static Build Central Spine v1.0

Offline-first single-page application (React 18 · TypeScript · Vite · Tailwind CSS, `en-GB`) that replaces
spreadsheet prototypes for long-cycle **Static Build & Heavy Assembly** factories. It ingests any number of
Fixed Process Documents (FPDs — built and tested for 30+) into one unified Bill of Process and lets engineers
filter by single FPD, group of FPDs, Cell (1–6), Zone or Whole Factory.

Third pillar of the suite alongside *Cell Design Passport V2* and *Multi-Factory Master Control Hub v1.0*; it
exports a `summary@V2` roll-up for the Hub.

## Run it

```bash
npm install
npm run dev            # local development server
npm run build          # ONE self-contained file: dist/index.html  (opens from file://, or host on GitHub Pages)
npm run build:static   # conventional chunked build in dist-static/ (needs an http(s) origin)
npm run build:pages    # build, then copy the single file to docs/index.html
npm test               # engine + integrity unit tests (Vitest)
```

`dist/index.html` has **no runtime network dependencies**: no CDNs, no web fonts, no telemetry. SheetJS (`xlsx`)
is bundled into the file. Copy that one file behind the firewall and double-click it.

A ready-built copy is committed at **`docs/index.html`**. To host on GitHub Pages, set *Settings → Pages → Deploy from a
branch → `/docs`*. Re-run `npm run build:pages` after changing the source.

## Navigation

| # | Tab | Group |
|---|-----|-------|
| 1 | Targets & Pre-Requisites — cadence, learning curve, calendar, floor layout importer, crane envelope, lift thresholds, 10-point integrity panel | Input Spine |
| 2 | Bill of Process — mergeable KTP central spine | Input Spine |
| 3 | FPD Registry & Components (BOM, weights, dimensions) | Input Spine |
| 4 | Equipment & Resource Registry (rigs, cranes, rigging, vehicles, stands) | Input Spine |
| 5 | Cells, Zones & Crew | Input Spine |
| 6 | PFMEA & Quality Hold Points | Input Spine |
| 7 | CPM Schedule & Critical Path | Analysis & Governance |
| 8 | Lift, Crane & Resource Load | Analysis & Governance |
| 9 | Governance & Release Gates, assumptions, `summary@V2` export | Analysis & Governance |

The **Spine Filter** bar under the tabs scopes every tab. Integrity checks and the `summary@V2` export always use
the whole factory.

Two UI primitives are used everywhere (`src/components/primitives.tsx`):

- **`ExpandableTextCell`** — free-text table cells that grow on focus and open a pop-out drawer editor (`⤢`).
- **`EngineeringTooltip`** — `?` badges on every KPI, column header, threshold, CPM badge and gate, each with
  *what it measures & formula · how the engine uses it · what action to take*. Texts live in `src/data/guides.ts`.

## Engine reference (`src/engine`)

| Quantity | Formula |
|---|---|
| Learning factor, build *n* | `1st Build % − Step % × (n − 1)`, held at `Stabilised %` after *Builds to Stabilise* steps (130 → 125 → 120 → 115 → 110 → 110) |
| Waste % | Manual value, or **Automated** = NVA manning burden ÷ total manning burden (all active FPDs) |
| Max Production Window | `(12 ÷ annual demand) × (1 − Waste %)` → 7.8 months nominal, 6.5 months peak on the baseline |
| Total Manning Burden | `Manning Time × Crew Size` |
| Labour Hours | `Burden × Learning Factor ÷ Labour Efficiency` |
| Elapsed Bay Duration | `Max(Run, Manning) ÷ Net Active Factor × Learning Factor` |
| Attendance Ratio `Ar` | `Manning ÷ Run`; Red when ≥ limit (100%) on cycles longer than 5 min |
| In-Station Opportunity | `Manning − Touch` |
| CPM | Finish-to-start network; a *Sequential* row with no predecessor follows the row above in its FPD; *Parallel* rows start when listed predecessors finish. Forward/backward pass → ES, EF, LS, LF, float |
| Working months | `elapsed h ÷ (shifts × h/shift × working days ÷ 12)` |
| Lift load | Component weight (+ rigging tare). Heaviest component when lifts ≥ components, otherwise summed |
| Governing capacity | Lowest of crane SWL (or derated tandem total) and rigging WLL |
| Hook check | `available hook − (floor level × tier height + component height + rigging headroom + clearance)` |
| Duty cycle | `busy h per build × annual demand ÷ (qty × annual hours)`; Full-Build Dwell = whole critical path |
| Spatial conflict | More simultaneous users than units on the early-start schedule; reported with whether it is resolvable within float |
| Cell utilisation | `labour h per build × annual demand ÷ (crew per shift × annual hours)` |
| RPN | `S × O × D`, banded by the Tab 1 thresholds |

A **Work Block** is a merged group of activities in one FPD. Its header is the roll-up of its children (treated as
a serial chain); children keep their own times, classification, tags and lift data, so lift checks and VA / NNVA /
NVA splits are unchanged by merging. Unmerge restores the rows exactly.

### 10-point integrity self-test (`integrity.ts`)

1 no predecessor loops · 2 predecessor references resolve · 3 unique Op # · 4 weights on lift ops ·
5 Work Blocks reconcile to activities · 6 independent labour-hours recalculation · 7 independent critical-path
recalculation (memoised longest path vs forward pass) · 8 independent lift count · 9 time logic and reference
integrity · 10 assumptions confirmed. Checks 6–8 use separate code from the main engine.

## Data & persistence

- A workspace is one JSON document, schema `asbcs-workspace@1` (`src/types.ts`).
- Every change is written to `localStorage` immediately.
- **Auto-Save File Link** uses the File System Access API (`showSaveFilePicker`) to write each change to a `.json`
  file you choose. Browsers without that API fall back to browser storage plus manual **Export JSON**.
- A dirty-state indicator sits beside the link and the browser warns before closing with unsaved-to-file changes.
- Undo / redo (60 steps) covers every edit, import and reset.

### Excel (.xlsx)

*More ▾ → Download Excel import template* gives the exact layout. Sheets are recognised by name: `FPDs`, `BOP`,
`Components`, `Resources`, `PFMEA`. Rows are matched on FPD Code, Op #, BOM Ref and resource kind + name. Multi-value
cells (predecessors, components, the five resource tag columns) are separated by `;` or `,`. Excel error cells
(`#REF!`, `#N/A`, …) are read as blank and listed in the import preview. Unknown resources or components referenced
from the BOP sheet are created with blank ratings and flagged.

### Floor layout geometry

Tab 1 accepts JSON (`{ "shapes": [{ "label": "Cell 4", "points": [[x, y], …] }] }`, also `x/y/width/height` boxes
and GeoJSON polygons), SVG (`rect`, `polygon`, `polyline`, straight-segment `path`) and DXF (`LWPOLYLINE`,
`POLYLINE`). Labels and layer names such as `CELL_4`, `Stores`, `Dispatch` are auto-assigned. Alternatively upload
a PNG / JPG, set the scale with two clicks and a known distance, then trace boxes or polygons with grid snapping.

### `summary@V2`

`buildSummary()` in `src/engine/gates.ts` produces: `schema`, `source`, `exportedAt`, `factory`, `basis`, `kpis`,
`cells[]`, `fpds[]`, `resources[]`, `criticalPath[]`, `integrity`, `gates[]`, `overallRag`.

## Baseline dataset

`src/data/seed.ts` — *PMA / UMA Heavy Assembly Baseline*: 6 cells, 8 zones, 8 FPDs, 52 activities, 15 components,
22 resources, 8 PFMEA lines, 6 hold points, 5 assumptions. It is tuned to reproduce the programme figures
(baseline ≈ 6.0 months; Build #1 at 130% ≈ 7.7 months against a 7.8-month window) and deliberately contains live
findings: a closure-head hook-height breach, three lifts above 90% SWL, a Full-Build stand at 97% duty and two
unconfirmed assumptions. *More ▾ → Restore PMA / UMA baseline dataset* reloads it.
