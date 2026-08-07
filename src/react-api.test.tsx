import { act, fireEvent, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider, type DndProviderProps } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { pointerSensor } from './pointer-sensor.js'
import type { Rect } from './types.js'
import { useDraggable } from './use-draggable.js'
import { useDroppable } from './use-droppable.js'

/**
 * The failure modes that only appear once several components share one provider. Everything
 * here is driven through the public API and real DOM events — no sensor internals, no store
 * calls to make something happen.
 */

const ROW_HEIGHT_PX = 40
const ROW_COUNT = 10
const ACTIVATION_DISTANCE_PX = 4

const rowRect = (index: number): Rect => ({
  left: 0,
  top: index * ROW_HEIGHT_PX,
  width: 200,
  height: ROW_HEIGHT_PX,
})

/**
 * One element registered as both a draggable and a droppable, which is what a sortable row is.
 *
 * `onCommit` is called from an effect, so it counts **commits** rather than render-function
 * runs. That is unambiguous under both of React's bailout paths, including the late one where
 * the body runs and its output is discarded.
 */
const Row = ({ index, onCommit }: { index: number; onCommit: (index: number) => void }) => {
  const id = `row-${index}`
  const draggable = useDraggable({ id, data: { index }, trackTransform: false })
  const droppable = useDroppable({ id, data: { index } })

  useEffect(() => {
    onCommit(index)
  })

  return (
    <li
      ref={(node) => {
        if (node) mockElementRect(node, rowRect(index))
        draggable.setNodeRef(node)
        return droppable.setNodeRef(node)
      }}
      data-testid={id}
      data-over={droppable.isOver}
      data-dragging={draggable.isDragging}
      {...draggable.handleProps}
    >
      Row {index}
    </li>
  )
}

const renderRows = (
  props: Partial<DndProviderProps> = {},
  { strict = true, rowCount = ROW_COUNT }: { strict?: boolean; rowCount?: number } = {},
) => {
  const commits: number[] = []
  let store: DragStore | null = null
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
  const StoreProbe = () => {
    store = useDndContext('StoreProbe').store
    return null
  }
  const Scene = ({ mounted = true }: { mounted?: boolean }) => (
    <DndProvider sensors={sensors} {...props}>
      <StoreProbe />
      <ul>
        {mounted
          ? Array.from({ length: rowCount }, (_unused, index) => `row-${index}`).map(
              (rowId, index) => (
                <Row key={rowId} index={index} onCommit={(rowIndex) => commits.push(rowIndex)} />
              ),
            )
          : null}
      </ul>
    </DndProvider>
  )
  const view = render(strict ? <StrictMode>{<Scene />}</StrictMode> : <Scene />)

  return {
    view,
    commits,
    getStore: () => store as unknown as DragStore,
    unmountRows: () =>
      view.rerender(
        strict ? <StrictMode>{<Scene mounted={false} />}</StrictMode> : <Scene mounted={false} />,
      ),
    commitsSince: (mark: number) => commits.slice(mark),
    handle: (index: number) => view.getByTestId(`row-${index}`),
  }
}

const dragFromRowTo = (element: Element, deltaY: number) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    isPrimary: true,
  })
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: deltaY })
  })
}

const releasePointer = (deltaY: number) => {
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: deltaY })
  })
}

describe('StrictMode lifecycle — perf invariant 8', () => {
  it('registers each row exactly once, with no duplicates and no leftovers', () => {
    const scene = renderRows()

    act(() => {
      scene.getStore().beginDrag('row-0', { pointer: null })
    })

    // measuredRects holds one entry per registered droppable. A double registration or a
    // leaked entry would change this number; the console staying quiet would not.
    expect(scene.getStore().getState().measuredRects.size).toBe(ROW_COUNT)
  })

  it('leaves nothing registered after the rows unmount', () => {
    const scene = renderRows()

    scene.unmountRows()

    expect(scene.getStore().beginDrag('row-0', { pointer: null })).toBeNull()
    act(() => {
      scene.getStore().beginDrag('row-3', { pointer: null })
    })
    expect(scene.getStore().getState().origin).toBeNull()
  })

  it('runs a whole drag inside StrictMode without a leaked subscription double-firing', () => {
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderRows({ onDragStart, onDragEnd })

    dragFromRowTo(scene.handle(0), 100)
    releasePointer(100)

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })
})

