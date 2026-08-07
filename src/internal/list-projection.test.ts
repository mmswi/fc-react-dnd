import { describe, expect, it } from 'vitest'
import type { DndId, Rect } from '../types.js'
import { LIST_DIRECTIONS, projectList } from './list-projection.js'
import type { DragStoreState } from './store.js'

const ROW_HEIGHT_PX = 40

const stacked = (ids: readonly DndId[], heightPx = ROW_HEIGHT_PX): Map<DndId, Rect> =>
  new Map(
    ids.map((id, index) => [id, { left: 0, top: index * heightPx, width: 200, height: heightPx }]),
  )

const stateWith = (args: {
  activeId: DndId | null
  overId?: DndId | null
  rects: Map<DndId, Rect>
}): DragStoreState => ({
  origin: args.activeId
    ? {
        id: args.activeId,
        data: {},
        rect: args.rects.get(args.activeId) ?? { top: 0, left: 0, width: 0, height: 0 },
        pointer: null,
      }
    : null,
  overId: args.overId ?? null,
  translate: { x: 0, y: 0 },
  measuredRects: args.rects,
})

const ids = ['a', 'b', 'c', 'd'] as const

const verticalProjection = (state: DragStoreState, itemIds: readonly DndId[] = ids) =>
  projectList(state, { itemIds, direction: LIST_DIRECTIONS.vertical })

const translateOf = (state: DragStoreState, id: DndId, itemIds: readonly DndId[] = ids) =>
  verticalProjection(state, itemIds)?.translateById.get(id) ?? null

describe('ordering', () => {
  it('derives order from the cached rects, not from the array it was handed', () => {
    // The array is deliberately scrambled: position along the axis is the source of truth.
    const state = stateWith({ activeId: 'a', overId: 'a', rects: stacked(ids) })

    expect(
      projectList(state, {
        itemIds: ['d', 'b', 'a', 'c'],
        direction: LIST_DIRECTIONS.vertical,
      })?.orderedIds,
    ).toEqual(['a', 'b', 'c', 'd'])
  })

  it('orders by the left edge for a horizontal list', () => {
    const rects = new Map<DndId, Rect>([
      ['a', { left: 200, top: 0, width: 100, height: 40 }],
      ['b', { left: 0, top: 0, width: 100, height: 40 }],
      ['c', { left: 100, top: 0, width: 100, height: 40 }],
    ])
    const state = stateWith({ activeId: 'a', overId: 'a', rects })

    expect(
      projectList(state, { itemIds: ['a', 'b', 'c'], direction: LIST_DIRECTIONS.horizontal })
        ?.orderedIds,
    ).toEqual(['b', 'c', 'a'])
  })

  it('leaves out items that have no measured rect', () => {
    const rects = stacked(['a', 'b'])
    const state = stateWith({ activeId: 'a', overId: 'a', rects })

    expect(verticalProjection(state, ['a', 'b', 'never-mounted'])?.orderedIds).toEqual(['a', 'b'])
  })
})

describe('the projected index', () => {
  it('is null outside a drag', () => {
    expect(verticalProjection(stateWith({ activeId: null, rects: stacked(ids) }))).toBeNull()
  })

  it('is null when the active item does not belong to this list', () => {
    const state = stateWith({
      activeId: 'elsewhere',
      overId: 'b',
      rects: stacked([...ids, 'elsewhere']),
    })

    expect(verticalProjection(state)).toBeNull()
  })

  it('reports where the item came from and where it would land', () => {
    const state = stateWith({ activeId: 'a', overId: 'c', rects: stacked(ids) })

    expect(verticalProjection(state)).toMatchObject({ fromIndex: 0, toIndex: 2 })
  })

  it('projects the origin index when the item is over itself', () => {
    const state = stateWith({ activeId: 'b', overId: 'b', rects: stacked(ids) })

    expect(verticalProjection(state)).toMatchObject({ fromIndex: 1, toIndex: 1 })
  })

  it('projects the origin index when over nothing, or over something outside the list', () => {
    const overNothing = stateWith({ activeId: 'b', overId: null, rects: stacked(ids) })
    const overOutside = stateWith({
      activeId: 'b',
      overId: 'elsewhere',
      rects: stacked([...ids, 'elsewhere']),
    })

    expect(verticalProjection(overNothing)).toMatchObject({ fromIndex: 1, toIndex: 1 })
    expect(verticalProjection(overOutside)).toMatchObject({ fromIndex: 1, toIndex: 1 })
  })

  it('handles both ends of the list', () => {
    const toTheTop = stateWith({ activeId: 'd', overId: 'a', rects: stacked(ids) })
    const toTheBottom = stateWith({ activeId: 'a', overId: 'd', rects: stacked(ids) })

    expect(verticalProjection(toTheTop)).toMatchObject({ fromIndex: 3, toIndex: 0 })
    expect(verticalProjection(toTheBottom)).toMatchObject({ fromIndex: 0, toIndex: 3 })
  })
})

