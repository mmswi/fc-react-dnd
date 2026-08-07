import type { DndId, Rect } from './types.js'

/**
 * The thing this library exists to do properly.
 *
 * Tree drag-and-drop is hard because "where does this drop" has two answers at once — *into* a
 * node or *between* two nodes — and because a careless implementation happily drops a node
 * inside its own subtree. The whole answer here is **pure functions over plain data**: no React,
 * no DOM, exhaustively testable in milliseconds.
 *
 * Every general-purpose library reports a gesture relative to *one row* and stops. This module
 * returns the resulting **position** — `(parentId, index, depth)` — clamped against both
 * neighbours, with cycles unrepresentable rather than merely rejected.
 */

/**
 * A node in the consumer's tree. `Extra` carries whatever else their node has, so
 * `TreeItem<{ title: string }>` is `{ id, children?, title }` and nothing is copied or wrapped.
 */
export type TreeItem<Extra = unknown> = Extra & {
  readonly id: DndId
  readonly children?: readonly TreeItem<Extra>[]
}

/**
 * Where one node sits. `index` is the **sibling index within its parent**, not the position of
 * the row on screen — the distinction the rest of this module rests on.
 */
export type TreeRow = {
  readonly id: DndId
  readonly parentId: DndId | null
  readonly depth: number
  readonly index: number
}

export type FlattenedTree = {
  /** Visible rows, in reading order, with the active subtree and collapsed branches removed. */
  readonly rows: readonly TreeRow[]
  /**
   * Every node in the source tree, including the ones `rows` leaves out.
   *
   * `applyTreeDrop` locates the active node through this in O(depth) rather than searching the
   * tree — and the active node is by definition absent from `rows`. Emitted from the same single
   * walk, and a plain `Map` rather than a `WeakMap` because the keys are ids and the whole thing
   * is per-drag and discarded.
   */
  readonly locationById: ReadonlyMap<DndId, TreeRow>
}

export type FlattenTreeOptions = {
  /**
   * The node being dragged. It **and its descendants** are left out of `rows`, which is where
   * cycle prevention lives: a position inside your own subtree is not merely rejected, it is
   * never offered.
   */
  readonly activeId?: DndId | null
  readonly collapsedIds?: ReadonlySet<DndId>
}

export const flattenTree = <Extra>(
  items: readonly TreeItem<Extra>[],
  options: FlattenTreeOptions = {},
): FlattenedTree => {
  const { activeId = null, collapsedIds } = options

  const rows: TreeRow[] = []
  const locationById = new Map<DndId, TreeRow>()

  const walk = (
    siblings: readonly TreeItem<Extra>[],
    parentId: DndId | null,
    depth: number,
    isHiddenFromRows: boolean,
  ): void => {
    siblings.forEach((item, index) => {
      const row: TreeRow = { id: item.id, parentId, depth, index }
      locationById.set(item.id, row)

      const isHidden = isHiddenFromRows || item.id === activeId
      if (!isHidden) rows.push(row)

      // A collapsed branch is still walked, because the reverse index has to cover every node —
      // only its rows are withheld. Same for the active subtree, which is why one flag serves
      // both: from `rows`' point of view "dragged" and "collapsed away" are the same condition.
      const isCollapsed = collapsedIds?.has(item.id) ?? false
      if (item.children) walk(item.children, item.id, depth + 1, isHidden || isCollapsed)
    })
  }

  walk(items, null, 0, false)

  return { rows, locationById }
}

export const TREE_DROP_MODES = {
  /** Inside the target node, as its first child. */
  into: 'into',
  /** Between two rows, at a depth the pointer's horizontal position chose. */
  between: 'between',
} as const

export type TreeDropMode = (typeof TREE_DROP_MODES)[keyof typeof TREE_DROP_MODES]

/**
 * Whether `candidateParent` will take `active` as a child.
 *
 * Takes both nodes because the answer often depends on the pair. Defaults to always-true: any
 * node can be a parent, and a document that gains children is still a document (§ A7 D2).
 */
export type TreeNestPredicate = (candidateParent: TreeRow, active: TreeRow) => boolean

/**
 * Where the drop would land. Not a gesture relative to one row — the resulting **position**.
 *
 * `parentId` is an id and therefore safe; `index` is a slot and therefore is not. Both are
 * reported, plus the neighbours by id, so `applyTreeDrop` can resolve the final index against
 * the tree it is actually handed rather than trusting a number captured mid-drag (§ A6).
 */
