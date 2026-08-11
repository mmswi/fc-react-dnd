import {
  flattenTree,
  projectTreeDrop,
  type TreeDropProjection,
  type TreeItem,
  type TreeNestPredicate,
} from '../tree.js'
import type { DndId } from '../types.js'
import type { DragStoreState } from './store.js'

/**
 * The live tree projection, memoised once per store-state version.
 *
 * Same shape as the list projection, and for the same reason: every subscriber's selector runs
 * on every notification whether or not anything re-renders, so recomputing here would make the
 * move path O(N²) (perf invariant 9).
 */

export type TreeProjectionArgs<Extra> = {
  readonly items: readonly TreeItem<Extra>[]
  readonly collapsedIds?: ReadonlySet<DndId>
  readonly indentPx?: number
  readonly nestBandFraction?: number
  readonly canNest?: TreeNestPredicate
}

type CacheEntry = {
  readonly args: TreeProjectionArgs<never>
  readonly projection: TreeDropProjection | null
}

/**
 * Both keys are load-bearing. Outer: the per-provider state object — this cache is module-level,
 * so a key two providers shared would let them overwrite each other's entry (§ A5). Inner: the
 * consumer's `items` array, because a mid-drag auto-expand changes the rows while the state
 * object need not change at all, and keying on state alone would serve a stale projection
 * (§ A7 F6).
 */
const projectionCache = new WeakMap<DragStoreState, WeakMap<object, CacheEntry>>()

const sameOptions = (a: TreeProjectionArgs<never>, b: TreeProjectionArgs<never>): boolean =>
  a.collapsedIds === b.collapsedIds &&
  a.indentPx === b.indentPx &&
  a.nestBandFraction === b.nestBandFraction &&
  a.canNest === b.canNest

const computeProjection = <Extra>(
  state: DragStoreState,
  args: TreeProjectionArgs<Extra>,
): TreeDropProjection | null => {
  const { origin, translate, measuredRects } = state
  if (!origin) return null

  const flattened = flattenTree(args.items, {
    activeId: origin.id,
    collapsedIds: args.collapsedIds,
  })

  // What the drop is aimed at vertically, and the two sensors genuinely need different numbers.
  // A pointer drag aims with the **cursor** — what the user is looking at, moving continuously
  // through rows and the gaps between them. A keyboard drag has none, and stepping to a row's
  // centre would land in its middle band every time, leaving ArrowLeft/ArrowRight nothing to
  // clamp between and whole depths unreachable (§ A7 F9). So it anchors on the dragged row's
  // **leading edge**, which puts every step on a gap boundary; 'into' stays reachable as the
  // deepest rung of the gap below a nestable row.
  const pointerY =
    origin.pointer !== null ? origin.pointer.y + translate.y : origin.rect.top + translate.y

  return projectTreeDrop({
    flattened,
    activeId: origin.id,
    rowRects: measuredRects,
    pointerY,
    offsetX: translate.x,
    indentPx: args.indentPx,
    nestBandFraction: args.nestBandFraction,
    canNest: args.canNest,
  })
}

export const projectTreeForDrag = <Extra>(
  state: DragStoreState,
  args: TreeProjectionArgs<Extra>,
): TreeDropProjection | null => {
  let byItems = projectionCache.get(state)
  if (!byItems) {
    byItems = new WeakMap()
    projectionCache.set(state, byItems)
  }

  const cached = byItems.get(args.items)
  if (cached && sameOptions(cached.args, args as TreeProjectionArgs<never>))
    return cached.projection

  const projection = computeProjection(state, args)
  byItems.set(args.items, { args: args as TreeProjectionArgs<never>, projection })
  return projection
}

export const treeProjectionsAreEqual = (
  a: TreeDropProjection | null,
  b: TreeDropProjection | null,
): boolean => {
  if (a === b) return true
  if (!a || !b) return false

  return (
    a.parentId === b.parentId &&
    a.index === b.index &&
    a.depth === b.depth &&
    a.mode === b.mode &&
    a.afterId === b.afterId &&
    a.beforeId === b.beforeId &&
    a.indicator.rowId === b.indicator.rowId &&
    a.indicator.edge === b.indicator.edge &&
    a.indicator.depth === b.indicator.depth
  )
}
