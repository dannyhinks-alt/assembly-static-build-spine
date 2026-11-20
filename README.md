## 1. Quick Start for Engineers (Offline Usage)

1. **Download the Latest Offline App (1-Click Direct Link):**
   - Open: `https://github.com/dannyhinks-alt/assembly-static-build-spine/raw/main/dist-offline/index.html`
   - *(If transferring via corporate email, rename `index.html` to `index.txt`, send it, then rename back to `index.html`.)*
2. **Open in Microsoft Edge or Chrome:**
   - Double-click `index.html` locally—runs 100% offline with zero internet or CDN calls.

## 2. Standard Solo Workflow & Automated Rules for `claude.ai/code`

- **Single-Branch Policy (`main`):** Always commit and push directly to `main` and delete any stale `claude/*` feature branches (`git push origin --delete <branch> || true`) so `main` stays our single clean branch with no open PRs. Push fast-forward where possible; only force-push (`git push -f origin main`) when you have deliberately rewritten `main`'s history yourself and know what you are discarding.
- **Offline Single-File Build:** Every code change MUST rebuild and force-commit `dist-offline/index.html` (`npm run build:offline && git add -f dist-offline/index.html`). Zero external runtime CDNs are permitted.
- **Domain & Language Standards:**
  - Use **British English** throughout (`utilisation`, `despatch`, `analyse`, `programme`, `£`, `m²`).
  - Never use retail terminology; use **Product Family / FPD / Variant**.

---

# Assembly & Static Build Central Spine v1.0

Offline-first single-page application (React 18 · TypeScript · Vite · Tailwind CSS, `en-GB`) that replaces
spreadsheet prototypes for long-cycle **Static Build & Heavy Assembly** factories. It ingests any number of
Fixed Process Documents (FPDs — built and tested for 30+) into one unified Bill of Process and lets engineers
filter by single FPD, group of FPDs, Cell (1–6), Zone or Whole Factory.

Third pillar of the suite alongside *Cell Design Passport V2* and *Multi-Factory Master Control Hub v1.0*; it
exports a `summary@V2` roll-up for the Hub.

## Get the app

- **`Assembly_Spine_v1.html`** in the repository root is the complete application in one file. Download it and open it
  on a PC or phone — no install, no internet connection.
- Inside the app, **⤓ Download Offline App (.html)** (header and *More ▾* menu) saves the same single file as
  `Assembly_Spine_v1.html`. It contains the application only; move your data with **Export JSON**.
- `docs/index.html` is the same build for GitHub Pages (*Settings → Pages → Deploy from a branch → `/docs`*).

## Build it

```bash
npm install
npm run dev            # local development server
npm run build          # ONE self-contained file: dist/index.html
npm run build:pages    # build, then copy to docs/index.html and Assembly_Spine_v1.html
npm run build:static   # conventional chunked build in dist-static/ (needs an http(s) origin)
npm test               # engine + integrity unit tests (Vitest)
```

The single-file build has **no runtime network dependencies**: no CDNs, no web fonts, no telemetry. SheetJS (`xlsx`)
is bundled into the file.

## Navigation — 6 Input tabs + 3 Analysis tabs

