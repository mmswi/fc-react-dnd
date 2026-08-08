import { describe, expect, it } from 'vitest'
import {
  applyTreeDrop,
  flattenTree,
  projectTreeDrop,
  type TreeDropProjection,
  type TreeItem,
  type TreeNestPredicate,
  type TreeRow,
} from './tree.js'
import type { DndId, Rect } from './types.js'

/**
 * ```
 * docs
 *   guide
 *     install
 *     usage
 *   api
 * changelog
 * ```
 */
const DOC_TREE: readonly TreeItem[] = [
  {
    id: 'docs',
    children: [{ id: 'guide', children: [{ id: 'install' }, { id: 'usage' }] }, { id: 'api' }],
  },
  { id: 'changelog' },
]

const rowIds = (rows: readonly { id: string | number }[]) => rows.map((row) => row.id)

describe('flattenTree', () => {
  it('lists every visible row in reading order', () => {
    const { rows } = flattenTree(DOC_TREE)

    expect(rowIds(rows)).toEqual(['docs', 'guide', 'install', 'usage', 'api', 'changelog'])
  })

  it('reports depth, parent, and the sibling index — not the visible-row position', () => {
    const { rows } = flattenTree(DOC_TREE)

    expect(rows).toEqual([
      { id: 'docs', parentId: null, depth: 0, index: 0 },
      { id: 'guide', parentId: 'docs', depth: 1, index: 0 },
      { id: 'install', parentId: 'guide', depth: 2, index: 0 },
      { id: 'usage', parentId: 'guide', depth: 2, index: 1 },
      { id: 'api', parentId: 'docs', depth: 1, index: 1 },
      // Visible row 5, but sibling index 1 — the distinction the whole module rests on.
      { id: 'changelog', parentId: null, depth: 0, index: 1 },
    ])
  })

  it('returns nothing for an empty tree', () => {
    expect(flattenTree([]).rows).toEqual([])
  })

  it('handles a node with an empty children array as a leaf', () => {
    const { rows } = flattenTree([{ id: 'empty', children: [] }])

    expect(rowIds(rows)).toEqual(['empty'])
  })
})

describe('collapsed subtrees', () => {
  it('keeps the collapsed node and drops everything under it', () => {
    const { rows } = flattenTree(DOC_TREE, { collapsedIds: new Set(['guide']) })

    expect(rowIds(rows)).toEqual(['docs', 'guide', 'api', 'changelog'])
  })

  it('drops a whole branch when its root is collapsed', () => {
    const { rows } = flattenTree(DOC_TREE, { collapsedIds: new Set(['docs']) })

    expect(rowIds(rows)).toEqual(['docs', 'changelog'])
  })
})

describe('the active subtree — ANALYSIS.md A7 F4', () => {
  it('excludes the active node itself', () => {
    const { rows } = flattenTree(DOC_TREE, { activeId: 'api' })

    expect(rowIds(rows)).toEqual(['docs', 'guide', 'install', 'usage', 'changelog'])
  })

  it('excludes its descendants too — the front-door cycle', () => {
    // Left in, `prev = guide` at depth 2 would offer "nest into guide" while guide is the thing
    // being dragged. Cycle prevention lives here, not in a downstream check.
    const { rows } = flattenTree(DOC_TREE, { activeId: 'guide' })

    expect(rowIds(rows)).toEqual(['docs', 'api', 'changelog'])
  })

  it('leaves nothing at all when the whole tree is the active subtree', () => {
    const { rows } = flattenTree(DOC_TREE, { activeId: 'docs' })

    expect(rowIds(rows)).toEqual(['changelog'])
    expect(flattenTree([DOC_TREE[0] as TreeItem], { activeId: 'docs' }).rows).toEqual([])
  })

  it('renumbers nothing — sibling indices still describe the source tree', () => {
    const { rows } = flattenTree(DOC_TREE, { activeId: 'docs' })

    // changelog is still sibling index 1, even though docs is no longer in the rows.
    expect(rows).toEqual([{ id: 'changelog', parentId: null, depth: 0, index: 1 }])
  })
})

