# fc-react-dnd

A React drag-and-drop library written from scratch. Performance, maintainability, and readability are the product; bundle size is explicitly not a current concern. MIT licensed. Zero runtime dependencies — `react` and `react-dom` are peer dependencies (**>= 19**; React 19 is the only tested target — see `.claude/ANALYSIS.md` § A8).

**Scope (locked with the user):** sortable list, pointer + keyboard sensors, exactly one collision strategy (`closestCenter`), a drag overlay — and one hard thing done deeply: **first-class tree drag-and-drop** (drop-into vs drop-between, depth projection during drag, cycle prevention) as pure, Node-tested functions. Every general-purpose React DnD library stops at the same boundary: it reports what gesture you made relative to *one row*, and leaves you to compute the actual outcome. This library returns the outcome — `(parentId, index, depth)`, clamped against both neighbours, with the active subtree excluded so a cycle cannot be expressed. That's the differentiator; see `.claude/ANALYSIS.md` § A2 for the evidence and § A1 for why the boundary exists. Deliverables around the code: a StrictMode-clean demo, a React Profiler render-count comparison against dnd-kit, and a technical blog post — **the blog post is the actual artifact; the library is the evidence for it.**

## Ground rules — read first, non-negotiable

1. **Load the `mihai-coding-standards` skill (Skill tool) before writing or reviewing any code in this repo.** Every task ends by walking that skill's closing checklist against the diff. Mandatory, not advisory.
2. **Load the `tdd` skill (Skill tool) before creating any component, hook, function, module, or bug fix.** The first artifact of every implementation task is a *failing* test, not an implementation. Red → green → refactor, one behaviour at a time. Mandatory, not advisory — a task whose first commit-worthy change is production code was done wrong.
3. **Work the task board.** `.claude/TASKS.md` is the canonical board — see "Task workflow" below. No coding without a task; no task marked done without verification.
4. **No barrel files. Anywhere. Including `src/index.ts`.** This package deliberately has no root entry — the public API is the explicit subpath list in `package.json#exports`. Consumers import from the source module: `import { useDraggable } from 'fc-react-dnd/use-draggable'`.
5. **ESM-only, zero runtime dependencies.** No CJS build, no bundler in the build chain — `tsc` emits `dist/` per-file, mirroring `src/` 1:1.
6. **Never publish to npm without the user's explicit go.** `npm pack --dry-run` is the ceiling for autonomous work.

## Task workflow

The board is split so each piece stays small enough to read in full:

- **`.claude/TASKS.md`** — the table of contents. One line per task: status, id, title, link. Phases `P0..P10`, tasks `T<phase>.<n>`.
- **`.claude/tasks/T<phase>.<n>-<slug>.md`** — one file per task: goal, the test that opens it, acceptance criteria, files touched, and a "where it stands" note.
- **`.claude/ANALYSIS.md`** — the reasoning *behind* the board: problem definitions, brainstorming, and research, in numbered entries (`A1`, `A2`, …). Every claim about the outside world carries a `[verified]` / `[unverified]` / `[open]` tag. Read it before reopening a scope decision, and add to it before making one. **An `[unverified]` claim must never reach the README or the blog post** — promote it with a named source or drop it.

Rules:

- **Status lives in `.claude/TASKS.md` and nowhere else.** Statuses are `[ ]` todo, `[x]` done; append `← in progress` to the line currently being worked. Task files must never carry a status field or checkbox criteria — two copies of a status always drift, and this repo's single-source-of-truth standard forbids it.
- **Start a task by writing its red test**, per ground rule 2. A task is not "in progress" until a failing test exists for it.
- Keep the task file's **"Where it stands"** section current *as work happens* — files touched, what's left, blockers — detailed enough that a fresh session could pick the task up cold.
- Update the board **in the same working session as the change** — never "later".
- A task is done only when its acceptance criteria hold **and** `bun run verify` is green (typecheck, Biome, tests, build, package checks).
- Work discovered mid-task becomes a new task (a TOC line **and** its own file) or a Backlog entry before it is coded.
- If the user's gbrain MCP server is connected in the session, mirror the **TOC** there as a single page (`notes/fc-react-dnd-tasks`) per the user's global protocol — one page, not one per task. If it is not connected, the repo board alone is the source of truth.