| # | Tab | Contents |
|---|-----|----------|
| 1 | Targets & Pre-Requisites | Cadence, learning curve, calendar, crane envelope, lift thresholds, 10-point integrity, assumptions, cells / zones / crew, floor-layout importer |
| 2 | Bill of Process | Multi-FPD Registry and the mergeable Baseline spine |
| 3 | Equipment, Tooling, Vehicles & Stands | Five registers, 1–3 Complexity Scoring Matrix, floor claims, utility services |
| 4 | Component, Lift & Movement Analysis | Six lift counters, per-lift SWL and hook-height stack-up, movement register, From–To matrix, component register |
| 5 | Cell & Process PFMEA | Multiple failure modes per activity, High-Severity Blind-Spot Watch, control-document check, assigned equipment, hold points |
| 6 | Labour Load & Spatial Balancing | CPM forward / backward pass, Gantt, crew histogram, spatial conflicts by cell / zone / stand level |
| 7 | Footprint, Space & Dual-View Layout | Inter-cell vs intra-cell view, current vs future spaghetti distance, 3D pinch-point overlay, side-elevation X–Z window |
| 8 | Resource Utilisation & Concurrency | Duty cycle, HIGH RISK flags, concurrency conflicts, bottleneck mitigation |
| 9 | Executive Summary | Release gates, Route to Green advisor, 8 KPI cards, four charts, `summary@V2` export |

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
| Attendance Ratio `Ar` | `Manning ÷ Run`. Run Time = 0 → **Manual op** (neutral). **RED – MACHINE LOCKED LABOUR** only when Run Time > 5 min (0.083 h) and Manning ≥ Run |
| In-Station Opportunity | `Manning − Touch` |
| CPM | Finish-to-start network; a *Sequential* row with no predecessor follows the row above in its FPD; *Parallel* rows start when listed predecessors finish. Forward/backward pass → ES, EF, LS, LF, float |
| Working months | `elapsed h ÷ (shifts × h/shift × working days ÷ 12)` |
| Complexity class | Four 1–3 scores summed: 4–6 Simple, 7–9 Medium, 10–12 Complex |
| Lift load | Component weight (+ rigging tare). Heaviest component when lifts ≥ components, otherwise summed |
| Governing capacity | Lowest of crane SWL (or derated tandem total) and rigging WLL |
| Hook check | `available hook − (floor level × tier height + component height + rigging headroom + clearance)` |
| Lift flags | Heavy (> threshold kg) · Multi-Person (crew ≥ threshold) · 3D Elevation · Complex (Complex-class item tagged) · Multi-Tool / Tandem (items ≥ threshold or two cranes) |
| Duty cycle | `Shifts Used ÷ Programme Shifts`. Shifts Used = busy h ÷ h per shift (Full-Build Dwell = whole critical path); Programme Shifts = production window × shifts per day × qty |
| HIGH RISK | Duty above the Serious limit, or hard double-booking beyond quantity |
| Resource concurrency | More simultaneous users than units on the early-start schedule; reported with whether it is resolvable within float |
| Spatial conflict | By zone and stand floor level: crew above the zone's per-level limit (congestion); an activity with lifts overlapping other work on the same level, or on another level (3D pinch point) |
| Spaghetti distance | `Σ moves × one-way rectilinear distance` between zone station points; Current vs Future positions. Moves inside one zone use half the side of an equivalent square cell |
| Control doc required | Severity ≥ 8, or RPN ≥ Serious, or ticked manually. Blind spot = Severity ≥ 8 with a Green RPN |
| Cell utilisation | `labour h per build × annual demand ÷ (crew per shift × annual hours)` |
| RPN | `S × O × D`, banded by the Tab 1 thresholds |

A **Baseline Work Block** is a merged group of activities in one FPD. Its header is the roll-up of its children (treated as
a serial chain); children keep their own times, classification, tags and lift data, so lift checks and VA / NNVA /
NVA splits are unchanged by merging. Unmerge restores the rows exactly.

### 10-point integrity self-test (`integrity.ts`)

1 no predecessor loops · 2 predecessor references resolve · 3 unique Op # · 4 weights on lift ops ·
5 Baseline Work Blocks reconcile to activities · 6 independent labour-hours recalculation · 7 independent critical-path
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

*More ▾ → Download Excel import template* gives the exact layout. Sheets are recognised by content first (BOP
header signals such as `Phase #`, `Route Code`, `Labour Content (Hours)`) and then by tab name: `FPDs`,
`Components`, `Resources`. PFMEA data is never imported from Excel; the register is maintained manually in Tab 5.
Rows are matched on FPD Code, Op #, BOM Ref and resource kind + name. Multi-value cells (predecessors, components,
the five resource tag columns) are separated by `;` or `,`. Excel error cells (`#REF!`, `#N/A`, …) are read as
blank and listed in the import preview. Unknown resources or components referenced from the BOP sheet are created
with blank ratings and flagged. Duplicate Op # values within a single sheet are auto-suffixed (`010-2`, `010-3`)
and warned.

### Floor layout geometry

Tab 1 accepts JSON (`{ "shapes": [{ "label": "Cell 4", "points": [[x, y], …] }] }`, also `x/y/width/height` boxes
and GeoJSON polygons), SVG (`rect`, `polygon`, `polyline`, straight-segment `path`) and DXF (`LWPOLYLINE`,
`POLYLINE`). Labels and layer names such as `CELL_4`, `Stores`, `Dispatch` are auto-assigned. Alternatively upload
a PNG / JPG, set the scale with two clicks and a known distance, then trace boxes or polygons with grid snapping.

### `summary@V2`

`buildSummary()` in `src/engine/gates.ts` produces: `schema`, `source`, `exportedAt`, `factory` (`id: "F4"`, with the
six cells nested as `factory.cells[]`, ids `F4-C1` … `F4-C6`), `basis`, `kpis`, `lifts`, `movement`, `pfmea`, `fpds[]`,
`resources[]`, `criticalPath[]`, `integrity`, `gates[]`, `routeToGreen[]`, `overallRag`.

## Baseline dataset

`src/data/seed.ts` — *PMA / UMA Heavy Assembly Baseline*: 6 cells, 8 zones, 8 FPDs, 52 activities, 15 components,
22 resources, 9 PFMEA lines, 6 hold points, 5 assumptions. It is tuned to reproduce the programme figures
(baseline ≈ 6.0 months; Build #1 at 130% ≈ 7.7 months against a 7.8-month window) and deliberately contains live
findings: a closure-head hook-height breach, two lifts above 90% SWL, one machine-locked labour operation, a
Full-Build stand at 99% duty, three spatial conflicts, three missing control documents and two unconfirmed assumptions. *More ▾ → Restore PMA / UMA baseline dataset* reloads it.