describe('the reverse index', () => {
  it('locates every node in the source tree in one walk', () => {
    const { locationById } = flattenTree(DOC_TREE)

    expect(locationById.get('usage')).toEqual({
      id: 'usage',
      parentId: 'guide',
      depth: 2,
      index: 1,
    })
    expect(locationById.size).toBe(6)
  })

  it('covers nodes that the rows deliberately leave out', () => {
    // `applyTreeDrop` has to locate the active node in O(depth), and the active node is by
    // definition not in the rows.
    const { rows, locationById } = flattenTree(DOC_TREE, {
      activeId: 'guide',
      collapsedIds: new Set(['docs']),
    })

    expect(rowIds(rows)).toEqual(['docs', 'changelog'])
    expect(locationById.get('guide')).toMatchObject({ parentId: 'docs', index: 0 })
    expect(locationById.get('install')).toMatchObject({ parentId: 'guide', index: 0 })
    expect(locationById.size).toBe(6)
  })

  it('reports nothing for an id that is not in the tree', () => {
    expect(flattenTree(DOC_TREE).locationById.get('nowhere')).toBeUndefined()
  })
})

describe('consumer node data', () => {
  it('is carried through the generic without being copied into the rows', () => {
    type DocNode = { title: string }
    const titled: readonly TreeItem<DocNode>[] = [
      { id: 'docs', title: 'Documentation', children: [{ id: 'api', title: 'API' }] },
    ]

    const { rows } = flattenTree(titled)

    expect(rowIds(rows)).toEqual(['docs', 'api'])
    expect(rows[0]).not.toHaveProperty('title')
  })
})

// ---------------------------------------------------------------------------------------------
// projectTreeDrop
// ---------------------------------------------------------------------------------------------

const ROW_HEIGHT_PX = 40
const INDENT_PX = 24
const NEST_BAND_FRACTION = 0.3
const NEST_BAND_PX = ROW_HEIGHT_PX * NEST_BAND_FRACTION

/** Lays the visible rows out as a stack of 40px rows, indented by depth. */
const layOutRows = (rows: readonly TreeRow[]): Map<DndId, Rect> =>
  new Map(
    rows.map((row, position) => [
      row.id,
      {
        left: row.depth * INDENT_PX,
        top: position * ROW_HEIGHT_PX,
        width: 300,
        height: ROW_HEIGHT_PX,
      },
    ]),
  )

/** Centre of the visible row at `position`, and offsets from it. */
const centreOfRow = (position: number) => position * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2
const topOfRow = (position: number) => position * ROW_HEIGHT_PX

type ProjectOptions = {
  tree?: readonly TreeItem[]
  activeId?: DndId
  pointerY: number
  depthSteps?: number
  canNest?: TreeNestPredicate
  collapsedIds?: ReadonlySet<DndId>
}

const project = ({
  tree = DOC_TREE,
  activeId = 'changelog',
  pointerY,
  depthSteps = 0,
  canNest,
  collapsedIds,
}: ProjectOptions) => {
  const flattened = flattenTree(tree, { activeId, collapsedIds })
  return projectTreeDrop({
    flattened,
    activeId,
    rowRects: layOutRows(flattened.rows),
    pointerY,
    offsetX: depthSteps * INDENT_PX,
    indentPx: INDENT_PX,
    nestBandFraction: NEST_BAND_FRACTION,
    canNest,
  })
}

const NEVER_NEST: TreeNestPredicate = () => false

