# Contributing — Assembly & Static Build Central Spine

*Last updated: 2026-11-18*

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 10 or later (bundled with Node 20) |

No other global tools are required. All dependencies (including SheetJS) are installed locally via npm.

---

## Setup

```bash
git clone https://github.com/dannyhinks-alt/assembly-static-build-spine.git
cd assembly-static-build-spine
npm install
```

---

## Development Server

```bash
npm run dev
```

Vite starts a dev server at `http://localhost:5173`. Hot-module replacement is active.

> The dev server does not enforce the single-file constraint — it uses normal module splitting. Use `npm run build:offline` to test the final artefact.

---

## Pre-Push Verification Checklist

**Every push to any branch must have passed all four steps, in order:**

```bash
# 1. Zero TypeScript errors
npm run typecheck

# 2. Full test suite — all 19 tests must pass
npm test

# 3. Rebuild offline single-file bundle and force-add it
npm run build:offline
git add -f dist-offline/index.html

# 4. Rebuild root release HTML and force-add it
npm run build:pages
git add -f Assembly_Spine_v1.html docs/index.html
```

If any step fails, **do not push**. Fix the root cause; never use `@ts-ignore`, `eslint-disable`, or widen test tolerances to paper over failures.

---

## Code Standards (summary — full rules in `CLAUDE.md`)

| Rule | Limit |
|---|---|
| File length | ≤ 250 lines |
| Function length | ≤ 40 lines |
| TypeScript `any` types | Zero — use `unknown` with a narrowing guard |
| `as` casts | Only with an inline explanation of why the cast is provably safe |
| Inline arithmetic in tabs/components | Forbidden — all formulae live in `src/engine/` or `src/lib/` |
| State mutations outside `mutate()` | Forbidden |
| External CDN imports | Forbidden — all dependencies must be bundled locally |

---

## Branching Policy

- **All work merges to `main`** via short-lived feature branches.
- Branch naming: `claude/<short-descriptor>` for AI-assisted work; `fix/<short-descriptor>` or `feat/<short-descriptor>` for human work.
- **No force-push to `main`.**
- Squash-merge feature branches; delete them after merge.
- A PR sitting unmerged for more than two weeks should be rebased or closed.

---

## Commit Message Style

```
Imperative mood, present tense, British English.

Short summary line (≤ 72 chars), then a blank line, then as many
body paragraphs as needed.

Co-Authored-By: Your Name <your@email.com>
```

---

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode during development
npm run test -- --watch
```

Tests live in `src/engine/model.test.ts`. The fixture baseline in `src/engine/testFixture.ts` must never be altered to make a failing test pass — it represents the locked reference aircraft programme figures.

---

## Architecture Overview

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module map, data flow diagram, schema contracts, and key invariants.
