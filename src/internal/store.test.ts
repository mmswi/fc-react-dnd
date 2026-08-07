import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../../test/helpers.js'
import { closestCenter } from '../collision.js'
import { type DndId, DRAG_CANCEL_REASONS, DRAG_DIRECTIONS, type Rect } from '../types.js'
import { createDragStore, type DragStore, type RectReader } from './store.js'

const nodeAt = (rect: Rect): HTMLElement => {
  const element = document.createElement('div')
  mockElementRect(element, rect)
  document.body.append(element)
  return element
}

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

type Harness = {
  store: DragStore
  readRect: RectReader & { mock: { calls: unknown[][] } }
  addDraggable: (id: DndId, rect: Rect) => HTMLElement
  addDroppable: (id: DndId, rect: Rect, options?: { disabled?: boolean }) => HTMLElement
  addMeasureOnlyRow: (id: DndId, rect: Rect) => HTMLElement
}

const createHarness = (): Harness => {
  const readRect: Harness['readRect'] = vi.fn((element: HTMLElement) => {
    const { top, left, width, height } = element.getBoundingClientRect()
    return { top, left, width, height }
  }) as Harness['readRect']

  const store = createDragStore({ collisionDetection: closestCenter, readRect })

  return {
    store,
    readRect,
    addDraggable: (id, rect) => {
      const node = nodeAt(rect)
      store.registerDraggable(id, node)
      return node
    },
    addDroppable: (id, rect, options) => {
      const node = nodeAt(rect)
      store.registerDroppable(id, node)
      if (options?.disabled) store.updateDroppable(id, { disabled: true })
      return node
    },
    addMeasureOnlyRow: (id, rect) => {
      const node = nodeAt(rect)
      store.registerMeasuredRow(id, node)
      return node
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('registration while idle', () => {
  it('never notifies — perf invariant 5', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const listener = vi.fn()
    store.subscribe(listener)

    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 100))
    store.unregisterDraggable('item')
    store.unregisterDroppable('slot')

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not measure anything — rects are read at drag start, not at mount', () => {
    const { readRect, addDroppable } = createHarness()

    addDroppable('slot', rectAt(0, 100))

    expect(readRect).not.toHaveBeenCalled()
  })
})

describe('beginDrag', () => {
  it('refuses to start a second drag while one is running', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('a', rectAt(0, 0))
    addDraggable('b', rectAt(0, 100))

    const first = store.beginDrag('a', { pointer: { x: 0, y: 0 } })
    const second = store.beginDrag('b', { pointer: { x: 0, y: 0 } })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('refuses to start on an unregistered or disabled draggable', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('disabled', rectAt(0, 0))
    store.updateDraggable('disabled', { disabled: true })

    expect(store.beginDrag('never-registered', { pointer: null })).toBeNull()
    expect(store.beginDrag('disabled', { pointer: null })).toBeNull()
  })

  it('records where the item started, which is what the overlay positions from', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(20, 60))

    store.beginDrag('item', { pointer: { x: 30, y: 70 } })

    expect(store.getState().origin).toMatchObject({
      id: 'item',
      rect: rectAt(20, 60),
      pointer: { x: 30, y: 70 },
    })
  })

  it('collides immediately, so a drag starts already over its own slot', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('near', rectAt(0, 10))
    addDroppable('far', rectAt(0, 900))

    store.beginDrag('item', { pointer: null })

    expect(store.getState().overId).toBe('near')
  })
})

describe('the rect cache — perf invariant 1', () => {
  it('measures once across a drag start and many moves, not once per move', () => {
    const { store, readRect, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 100))

    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    const callsAfterBegin = readRect.mock.calls.length
    for (let step = 1; step <= 20; step += 1) session?.move({ x: 0, y: step })

    expect(callsAfterBegin).toBeGreaterThan(0)
    expect(readRect.mock.calls.length).toBe(callsAfterBegin)
  })

  it('re-measures on the next update after a dirty signal, and only that one', () => {
    const { store, readRect, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 100))
    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    const callsAfterBegin = readRect.mock.calls.length

    store.markRectsDirty()
    const callsAfterDirty = readRect.mock.calls.length
    session?.move({ x: 0, y: 5 })
    session?.move({ x: 0, y: 10 })

    expect(callsAfterDirty).toBeGreaterThan(callsAfterBegin)
    expect(readRect.mock.calls.length).toBe(callsAfterDirty)
  })

  it('updates over without the pointer moving when the page scrolls under it', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    const first = addDroppable('first', rectAt(0, 10))
    addDroppable('second', rectAt(0, 400))
    store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    expect(store.getState().overId).toBe('first')

    // The scroll moves 'first' far away without the pointer moving at all.
    mockElementRect(first, rectAt(0, 900))
    store.markRectsDirty()

    expect(store.getState().overId).toBe('second')
  })
})

