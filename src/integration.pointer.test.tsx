import { act, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { pointerSensor } from './pointer-sensor.js'
import type { DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent, Rect } from './types.js'
import { useDraggable } from './use-draggable.js'
import { useDroppable } from './use-droppable.js'

/**
 * One whole pointer drag through the real public API — provider, sensor, store, collision,
 * callbacks — asserting what a consumer would actually observe. The unit tests prove each piece;
 * this proves they compose.
 */

const ACTIVATION_DISTANCE_PX = 8

const rectAt = (top: number): Rect => ({ left: 0, top, width: 200, height: 60 })

const CARD_RECT = rectAt(0)
const INBOX_RECT = rectAt(200)
const ARCHIVE_RECT = rectAt(400)

const Card = () => {
  const { setNodeRef, handleProps } = useDraggable({ id: 'card', data: { title: 'Invoice #12' } })
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, CARD_RECT)
        return setNodeRef(node)
      }}
      data-testid="card"
      {...handleProps}
    />
  )
}

const Column = ({ id, rect }: { id: string; rect: Rect }) => {
  const { setNodeRef, isOver } = useDroppable({ id, data: { column: id } })
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={id}
      data-over={isOver}
    />
  )
}

type RecordedEvent =
  | { name: 'start'; event: DragStartEvent }
  | { name: 'over'; event: DragOverEvent }
  | { name: 'end'; event: DragEndEvent }
  | { name: 'cancel'; event: DragCancelEvent }

const renderBoard = () => {
  const recorded: RecordedEvent[] = []
  let moveCount = 0
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

  const view = render(
    <StrictMode>
      <DndProvider
        sensors={sensors}
        onDragStart={(event) => recorded.push({ name: 'start', event })}
        onDragMove={() => {
          moveCount += 1
        }}
        onDragOver={(event) => recorded.push({ name: 'over', event })}
        onDragEnd={(event) => recorded.push({ name: 'end', event })}
        onDragCancel={(event) => recorded.push({ name: 'cancel', event })}
      >
        <Card />
        <Column id="inbox" rect={INBOX_RECT} />
        <Column id="archive" rect={ARCHIVE_RECT} />
      </DndProvider>
    </StrictMode>,
  )

  return {
    view,
    recorded,
    sequence: () => recorded.map((entry) => entry.name),
    moveCount: () => moveCount,
    card: () => view.getByTestId('card'),
    column: (id: string) => view.getByTestId(id),
  }
}

const press = (element: Element, y: number) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: y,
    button: 0,
    isPrimary: true,
  })
}

const moveTo = (y: number) => {
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: y })
  })
}

const release = (y: number) => {
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: y })
  })
}

describe('a whole pointer drag', () => {
  it('does nothing at all for a press that stays under the threshold', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(ACTIVATION_DISTANCE_PX - 1)
    release(ACTIVATION_DISTANCE_PX - 1)

    expect(board.sequence()).toEqual([])
    expect(board.moveCount()).toBe(0)
  })

  it('runs start → over → end, in that order, across two drop targets', () => {
    const board = renderBoard()

    press(board.card(), 0)
    // Crossing the threshold. The card's centre is nearest 'inbox' both before and after, so
    // this produces no target change — the initial target rides on the start event.
    moveTo(200)
    // …and on to 'archive', which is a change.
    moveTo(400)
    release(400)

    expect(board.sequence()).toEqual(['start', 'over', 'end'])
  })

  it('reports the target the drag began over on the start event itself', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(200)

    const start = board.recorded[0] as { event: DragStartEvent }
    expect(start.event.over?.id).toBe('inbox')
  })

  it('fires over on a change of target and not on every move within one', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(200)
    for (let offsetPx = 1; offsetPx <= 20; offsetPx += 1) moveTo(200 + offsetPx)
    release(220)

    // Twenty-two moves, all of them over 'inbox', and not one `over` event among them.
    expect(board.sequence()).toEqual(['start', 'end'])
    expect(board.moveCount()).toBe(21)
  })

  it('carries the payloads a consumer builds on', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(400)
    release(400)

    const start = board.recorded[0] as { name: 'start'; event: DragStartEvent }
    const end = board.recorded.at(-1) as { name: 'end'; event: DragEndEvent }

    expect(start.event.active.id).toBe('card')
    expect(start.event.active.data).toEqual({ title: 'Invoice #12' })
    expect(start.event.active.initialRect).toEqual(CARD_RECT)

    expect(end.event.active.id).toBe('card')
    expect(end.event.over?.id).toBe('archive')
    expect(end.event.over?.data).toEqual({ column: 'archive' })
    expect(end.event.translate).toEqual({ x: 0, y: 400 })
  })

  it('reports the drop target to the element that is over', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(400)

    expect(board.column('archive').dataset.over).toBe('true')
    expect(board.column('inbox').dataset.over).toBe('false')
  })

  it('reports over as null when nothing is registered to land on', () => {
    const recorded: RecordedEvent[] = []
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const view = render(
      <StrictMode>
        <DndProvider sensors={sensors} onDragEnd={(event) => recorded.push({ name: 'end', event })}>
          <Card />
        </DndProvider>
      </StrictMode>,
    )

    press(view.getByTestId('card'), 0)
    moveTo(400)
    release(400)

    expect((recorded[0] as { event: DragEndEvent }).event.over).toBeNull()
  })

  it('replaces the end with a cancel when Escape interrupts it', () => {
    const board = renderBoard()

    press(board.card(), 0)
    moveTo(400)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(board.sequence()).toEqual(['start', 'over', 'cancel'])
    expect((board.recorded.at(-1) as { event: DragCancelEvent }).event.reason).toBe('escape')
  })

  it('leaves the board usable for a second drag', () => {
    const board = renderBoard()
    press(board.card(), 0)
    moveTo(400)
    release(400)

    press(board.card(), 0)
    moveTo(200)
    release(200)

    expect(board.sequence()).toEqual(['start', 'over', 'end', 'start', 'end'])
    expect((board.recorded.at(-1) as { event: DragEndEvent }).event.over?.id).toBe('inbox')
  })
})
