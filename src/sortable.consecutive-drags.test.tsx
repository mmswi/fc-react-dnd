import { act, fireEvent, render } from '@testing-library/react'
import { useCallback, useMemo, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { pointerSensor } from './pointer-sensor.js'
import { SortableList, type SortEndEvent } from './sortable-list.js'
import { useSortable } from './use-sortable.js'

/**
 * Drag, drop, drag again — the thing a user does within ten seconds of opening the page, and the
 * thing a single-drag test never covers.
 *
 * Every drag here re-mocks the rects from the **current** order, because that is what the browser
 * does after a reflow: the second drag must be measured against where the rows ended up, not
 * where they started.
 */

const ROW_HEIGHT_PX = 50
const ACTIVATION_DISTANCE_PX = 4
const INITIAL_IDS = ['a', 'b', 'c', 'd', 'e'] as const

/**
 * A row that behaves the way one does in a browser.
 *
 * Two details matter and are easy to leave out. Its rect is positioned by the row's place in the
 * **current** order, as a reflow would put it — and its rect **includes its own transform**,
 * exactly as `getBoundingClientRect` does. Without the second, a drag begun mid-animation is not
 * measurable here at all.
 */
const Row = ({
  id,
  index,
  lingeringTranslateY = 0,
}: {
  id: string
  index: number
  lingeringTranslateY?: number
}) => {
  const { setNodeRef, handleProps, translate } = useSortable({ id })
  const appliedTranslateY = translate.y + lingeringTranslateY

  return (
    <li
      ref={(node) => {
        if (node) {
          node.style.transform = `translate3d(0px, ${appliedTranslateY}px, 0px)`
          mockElementRect(node, {
            left: 0,
            top: index * ROW_HEIGHT_PX + appliedTranslateY,
            width: 200,
            height: ROW_HEIGHT_PX,
          })
        }
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

const renderList = ({ lingeringTranslateY = 0 }: { lingeringTranslateY?: number } = {}) => {
  const sortEvents: SortEndEvent[] = []
  let currentIds: readonly string[] = INITIAL_IDS
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

  const Scene = () => {
    const [ids, setIds] = useState<readonly string[]>(INITIAL_IDS)
    currentIds = ids
    const items = useMemo(() => ids, [ids])

    const handleSortEnd = useCallback((event: SortEndEvent) => {
      sortEvents.push(event)
      setIds((current) => {
        const next = [...current]
        const [moved] = next.splice(event.fromIndex, 1)
        if (moved) next.splice(event.toIndex, 0, moved)
        return next
      })
    }, [])

    return (
      <DndProvider sensors={sensors}>
        <SortableList items={items} onSortEnd={handleSortEnd}>
          <ul>
            {ids.map((id, index) => (
              <Row
                key={id}
                id={id}
                index={index}
                lingeringTranslateY={index === 0 ? lingeringTranslateY : 0}
              />
            ))}
          </ul>
        </SortableList>
      </DndProvider>
    )
  }

  const view = render(<Scene />)
  return { view, sortEvents, order: () => currentIds }
}

/** Grabs the row currently at `fromRow` and drops it on the row currently at `toRow`. */
const dragRow = (
  list: ReturnType<typeof renderList>,
  fromRow: number,
  toRow: number,
  pointerId: number,
) => {
  const id = list.order()[fromRow] as string
  const element = list.view.getByTestId(id)
  const startY = fromRow * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2
  const endY = toRow * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2

  fireEvent.pointerDown(element, {
    pointerId,
    clientX: 0,
    clientY: startY,
    button: 0,
    isPrimary: true,
  })
  const steps = 8
  for (let step = 1; step <= steps; step += 1) {
    act(() => {
      fireEvent.pointerMove(document, {
        pointerId,
        clientX: 0,
        clientY: startY + ((endY - startY) * step) / steps,
      })
    })
  }
  act(() => {
    fireEvent.pointerUp(document, { pointerId, clientX: 0, clientY: endY })
  })
}

describe('dragging more than once', () => {
  it('applies the first move', () => {
    const list = renderList()

    dragRow(list, 0, 2, 1)

    expect(list.order()).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('applies the second move to the order the first one produced', () => {
    // The failure this guards: the second drag measured against stale rects, so the item appears
    // to snap back or land somewhere unrelated.
    const list = renderList()

    dragRow(list, 0, 2, 1)
    expect(list.order()).toEqual(['b', 'c', 'a', 'd', 'e'])

    // 'e' is last; move it to the top.
    dragRow(list, 4, 0, 2)

    expect(list.order()).toEqual(['e', 'b', 'c', 'a', 'd'])
  })

  it('survives five drags in a row without losing or duplicating a row', () => {
    const list = renderList()

    dragRow(list, 0, 3, 1)
    dragRow(list, 4, 1, 2)
    dragRow(list, 2, 0, 3)
    dragRow(list, 1, 4, 4)
    dragRow(list, 3, 2, 5)

    expect([...list.order()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(list.sortEvents).toHaveLength(5)
  })

  it('leaves every row at rest between drags', () => {
    const list = renderList()

    dragRow(list, 0, 2, 1)

    for (const id of INITIAL_IDS) {
      expect(list.view.getByTestId(id).dataset.translate).toBe('0,0')
    }
  })

  it('measures where rows rest, not where a running drop animation has them', () => {
    // The bug this pins, reported from the demo: a row still animating back from the previous
    // drop is measured mid-flight, the whole projection is built on geometry that is about to
    // stop being true, and the second drag of a session displaces the wrong rows entirely.
    //
    // Here the first row carries 120px of leftover transform when the drag begins — as it would
    // 60ms into a 200ms transition.
    const list = renderList({ lingeringTranslateY: 120 })

    dragRow(list, 1, 3, 1)

    expect(list.order()).toEqual(['a', 'c', 'd', 'b', 'e'])
  })

  it('reports a landing position that matches where the row actually ends up', () => {
    const list = renderList()

    dragRow(list, 0, 2, 1)

    const [event] = list.sortEvents
    expect(event).toBeDefined()
    expect(list.order()[event?.toIndex ?? -1]).toBe(event?.activeId)
  })
})