export type TreeDropProjection = {
  readonly parentId: DndId | null
  readonly index: number
  readonly depth: number
  readonly mode: TreeDropMode
  /** The sibling it lands after; `null` at the start of the sibling list. */
  readonly afterId: DndId | null
  /** The sibling it lands before; `null` at the end of the sibling list. */
  readonly beforeId: DndId | null
}

export type ProjectTreeDropArgs = {
  readonly flattened: FlattenedTree
  readonly activeId: DndId
  /** Measured rects for the visible rows. Rows without one are simply not aimed at. */
  readonly rowRects: ReadonlyMap<DndId, Rect>
  /** The vertical position the drop is aimed at — in practice the dragged row's centre. */
  readonly pointerY: number
  /** How far the dragged row has moved horizontally from where it started. */
  readonly offsetX: number
  readonly indentPx?: number
  /** Share of a nestable row's height given to the "before" and "after" bands, each. */
  readonly nestBandFraction?: number
  readonly canNest?: TreeNestPredicate
}

export const DEFAULT_TREE_INDENT_PX = 24
export const DEFAULT_NEST_BAND_FRACTION = 0.3

const ALWAYS_NEST: TreeNestPredicate = () => true

const ROOT_PROJECTION: TreeDropProjection = {
  parentId: null,
  index: 0,
  depth: 0,
  mode: TREE_DROP_MODES.between,
  afterId: null,
  beforeId: null,
}

type PositionedRow = {
  readonly row: TreeRow
  readonly rect: Rect
}

type Gap = {
  readonly prev: TreeRow | null
  readonly next: TreeRow | null
}

const clamp = (value: number, lowest: number, highest: number): number =>
  Math.min(Math.max(value, lowest), highest)

/** Walks up the reverse index until it reaches `depth`. O(depth), not O(N). */
const ancestorOrSelfAtDepth = (
  row: TreeRow,
  depth: number,
  locationById: ReadonlyMap<DndId, TreeRow>,
): TreeRow => {
  let current = row
  while (current.depth > depth && current.parentId !== null) {
    const parent = locationById.get(current.parentId)
    if (!parent) return current
    current = parent
  }
  return current
}

/**
 * Which row the drop is aimed at, and whether it is the row itself or one of the gaps beside it.
 *
 * Band boundaries are stated in one place because they are asserted to the pixel: the exact
 * `top + band` belongs to the middle, and the exact `bottom - band` belongs to the after-gap.
 * For a row that will not nest there is no middle at all, and the exact half belongs to the
 * after-gap for the same reason.
 */
const resolveTarget = (
  positioned: readonly PositionedRow[],
  pointerY: number,
  activeRow: TreeRow,
  canNest: TreeNestPredicate,
  nestBandFraction: number,
): { intoRow: TreeRow | null; gap: Gap } => {
  const first = positioned[0]
  const last = positioned[positioned.length - 1]
  if (!first || !last) return { intoRow: null, gap: { prev: null, next: null } }

  if (pointerY < first.rect.top) return { intoRow: null, gap: { prev: null, next: first.row } }
  if (pointerY >= last.rect.top + last.rect.height) {
    return { intoRow: null, gap: { prev: last.row, next: null } }
  }

  const hitIndex = positioned.findIndex(
    (entry) => pointerY >= entry.rect.top && pointerY < entry.rect.top + entry.rect.height,
  )
  // Between two rows that do not touch — treat it as the gap after the last row above it.
  if (hitIndex === -1) {
    const above = [...positioned].reverse().find((entry) => entry.rect.top <= pointerY)
    const below = positioned.find((entry) => entry.rect.top > pointerY)
    return { intoRow: null, gap: { prev: above?.row ?? null, next: below?.row ?? null } }
  }

  const hit = positioned[hitIndex] as PositionedRow
  const previousRow = positioned[hitIndex - 1]?.row ?? null
  const nextRow = positioned[hitIndex + 1]?.row ?? null
  const offsetIntoRow = pointerY - hit.rect.top

  if (!canNest(hit.row, activeRow)) {
    const isInLowerHalf = offsetIntoRow >= hit.rect.height / 2
    return isInLowerHalf
      ? { intoRow: null, gap: { prev: hit.row, next: nextRow } }
      : { intoRow: null, gap: { prev: previousRow, next: hit.row } }
  }

  const bandPx = hit.rect.height * nestBandFraction
  if (offsetIntoRow < bandPx) return { intoRow: null, gap: { prev: previousRow, next: hit.row } }
  if (offsetIntoRow >= hit.rect.height - bandPx) {
    return { intoRow: null, gap: { prev: hit.row, next: nextRow } }
  }

  return { intoRow: hit.row, gap: { prev: null, next: null } }
}