describe('projectTreeDrop — the three bands', () => {
  // With 'changelog' dragged, the visible rows are docs(0) guide(1) install(2) usage(3) api(4).
  it('drops into a nestable row when the pointer is in its middle band', () => {
    expect(project({ pointerY: centreOfRow(4) })).toMatchObject({
      mode: 'into',
      parentId: 'api',
      index: 0,
      depth: 2,
    })
  })

  it('drops between when the pointer is in the top band of a row', () => {
    expect(project({ pointerY: topOfRow(4) + 1 })).toMatchObject({ mode: 'between' })
  })

  it('drops between when the pointer is in the bottom band of a row', () => {
    expect(project({ pointerY: topOfRow(4) + ROW_HEIGHT_PX - 1 })).toMatchObject({
      mode: 'between',
    })
  })

  it('gives the exact top-band boundary pixel to the middle band', () => {
    // top + bandPx belongs to 'into'; one pixel above it does not.
    expect(project({ pointerY: topOfRow(4) + NEST_BAND_PX })).toMatchObject({ mode: 'into' })
    expect(project({ pointerY: topOfRow(4) + NEST_BAND_PX - 1 })).toMatchObject({
      mode: 'between',
    })
  })

  it('gives the exact bottom-band boundary pixel to the after-gap', () => {
    const bottomBandStart = topOfRow(4) + ROW_HEIGHT_PX - NEST_BAND_PX
    expect(project({ pointerY: bottomBandStart })).toMatchObject({ mode: 'between' })
    expect(project({ pointerY: bottomBandStart - 1 })).toMatchObject({ mode: 'into' })
  })

  it('splits a non-nestable row in two, with the exact half going to the after-gap', () => {
    // The depth is held at api's own level, because the two halves differ in *position* and the
    // position also depends on depth: released at depth 0, the lower half would land after the
    // whole `docs` subtree rather than after `api`.
    const half = topOfRow(4) + ROW_HEIGHT_PX / 2
    const upperHalf = project({ pointerY: half - 1, depthSteps: 1, canNest: NEVER_NEST })
    const lowerHalf = project({ pointerY: half, depthSteps: 1, canNest: NEVER_NEST })

    expect(upperHalf).toMatchObject({ mode: 'between', depth: 1, beforeId: 'api' })
    expect(lowerHalf).toMatchObject({ mode: 'between', depth: 1, afterId: 'api' })
  })
})

describe('projectTreeDrop — into resolves to index 0 (§ A7 D1)', () => {
  it('names the target as the parent and the start of its children', () => {
    expect(project({ pointerY: centreOfRow(1) })).toMatchObject({
      mode: 'into',
      parentId: 'guide',
      index: 0,
      depth: 2,
    })
  })

  it('is the same position as the gap below an expanded parent at depth + 1', () => {
    // guide is expanded, so its first child install sits directly below it. "Into guide" and
    // "in the gap below guide, one level in" have to be the same place — including the ids they
    // resolve against, or they would diverge under a concurrent edit.
    const into = project({ pointerY: centreOfRow(1) })
    const gapBelow = project({ pointerY: topOfRow(2) + 1, depthSteps: 2 })

    expect(gapBelow).toMatchObject({ parentId: 'guide', index: 0, depth: 2 })
    expect(gapBelow?.afterId).toBe(into?.afterId)
    expect(gapBelow?.beforeId).toBe(into?.beforeId)
    expect(into?.beforeId).toBe('install')
  })

  it('reports no following sibling when the target has no visible children', () => {
    expect(project({ pointerY: centreOfRow(4) })).toMatchObject({
      parentId: 'api',
      afterId: null,
      beforeId: null,
    })
  })
})

describe('projectTreeDrop — depth from the horizontal offset', () => {
  it('reads one indent step as one level', () => {
    // The gap after 'usage' (row 3) admits depths 1 (api's level) through 3 (nesting into usage).
    expect(project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 3 })?.depth).toBe(3)
  })

  it('rounds a half step up, and rounds a negative half step toward zero', () => {
    // Pinning JS's Math.round on negatives: round(-0.5) is -0, not -1. A future switch to
    // trunc or floor should be a visible change, not an invisible one.
    const gapY = topOfRow(3) + ROW_HEIGHT_PX - 1
    expect(project({ pointerY: gapY, depthSteps: 2.5 })?.depth).toBe(3)
    expect(project({ pointerY: gapY, depthSteps: -0.5 })?.depth).toBe(1)
  })
})