## Toolchain

- **bun** — package manager, script runner, and workspaces (root lib + `playground/`). No pnpm, no npm-for-installs.
- **Biome** — lint, format, and import sorting in one binary. It replaced ESLint + Prettier; no `eslint.config.js`, `.prettierrc.json`, or `.prettierignore` belongs in this repo.
- **Vitest (jsdom)** — the test runner. Deliberately *not* `bun:test`: the suite depends on `vitest.config.ts`, `vi.useFakeTimers({ toFake: [...] })`, and jsdom.
- **tsc** — the whole build. No bundler.

## Commands

| Command | What it does |
| --- | --- |
| `bun install` | Install (bun workspaces: root lib + `playground/`) |
| `bun run test` / `bun run test:watch` | Vitest (jsdom). **Never `bun test`** — that invokes Bun's own runner, ignores `vitest.config.ts`, and fails in ways that look like product bugs. |
| `bun run typecheck` | `tsc --noEmit` over src + tests |
| `bun run check` / `bun run check:fix` | `biome check .` / `biome check --write .` — lint, format, and import sorting in one pass |
| `bun run build` | Clean `dist/`, per-file `tsc` emit (JS + d.ts + maps) |
| `bun run check:package` | `publint` + `attw --pack . --profile esm-only` |
| `bun run verify` | typecheck → check → test → build → check:package. The gate for every task. |
| `bun run --filter playground dev` | Vite playground app (aliases `fc-react-dnd/*` → `../src/*`). `--filter` matches the workspace **package name**, not the directory. |

`npm pack --dry-run` stays on npm on purpose — it is a check against the registry's own tarball rules, not a package-manager preference. Do not "convert" it.

## Architecture

Headless, store-first. All drag state lives in a plain external store (`src/internal/store.ts`), created **per `DndProvider` instance** (never module-level — SSR-safe, multi-provider-safe). React subscribes to narrow slices via `useSyncExternalStore`, so a 120 Hz pointer stream re-renders almost nothing:

- **Sensors** translate DOM events into store lifecycle calls. On activation they receive a `DragSession` (`move` / `end` / `cancel`) and own their window/document listeners for the duration of one interaction. Stale sessions (after end/cancel) become no-ops via a session token. (`setTransform` was dropped before P1 — no test could tell it apart from `move`; see `.claude/ANALYSIS.md` § A9.1.)
- **The store** measures droppable rects **once** at `beginDrag` (batched reads), caches them, and runs collision detection against the cache on every move — no DOM reads in the move path. Scroll/resize during a drag set a dirty flag; rects re-measure lazily on the next update.
- **`DragOverlay`** follows the pointer by writing `style.transform` directly to its element inside `requestAnimationFrame` — zero React renders per move. `pointer-events: none` so it never blocks hit-testing.
- **`useDraggable` / `useDroppable`** re-render only on the slices they select (`isDragging`, `isOver`) — i.e. on drag start/end and over-change, not per move. Registration happens in effects and never notifies subscribers.

### Module map

