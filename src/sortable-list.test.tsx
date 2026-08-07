import { act, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useSortableListContext } from './internal/sortable-context.js'
import { pointerSensor } from './pointer-sensor.js'
import { SortableList, type SortEndEvent } from './sortable-list.js'
import type { Rect } from './types.js'
import { useSortable } from './use-sortable.js'

const ROW_HEIGHT_PX = 40
const ACTIVATION_DISTANCE_PX = 4

const rowRect = (index: number): Rect => ({
  left: 0,
  top: index * ROW_HEIGHT_PX,
  width: 200,
  height: ROW_HEIGHT_PX,
})

const Row = ({ id, index }: { id: string; index: number }) => {
  const { setNodeRef, handleProps, translate } = useSortable({ id })
  return (
    <li
      ref={(node) => {
        if (node) mockElementRect(node, rowRect(index))
        return setNodeRef(node)
      }}
      data-testid={id}
      data-translate={`${translate.x},${translate.y}`}
      {...handleProps}
    >
      {id}
    </li>
  )
}

const ROW_IDS = ['a', 'b', 'c', 'd'] as const
const SENSORS = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

const renderList = (onSortEnd?: (event: SortEndEvent) => void) => {
  const view = render(
    <DndProvider sensors={SENSORS}>
      <SortableList items={ROW_IDS} onSortEnd={onSortEnd}>
        <ul>
          {ROW_IDS.map((id, index) => (
            <Row key={id} id={id} index={index} />
          ))}
        </ul>
      </SortableList>
    </DndProvider>,
  )
  return { view, handle: (id: string) => view.getByTestId(id) }
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

const drop = (deltaY: number) => {
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: deltaY })
  })
}

describe('onSortEnd', () => {
  it('fires once with the indices from the final projection', () => {
    const onSortEnd = vi.fn()
    const list = renderList(onSortEnd)

    dragBy(list.handle('a'), ROW_HEIGHT_PX * 2)
    drop(ROW_HEIGHT_PX * 2)

    expect(onSortEnd).toHaveBeenCalledTimes(1)
    expect(onSortEnd.mock.calls[0]?.[0]).toMatchObject({
      activeId: 'a',
      fromIndex: 0,
      toIndex: 2,
    })
  })

  it('reports the landing position by id as well as by index', () => {
    // Indices are positional and a concurrent edit can shift them under the drag; the ids
    // survive that, so a consumer can place the item correctly either way.
    const onSortEnd = vi.fn()
    const list = renderList(onSortEnd)

    dragBy(list.handle('a'), ROW_HEIGHT_PX * 2)
    drop(ROW_HEIGHT_PX * 2)

    // With a removed, the rest read b, c, d. Landing at index 2 puts a between c and d.
    expect(onSortEnd.mock.calls[0]?.[0]).toMatchObject({ afterId: 'c', beforeId: 'd' })
  })

  it('reports a null neighbour at each end of the list', () => {
    const onSortEnd = vi.fn()
    const list = renderList(onSortEnd)

    dragBy(list.handle('d'), -(ROW_HEIGHT_PX * 3))
    drop(-(ROW_HEIGHT_PX * 3))
    expect(onSortEnd.mock.calls[0]?.[0]).toMatchObject({ afterId: null, beforeId: 'a' })

    onSortEnd.mockClear()
    dragBy(list.handle('a'), ROW_HEIGHT_PX * 3)
    drop(ROW_HEIGHT_PX * 3)
    expect(onSortEnd.mock.calls[0]?.[0]).toMatchObject({ afterId: 'd', beforeId: null })
  })

  it('does not fire when the item lands back where it started', () => {
    // Documented behaviour: a drop that changes nothing is not a sort. Consumers build undo
    // stacks on this event, and an entry that undoes to the same order is worse than none.
    const onSortEnd = vi.fn()
    const list = renderList(onSortEnd)

    dragBy(list.handle('b'), 5)
    drop(5)

    expect(onSortEnd).not.toHaveBeenCalled()
  })

  it('does not fire when the drag is cancelled', () => {
    const onSortEnd = vi.fn()
    const list = renderList(onSortEnd)

    dragBy(list.handle('a'), ROW_HEIGHT_PX * 2)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(onSortEnd).not.toHaveBeenCalled()
  })

  it('calls the handler the consumer passed most recently', () => {
    const original = vi.fn()
    const replacement = vi.fn()
    let swap: (() => void) | null = null
    const Host = () => {
      const [onSortEnd, setOnSortEnd] = useState(() => original)
      swap = () => setOnSortEnd(() => replacement)
      return (
        <DndProvider sensors={SENSORS}>
          <SortableList items={ROW_IDS} onSortEnd={onSortEnd}>
            <ul>
              {ROW_IDS.map((id, index) => (
                <Row key={id} id={id} index={index} />
              ))}
            </ul>
          </SortableList>
        </DndProvider>
      )
    }
    const view = render(<Host />)

    dragBy(view.getByTestId('a'), ROW_HEIGHT_PX * 2)
    act(() => {
      swap?.()
    })
    drop(ROW_HEIGHT_PX * 2)

    expect(original).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledTimes(1)
  })
})

