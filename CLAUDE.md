# Assembly & Static Build Central Spine — AI Development Guide

This file governs every AI-assisted and human contribution to this repository.
Read it in full before making any change. All rules are permanent unless explicitly
superseded by a later commit to this file on `main`.

---

## Repository Overview

| Item | Value |
|---|---|
| Project | Assembly & Static Build Central Spine (`assembly-static-build-spine`) |
| Stack | React 18 · TypeScript · Vite · Tailwind CSS · Immer · SheetJS (bundled) |
| Build target | Zero-dependency single-file offline HTML via `vite-plugin-singlefile` |
| Schema tag | `asbcs-workspace@1` (workspace files); `summary@V2` (Master Hub export) |
| Language | British English throughout — `despatch`, `analyse`, `utilisation`, `£` |
| Terminology | Product Family / FPD / Variant — never retail equivalents |

---

## Source Layout

```
src/
  types.ts            — All domain types, constants, uid helpers
  store.tsx           — Zustand store with Immer mutate()
  App.tsx             — Root shell, tab routing, file I/O
  engine/
    model.ts          — Pure domain calculations (CPM, AR%, lifts, learning curve)
    gates.ts          — Governance gate logic and summary@V2 export
    integrity.ts      — Workspace self-test checks
    space.ts          — Factory floor space calculations
    model.test.ts     — Vitest unit tests (run with `npm test`)
    testFixture.ts    — Deterministic baseline fixture for tests
  lib/
    excel.ts          — SheetJS import/export (no CDN — bundled locally)
    persistence.ts    — JSON workspace serialisation, localStorage, FSA API
    format.ts         — Number/date formatting helpers
    geometry.ts       — Layout geometry utilities
  components/
    primitives.tsx    — Shared UI primitives (TagPicker, Drawer, NumInput, …)
    CellsZones.tsx    — Cell & Zone editor
    FpdRegistry.tsx   — FPD registry card
    LayoutEditor.tsx  — Floor-plan canvas editor
    DataTable.tsx     — Generic sortable table
  tabs/
    Tab1Targets.tsx   — Programme targets & learning curve
    Tab2Bop.tsx       — Bill of Process (BOP) central spine
    Tab3Equipment.tsx — Tooling & equipment registry
    Tab4Lifts.tsx     — Lift & move analysis
    Tab5Pfmea.tsx     — PFMEA risk register
    Tab6Labour.tsx    — Labour & attendance analysis
    Tab7Footprint.tsx — Factory floor-plan & footprint
    Tab8Utilisation.tsx — Resource utilisation
    Tab9Executive.tsx — Executive summary
  data/
    seed.ts           — blankRow / blankResource / seedWorkspace factories
    guides.ts         — In-app guidance text
```

---

## Code Readability & Architecture Standards

These rules apply to every file touched. They are non-negotiable and
must be enforced before any commit is pushed.

### 1 · Modular File Size & Separation of Concerns

- **Maximum 250 lines per file.** If a file grows beyond this, extract
  helpers, sub-components, or domain logic into a new file.
- **Maximum 40 lines per function.** If a function grows beyond this,
  decompose it into named helpers that each do one thing.
- **Domain logic lives in `src/engine/` or `src/lib/`.** UI views
  (`src/tabs/`, `src/components/`) must be thin and declarative — they
  call engine/lib functions; they do not contain arithmetic or business
  rules inline.
- **State mutations live in `src/store.tsx`.** No tab or component may
  call `produce` or modify workspace state directly; all mutations go
  through `mutate()` from `useStore`.

### 2 · Human-Readable Naming

- Use **full, self-explanatory domain names** for every variable,
  function, parameter and type:
  - ✅ `effectiveCycleTimeMinutes`, `competentOperatorCount`, `attendanceRatioPct`
  - ❌ `ct`, `op`, `tmp`, `fn`, `v`, `n`, `r` (outside tiny array callbacks)
- Abbreviations permitted only in contexts where they are universal
  domain shorthand: `BOP`, `FPD`, `CPM`, `AR`, `RPN`, `NVA`, `NNVA`,
  `VA`, `PFMEA`, `KPI`.
- Single-letter variables are only acceptable as the callback parameter
  of a one-line `map`/`filter`/`reduce` where the type is obvious from
  context.

### 3 · JSDoc Formula & Rule Documentation

Every **calculation function** and every **validation / guardrail rule**
must carry a JSDoc block documenting:

```ts
/**
 * Purpose: Plain-English explanation of what is calculated and why it matters.
 *
 * Formula: result = (input_a × input_b) / input_c
 *
 * Inputs:
 *   @param inputA — description (unit, e.g. hours/build)
 *   @param inputB — description (unit, e.g. builds/year)
 *
 * Downstream impact: Names the KPIs, tabs, or governance gates that
 *   consume this value (e.g. "drives Tab 6 Labour burden row and Tab 9
 *   Executive KPI card").
 *
 * @returns description (unit)
 */
export function calculateLabourBurden(...): number { ... }
```

This requirement applies to every exported function in `src/engine/` and
`src/lib/`. Inline helpers in the same file may use a single-line comment
when the name is self-explanatory.

### 4 · Strict TypeScript

- **Zero `any` types.** Use `unknown` with a narrowing guard, or define a
  proper interface.
- **Explicit return types on all exported functions.**
- **No `as` type assertions** unless accompanied by a narrowing check that
  makes the cast provably safe; add an inline comment explaining why.
- Run `npm run typecheck` (`tsc --noEmit`) before every commit. The build
  must report zero errors and zero warnings.