describe('per-item translates', () => {
  it('produces none at all for a no-op drag', () => {
    const state = stateWith({ activeId: 'b', overId: 'b', rects: stacked(ids) })

    expect(verticalProjection(state)?.translateById.size).toBe(0)
  })

  it('closes the gap behind an item moving down, and moves the item to the end of it', () => {
    // a moves to c's slot. b and c each move up one row; d does not move at all.
    const state = stateWith({ activeId: 'a', overId: 'c', rects: stacked(ids) })

    expect(translateOf(state, 'b')).toEqual({ x: 0, y: -ROW_HEIGHT_PX })
    expect(translateOf(state, 'c')).toEqual({ x: 0, y: -ROW_HEIGHT_PX })
    expect(translateOf(state, 'a')).toEqual({ x: 0, y: ROW_HEIGHT_PX * 2 })
    expect(translateOf(state, 'd')).toBeNull()
  })

  it('opens a gap ahead of an item moving up', () => {
    // d moves to b's slot. b and c each move down one row; a does not move.
    const state = stateWith({ activeId: 'd', overId: 'b', rects: stacked(ids) })

    expect(translateOf(state, 'b')).toEqual({ x: 0, y: ROW_HEIGHT_PX })
    expect(translateOf(state, 'c')).toEqual({ x: 0, y: ROW_HEIGHT_PX })
    expect(translateOf(state, 'd')).toEqual({ x: 0, y: -(ROW_HEIGHT_PX * 2) })
    expect(translateOf(state, 'a')).toBeNull()
  })

  it('gets unequal sizes right, which equal-height fixtures hide', () => {
    // Heights 20, 60, 30. Dragging 'a' (20 tall) onto 'c'.
    const rects = new Map<DndId, Rect>([
      ['a', { left: 0, top: 0, width: 200, height: 20 }],
      ['b', { left: 0, top: 20, width: 200, height: 60 }],
      ['c', { left: 0, top: 80, width: 200, height: 30 }],
    ])
    const state = stateWith({ activeId: 'a', overId: 'c', rects })
    const itemIds = ['a', 'b', 'c']

    // Removing a (20 tall) closes 20px, so both b and c slide up by 20 — not by the height of
    // whichever row happens to precede them, which is the mistake equal-height fixtures hide.
    expect(translateOf(state, 'b', itemIds)).toEqual({ x: 0, y: -20 })
    expect(translateOf(state, 'c', itemIds)).toEqual({ x: 0, y: -20 })
    // Final layout is b[0,60), c[60,90), a[90,110): a lands at 90, from 0.
    expect(translateOf(state, 'a', itemIds)).toEqual({ x: 0, y: 90 })
  })

  it('respects gaps between items rather than assuming they are flush', () => {
    // 10px gaps: an item moving up must land where its predecessor was, gap included.
    const rects = new Map<DndId, Rect>([
      ['a', { left: 0, top: 0, width: 200, height: 40 }],
      ['b', { left: 0, top: 50, width: 200, height: 40 }],
      ['c', { left: 0, top: 100, width: 200, height: 40 }],
    ])
    const state = stateWith({ activeId: 'a', overId: 'b', rects })

    expect(translateOf(state, 'b', ['a', 'b', 'c'])).toEqual({ x: 0, y: -50 })
    expect(translateOf(state, 'a', ['a', 'b', 'c'])).toEqual({ x: 0, y: 50 })
  })

  it('translates along x for a horizontal list', () => {
    const rects = new Map<DndId, Rect>([
      ['a', { left: 0, top: 0, width: 100, height: 40 }],
      ['b', { left: 100, top: 0, width: 100, height: 40 }],
    ])
    const state = stateWith({ activeId: 'a', overId: 'b', rects })

    const projection = projectList(state, {
      itemIds: ['a', 'b'],
      direction: LIST_DIRECTIONS.horizontal,
    })

    expect(projection?.translateById.get('b')).toEqual({ x: -100, y: 0 })
    expect(projection?.translateById.get('a')).toEqual({ x: 100, y: 0 })
  })
})

describe('memoisation — perf invariant 9', () => {
  it('returns the identical reference for the same state and the same items', () => {
    const state = stateWith({ activeId: 'a', overId: 'c', rects: stacked(ids) })
    const itemIds = [...ids]

    const first = projectList(state, { itemIds, direction: LIST_DIRECTIONS.vertical })
    const second = projectList(state, { itemIds, direction: LIST_DIRECTIONS.vertical })

    expect(first).toBe(second)
  })

  it('recomputes for a new state object', () => {
    const rects = stacked(ids)
    const itemIds = [...ids]
    const first = projectList(stateWith({ activeId: 'a', overId: 'c', rects }), {
      itemIds,
      direction: LIST_DIRECTIONS.vertical,
    })

    const second = projectList(stateWith({ activeId: 'a', overId: 'c', rects }), {
      itemIds,
      direction: LIST_DIRECTIONS.vertical,
    })

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  it('keeps two lists in one provider apart, though they share a state object', () => {
    // The two-level key is what makes this work. Keyed on the state alone, the second list
    // would overwrite the first's entry and both would read whichever computed last.
    const rects = new Map<DndId, Rect>([
      ...stacked(['a', 'b']),
      ['x', { left: 0, top: 500, width: 200, height: 40 }],
      ['y', { left: 0, top: 540, width: 200, height: 40 }],
    ])
    const state = stateWith({ activeId: 'a', overId: 'b', rects })
    const leftItems = ['a', 'b']
    const rightItems = ['x', 'y']

    const left = projectList(state, { itemIds: leftItems, direction: LIST_DIRECTIONS.vertical })
    const right = projectList(state, { itemIds: rightItems, direction: LIST_DIRECTIONS.vertical })

    expect(left?.orderedIds).toEqual(['a', 'b'])
    // The active item is not in the right-hand list, so it has no projection at all.
    expect(right).toBeNull()
    // …and asking the left list again still gets the left list's answer.
    expect(projectList(state, { itemIds: leftItems, direction: LIST_DIRECTIONS.vertical })).toBe(
      left,
    )
  })

  it('recomputes when the same items are projected along a different axis', () => {
    const state = stateWith({ activeId: 'a', overId: 'b', rects: stacked(['a', 'b']) })
    const itemIds = ['a', 'b']

    const vertical = projectList(state, { itemIds, direction: LIST_DIRECTIONS.vertical })
    const horizontal = projectList(state, { itemIds, direction: LIST_DIRECTIONS.horizontal })

    expect(horizontal).not.toBe(vertical)
  })
})
