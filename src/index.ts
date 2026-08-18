/**
 * The root entry: everything this package publishes, from one specifier.
 *
 * ```ts
 * import { DndProvider, SortableList, useSortable, applySortEnd } from 'fc-react-dnd'
 * ```
 *
 * Every subpath is still published and still works — this re-exports them, it does not replace
 * them. Importing through here costs a bundled app nothing: `sideEffects: false` plus ESM means
 * everything unused is dropped.
 *
 * (Unbundled, re-exports are eager, so importing this instantiates all 17 modules rather than 1 —
 * about 8 ms, once. Measured in `.claude/tasks/T11.12-root-entry.md`; too small to design around,
 * and recorded there so it does not get re-litigated.)
 *
 * Re-exports are written out by name rather than `export *`, so this file is a readable manifest
 * of the public surface and a new export has to be added here deliberately. `public-api.test.ts`
 * pins the result, so an export added to a module and forgotten here fails the suite.
 */

export { closestCenter } from './collision.js'
export { DndProvider, type DndProviderProps } from './dnd-provider.js'
export { DragOverlay, type DragOverlayProps } from './drag-overlay.js'
export { type KeyboardSensorOptions, keyboardSensor } from './keyboard-sensor.js'
export { applySortEnd } from './list.js'
export { type PointerSensorOptions, pointerSensor } from './pointer-sensor.js'
export {
  SortableList,
  type SortableListProps,
  type SortEndEvent,
} from './sortable-list.js'
export {
  applyTreeDrop,
  DEFAULT_NEST_BAND_FRACTION,
  DEFAULT_TREE_INDENT_PX,
  type FlattenedTree,
  type FlattenTreeOptions,
  flattenTree,
  type ProjectTreeDropArgs,
  projectTreeDrop,
  TREE_DROP_MODES,
  TREE_INDICATOR_EDGES,
  type TreeDropIndicatorType,
  type TreeDropMode,
  type TreeDropProjection,
  type TreeIndicatorEdge,
  type TreeItem,
  type TreeNestPredicate,
  type TreeRow,
} from './tree.js'
export { TreeDropIndicator, type TreeDropIndicatorProps } from './tree-drop-indicator.js'
export {
  type ActiveDragInfo,
  type CollisionActive,
  type CollisionArgs,
  type CollisionDetection,
  type DirectionalTarget,
  type DndAccessibility,
  type DndAnnouncements,
  type DndData,
  type DndId,
  type DndMonitorListeners,
  DRAG_CANCEL_REASONS,
  DRAG_DIRECTIONS,
  type DragActive,
  type DragBeginInit,
  type DragCancelEvent,
  type DragCancelReason,
  type DragDirection,
  type DragEndEvent,
  type DragHandleProps,
  type DragMoveEvent,
  type DragNodeStyle,
  type DragOver,
  type DragOverEvent,
  type DragSession,
  type DragStartEvent,
  type DroppableCandidate,
  type Point,
  type Rect,
  type Sensor,
  type SensorActivatorProps,
  type SensorContext,
  type Translate,
} from './types.js'
export { useActiveDrag } from './use-active-drag.js'
export { useDndMonitor } from './use-dnd-monitor.js'
export { type UseDraggableOptions, type UseDraggableResult, useDraggable } from './use-draggable.js'
export { type UseDroppableOptions, type UseDroppableResult, useDroppable } from './use-droppable.js'
export {
  SORTABLE_SETTLE_TRANSITION,
  type UseSortableOptions,
  type UseSortableResult,
  useSortable,
} from './use-sortable.js'
export {
  type TreeRowProps,
  type UseTreeDropOptions,
  type UseTreeDropResult,
  useTreeDrop,
} from './use-tree-drop.js'