describe('projectTreeDrop — the depth clamp is canNest-aware (§ A7 F1)', () => {
  it('settles at the depth of the row below the gap when the pointer has not gone left', () => {
    // Gap between guide(1) and install(2). A row arriving from the root requests depth 0, and
    // the floor lifts it to install's depth so it joins the group it was aimed at rather than
    // landing beside it. Pulling left overrides this — § A10.
    expect(project({ pointerY: topOfRow(2) + 1, depthSteps: 0 })?.depth).toBe(2)
  })

  it('cannot go deeper than one level inside the row above', () => {
    expect(project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 99 })?.depth).toBe(3)
  })

  it('stops one level shallower when the row above refuses to nest', () => {
    // depth = prev.depth + 1 *is* nesting into prev, so it must obey the same predicate as the
    // middle band. Without this, dragging right past a leaf silently adopts it as a parent.
    const nestable = project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 99 })
    const notNestable = project({
      pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1,
      depthSteps: 99,
      canNest: NEVER_NEST,
    })

    expect(nestable?.depth).toBe(3)
    expect(notNestable?.depth).toBe(2)
  })

  it('does not let a far-left drag adopt the subtree that follows it', () => {
    // A row lifted to the root from a gap *above* other rows must not collect them on the way
    // out. It cannot: the position is derived by walking up to the ancestor at the target depth
    // and landing after it, so the rows below keep the parent they already had. Asserted through
    // the applied tree, because that is where an adoption would actually show up — the
    // projection alone could look innocent and still splice a subtree.
    const projection = project({ pointerY: topOfRow(2) + 1, depthSteps: -99 })
    expect(projection).toMatchObject({ depth: 0, parentId: null })

    const applied = applyTreeDrop(DOC_TREE, 'changelog', projection as TreeDropProjection)

    expect(rowIds(childrenOf(applied, 'guide'))).toEqual(['install', 'usage'])
    expect(rowIds(childrenOf(applied, 'docs'))).toEqual(['guide', 'api'])
  })
})

describe('projectTreeDrop — dragging left lifts a row out of its parent (§ A10)', () => {
  // The gap between `guide` and its own child `usage`. Every row bounding this gap sits at depth
  // 1 or deeper, so "the shallowest thing next to me" offers no way out — yet pulling left is
  // exactly how a user says *take this out of here*.
  const gapInsideGuide = topOfRow(2)

  it('makes the row a sibling of its parent', () => {
    const projection = project({ activeId: 'install', pointerY: gapInsideGuide, depthSteps: -1 })

    expect(projection).toMatchObject({ depth: 1, parentId: 'docs', afterId: 'guide' })
  })

  it('makes the row a sibling of its grandparent when pulled left again', () => {
    const projection = project({ activeId: 'install', pointerY: gapInsideGuide, depthSteps: -2 })

    expect(projection).toMatchObject({ depth: 0, parentId: null, afterId: 'docs' })
  })

  it('stops at the root however far left the pointer goes', () => {
    const projection = project({ activeId: 'install', pointerY: gapInsideGuide, depthSteps: -9 })

    expect(projection).toMatchObject({ depth: 0, parentId: null })
  })

  it('still drops a row into the group it was aimed at when the pointer never went left', () => {
    // The guard on the rule above: a floor of 0 applied unconditionally would turn every drop
    // into a group into a drop *past* it, because a row arriving from the root requests its own
    // depth of 0 and would now be granted it.
    const projection = project({ activeId: 'changelog', pointerY: gapInsideGuide, depthSteps: 0 })

    expect(projection).toMatchObject({ depth: 2, parentId: 'guide' })
  })
})