| Public subpath (`fc-react-dnd/…`) | File | Main exports |
| --- | --- | --- |
| `dnd-provider` | `src/dnd-provider.tsx` | `DndProvider`, `DndProviderProps` |
| `use-draggable` | `src/use-draggable.ts` | `useDraggable`, `UseDraggableOptions`, `UseDraggableResult` |
| `use-droppable` | `src/use-droppable.ts` | `useDroppable`, `UseDroppableOptions`, `UseDroppableResult` |
| `use-active-drag` | `src/use-active-drag.ts` | `useActiveDrag` |
| `use-dnd-monitor` | `src/use-dnd-monitor.ts` | `useDndMonitor`, `DndMonitorListeners` |
| `drag-overlay` | `src/drag-overlay.tsx` | `DragOverlay`, `DragOverlayProps` |
| `pointer-sensor` | `src/pointer-sensor.ts` | `pointerSensor`, `PointerSensorOptions` |
| `keyboard-sensor` | `src/keyboard-sensor.ts` | `keyboardSensor`, `KeyboardSensorOptions` |
| `collision` | `src/collision.ts` | `closestCenter` — the one shipped strategy; the `CollisionDetection` type keeps custom ones pluggable |
| `sortable-list` | `src/sortable-list.tsx` | `SortableList`, `SortableListProps` (per-list context + `onSortEnd`) |
| `use-sortable` | `src/use-sortable.ts` | `useSortable`, `UseSortableOptions`, `UseSortableResult` |
| `tree` | `src/tree.ts` | **Pure tree math**: `flattenTree`, `projectTreeDrop`, `applyTreeDrop`, tree types |
| `use-tree-drop` | `src/use-tree-drop.ts` | `useTreeDrop` — live `TreeDropProjection` + `getRowProps(id)` row wiring (rows are measure-only, never droppables); re-renders only when the projection changes |
| `types` | `src/types.ts` | Shared public types (`DndId`, events, `Sensor`, `CollisionDetection`, …) |

`src/internal/*` (store, context, geometry, list projection, auto-scroll, live region, announcements, DOM helpers, `use-store-selector`) is private: it is not in the `exports` map, so Node and TypeScript refuse deep imports. Internal modules import each other directly — never through any re-export hub.

## Performance invariants — number-cite these in reviews

