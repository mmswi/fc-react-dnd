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
 * Two levels, and the inner one is the correction § A7 F6 makes to the § A5 rule.
 *
 * Keyed on the store state alone, a mid-drag auto-expand would return a **stale** projection by
 * construction: the projection is a function of the consumer's rows, and those rows changed
 * while the state object did not have to. Keyed on the rows alone, two providers rendering the
 * same array would overwrite each other. So: outer key the per-provider state, inner key the
 * consumer's `items` array.
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

  // What the drop is aimed at vertically, and it is genuinely different for the two sensors —
  // the same number would make one of them wrong.
  //
  // A pointer drag aims with the **cursor**: that is what the user is looking at, and it moves
  // continuously through rows and the gaps between them.
  //
  // A keyboard drag has no cursor, and stepping to a row's *centre* would land in that row's
  // middle band every time — so ArrowLeft/ArrowRight would have nothing to clamp between and
  // whole depths would be unreachable, which is precisely what § A7 F9's reachability invariant
  // exists to catch. Anchoring on the dragged row's **leading edge** puts each step on a gap
  // boundary, and D1 makes that total: 'into' is still reachable as the deepest rung of the gap
  // below a nestable row.
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
    a.beforeId === b.beforeId
  )
}