describe('projectTreeDrop — the indicator names the screen row to draw against (§ A10)', () => {
  // `afterId`/`beforeId` are sibling-space; a consumer drawing a line needs screen-space. Every
  // consumer that derived one from the other got it wrong — three times in this repo alone — so
  // the projection now carries the anchor ready to draw.

  it('puts the into box on the parent row itself, not its first child', () => {
    // 'guide' has visible children, so beforeId is 'install' — and an indicator anchored via
    // beforeId lands the box on the child's row. The reported symptom was "into styling is not
    // triggered always": it triggered, one row too low, precisely when the target had children.
    const projection = project({ pointerY: centreOfRow(1) })

    expect(projection?.mode).toBe('into')
    expect(projection?.indicator).toEqual({ rowId: 'guide', edge: 'over', depth: 1 })
  })

  it('draws a plain gap under the row above it', () => {
    const projection = project({ pointerY: topOfRow(3) + 1 })

    expect(projection?.indicator).toEqual({ rowId: 'install', edge: 'below', depth: 2 })
  })

  it('draws the gap above the first row against that row', () => {
    const projection = project({ pointerY: -5 })

    expect(projection?.indicator).toEqual({ rowId: 'docs', edge: 'above', depth: 0 })
  })

  it('draws "first child via the gap" directly under the parent row', () => {
    // The "says between, but goes into" screenshot: the drop makes the row a child of `guide`,
    // and the old anchor chain fell through to the parent with the line drawn *above* it — an
    // entirely different gap from where the row would land.
    const projection = project({ pointerY: topOfRow(2) + 1, depthSteps: 2 })

    expect(projection).toMatchObject({ parentId: 'guide', index: 0 })
    expect(projection?.indicator).toEqual({ rowId: 'guide', edge: 'below', depth: 2 })
  })

  it('draws an un-nest below the whole subtree it lands after', () => {
    // Lifting to the root from a gap inside `guide` lands after all of `docs`, so the line
    // belongs under `api` — the last visible row of that subtree — not under the pointer.
    const projection = project({ activeId: 'install', pointerY: topOfRow(2) + 1, depthSteps: -2 })

    expect(projection).toMatchObject({ depth: 0, afterId: 'docs' })
    expect(projection?.indicator).toEqual({ rowId: 'api', edge: 'below', depth: 0 })
  })
})

describe('projectTreeDrop — a last child nests into the sibling above it', () => {
  it('drops into the previous sibling from the middle band', () => {
    // The user-reported gesture: 'usage' is the last child of 'guide', dragged over 'install'.
    // In the demo it appeared broken because the row it was tried on was the demo's one locked
    // node; the library itself has no such asymmetry.
    const projection = project({ activeId: 'usage', pointerY: centreOfRow(2) })

    expect(projection).toMatchObject({ parentId: 'install', mode: 'into', depth: 3 })
    expect(projection?.indicator).toEqual({ rowId: 'install', edge: 'over', depth: 2 })
  })
})

describe('projectTreeDrop — a gap with no legal depth is blocked (§ A7 F2)', () => {
  it('returns null between a node and its own first child when that node refuses to nest', () => {
    // Lower bound is install's depth (2); upper bound is guide's depth (1) because guide will
    // not take children. The interval is empty, so there is no position to offer.
    const onlyGuideRefuses: TreeNestPredicate = (candidateParent) => candidateParent.id !== 'guide'

    expect(project({ pointerY: topOfRow(2) + 1, canNest: onlyGuideRefuses })).toBeNull()
  })
})

describe('projectTreeDrop — the boundary gaps (§ A7 F5)', () => {
  it('pins the gap above the first row to that row depth, whatever the offset', () => {
    expect(project({ pointerY: 1, depthSteps: 99 })).toMatchObject({
      depth: 0,
      parentId: null,
      index: 0,
      afterId: null,
      beforeId: 'docs',
    })
  })

  it('treats a pointer above the tree entirely as the top gap', () => {
    expect(project({ pointerY: -500 })).toMatchObject({ index: 0, parentId: null })
  })

  it('clamps the gap below the last row between the root and one level inside it', () => {
    const lastRowBottom = topOfRow(4) + ROW_HEIGHT_PX - 1

    expect(project({ pointerY: lastRowBottom, depthSteps: -99 })?.depth).toBe(0)
    expect(project({ pointerY: lastRowBottom, depthSteps: 99 })?.depth).toBe(2)
  })

  it('treats a pointer below the tree entirely as the bottom gap', () => {
    expect(project({ pointerY: 5000, depthSteps: -99 })).toMatchObject({
      depth: 0,
      parentId: null,
    })
  })
})