1. **No DOM reads in the pointermove path.** Rects are read once at `beginDrag`, cached in the store; re-measure only through the dirty flag.
2. **Reads batched before writes** — never interleaved (see the standards' layout-thrashing section; the `layout-thrashing-prevention` skill has the full model).
3. **Motion is `transform`/`opacity` only**; overlay DOM writes are rAF-coalesced (one write per frame max).
4. A store notification whose selected slice is unchanged **never enters React**: `useSyncExternalStore`'s subscribe wrapper compares first and only then schedules, so there is no lane, no root scheduling, and no render at all (`ReactFiberHooks.js:1859-1893`). This is a guarantee, not an optimization that might not fire. Only the active draggable (and only if it selects `transform`) renders during a move; the provider subtree never does. See `.claude/ANALYSIS.md` § A3.1.
5. Draggable/droppable registration (mount/unmount) never notifies subscribers — **while no drag is active.** During an active drag it is a structural event, and the policy is asymmetric by design (see `.claude/ANALYSIS.md` § A6):
   - **Unregistration cancels the drag**, returning the item to its origin. Any removal — the active item, the current `over`, or any other row — invalidates cached geometry, and cancelling leaves no window in which a drop position derived from a vanished tree can be presented. Without this, a collaborator deleting a row produces a **silently wrong drop**.
   - **Registration does not cancel**; it marks rects dirty, re-measures, and re-collides. Cancelling on insertion would break tree auto-expand-on-hover (which mounts rows as a result of the user's own drag) and any lazy-loading list reached by auto-scroll.
6. Event listeners are passive except where `preventDefault` is load-bearing (activated pointermove, keyboard activation keys).
7. Per-interaction state (listeners, autoscroll loop) is torn down completely on end/cancel/unmount — no leaks between drags.
8. **StrictMode-clean**: double-invoked effects must not double-register, double-subscribe, or leak. The demo runs inside `<StrictMode>`.
9. Derived per-move computations shared by many subscribers (list projection, tree projection) are memoized **once per store-state version** (WeakMap keyed by the immutable state object), then read by O(1) selectors — never recomputed per subscriber. **This is *the* performance constraint of the architecture, not an optimization.** Invariant 4 buys you no re-render, but reaching that conclusion requires React to call `getSnapshot` — so every subscriber's selector runs on every notification regardless of outcome. 50 rows at 120 Hz is ~6,000 selector calls per second in the steady state where nothing re-renders; if one recomputes a projection, the move path is O(N²) and the frame is gone. The selector must also return a **cached reference** — an uncached one is an infinite loop, which is what React's DEV double-call detects. See `.claude/ANALYSIS.md` § A3.2.

## Accessibility invariants

1. Keyboard path is first-class: Space/Enter picks up, arrows move between droppables (nearest in direction), Space/Enter drops, Escape cancels, blur cancels.
2. A visually-hidden live region announces start / over / drop / cancel; all texts overridable via `DndProvider`'s `accessibility` prop.
3. Handle props ship `role="button"`, `tabIndex={0}`, `aria-roledescription`, and `aria-describedby` pointing at a hidden instructions element.
4. Disabled draggables keep semantics (`aria-disabled`) and lose activation listeners.

## Public API policy

- Adding, renaming, or removing a subpath or an export is an API decision → its own task (TOC line + task file) in `.claude/TASKS.md`.
- Public option/result types get unique exported names (`UseDraggableOptions`, `DndProviderProps`, …). The standards' `Props` shorthand applies only to non-exported internal components — exported names must stay unique handles package-wide.
- `data` payloads are `Record<string, unknown>`. Never `any` anywhere.

## Repo conventions

- **File name = kebab-case of its primary export; public subpath = file stem** (`use-draggable.ts` → `fc-react-dnd/use-draggable`). One primary export per public file.
- **Relative imports carry the `.js` extension** (NodeNext ESM emit; Vite/Vitest resolve them back to `.ts`).
- **`'use client'`** tops every module that touches React state/effects/context or the DOM at render time. Pure modules (`collision`, `types`, `internal/geometry`) stay directive-free so they remain server-importable.
- Tests are colocated (`foo.ts` → `foo.test.ts` / `foo.test.tsx`); shared helpers live in `test/`.
- Every tunable is a named constant (`DEFAULT_ACTIVATION_DISTANCE_PX`, `AUTO_SCROLL_EDGE_PX`, …) defined next to its use — no bare literals in logic.
- `@dnd-kit/*` may appear **only** inside `playground/` as the profiler-comparison baseline — never anywhere in the library itself.
- The blog post (`docs/`) is written with the `explain-how-it-works` skill loaded; profiler numbers in it must come from the actual comparison run, never estimated. The same rule governs **competitive claims**: any statement about what another library does or doesn't support must be `[verified]` in `.claude/ANALYSIS.md` against a named source before it appears in public writing. This is not hypothetical — the project's original framing ("the ecosystem punts on the tree case") was checked in `A2` and turned out to be **false**; Atlassian ships tree instructions. Re-verify before publishing, since these libraries move.

## Testing notes

- Tests come first (ground rule 2). Run them with `bun run test` — never `bun test`.
- jsdom has no layout engine: position elements with `mockElementRect(el, rect)` from `test/helpers.ts`.
- `PointerEvent` and pointer-capture methods are polyfilled in `test/setup.ts` — don't assume jsdom provides them.
- rAF-dependent tests use `vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })` and the `nextFrame()` helper; store logic is synchronous by design and needs no frame control.
- Integration tests drive real DOM events (`fireEvent.pointerDown` …), never sensor internals.
- **Render-count assertions should count commits, and must say which they count.** For store-driven granularity (the P4/P7/P8 tests), a counter in the component body is accurate — an unchanged slice never schedules a render, so the body genuinely does not run. The ambiguity appears when a **parent** re-renders: `useSyncExternalStore` then reaches React's *late* bailout, which runs the body and discards the output (`ReactFiberBeginWork.js:1519-1522`), so a body counter ticks on a render that committed nothing. Counting in a `useEffect` / `<Profiler>` `onRender` is unambiguous under both paths — prefer it, and state the method in the test. Every "re-renders exactly N times" criterion on the board means **commits**. Background: `.claude/ANALYSIS.md` § A3.1.

## Release checklist (v0.1 target: *ready to publish*; publishing itself is the user's call)

1. `bun run verify` green.
2. README examples compile against the current API.
3. `CHANGELOG.md` entry written.
4. `npm pack --dry-run` output reviewed — only `dist/`, `README.md`, `LICENSE`, `package.json`.
5. Stop. Publishing requires the user's explicit go.