describe('the immutable state object', () => {
  it('mints a new state reference on every notifying transition', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 100))

    const idle = store.getState()
    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    const started = store.getState()
    session?.move({ x: 0, y: 5 })
    const moved = store.getState()

    expect(started).not.toBe(idle)
    expect(moved).not.toBe(started)
  })

  it('keeps the origin object stable across moves, so selecting it does not re-render per move', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(0, 0))

    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    const originAtStart = store.getState().origin
    session?.move({ x: 0, y: 5 })
    session?.move({ x: 0, y: 50 })

    expect(store.getState().origin).toBe(originAtStart)
  })

  it('mints a new state on a mid-drag registration even when over is unchanged', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('near', rectAt(0, 10))
    store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    const before = store.getState()

    addDroppable('lazily-loaded', rectAt(0, 5000))

    expect(store.getState().overId).toBe(before.overId)
    expect(store.getState()).not.toBe(before)
  })
})

describe('the asymmetric registration policy during a drag — ANALYSIS.md A6', () => {
  it('cancels when an unrelated row is removed, because every rect below it just moved', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const monitor = { onDragCancel: vi.fn(), onDragEnd: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 200))
    addDroppable('above', rectAt(0, 0))
    addDroppable('target', rectAt(0, 200))
    store.beginDrag('item', { pointer: { x: 0, y: 0 } })

    store.unregisterDroppable('above')

    expect(monitor.onDragCancel).toHaveBeenCalledTimes(1)
    expect(monitor.onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
    expect(monitor.onDragEnd).not.toHaveBeenCalled()
    expect(store.getState().origin).toBeNull()
  })

  it('cancels when the current over row is removed', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const monitor = { onDragCancel: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 0))
    addDroppable('target', rectAt(0, 10))
    store.beginDrag('item', { pointer: null })
    expect(store.getState().overId).toBe('target')

    store.unregisterDroppable('target')

    expect(monitor.onDragCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels when the active row itself is removed', () => {
    const { store, addDraggable } = createHarness()
    const monitor = { onDragCancel: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 0))
    store.beginDrag('item', { pointer: null })

    store.unregisterDraggable('item')

    expect(monitor.onDragCancel).toHaveBeenCalledTimes(1)
    expect(store.getState().origin).toBeNull()
  })

  it('cancels when a measure-only tree row is removed — a collapsing branch is a removal', () => {
    const { store, addDraggable, addMeasureOnlyRow } = createHarness()
    const monitor = { onDragCancel: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 0))
    addMeasureOnlyRow('child', rectAt(0, 40))
    store.beginDrag('item', { pointer: null })

    store.unregisterMeasuredRow('child')

    expect(monitor.onDragCancel).toHaveBeenCalledTimes(1)
    expect(monitor.onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
  })

  it('does NOT cancel when a row is inserted — auto-expand and lazy loads depend on it', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const monitor = { onDragCancel: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 0))
    addDroppable('first', rectAt(0, 400))
    store.beginDrag('item', { pointer: null })

    addDroppable('appeared-nearer', rectAt(0, 10))

    expect(monitor.onDragCancel).not.toHaveBeenCalled()
    expect(store.getState().origin).not.toBeNull()
    expect(store.getState().overId).toBe('appeared-nearer')
  })

  it('does not cancel on the unregistrations that happen after a drag has already ended', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const monitor = { onDragCancel: vi.fn() }
    store.addMonitor(monitor)
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))
    const session = store.beginDrag('item', { pointer: null })
    session?.end()

    store.unregisterDraggable('item')
    store.unregisterDroppable('slot')

    expect(monitor.onDragCancel).not.toHaveBeenCalled()
  })
})

describe('the stale session token', () => {
  it('makes a session captured before the end inert afterwards', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))
    const session = store.beginDrag('item', { pointer: null })
    session?.end()
    const afterEnd = store.getState()
    const listener = vi.fn()
    store.subscribe(listener)

    session?.move({ x: 0, y: 500 })
    session?.end()
    session?.cancel(DRAG_CANCEL_REASONS.escape)

    expect(store.getState()).toBe(afterEnd)
    expect(listener).not.toHaveBeenCalled()
  })

  it('makes a session from a cancelled drag inert too', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    const session = store.beginDrag('item', { pointer: null })
    session?.cancel(DRAG_CANCEL_REASONS.escape)
    const monitor = { onDragEnd: vi.fn() }
    store.addMonitor(monitor)

    session?.end()

    expect(monitor.onDragEnd).not.toHaveBeenCalled()
  })

  it('does not let a stale session interfere with the drag that replaced it', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('first', rectAt(0, 0))
    addDraggable('second', rectAt(0, 100))
    const stale = store.beginDrag('first', { pointer: null })
    stale?.end()
    store.beginDrag('second', { pointer: null })

    stale?.cancel(DRAG_CANCEL_REASONS.escape)

    expect(store.getState().origin?.id).toBe('second')
  })
})