describe('projectTreeDrop — deriving parent and index from depth (§ A7 F3)', () => {
  it('nests into the row above when the depth is one deeper than it', () => {
    expect(project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 3 })).toMatchObject({
      parentId: 'usage',
      index: 0,
      depth: 3,
    })
  })

  it('becomes the next sibling of the row above at that depth', () => {
    expect(project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 2 })).toMatchObject({
      parentId: 'guide',
      index: 2,
      afterId: 'usage',
    })
  })

  it('climbs to the right ancestor when the depth is shallower than the row above', () => {
    // In the gap after 'usage' at depth 1: the ancestor-or-self of usage at depth 1 is guide,
    // so the item becomes guide's next sibling inside docs.
    expect(project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 1 })).toMatchObject({
      parentId: 'docs',
      index: 1,
      afterId: 'guide',
    })
  })

  it('equals "insert before the next row" whenever that row sits at the projected depth', () => {
    // The gap after usage at depth 1 is the same place as "before api", and the two derivations
    // have to agree — one climbs from usage, the other reads api directly.
    const projection = project({ pointerY: topOfRow(3) + ROW_HEIGHT_PX - 1, depthSteps: 1 })
    const apiLocation = flattenTree(DOC_TREE).locationById.get('api')

    expect(projection?.parentId).toBe(apiLocation?.parentId)
    expect(projection?.index).toBe(apiLocation?.index)
    expect(projection?.beforeId).toBe('api')
  })
})