### 5 · British English & Domain Language

- Spell-check all user-visible strings, comments and identifiers using
  British English: `despatch`, `analyse`, `colour`, `utilisation`,
  `organisation`, `licence` (noun), `prioritise`.
- Currency: `£` — never `$` or `USD`.
- Zero retail terminology. Accepted domain vocabulary:
  - Product Family, FPD (Final Product Document), Variant, Sub-Assembly
  - Baseline Work Block, Operation Phase, Route Code
  - Attendance Ratio, Lean Action Profile, PFMEA

### 6 · Developer Handover Docs

- Keep `docs/ARCHITECTURE.md` aligned whenever folder structure, database
  schemas, or API contracts change.
- Keep `CONTRIBUTING.md` aligned whenever build commands, environment
  setup, or branching policy changes.
- Neither file needs to be updated for routine feature additions — only
  when the structural contract changes.

---

## Mandatory Pre-Push Verification

Every push to any branch **must** have passed all of the following, in order:

```bash
# 1. Zero TypeScript errors
npm run typecheck

# 2. Full test suite — all tests must pass
npm test

# 3. Rebuild offline single-file bundle and force-add it
npm run build:offline
git add -f dist-offline/index.html

# 4. Rebuild root release HTML and force-add it
npm run build:pages
git add -f Assembly_Spine_v1.html docs/index.html
```

If any step fails, **do not push**. Fix the root cause; never bypass
TypeScript errors with `@ts-ignore` or `eslint-disable`.

---

## Schema Contracts — Do Not Break

| Contract | Location | Rule |
|---|---|---|
| Workspace schema | `src/types.ts` → `WORKSPACE_SCHEMA = 'asbcs-workspace@1'` | Never change the schema tag without a migration path in `persistence.ts` `normaliseWorkspace()` |
| Summary export schema | `src/types.ts` → `SUMMARY_SCHEMA = 'summary@V2'` | The Master Hub consumes this; changing it is a breaking change requiring coordinator sign-off |
| BOP canonical columns | `src/lib/excel.ts` `exportBop()` | The Master BOP & PFMEA Combined sheet column order is a round-trip contract — reordering breaks re-import |
| Test fixture baseline | `src/engine/testFixture.ts` | The baseline figures must remain stable; never alter them to make a failing test pass |
| Self-test tolerance | `src/engine/integrity.ts` | Numerical self-checks use 0.001 % tolerance — do not widen this threshold |

---

## Git & Branching Policy

- **Single-branch policy:** All work merges to `main`. Feature branches are
  short-lived; delete them after the PR is squash-merged.
- **Branch naming:** `claude/<short-descriptor>` for AI-assisted work,
  `fix/<short-descriptor>` or `feat/<short-descriptor>` for human work.
- **No force-push to `main`.** Rebase or squash on the feature branch
  before merging.
- **Commit messages:** Imperative mood, present tense, British English.
  Include the Co-Authored-By and Claude-Session trailers on AI-assisted
  commits.
- **No stale PRs.** A PR that has sat unmerged for more than two weeks
  should be rebased or closed.

---

## Offline Single-File Build Constraint

The application must run entirely offline with zero external runtime CDN
dependencies. This means:

- SheetJS (`xlsx`) is imported from the local bundle — never from a CDN URL.
- All fonts, icons and stylesheets are inlined at build time by
  `vite-plugin-singlefile`.
- `dist-offline/index.html` and `Assembly_Spine_v1.html` must be rebuilt
  and committed with every code change (see Pre-Push Verification above).
- Do not add any `import` or `<script src="…">` that resolves to an
  external host at runtime.

---

## Baseline Figures (Do Not Alter)

These figures are locked in `src/engine/testFixture.ts` and verified by
the test suite. They represent the designed baseline for the reference
aircraft programme. Changing them requires explicit sign-off and a new
fixture version.

| Metric | Baseline value |
|---|---|
| Learning curve start factor | 130 % (Build 1) |
| Learning curve floor | 110 % (Build 5+) |
| Programme window (nominal) | 7.8 months |
| Programme window (peak) | 6.5 months |
| Waste % (of elapsed hours) | ~2.5 % |

---

## Human-Legibility & Lifecycle Maintainability Standard

These six rules exist so that a software engineer who did not write any of this
code can read, configure, debug, and hand it on to a successor without needing
help from the original authors.

### R1 · Module granularity is the first gate

Before adding to any file, check its line count. If adding the new code would
push it past 250 lines, extract first. The extraction is not optional.

### R2 · Every sub-module has a single, nameable responsibility

Name the responsibility in one sentence before you write the first line. If you
cannot name it, the boundary is wrong. A file called `utils.ts` is a symptom of
a missing responsibility.

### R3 · Every JSDoc must include downstream impact

A formula without a downstream impact statement teaches nothing. Future
engineers need to know what breaks if they alter the formula. Include it.

### R4 · Tab and component files must stay thin

If a tab file contains an `if` statement that performs domain arithmetic, that
logic belongs in `src/engine/` or `src/lib/`. Move it before you commit.

### R5 · State mutation is a one-way door

The only path to a workspace mutation is `mutate()` from `useStore`. If you
find code that bypasses this, treat it as a bug.

### R6 · The offline constraint is not negotiable

The offline single-file build must work on an air-gapped corporate laptop. Any
`import` that resolves to an external host at runtime breaks this constraint.
If you are unsure whether a dependency resolves externally, run
`npm run build:offline` and inspect the output for external `src=` or `href=`
attributes.

---

*Last updated: 2026-11-18. Keep this file in sync with the codebase.*