describe('events and their ordering', () => {
  it('lets an onDragEnd listener read the drag it is reporting, before the reset', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))
    let seenDuringCallback: DndId | null | undefined
    store.addMonitor({
      onDragEnd: () => {
        seenDuringCallback = store.getState().origin?.id ?? null
      },
    })
    const session = store.beginDrag('item', { pointer: null })

    session?.end()

    expect(seenDuringCallback).toBe('item')
    expect(store.getState().origin).toBeNull()
  })

  it('does the same for cancel', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    let seenDuringCallback: DndId | null | undefined
    store.addMonitor({
      onDragCancel: () => {
        seenDuringCallback = store.getState().origin?.id ?? null
      },
    })
    const session = store.beginDrag('item', { pointer: null })

    session?.cancel(DRAG_CANCEL_REASONS.escape)

    expect(seenDuringCallback).toBe('item')
    expect(store.getState().origin).toBeNull()
  })

  it('fires onDragOver only when the target actually changes', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const onDragOver = vi.fn()
    addDraggable('item', rectAt(0, 0))
    addDroppable('first', rectAt(0, 0))
    addDroppable('second', rectAt(0, 400))
    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    store.addMonitor({ onDragOver })

    session?.move({ x: 0, y: 10 })
    session?.move({ x: 0, y: 20 })
    session?.move({ x: 0, y: 380 })
    session?.move({ x: 0, y: 390 })

    expect(onDragOver).toHaveBeenCalledTimes(1)
    expect(onDragOver.mock.calls[0]?.[0].over.id).toBe('second')
  })

  it('fires onDragMove on every move, unlike onDragOver', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    const onDragMove = vi.fn()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 0))
    const session = store.beginDrag('item', { pointer: { x: 0, y: 0 } })
    store.addMonitor({ onDragMove })

    session?.move({ x: 0, y: 1 })
    session?.move({ x: 0, y: 2 })
    session?.move({ x: 0, y: 3 })

    expect(onDragMove).toHaveBeenCalledTimes(3)
  })

  it('carries the consumer payloads of both sides through to the event', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    store.updateDraggable('item', { data: { kind: 'card' } })
    addDroppable('slot', rectAt(0, 10))
    store.updateDroppable('slot', { data: { column: 3 } })
    const onDragEnd = vi.fn()
    store.addMonitor({ onDragEnd })

    store.beginDrag('item', { pointer: null })?.end()

    expect(onDragEnd.mock.calls[0]?.[0].active.data).toEqual({ kind: 'card' })
    expect(onDragEnd.mock.calls[0]?.[0].over.data).toEqual({ column: 3 })
  })

  it('reports the active rect already translated, so a consumer never re-does the sum', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(10, 20))
    const onDragEnd = vi.fn()
    store.addMonitor({ onDragEnd })

    const session = store.beginDrag('item', { pointer: null })
    session?.move({ x: 5, y: 7 })
    session?.end()

    expect(onDragEnd.mock.calls[0]?.[0].active.initialRect).toEqual(rectAt(10, 20))
    expect(onDragEnd.mock.calls[0]?.[0].active.rect).toEqual(rectAt(15, 27))
    expect(onDragEnd.mock.calls[0]?.[0].translate).toEqual({ x: 5, y: 7 })
  })
})

