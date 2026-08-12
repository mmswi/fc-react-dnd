# TASKS — fc-react-dnd

Canonical task board. This file is the **table of contents and the only place task
status lives**; each task's detail lives in its own file under `.claude/tasks/`.
`CLAUDE.md` § "Task workflow" defines how to use both.

Statuses: `[ ]` todo · `[x]` done · append `← in progress` to the active line.
Task files carry goal, red test, acceptance criteria, files, and "where it stands" —
**never a status field**. Two copies of a status always drift.

Every task starts with a failing test (`tdd` skill) and is done only when its
acceptance criteria hold **and** `bun run verify` is green.

> **Repo state note (2026-08-07):** an earlier session wrote parts of the P1 scaffold
> ahead of the board, half of it for a toolchain this project no longer uses (pnpm +
> ESLint + Prettier → **bun + Biome**). All of it was removed before the initial commit,
> so the repo now holds governance only: `CLAUDE.md`, `LICENSE`, `.gitignore`, and this
> board. **P1 starts from nothing** — there are no config files, no `node_modules`, and
> no lockfile. Build them against the task criteria, test-first, rather than looking for
> drafts to adapt.

## P0 — Governance

- [x] [T0.1](tasks/T0.1-claude-md-constitution.md) — `CLAUDE.md`, the project constitution
- [x] [T0.2](tasks/T0.2-license.md) — `LICENSE`, MIT, 2026 Mihai Marinescu
- [x] [T0.3](tasks/T0.3-task-board.md) — the split task board (`.claude/TASKS.md` + `.claude/tasks/`)
- [x] [T0.4](tasks/T0.4-gitignore.md) — `.gitignore`
- [x] [T0.5](tasks/T0.5-scope-lock.md) — scope locked with the user
- [x] [T0.6](tasks/T0.6-toolchain-decision.md) — toolchain decided: bun + Biome + Vitest + tsc

## P1 — Scaffold

- [x] [T1.1](tasks/T1.1-npm-name-availability.md) — confirm `fc-react-dnd` is free on the npm registry
- [x] [T1.2](tasks/T1.2-package-json.md) — `package.json`: ESM-only, subpath `exports`, bun workspaces, bun scripts
- [x] [T1.3](tasks/T1.3-tsconfig.md) — `tsconfig.json` + `tsconfig.build.json`
- [x] [T1.4](tasks/T1.4-biome-and-vitest-config.md) — `biome.json` + `vitest.config.ts`; delete the ESLint/Prettier/pnpm files
- [x] [T1.5](tasks/T1.5-test-harness.md) — `test/setup.ts` and `test/helpers.ts`
- [x] [T1.6](tasks/T1.6-install-green.md) — `bun install` clean; typecheck / check / test all run empty-green
- [x] [T1.7](tasks/T1.7-ci-workflow.md) — CI workflow running `bun run verify`

## P2 — Core primitives (pure, no React, Node-testable)

- [x] [T2.1](tasks/T2.1-public-types.md) — `src/types.ts`, the shared public type surface
- [x] [T2.2](tasks/T2.2-geometry.md) — `src/internal/geometry.ts` + tests
- [x] [T2.3](tasks/T2.3-collision-closest-center.md) — `src/collision.ts` + tests: `closestCenter`

## P3 — Store & subscription layer

- [x] [T3.1](tasks/T3.1-store.md) — `src/internal/store.ts` + tests: the whole drag lifecycle
- [x] [T3.2](tasks/T3.2-use-store-selector.md) — `src/internal/use-store-selector.ts` + tests
- [x] [T3.3](tasks/T3.3-context.md) — `src/internal/context.ts`, the per-provider store handle

## P4 — React API

- [x] [T4.1](tasks/T4.1-dnd-provider.md) — `src/dnd-provider.tsx`
- [x] [T4.2](tasks/T4.2-use-draggable.md) — `src/use-draggable.ts`
- [x] [T4.3](tasks/T4.3-use-droppable.md) — `src/use-droppable.ts`
- [x] [T4.4](tasks/T4.4-use-active-drag-and-monitor.md) — `src/use-active-drag.ts` + `src/use-dnd-monitor.ts`
- [x] [T4.5](tasks/T4.5-react-api-component-tests.md) — component tests: lifecycle, granularity, StrictMode