describe('projectTreeDrop — invariants', () => {
  it('never targets the active subtree, over every position and depth in the tree', () => {
    const activeId = 'guide'
    const forbidden = new Set(['guide', 'install', 'usage'])
    let projections = 0

    for (let pointerY = -60; pointerY <= 260; pointerY += 3) {
      for (let depthSteps = -4; depthSteps <= 4; depthSteps += 1) {
        const projection = project({ activeId, pointerY, depthSteps })
        if (!projection) continue
        projections += 1
        expect(forbidden.has(String(projection.parentId))).toBe(false)
        expect(projection.afterId === null || !forbidden.has(String(projection.afterId))).toBe(true)
        expect(projection.beforeId === null || !forbidden.has(String(projection.beforeId))).toBe(
          true,
        )
      }
    }

    expect(projections).toBeGreaterThan(100)
  })

  it('keeps every projected depth inside the canNest-aware clamp', () => {
    for (let pointerY = 0; pointerY <= 200; pointerY += 5) {
      for (let depthSteps = -5; depthSteps <= 5; depthSteps += 1) {
        const projection = project({ pointerY, depthSteps })
        if (!projection) continue
        expect(projection.depth).toBeGreaterThanOrEqual(0)
        expect(projection.depth).toBeLessThanOrEqual(3)
      }
    }
  })

  it('reports nothing when the active node is not in this tree at all', () => {
    expect(project({ activeId: 'from-another-tree', pointerY: centreOfRow(1) })).toBeNull()
  })

  it('offers the root when there is nothing left to project against', () => {
    expect(project({ tree: [{ id: 'only' }], activeId: 'only', pointerY: 0 })).toMatchObject({
      parentId: null,
      index: 0,
      depth: 0,
      afterId: null,
      beforeId: null,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// applyTreeDrop
// ---------------------------------------------------------------------------------------------

const childrenOf = (items: readonly TreeItem[], id: DndId): readonly TreeItem[] =>
  (flattenTree(items).locationById.has(id) ? findNode(items, id)?.children : undefined) ?? []

const findNode = (items: readonly TreeItem[], id: DndId): TreeItem | undefined => {
  for (const item of items) {
    if (item.id === id) return item
    const found = item.children ? findNode(item.children, id) : undefined
    if (found) return found
  }
  return undefined
}

const projectionTo = (
  overrides: Partial<TreeDropProjection> & Pick<TreeDropProjection, 'parentId' | 'index'>,
): TreeDropProjection => ({
  depth: 0,
  mode: 'between',
  afterId: null,
  beforeId: null,
  // Screen-space drawing data — `applyTreeDrop` never reads it, so a placeholder is honest here.
  indicator: { rowId: null, edge: 'above', depth: 0 },
  ...overrides,
})

describe('applyTreeDrop — structural sharing (§ A5)', () => {
  it('keeps the identity of every subtree it did not touch', () => {
    // A deep clone would be *correct* and would give every node a fresh identity, so every
    // memoised row in the consumer's tree re-renders. On 10k nodes that is 10k renders where
    // roughly 2×depth would do. Only an identity assertion catches it.
    const next = applyTreeDrop(DOC_TREE, 'changelog', projectionTo({ parentId: 'api', index: 0 }))
    const originalGuide = findNode(DOC_TREE, 'guide')

    expect(findNode(next, 'guide')).toBe(originalGuide)
    expect(findNode(next, 'install')).toBe(findNode(DOC_TREE, 'install'))
  })

  it('rebuilds only the spines of the removal and the insertion', () => {
    const next = applyTreeDrop(DOC_TREE, 'changelog', projectionTo({ parentId: 'api', index: 0 }))

    // docs and api are on the insertion spine, so they are new objects…
    expect(findNode(next, 'docs')).not.toBe(findNode(DOC_TREE, 'docs'))
    expect(findNode(next, 'api')).not.toBe(findNode(DOC_TREE, 'api'))
    // …and the moved node itself is carried across untouched.
    expect(findNode(next, 'changelog')).toBe(findNode(DOC_TREE, 'changelog'))
  })

  it('never mutates the tree it was given', () => {
    const snapshot = JSON.stringify(DOC_TREE)

    applyTreeDrop(DOC_TREE, 'changelog', projectionTo({ parentId: 'guide', index: 1 }))

    expect(JSON.stringify(DOC_TREE)).toBe(snapshot)
  })

  it('returns the identical array for a projection that changes nothing', () => {
    // Structural sharing's degenerate case: the two gaps around the dragged row's own origin
    // merge into one no-op position, and a no-op must cost the consumer nothing.
    const noop = projectionTo({ parentId: null, index: 1, afterId: 'docs', beforeId: null })

    expect(applyTreeDrop(DOC_TREE, 'changelog', noop)).toBe(DOC_TREE)
  })
})

describe('applyTreeDrop — moving between parents', () => {
  it('places the node at the projected parent and index', () => {
    const next = applyTreeDrop(DOC_TREE, 'changelog', projectionTo({ parentId: 'guide', index: 1 }))

    expect(rowIds(childrenOf(next, 'guide'))).toEqual(['install', 'changelog', 'usage'])
    expect(rowIds(next)).toEqual(['docs'])
  })

  it('creates a children array on a childless node, immutably (§ A7 D2)', () => {
    const next = applyTreeDrop(DOC_TREE, 'changelog', projectionTo({ parentId: 'api', index: 0 }))

    expect(findNode(DOC_TREE, 'api')?.children).toBeUndefined()
    expect(rowIds(childrenOf(next, 'api'))).toEqual(['changelog'])
  })

  it('leaves an empty children array behind when the last child moves out', () => {
    // Documented behaviour in both directions: the key stays, so a consumer rendering an
    // expand arrow off `children !== undefined` does not see it vanish.
    const oneChild: readonly TreeItem[] = [
      { id: 'parent', children: [{ id: 'only' }] },
      { id: 'sibling' },
    ]

    const next = applyTreeDrop(oneChild, 'only', projectionTo({ parentId: null, index: 2 }))

    expect(findNode(next, 'parent')?.children).toEqual([])
    expect(rowIds(next)).toEqual(['parent', 'sibling', 'only'])
  })

  it('moves a whole subtree, not just its root', () => {
    const next = applyTreeDrop(DOC_TREE, 'guide', projectionTo({ parentId: null, index: 2 }))

    expect(rowIds(next)).toEqual(['docs', 'changelog', 'guide'])
    expect(rowIds(childrenOf(next, 'guide'))).toEqual(['install', 'usage'])
    expect(rowIds(childrenOf(next, 'docs'))).toEqual(['api'])
  })
})

describe('applyTreeDrop — the same-parent off-by-one', () => {
  it('moves a node later among its own siblings', () => {
    const flat: readonly TreeItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    const next = applyTreeDrop(
      flat,
      'a',
      projectionTo({ parentId: null, index: 2, afterId: 'c', beforeId: 'd' }),
    )

    expect(rowIds(next)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a node earlier among its own siblings', () => {
    const flat: readonly TreeItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    const next = applyTreeDrop(
      flat,
      'd',
      projectionTo({ parentId: null, index: 1, afterId: 'a', beforeId: 'b' }),
    )

    expect(rowIds(next)).toEqual(['a', 'd', 'b', 'c'])
  })
})

describe('applyTreeDrop — resolving the index by id (§ A6)', () => {
  it('lands next to the intended neighbour even after a sibling was removed underneath', () => {
    // Project against the tree as it was, then let a concurrent edit remove a preceding sibling
    // before applying. Trusting the captured index would put the node one slot too late.
    const before: readonly TreeItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'moving' }]
    const projection = projectionTo({ parentId: null, index: 3, afterId: 'c', beforeId: null })
    const afterConcurrentEdit: readonly TreeItem[] = [{ id: 'b' }, { id: 'c' }, { id: 'moving' }]

    expect(rowIds(applyTreeDrop(before, 'moving', projection))).toEqual(['a', 'b', 'c', 'moving'])
    expect(rowIds(applyTreeDrop(afterConcurrentEdit, 'moving', projection))).toEqual([
      'b',
      'c',
      'moving',
    ])
  })

  it('falls back to the following neighbour when the preceding one is gone', () => {
    const tree: readonly TreeItem[] = [{ id: 'b' }, { id: 'c' }, { id: 'moving' }]
    const projection = projectionTo({ parentId: null, index: 1, afterId: 'gone', beforeId: 'c' })

    expect(rowIds(applyTreeDrop(tree, 'moving', projection))).toEqual(['b', 'moving', 'c'])
  })

  it('falls back to the captured index, clamped, when both neighbours are gone', () => {
    // The one case where the id-relative machinery gives up. It degrades to the projected slot
    // rather than throwing, and the clamp is what keeps it in range.
    const tree: readonly TreeItem[] = [
      { id: 'parent', children: [{ id: 'other' }] },
      { id: 'moving' },
    ]
    const projection = projectionTo({
      parentId: 'parent',
      index: 9,
      afterId: 'long-gone',
      beforeId: 'also-gone',
    })

    const next = applyTreeDrop(tree, 'moving', projection)

    expect(rowIds(childrenOf(next, 'parent'))).toEqual(['other', 'moving'])
  })
})

describe('applyTreeDrop — the defensive cycle guard', () => {
  it('rejects a projection that would put a node inside its own subtree', () => {
    // flattenTree makes this unreachable through the front door; this is the back door.
    const corrupting = projectionTo({ parentId: 'install', index: 0 })

    expect(applyTreeDrop(DOC_TREE, 'guide', corrupting)).toBe(DOC_TREE)
  })

  it('rejects a projection naming the dragged node as its own parent', () => {
    expect(applyTreeDrop(DOC_TREE, 'guide', projectionTo({ parentId: 'guide', index: 0 }))).toBe(
      DOC_TREE,
    )
  })

  it('leaves the tree alone when the dragged node is not in it', () => {
    expect(applyTreeDrop(DOC_TREE, 'nowhere', projectionTo({ parentId: null, index: 0 }))).toBe(
      DOC_TREE,
    )
  })
})

describe('applyTreeDrop — the round-trip invariant', () => {
  it('puts the node exactly where the projection said, for every legal projection', () => {
    // One property test covering more than any handful of examples: project from a real pointer
    // position, apply, re-flatten, and check the node is at the projected parent, index, depth.
    const activeId = 'changelog'
    let checked = 0

    for (let pointerY = 0; pointerY <= 200; pointerY += 7) {
      for (let depthSteps = -3; depthSteps <= 3; depthSteps += 1) {
        const projection = project({ activeId, pointerY, depthSteps })
        if (!projection) continue

        const next = applyTreeDrop(DOC_TREE, activeId, projection)
        const landed = flattenTree(next).locationById.get(activeId)
        checked += 1

        expect(landed?.parentId).toBe(projection.parentId)
        expect(landed?.index).toBe(projection.index)
        expect(landed?.depth).toBe(projection.depth)
      }
    }

    expect(checked).toBeGreaterThan(50)
  })
})