describe('render granularity across a realistic tree — perf invariant 4', () => {
  it('commits exactly the rows whose isOver flipped when one boundary is crossed', () => {
    const scene = renderRows({}, { strict: false })
    // Start on row 0. Its rect is 0..40, the active rect starts there, so row 0 is `over`.
    dragFromRowTo(scene.handle(0), ACTIVATION_DISTANCE_PX)
    const mark = scene.commits.length

    // Move far enough that the active rect's centre lands inside row 2 and nothing else.
    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 2 })
    })

    // Row 0 loses `isOver`, row 2 gains it. Rows 1 and 3..9 have no changed slice at all.
    expect([...scene.commitsSince(mark)].sort()).toEqual([0, 2])
  })

  it('commits nothing at all for moves that stay inside one row', () => {
    const scene = renderRows({}, { strict: false })
    dragFromRowTo(scene.handle(0), ACTIVATION_DISTANCE_PX)
    const mark = scene.commits.length

    for (let step = 1; step <= 12; step += 1) {
      act(() => {
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: step })
      })
    }

    expect(scene.commitsSince(mark)).toEqual([])
  })

  it('commits only the dragged row on drag start, since only its isDragging changed', () => {
    const scene = renderRows({}, { strict: false })
    const mark = scene.commits.length

    dragFromRowTo(scene.handle(0), ACTIVATION_DISTANCE_PX)

    // Row 0 starts dragging *and* is already `over` itself, so it commits once. No other row
    // has a changed slice.
    expect([...new Set(scene.commitsSince(mark))]).toEqual([0])
  })
})

describe('callback order and payloads', () => {
  it('fires start, over, move, and end in order for one pointer drag', () => {
    const sequence: string[] = []
    const scene = renderRows({
      onDragStart: () => sequence.push('start'),
      onDragMove: () => sequence.push('move'),
      onDragOver: () => sequence.push('over'),
      onDragEnd: () => sequence.push('end'),
      onDragCancel: () => sequence.push('cancel'),
    })

    dragFromRowTo(scene.handle(0), ROW_HEIGHT_PX * 3)
    releasePointer(ROW_HEIGHT_PX * 3)

    expect(sequence).toEqual(['start', 'move', 'over', 'end'])
  })

  it('carries active, over, and translate on the drop', () => {
    const onDragEnd = vi.fn()
    const scene = renderRows({ onDragEnd })

    dragFromRowTo(scene.handle(0), ROW_HEIGHT_PX * 3)
    releasePointer(ROW_HEIGHT_PX * 3)

    const event = onDragEnd.mock.calls[0]?.[0]
    expect(event.active.id).toBe('row-0')
    expect(event.active.data).toEqual({ index: 0 })
    expect(event.over.id).toBe('row-3')
    expect(event.over.data).toEqual({ index: 3 })
    expect(event.translate).toEqual({ x: 0, y: ROW_HEIGHT_PX * 3 })
  })

  it('reports over as null when there is no drop target anywhere', () => {
    // closestCenter has no range limit by design, so with any droppable mounted there is always
    // an `over`. The only way to observe the null case is a subtree with none — which is also
    // the realistic one: a draggable dragged out of every registered region.
    const onDragEnd = vi.fn()
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const LoneDraggable = () => {
      const { setNodeRef, handleProps } = useDraggable({ id: 'lonely' })
      return (
        <div
          ref={(node) => {
            if (node) mockElementRect(node, rowRect(0))
            return setNodeRef(node)
          }}
          data-testid="lonely"
          {...handleProps}
        />
      )
    }
    const view = render(
      <DndProvider sensors={sensors} onDragEnd={onDragEnd}>
        <LoneDraggable />
      </DndProvider>,
    )

    dragFromRowTo(view.getByTestId('lonely'), 100)
    releasePointer(100)

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd.mock.calls[0]?.[0].over).toBeNull()
  })

  it('replaces end with cancel when Escape is pressed mid-drag', () => {
    const sequence: string[] = []
    const scene = renderRows({
      onDragStart: () => sequence.push('start'),
      onDragEnd: () => sequence.push('end'),
      onDragCancel: () => sequence.push('cancel'),
    })

    dragFromRowTo(scene.handle(0), ROW_HEIGHT_PX * 2)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(sequence).toEqual(['start', 'cancel'])
  })
})
