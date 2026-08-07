import type { DndId, Rect, Translate } from '../types.js'
import type { DragStoreState } from './store.js'

/**
 * "Where would this item land, and how far does every other item shift?" — as pure arithmetic
 * over cached rects, computed **once per store-state version** and read afterwards by O(1)
 * selectors.
 *
 * That last part is perf invariant 9, and it is the architecture's binding constraint rather
 * than an optimisation. Every subscriber's selector runs on every notification whether or not
 * anything re-renders, so a selector that recomputed this would make the move path O(N²) and
 * lose the frame regardless of how few components rendered.
 */

export const LIST_DIRECTIONS = {
  vertical: 'vertical',
  horizontal: 'horizontal',
} as const

export type ListDirection = (typeof LIST_DIRECTIONS)[keyof typeof LIST_DIRECTIONS]

export type ListProjection = {
  /** Item ids in the order their rects appear along the axis, not the order they were passed. */
  readonly orderedIds: readonly DndId[]
  readonly fromIndex: number
  readonly toIndex: number
  /** Only the items that actually move; everything else is absent rather than zero. */
  readonly translateById: ReadonlyMap<DndId, Translate>
}

export type ListProjectionArgs = {
  readonly itemIds: readonly DndId[]
  readonly direction: ListDirection
}

type MeasuredItem = {
  readonly id: DndId
  readonly start: number
  readonly size: number
}

type CacheEntry = {
  readonly direction: ListDirection
  readonly projection: ListProjection | null
}

/**
 * Two levels, and both are load-bearing.
 *
 * The **outer** key is the per-provider store state object — never consumer data. This map is
 * module-level, so an identity shared between two `DndProvider`s would make them overwrite each
 * other's entry: last writer wins, and the symptom is a wrong projection in whichever provider
 * rendered second. That is exactly the slate-react `NODE_TO_PARENT` bug (`ANALYSIS.md` § A5).
 *
 * The **inner** key is the list's own `itemIds` array, because two `SortableList`s inside one
 * provider share a single state object and must not share a projection.
 */
const projectionCache = new WeakMap<DragStoreState, WeakMap<object, CacheEntry>>()

const startAlong = (rect: Rect, direction: ListDirection): number =>
  direction === LIST_DIRECTIONS.vertical ? rect.top : rect.left

const sizeAlong = (rect: Rect, direction: ListDirection): number =>
  direction === LIST_DIRECTIONS.vertical ? rect.height : rect.width

const translateAlong = (distance: number, direction: ListDirection): Translate =>
  direction === LIST_DIRECTIONS.vertical ? { x: 0, y: distance } : { x: distance, y: 0 }

const measureItems = (
  itemIds: readonly DndId[],
  rects: ReadonlyMap<DndId, Rect>,
  direction: ListDirection,
): MeasuredItem[] => {
  const measured: MeasuredItem[] = []

  for (const id of itemIds) {
    const rect = rects.get(id)
    // A row that mounted mid-drag is measured on the next structural update; until then it
    // simply is not part of the list's geometry.
    if (rect)
      measured.push({ id, start: startAlong(rect, direction), size: sizeAlong(rect, direction) })
  }

  return measured.sort((left, right) => left.start - right.start)
}

/**
 * How far the run of displaced items moves, and where the dragged item lands.
 *
 * Both are expressed in terms of the **active item's own footprint** — its size plus the gap
 * beside it — rather than "move to where my neighbour was". Those coincide only when every row
 * is identical and flush against the next, and they disagree visibly the moment heights differ:
 * with rows of 20, 60, and 30, removing the first slides the other two up by 20, not by 60.
 *
 * The landing position needs no gap term at all. `start[to] + size[to] - size[active]` is where
 * the active item ends up flush with the far end of the target's *new* slot, and the shift and
 * the gap cancel out of that expression — worth stating because it looks like it is missing one.
 */
const computeTranslates = (
  items: readonly MeasuredItem[],
  fromIndex: number,
  toIndex: number,
  direction: ListDirection,
): Map<DndId, Translate> => {
  const translateById = new Map<DndId, Translate>()
  const active = items[fromIndex]
  const target = items[toIndex]
  if (!active || !target || fromIndex === toIndex) return translateById

  const isMovingForward = toIndex > fromIndex

  if (isMovingForward) {
    const successor = items[fromIndex + 1]
    if (!successor) return translateById

    // Everything the active item leaves behind: its own size plus the gap that followed it.
    const freedSpace = successor.start - active.start
    for (let index = fromIndex + 1; index <= toIndex; index += 1) {
      const item = items[index]
      if (item) translateById.set(item.id, translateAlong(-freedSpace, direction))
    }

    const landingStart = target.start + target.size - active.size
    translateById.set(active.id, translateAlong(landingStart - active.start, direction))
    return translateById
  }

  const predecessor = items[fromIndex - 1]
  if (!predecessor) return translateById

  // Space the active item will need where it lands: its own size plus the gap that preceded it.
  const gapBeforeActive = active.start - (predecessor.start + predecessor.size)
  const neededSpace = active.size + gapBeforeActive
  for (let index = toIndex; index < fromIndex; index += 1) {
    const item = items[index]
    if (item) translateById.set(item.id, translateAlong(neededSpace, direction))
  }

  translateById.set(active.id, translateAlong(target.start - active.start, direction))
  return translateById
}

const computeProjection = (
  state: DragStoreState,
  args: ListProjectionArgs,
): ListProjection | null => {
  const { origin, overId } = state
  if (!origin) return null

  const items = measureItems(args.itemIds, state.measuredRects, args.direction)
  const fromIndex = items.findIndex((item) => item.id === origin.id)
  // The drag belongs to another list, or to no list at all.
  if (fromIndex === -1) return null

  const overIndex = items.findIndex((item) => item.id === overId)
  // Over nothing, or over something outside this list: the item stays where it is.
  const toIndex = overIndex === -1 ? fromIndex : overIndex

  return {
    orderedIds: items.map((item) => item.id),
    fromIndex,
    toIndex,
    translateById: computeTranslates(items, fromIndex, toIndex, args.direction),
  }
}

export const projectList = (
  state: DragStoreState,
  args: ListProjectionArgs,
): ListProjection | null => {
  let byList = projectionCache.get(state)
  if (!byList) {
    byList = new WeakMap()
    projectionCache.set(state, byList)
  }

  const cached = byList.get(args.itemIds)
  if (cached && cached.direction === args.direction) return cached.projection

  const projection = computeProjection(state, args)
  byList.set(args.itemIds, { direction: args.direction, projection })
  return projection
}