describe('two lists in one provider', () => {
  const LEFT_IDS = ['l1', 'l2'] as const
  const RIGHT_IDS = ['r1', 'r2'] as const

  const renderTwoLists = (onLeftSortEnd: () => void, onRightSortEnd: () => void) =>
    render(
      <DndProvider sensors={SENSORS}>
        <SortableList items={LEFT_IDS} onSortEnd={onLeftSortEnd}>
          <ul>
            {LEFT_IDS.map((id, index) => (
              <Row key={id} id={id} index={index} />
            ))}
          </ul>
        </SortableList>
        <SortableList items={RIGHT_IDS} onSortEnd={onRightSortEnd}>
          <ul>
            {RIGHT_IDS.map((id, index) => (
              <Row key={id} id={id} index={index + 10} />
            ))}
          </ul>
        </SortableList>
      </DndProvider>,
    )

  it('reports a sort only to the list the item belongs to', () => {
    const onLeftSortEnd = vi.fn()
    const onRightSortEnd = vi.fn()
    const view = renderTwoLists(onLeftSortEnd, onRightSortEnd)

    dragBy(view.getByTestId('l1'), ROW_HEIGHT_PX)
    drop(ROW_HEIGHT_PX)

    expect(onLeftSortEnd).toHaveBeenCalledTimes(1)
    expect(onRightSortEnd).not.toHaveBeenCalled()
  })

  it('reports nothing when an item is dropped over the other list', () => {
    // Cross-list moves are explicitly Backlog; the important part is that neither list invents
    // a result for a drop it cannot describe.
    const onLeftSortEnd = vi.fn()
    const onRightSortEnd = vi.fn()
    const view = renderTwoLists(onLeftSortEnd, onRightSortEnd)

    dragBy(view.getByTestId('l1'), ROW_HEIGHT_PX * 10)
    drop(ROW_HEIGHT_PX * 10)

    expect(onLeftSortEnd).not.toHaveBeenCalled()
    expect(onRightSortEnd).not.toHaveBeenCalled()
  })
})

describe('the list context', () => {
  it('is stable across a parent re-render, so items do not re-render because the list did', () => {
    const seen: unknown[] = []
    let forceRender: (() => void) | null = null
    const ContextProbe = () => {
      seen.push(useSortableListContext('ContextProbe'))
      return null
    }
    const Host = () => {
      const [, setTick] = useState(0)
      forceRender = () => setTick((tick) => tick + 1)
      return (
        <DndProvider sensors={SENSORS}>
          <SortableList items={ROW_IDS}>
            <ContextProbe />
          </SortableList>
        </DndProvider>
      )
    }
    render(<Host />)

    act(() => {
      forceRender?.()
    })

    expect(seen.length).toBeGreaterThan(1)
    expect(new Set(seen).size).toBe(1)
  })

  it('gives two lists different ids', () => {
    const ids: string[] = []
    const ContextProbe = () => {
      ids.push(useSortableListContext('ContextProbe').listId)
      return null
    }
    render(
      <DndProvider sensors={SENSORS}>
        <SortableList items={ROW_IDS}>
          <ContextProbe />
        </SortableList>
        <SortableList items={ROW_IDS}>
          <ContextProbe />
        </SortableList>
      </DndProvider>,
    )

    expect(new Set(ids).size).toBe(2)
  })
})
