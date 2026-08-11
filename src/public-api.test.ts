import { describe, expect, expectTypeOf, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import * as collision from './collision.js'
import * as dndProvider from './dnd-provider.js'
import * as dragOverlay from './drag-overlay.js'
import * as keyboardSensor from './keyboard-sensor.js'
import * as pointerSensor from './pointer-sensor.js'
import * as sortableList from './sortable-list.js'
import * as tree from './tree.js'
import * as treeDropIndicator from './tree-drop-indicator.js'
import * as types from './types.js'
import * as useActiveDrag from './use-active-drag.js'
import * as useDndMonitor from './use-dnd-monitor.js'
import * as useDraggable from './use-draggable.js'
import * as useDroppable from './use-droppable.js'
import * as useSortable from './use-sortable.js'
import * as useTreeDrop from './use-tree-drop.js'

/**
 * The published surface, pinned by name.
 *
 * A refactor is only safe if it cannot be felt from outside, and `bun run check:package` proves
 * the subpaths *resolve* without saying what they contain. This says what they contain, so moving
 * an export fails here rather than in a consumer's codebase.
 *
 * Namespace imports are what the whole file is for — enumerating a module is the only way to
 * assert nothing was added. Everywhere else in this package they are banned, for tree-shaking.
 */

/** The `./package.json` entry is a file passthrough, not a module — nothing to enumerate. */
const PACKAGE_JSON_SUBPATH = './package.json'

const RUNTIME_EXPORTS_BY_SUBPATH: Readonly<Record<string, readonly string[]>> = {
  './collision': ['closestCenter'],
  './dnd-provider': ['DndProvider'],
  './drag-overlay': ['DragOverlay'],
  './keyboard-sensor': ['keyboardSensor'],
  './pointer-sensor': ['pointerSensor'],
  './sortable-list': ['SortableList'],
  './tree': [
    'DEFAULT_NEST_BAND_FRACTION',
    'DEFAULT_TREE_INDENT_PX',
    'TREE_DROP_MODES',
    'TREE_INDICATOR_EDGES',
    'applyTreeDrop',
    'flattenTree',
    'projectTreeDrop',
  ],
  './tree-drop-indicator': ['TreeDropIndicator'],
  './types': ['DRAG_CANCEL_REASONS', 'DRAG_DIRECTIONS'],
  './use-active-drag': ['useActiveDrag'],
  './use-dnd-monitor': ['useDndMonitor'],
  './use-draggable': ['useDraggable'],
  './use-droppable': ['useDroppable'],
  './use-sortable': ['SORTABLE_SETTLE_TRANSITION', 'useSortable'],
  './use-tree-drop': ['useTreeDrop'],
}

const MODULES_BY_SUBPATH: Readonly<Record<string, object>> = {
  './collision': collision,
  './dnd-provider': dndProvider,
  './drag-overlay': dragOverlay,
  './keyboard-sensor': keyboardSensor,
  './pointer-sensor': pointerSensor,
  './sortable-list': sortableList,
  './tree': tree,
  './tree-drop-indicator': treeDropIndicator,
  './types': types,
  './use-active-drag': useActiveDrag,
  './use-dnd-monitor': useDndMonitor,
  './use-draggable': useDraggable,
  './use-droppable': useDroppable,
  './use-sortable': useSortable,
  './use-tree-drop': useTreeDrop,
}

const publishedSubpaths = Object.keys(packageJson.exports).filter(
  (subpath) => subpath !== PACKAGE_JSON_SUBPATH,
)

describe('the published subpath list', () => {
  it('is pinned here in full, so adding or dropping one cannot pass unnoticed', () => {
    expect(publishedSubpaths.slice().sort()).toEqual(Object.keys(RUNTIME_EXPORTS_BY_SUBPATH).sort())
  })

  it('points every subpath at a module this test actually imported', () => {
    expect(Object.keys(MODULES_BY_SUBPATH).sort()).toEqual(publishedSubpaths.slice().sort())
  })
})

describe('the value exports of each subpath', () => {
  for (const [subpath, expectedExports] of Object.entries(RUNTIME_EXPORTS_BY_SUBPATH)) {
    it(`${subpath} exports exactly its pinned names`, () => {
      const actualExports = Object.keys(MODULES_BY_SUBPATH[subpath] ?? {}).sort()
      expect(actualExports).toEqual([...expectedExports].sort())
    })
  }
})

/**
 * Types erase, so they cannot be enumerated at runtime — naming them here puts them under
 * `tsc --noEmit` instead, where renaming or deleting one fails the typecheck.
 */
type PublishedTypeSurface = {
  collision: types.CollisionActive | types.CollisionArgs | types.CollisionDetection
  dndProvider: dndProvider.DndProviderProps
  dragOverlay: dragOverlay.DragOverlayProps
  drags: types.DragActive | types.DragOver | types.ActiveDragInfo | types.DroppableCandidate
  events:
    | types.DragStartEvent
    | types.DragMoveEvent
    | types.DragOverEvent
    | types.DragEndEvent
    | types.DragCancelEvent
    | types.DndMonitorListeners
  geometry: types.DndId | types.Point | types.Translate | types.Rect | types.DndData
  handles: types.DragNodeStyle | types.DragHandleProps
  keyboardSensor: keyboardSensor.KeyboardSensorOptions
  pointerSensor: pointerSensor.PointerSensorOptions
  reasons: types.DragCancelReason | types.DragDirection
  sensors:
    | types.Sensor
    | types.SensorContext
    | types.SensorActivatorProps
    | types.DragSession
    | types.DragBeginInit
    | types.DirectionalTarget
  sortableList: sortableList.SortableListProps | sortableList.SortEndEvent
  speech: types.DndAnnouncements | types.DndAccessibility
  tree:
    | tree.TreeItem<unknown>
    | tree.TreeRow
    | tree.FlattenedTree
    | tree.FlattenTreeOptions
    | tree.TreeDropMode
    | tree.TreeNestPredicate
    | tree.TreeIndicatorEdge
    | tree.TreeDropIndicator
    | tree.TreeDropProjection
    | tree.ProjectTreeDropArgs
  treeDropIndicator: treeDropIndicator.TreeDropIndicatorProps
  useDraggable: useDraggable.UseDraggableOptions | useDraggable.UseDraggableResult
  useDroppable: useDroppable.UseDroppableOptions | useDroppable.UseDroppableResult
  useSortable: useSortable.UseSortableOptions | useSortable.UseSortableResult
  useTreeDrop:
    | useTreeDrop.UseTreeDropOptions<unknown>
    | useTreeDrop.UseTreeDropResult
    | useTreeDrop.TreeRowProps
}

describe('the type exports of each subpath', () => {
  it('still resolves every published type name', () => {
    expectTypeOf<PublishedTypeSurface>().toBeObject()
  })
})