export const projectTreeDrop = (args: ProjectTreeDropArgs): TreeDropProjection | null => {
  const {
    flattened,
    activeId,
    rowRects,
    pointerY,
    offsetX,
    indentPx = DEFAULT_TREE_INDENT_PX,
    nestBandFraction = DEFAULT_NEST_BAND_FRACTION,
    canNest = ALWAYS_NEST,
  } = args

  const activeRow = flattened.locationById.get(activeId)
  // The drag belongs to another tree entirely; cross-tree moves are Backlog (§ A7 F10).
  if (!activeRow) return null

  // A row that mounted mid-drag has no rect until the next structural update, and a row cannot
  // be aimed at before it has one.
  const positioned: PositionedRow[] = []
  for (const row of flattened.rows) {
    const rect = rowRects.get(row.id)
    if (rect) positioned.push({ row, rect })
  }
  if (positioned.length === 0) return ROOT_PROJECTION

  const requestedDepth = activeRow.depth + Math.round(offsetX / indentPx)
  const { intoRow, gap } = resolveTarget(positioned, pointerY, activeRow, canNest, nestBandFraction)

  if (intoRow) {
    const firstChild = positioned.find((entry) => entry.row.parentId === intoRow.id)
    return {
      parentId: intoRow.id,
      index: 0,
      depth: intoRow.depth + 1,
      mode: TREE_DROP_MODES.into,
      afterId: null,
      // The same id the gap below an expanded parent would produce. Without this the two
      // "same position" paths agree on the index and disagree the moment an edit shifts it.
      beforeId: firstChild?.row.id ?? null,
    }
  }

  const { prev, next } = gap

  // The gap above the first row: there is nothing to nest into above it, so its depth is fixed.
  if (!prev) {
    if (!next) return ROOT_PROJECTION
    return {
      parentId: next.parentId,
      index: next.index,
      depth: next.depth,
      mode: TREE_DROP_MODES.between,
      afterId: null,
      beforeId: next.id,
    }
  }

  const lowestDepth = next ? next.depth : 0
  // `prev.depth + 1` *is* nesting into prev, so it obeys the same predicate the middle band does.
  const highestDepth = canNest(prev, activeRow) ? prev.depth + 1 : prev.depth
  // An empty interval means the gap admits no legal position at all — between a node and its own
  // first child, when that node will not take children (§ A7 F2).
  if (lowestDepth > highestDepth) return null

  const depth = clamp(requestedDepth, lowestDepth, highestDepth)
  const followsAtSameDepth = next !== null && next.depth === depth

  if (depth === prev.depth + 1) {
    return {
      parentId: prev.id,
      index: 0,
      depth,
      mode: TREE_DROP_MODES.between,
      afterId: null,
      beforeId: followsAtSameDepth ? next.id : null,
    }
  }

  const anchor = ancestorOrSelfAtDepth(prev, depth, flattened.locationById)
  return {
    parentId: anchor.parentId,
    index: anchor.index + 1,
    depth,
    mode: TREE_DROP_MODES.between,
    afterId: anchor.id,
    beforeId: followsAtSameDepth ? next.id : null,
  }
}

/**
 * Apply a projection to the tree **as it exists now**, immutably.
 *
 * Two things make this more than an array splice.
 *
 * **Structural sharing, not a deep clone.** Only the ancestor spines of the removal and the
 * insertion are rebuilt; every subtree that did not change keeps its identity, so a consumer's
 * memoised rows bail out after a drop. A deep clone is otherwise *correct*, which is exactly why
 * it needs an identity assertion to catch: on a 10k-node tree it turns ~2×depth re-renders into
 * 10k (`ANALYSIS.md` § A5).
 *
 * **The final index is resolved by id.** The projection was computed against the tree as it was
 * some milliseconds ago; a concurrent edit can remove a sibling before the insertion point and
 * shift every index after it. So the neighbours are looked up by id in the tree actually handed
 * in, and the captured `index` is only a clamped last resort for when both have gone (§ A6).
 */
