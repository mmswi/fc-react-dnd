# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-08-18

### Changed

- Added `repository`, `homepage`, and `bugs` fields to the package manifest so the npm page links
  back to the GitHub source. Metadata only — no code, build, or API change.

## [0.1.0] — 2026-08-08

First release.

### What it does

A headless React drag-and-drop library whose distinguishing feature is that a tree drop returns a
**position** — `(parentId, index, depth)`, clamped against both neighbours, with the dragged
subtree removed from the maths so a cycle is never offered — rather than a gesture relative to one
row.

Sortable lists, pointer and keyboard sensors, one collision strategy, a drag overlay, auto-scroll,
and a screen-reader path that reaches every legal outcome.

### Public API

Fourteen subpaths. There is no root entry, deliberately — import from the module:

| | |
| --- | --- |
| `fc-react-dnd/dnd-provider` | `DndProvider` |
| `fc-react-dnd/use-draggable` | `useDraggable` |
| `fc-react-dnd/use-droppable` | `useDroppable` |
| `fc-react-dnd/use-active-drag` | `useActiveDrag` |
| `fc-react-dnd/use-dnd-monitor` | `useDndMonitor` |
| `fc-react-dnd/drag-overlay` | `DragOverlay` |
| `fc-react-dnd/pointer-sensor` | `pointerSensor` |
| `fc-react-dnd/keyboard-sensor` | `keyboardSensor` |
| `fc-react-dnd/collision` | `closestCenter` |
| `fc-react-dnd/sortable-list` | `SortableList` |
| `fc-react-dnd/use-sortable` | `useSortable` |
| `fc-react-dnd/tree` | `flattenTree`, `projectTreeDrop`, `applyTreeDrop` |
| `fc-react-dnd/use-tree-drop` | `useTreeDrop` |
| `fc-react-dnd/types` | the shared type vocabulary |

### Constraints you will meet

These are decisions, not gaps — each one is there because the alternative was worse.

- **React 19 or newer.** The peer range is `>=19.0.0`, and it is a support statement: 19 is the
  only version tested, so declaring 18 would be an untested claim in the manifest.
- **ESM only.** No CommonJS build. `tsc` emits `dist/` per-file, mirroring `src/` — there is no
  bundler anywhere in the chain.
- **No root entry point.** `import … from 'fc-react-dnd'` does not resolve. A barrel pulls the
  whole library into a consumer's module graph on the first import and defeats tree-shaking
  downstream.
- **Zero runtime dependencies.** `react` and `react-dom` are the only things `dist/` imports.
- **One collision strategy**, `closestCenter`. The `CollisionDetection` type keeps custom ones
  pluggable.
- **Tree mode is indicator-only.** Rows do not translate during a tree drag; the projection drives
  one indicator. Live reflow is future work.
- **A row disappearing mid-drag cancels the drag**, reported as
  `onDragCancel({ reason: 'item-removed' })`. A row *appearing* does not. Removing a row shifts
  every rect below it, so a drop resolved against the cached geometry would land in the wrong
  place with nothing reporting an error; insertions must survive, or tree auto-expand and every
  lazily-loaded list would cancel the drag that caused them.

### Consumer contracts

- `items` (and `canNest`) must be referentially stable — they key the projection memo.
- Restore collapse state in `onDragEnd`/`onDragCancel`, never mid-drag.
- Key lists by id, not by index.

### Not included

Cross-list and cross-tree moves, additional collision strategies, drop animations, live row reflow
during a tree drag, RTL-aware direction, and a built-in auto-expand helper (the recipe is
documented and demonstrated).

[0.1.1]: https://github.com/mmswi/fc-react-dnd/releases/tag/v0.1.1
[0.1.0]: https://github.com/mmswi/fc-react-dnd/releases/tag/v0.1.0