describe('monitor fan-out', () => {
  it('reaches every listener', () => {
    const { store, addDraggable } = createHarness()
    const first = vi.fn()
    const second = vi.fn()
    store.addMonitor({ onDragStart: first })
    store.addMonitor({ onDragStart: second })
    addDraggable('item', rectAt(0, 0))

    store.beginDrag('item', { pointer: null })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('leaves the others intact when one unsubscribes', () => {
    const { store, addDraggable } = createHarness()
    const staying = vi.fn()
    const leaving = vi.fn()
    store.addMonitor({ onDragStart: staying })
    const removeLeaving = store.addMonitor({ onDragStart: leaving })
    addDraggable('item', rectAt(0, 0))

    removeLeaving()
    store.beginDrag('item', { pointer: null })

    expect(staying).toHaveBeenCalledTimes(1)
    expect(leaving).not.toHaveBeenCalled()
  })
})

describe('collision candidates', () => {
  it('excludes disabled droppables', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('disabled-but-near', rectAt(0, 10), { disabled: true })
    addDroppable('enabled-but-far', rectAt(0, 400))

    store.beginDrag('item', { pointer: null })

    expect(store.getState().overId).toBe('enabled-but-far')
  })

  it('excludes measure-only rows — a tree row never becomes over', () => {
    const { store, addDraggable, addDroppable, addMeasureOnlyRow } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addMeasureOnlyRow('row', rectAt(0, 10))
    addDroppable('real-droppable', rectAt(0, 400))

    store.beginDrag('item', { pointer: null })

    expect(store.getState().overId).toBe('real-droppable')
  })

  it('still measures measure-only rows, because the tree projection reads them', () => {
    const { store, addDraggable, addMeasureOnlyRow } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addMeasureOnlyRow('row', rectAt(0, 40))

    store.beginDrag('item', { pointer: null })

    expect(store.getState().measuredRects.get('row')).toEqual(rectAt(0, 40))
  })

  it('reports no over at all when nothing is registered', () => {
    const { store, addDraggable } = createHarness()
    addDraggable('item', rectAt(0, 0))

    store.beginDrag('item', { pointer: null })

    expect(store.getState().overId).toBeNull()
  })
})

describe('findTargetInDirection — the keyboard seam', () => {
  it('steps to the nearest droppable in the given direction', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('below', rectAt(0, 100))
    addDroppable('far-below', rectAt(0, 500))
    const session = store.beginDrag('item', { pointer: null })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.down)?.id).toBe('below')
  })

  it('includes measure-only rows, so keyboard navigation walks a tree', () => {
    const { store, addDraggable, addMeasureOnlyRow } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addMeasureOnlyRow('row', rectAt(0, 100))
    const session = store.beginDrag('item', { pointer: null })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.down)?.id).toBe('row')
  })

  it('returns the translate that lands the item on the target', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('below', rectAt(0, 100))
    const session = store.beginDrag('item', { pointer: null })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.down)?.translate).toEqual({
      x: 0,
      y: 100,
    })
  })

  it('measures from where the item is now, not from where it started', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('first', rectAt(0, 100))
    addDroppable('second', rectAt(0, 200))
    const session = store.beginDrag('item', { pointer: null })
    session?.move({ x: 0, y: 100 })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.down)?.id).toBe('second')
  })

  it('returns nothing when there is nothing in that direction', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('below', rectAt(0, 100))
    const session = store.beginDrag('item', { pointer: null })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.up)).toBeNull()
  })

  it('never targets the dragged item itself', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('item', rectAt(0, 0))
    addDroppable('below', rectAt(0, 100))
    const session = store.beginDrag('item', { pointer: null })

    expect(session?.findTargetInDirection(DRAG_DIRECTIONS.down)?.id).toBe('below')
  })
})

describe('teardown — perf invariant 7', () => {
  it('clears every scrap of per-interaction state on end', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))

    const session = store.beginDrag('item', { pointer: { x: 1, y: 2 } })
    session?.move({ x: 0, y: 5 })
    session?.end()

    const state = store.getState()
    expect(state.origin).toBeNull()
    expect(state.overId).toBeNull()
    expect(state.translate).toEqual({ x: 0, y: 0 })
    expect(state.measuredRects.size).toBe(0)
  })

  it('clears it on cancel too, so a cancelled drag leaves nothing behind', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))

    const session = store.beginDrag('item', { pointer: { x: 1, y: 2 } })
    session?.move({ x: 0, y: 5 })
    session?.cancel(DRAG_CANCEL_REASONS.escape)

    const state = store.getState()
    expect(state.origin).toBeNull()
    expect(state.translate).toEqual({ x: 0, y: 0 })
    expect(state.measuredRects.size).toBe(0)
  })

  it('keeps registrations across a drag — teardown is per-interaction, not per-mount', () => {
    const { store, addDraggable, addDroppable } = createHarness()
    addDraggable('item', rectAt(0, 0))
    addDroppable('slot', rectAt(0, 10))

    store.beginDrag('item', { pointer: null })?.end()

    expect(store.beginDrag('item', { pointer: null })).not.toBeNull()
  })
})

describe('two stores in one page', () => {
  it('keeps their drags entirely separate', () => {
    const left = createHarness()
    const right = createHarness()
    left.addDraggable('shared-id', rectAt(0, 0))
    right.addDraggable('shared-id', rectAt(0, 500))

    left.store.beginDrag('shared-id', { pointer: null })

    expect(left.store.getState().origin).not.toBeNull()
    expect(right.store.getState().origin).toBeNull()
  })
})