export const applyTreeDrop = <Extra>(
  items: readonly TreeItem<Extra>[],
  activeId: DndId,
  projection: TreeDropProjection,
): readonly TreeItem<Extra>[] => {
  const { locationById } = flattenTree(items)
  const activeLocation = locationById.get(activeId)
  if (!activeLocation) return items

  // flattenTree makes a cycle unreachable through the front door by excluding the active
  // subtree from the rows. This is the back door: a hand-built projection, or one computed
  // against a tree that has since changed shape.
  if (wouldCreateCycle(projection.parentId, activeId, locationById)) return items

  const removal = removeAtPath(items, pathTo(activeLocation, locationById))
  if (!removal.removed) return items

  const remaining = removal.items
  const remainingLocations = flattenTree(remaining).locationById
  const parentPath = resolveParentPath(projection.parentId, remainingLocations)
  if (!parentPath) return items

  const siblings = siblingsAtPath(remaining, parentPath)
  const index = resolveIndex(projection, siblings)

  const landsWhereItStarted =
    projection.parentId === activeLocation.parentId && index === activeLocation.index
  if (landsWhereItStarted) return items

  return insertAtPath(remaining, parentPath, index, removal.removed)
}

const wouldCreateCycle = (
  parentId: DndId | null,
  activeId: DndId,
  locationById: ReadonlyMap<DndId, TreeRow>,
): boolean => {
  let current = parentId

  while (current !== null) {
    if (current === activeId) return true
    current = locationById.get(current)?.parentId ?? null
  }

  return false
}

/** Sibling indices from the root down to this node — the path a rebuild follows. */
const pathTo = (row: TreeRow, locationById: ReadonlyMap<DndId, TreeRow>): number[] => {
  const path: number[] = []
  let current: TreeRow | undefined = row

  while (current) {
    path.unshift(current.index)
    current = current.parentId === null ? undefined : locationById.get(current.parentId)
  }

  return path
}

const resolveParentPath = (
  parentId: DndId | null,
  locationById: ReadonlyMap<DndId, TreeRow>,
): number[] | null => {
  if (parentId === null) return []

  const parentLocation = locationById.get(parentId)
  // The projected parent has been deleted since the projection was computed. Dropping into a
  // node that no longer exists has no right answer, so nothing moves.
  if (!parentLocation) return null

  return pathTo(parentLocation, locationById)
}

const siblingsAtPath = <Extra>(
  items: readonly TreeItem<Extra>[],
  path: readonly number[],
): readonly TreeItem<Extra>[] => {
  let siblings = items

  for (const index of path) {
    siblings = siblings[index]?.children ?? []
  }

  return siblings
}

const resolveIndex = <Extra>(
  projection: TreeDropProjection,
  siblings: readonly TreeItem<Extra>[],
): number => {
  const afterIndex = siblings.findIndex((item) => item.id === projection.afterId)
  if (afterIndex !== -1) return afterIndex + 1

  const beforeIndex = siblings.findIndex((item) => item.id === projection.beforeId)
  if (beforeIndex !== -1) return beforeIndex

  // Both neighbours are gone. The captured slot is all that is left, and clamping is what keeps
  // it in range rather than silently appending or throwing.
  return clamp(projection.index, 0, siblings.length)
}

const removeAtPath = <Extra>(
  items: readonly TreeItem<Extra>[],
  path: readonly number[],
): { items: readonly TreeItem<Extra>[]; removed: TreeItem<Extra> | null } => {
  const [index, ...deeper] = path
  if (index === undefined) return { items, removed: null }

  const target = items[index]
  if (!target) return { items, removed: null }

  if (deeper.length === 0) {
    return {
      items: [...items.slice(0, index), ...items.slice(index + 1)],
      removed: target,
    }
  }

  const inner = removeAtPath(target.children ?? [], deeper)
  const rebuilt = [...items]
  // The one node on the spine gets a new identity; its untouched siblings keep theirs.
  rebuilt[index] = { ...target, children: inner.items }
  return { items: rebuilt, removed: inner.removed }
}

const insertAtPath = <Extra>(
  items: readonly TreeItem<Extra>[],
  parentPath: readonly number[],
  index: number,
  node: TreeItem<Extra>,
): readonly TreeItem<Extra>[] => {
  const [head, ...deeper] = parentPath
  if (head === undefined) {
    return [...items.slice(0, index), node, ...items.slice(index)]
  }

  const target = items[head]
  if (!target) return items

  // `?? []` is what creates a children array on a childless node — immutably, as a side effect
  // of the rebuild rather than as a mutation of the original (§ A7 D2).
  const rebuilt = [...items]
  rebuilt[head] = { ...target, children: insertAtPath(target.children ?? [], deeper, index, node) }
  return rebuilt
}
