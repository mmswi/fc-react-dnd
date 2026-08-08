import { act, fireEvent, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { pointerSensor } from './pointer-sensor.js'
import { SortableList } from './sortable-list.js'
import type { Rect } from './types.js'
import { useSortable } from './use-sortable.js'

const ROW_HEIGHT_PX = 40
const ACTIVATION_DISTANCE_PX = 4
const ROW_IDS = ['a', 'b', 'c', 'd'] as const

/**
 * A fresh sensor per scene.
 *
 * A `pointerSensor()` instance holds one interaction at a time — deliberately, so a second
 * finger cannot start a second drag. Sharing one instance across tests means a test that never
 * releases the pointer blocks every test after it.
 */
const buildSensors = () => [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

const rowRect = (index: number): Rect => ({
  left: 0,
  top: index * ROW_HEIGHT_PX,
  width: 200,
  height: ROW_HEIGHT_PX,
})

const Row = ({
  id,
  index,
  onCommit,
  trackTransform,
}: {
  id: string
  index: number
  onCommit?: (id: string) => void
  trackTransform?: boolean
}) => {
  const { setNodeRef, handleProps, isDragging, translate } = useSortable({ id, trackTransform })

  useEffect(() => {
    onCommit?.(id)
  })

  return (
    <li
      ref={(node) => {
        if (node) mockElementRect(node, rowRect(index))
        return setNodeRef(node)
      }}
      data-testid={id}
      data-dragging={isDragging}
      data-translate={`${translate.x},${translate.y}`}
      {...handleProps}
    >
      {id}
    </li>
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

const renderList = ({
  strict = false,
  onCommit,
  ids = ROW_IDS,
  trackTransform,
}: {
  strict?: boolean
  onCommit?: (id: string) => void
  ids?: readonly string[]
  trackTransform?: boolean
} = {}) => {
  let store: DragStore | null = null
  const sensors = buildSensors()
  const Scene = () => (
    <DndProvider sensors={sensors}>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <SortableList items={ids}>
        <ul>
          {ids.map((id, index) => (
            <Row
              key={id}
              id={id}
              index={index}
              onCommit={onCommit}
              trackTransform={trackTransform}
            />
          ))}
        </ul>
      </SortableList>
    </DndProvider>
  )
  const view = render(strict ? <StrictMode>{<Scene />}</StrictMode> : <Scene />)

  return {
    view,
    getStore: () => store as unknown as DragStore,
    row: (id: string) => view.getByTestId(id),
    translateOf: (id: string) => view.getByTestId(id).dataset.translate,
  }
}

const dragBy = (element: Element, deltaY: number) => {
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

describe('one node, two registrations', () => {
  it('registers as both a draggable and a droppable', () => {
    const list = renderList()

    // Registered as a droppable: it is measured, so it is in the rect cache.
    act(() => {
      list.getStore().beginDrag('a', { pointer: null })
    })

    expect(list.getStore().getState().measuredRects.size).toBe(ROW_IDS.length)
    expect(list.getStore().getState().origin?.id).toBe('a')
  })

  it('unregisters both on unmount, StrictMode included', () => {
    const list = renderList({ strict: true, ids: ['a', 'b'] })
    expect(list.getStore().getState().origin).toBeNull()

    list.view.unmount()

    // Nothing left to assert against a torn-down tree except that the registry is empty, which
    // a failed drag start is the honest way to observe.
    expect(list.getStore().beginDrag('a', { pointer: null })).toBeNull()
  })

  it('runs a drag cleanly inside StrictMode', () => {
    const list = renderList({ strict: true })

    dragBy(list.row('a'), ROW_HEIGHT_PX * 2)

    expect(list.getStore().getState().origin?.id).toBe('a')
    expect(list.getStore().getState().overId).toBe('c')
  })
})

describe('translate', () => {
  it('is zero for every item before a drag', () => {
    const list = renderList()

    for (const id of ROW_IDS) expect(list.translateOf(id)).toBe('0,0')
  })

  it('displaces the rows in the way, and puts the dragged row under the pointer', () => {
    const list = renderList()

    dragBy(list.row('a'), ROW_HEIGHT_PX * 2 + 7)

    // b and c slide up out of the way…
    expect(list.translateOf('b')).toBe(`0,${-ROW_HEIGHT_PX}`)
    expect(list.translateOf('c')).toBe(`0,${-ROW_HEIGHT_PX}`)
    expect(list.translateOf('d')).toBe('0,0')
    // …and the dragged row sits exactly where the pointer is, not snapped to a landing slot.
    expect(list.translateOf('a')).toBe(`0,${ROW_HEIGHT_PX * 2 + 7}`)
  })

  it('goes back to zero after a drop', () => {
    const list = renderList()
    dragBy(list.row('a'), ROW_HEIGHT_PX * 2)

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 2 })
    })

    for (const id of ROW_IDS) expect(list.translateOf(id)).toBe('0,0')
  })

  it('re-renders only the dragged row for a move that displaces nobody', () => {
    // The dragged row follows the pointer, so it re-renders on every move — that is what makes a
    // drag feel like a drag rather than a teleport. Every *other* row still only re-renders when
    // it actually moves, which is the claim that matters.
    const commits: string[] = []
    const list = renderList({ onCommit: (id) => commits.push(id) })
    dragBy(list.row('a'), ROW_HEIGHT_PX * 2)
    const mark = commits.length

    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 2 + 5 })
    })

    expect(commits.slice(mark)).toEqual(['a'])
  })

  it('re-renders nothing at all for such a move when an overlay carries the motion', () => {
    const commits: string[] = []
    const list = renderList({ onCommit: (id) => commits.push(id), trackTransform: false })
    dragBy(list.row('a'), ROW_HEIGHT_PX * 2)
    const mark = commits.length

    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 2 + 5 })
    })

    expect(commits.slice(mark)).toEqual([])
  })

  it('re-renders exactly the items whose translate changed when a boundary is crossed', () => {
    const commits: string[] = []
    const list = renderList({ onCommit: (id) => commits.push(id) })
    dragBy(list.row('a'), ROW_HEIGHT_PX * 2)
    const mark = commits.length

    // Landing moves from after c to after d. Three rows have a changed slice and no more:
    // a's translate grows, d's translate appears, and c hands `isOver` to d. b does not move.
    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 3 })
    })

    expect([...commits.slice(mark)].sort()).toEqual(['a', 'c', 'd'])
  })
})

describe('isDragging', () => {
  it('is true only for the item being dragged', () => {
    const list = renderList()

    dragBy(list.row('b'), ROW_HEIGHT_PX)

    expect(list.row('b').dataset.dragging).toBe('true')
    for (const id of ['a', 'c', 'd']) expect(list.row(id).dataset.dragging).toBe('false')
  })
})

describe('handleProps', () => {
  it('passes through from useDraggable so a handle works exactly as on a bare draggable', () => {
    const list = renderList()
    const row = list.row('a')

    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-roledescription')).toBe('draggable')
    expect(row.style.touchAction).toBe('none')
  })
})

describe('used outside a SortableList', () => {
  it('throws a named error rather than silently sorting nothing', () => {
    const Orphan = () => {
      useSortable({ id: 'a' })
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      render(
        <DndProvider sensors={buildSensors()}>
          <Orphan />
        </DndProvider>,
      ),
    ).toThrow(/SortableList/)

    consoleError.mockRestore()
  })
})