## P5 — Sensors

- [x] [T5.1](tasks/T5.1-pointer-sensor.md) — `src/pointer-sensor.ts` + tests
- [x] [T5.2](tasks/T5.2-keyboard-sensor.md) — `src/keyboard-sensor.ts` + tests

## P6 — Overlay, auto-scroll, accessibility

- [x] [T6.1](tasks/T6.1-drag-overlay.md) — `src/drag-overlay.tsx` + tests
- [x] [T6.2](tasks/T6.2-auto-scroll.md) — `src/internal/auto-scroll.ts` + tests
- [x] [T6.3](tasks/T6.3-accessibility-internals.md) — live region, announcements, instructions wiring + tests

## P7 — Sortable list

- [x] [T7.1](tasks/T7.1-list-projection.md) — `src/internal/list-projection.ts` + tests
- [x] [T7.2](tasks/T7.2-sortable-list.md) — `src/sortable-list.tsx`
- [x] [T7.3](tasks/T7.3-use-sortable.md) — `src/use-sortable.ts`
- [x] [T7.4](tasks/T7.4-sortable-granularity-tests.md) — render-granularity + StrictMode tests
- [x] [T7.5](tasks/T7.5-settle-transition.md) — `useSortable` returns `transition`; the drop commit never eases
- [x] [T7.6](tasks/T7.6-node-style.md) — every hook returns a ready-to-spread `style` (transform + transition + touch-action)

## P8 — Tree drag-and-drop (the flagship)

- [x] [T8.1](tasks/T8.1-tree-math.md) — `src/tree.ts` + exhaustive tests: flatten, project, apply
- [x] [T8.2](tasks/T8.2-use-tree-drop.md) — `src/use-tree-drop.ts` + tests
- [x] [T8.3](tasks/T8.3-un-nesting.md) — Dragging left lifts a row out of its parent (§ A10)
- [x] [T8.4](tasks/T8.4-drop-indicator.md) — `TreeDropProjection.indicator`: the library resolves the screen-space anchor

## P9 — Integration & verification

- [x] [T9.1](tasks/T9.1-integration-pointer-flow.md) — integration: full pointer flow
- [x] [T9.2](tasks/T9.2-integration-keyboard-flow.md) — integration: full keyboard flow
- [x] [T9.3](tasks/T9.3-edge-cases.md) — edge cases: disabled, Escape, unmount mid-drag, second pointer
- [x] [T9.4](tasks/T9.4-build-and-package-checks.md) — `bun run build` emits a working `dist/`; publint + attw clean
- [x] [T9.5](tasks/T9.5-playground-app.md) — `playground/` Vite app: sortable, tree, dnd-kit comparison
- [x] [T9.6](tasks/T9.6-chrome-qa-and-profiler.md) — Chrome QA + captured profiler render counts

## P10 — Docs & the artifact

- [x] [T10.1](tasks/T10.1-readme.md) — `README.md`
- [x] [T10.2](tasks/T10.2-changelog.md) — `CHANGELOG.md`, `0.1.0`
- [x] [T10.3](tasks/T10.3-npm-pack-dry-run.md) — `npm pack --dry-run` reviewed
- [x] [T10.4](tasks/T10.4-final-standards-sweep.md) — final `mihai-coding-standards` sweep over the whole diff
- [ ] [T10.5](tasks/T10.5-blog-post.md) — **the blog post**, the actual artifact (excluded from the 2026-08-08 implementation pass by the user; everything it depends on is done, and the outstanding inputs are the T9.6 GIF and a first green CI run — see those task files)

## P11 — Defects found after v0.1

- [x] [T11.1](tasks/T11.1-indent-px-single-source.md) — one indent width, not two: `keyboardSensor({ indentPx })` and `useTreeDrop({ indentPx })` are separate constants, so a non-default indent makes one arrow press jump two depth levels (or none)
- [x] [T11.2](tasks/T11.2-tree-drop-indicator.md) — ship the drop indicator: a tree built from the library alone renders no drag feedback at all
- [x] [T11.4](tasks/T11.4-server-render-and-hydration.md) — the server story, tested instead of asserted: renders under SSR, and hydrates with no mismatch
- [ ] [T11.7](tasks/T11.7-navigational-comments-and-activate-rename.md) — make the call graph readable: 1113 comment lines and exactly **one** names another module in this library, so tracing "what happens on pointerdown" is 11 hops across 5 files with no signposts. Add backlinks at the deferred-call seams (additive, guarded by a test) and rename the colliding internal `activate` in `pointer-sensor.ts`
- [x] [T11.8](tasks/T11.8-readability-rewrite.md) — **the readability rewrite**: remove the hops instead of signposting them. Promoted T11.7's two deferred sections with the user's go (2026-08-11) — flattened the re-entrant sensor hop, reordered `store.ts` by lifecycle, split `projectTreeDrop` into named steps, and compressed the rationale essays in place. Public API byte-identical, guarded by the new `src/public-api.test.ts`
- [ ] [T11.9](tasks/T11.9-tree-drop-indicator-name-collision.md) — two public-surface corrections found by the T11.8 standards sweep, both breaking so both out of that task's scope: `TreeDropIndicator` names two different exports (the anchor **type** in `tree.ts`, the **component** in `tree-drop-indicator.tsx`), and `SensorContext.draggableId` is written at both call sites and read by nothing ← in progress
- [x] [T11.12](tasks/T11.12-root-entry.md) — a **root entry**: `import { DndProvider, useSortable, applySortEnd } from 'fc-react-dnd'`. Reverses ground rule 4's "no barrels, including `src/index.ts`" at the user's call — the tree-shaking argument it rested on does not apply to an ESM package marked `sideEffects: false`. Subpaths all stay, because the root is **not** server-importable
- [x] [T11.11](tasks/T11.11-apply-sort-end.md) — `applySortEnd` in a new pure `fc-react-dnd/list`: the list side computed the outcome and then handed the consumer indices to splice by hand, while *Concurrent edits* explains that indices are the thing a concurrent edit invalidates — so the documented path was the unsafe one
- [ ] [T11.10](tasks/T11.10-readme-undocumented-api.md) — the README documents a subset of what ships: `useDraggable`/`useDroppable` had no example, and `data`, `direction`, `collapsedIds`, `nestBandFraction`, `canNest`, `trackTransform` and `activatorProps` were public and unmentioned

## Backlog (explicitly out of v0.1 scope)

No task files — promote an entry to a task (TOC line + file) before coding it.

- Cross-list sortable moves (kanban) as a first-class API
- Cross-**tree** moves (drag between two trees; v0.1 guards with a null projection — § A7 F10)
- Band-boundary hysteresis for the tree projection (pure shape: `projectTreeDrop` takes the
  previous projection and applies a switching threshold — § A7)
- Live-reflow tree mode (rows translating during a tree drag; v0.1 is indicator-only — § A7)
- Op-shaped `applyTreeDrop` return (a `move`-op description alongside the new tree, for
  consumer undo/redo — § A5)
- Built-in auto-expand helper (user, 2026-08-08): `autoExpand: { delayMs }` on `useTreeDrop`,
  wrapping the § A7 F8 recipe. Constraints for whoever builds it: **callback-shaped** —
  the consumer owns collapse state, so the helper emits expand requests (projection stable
  on the same collapsed nestable node for `delayMs`) and hands back the set of
  auto-expanded ids **only in `onDragEnd`/`onDragCancel`** for restoration (restoring
  mid-drag = removal = cancel, per A6); timers torn down on end/cancel; delay a named
  constant, no bare literals
- Additional collision strategies (`rectIntersection`, `pointerWithin`)
- Drop animation for `DragOverlay` (animate to final/origin rect)
- `portalContainer` prop for overlay + live region
- Keyboard navigation for a **horizontal** `SortableList`: ArrowLeft/ArrowRight are the depth
  step (T5.2), so a horizontal list steps by `indentPx` rather than target-to-target. Needs an
  axis-aware sensor option or a list-direction-aware targeting query — not a layout-dependent
  "target if one is there, otherwise indent" rule, which breaks on tree rows whose centres are
  offset by indentation
- RTL-aware keyboard direction + tree depth direction
- Touch long-press activation recipes; multi-pointer strategies
- Virtualized-list integration recipe
- Evaluate `bun:test` as a Vitest replacement once the suite exists (needs a jsdom/happy-dom story, `--preload` setup, and a fake-timers equivalent for rAF)
- `repository` field + GitHub remote once created; npm publish + provenance
