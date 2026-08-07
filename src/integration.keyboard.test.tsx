import { act, fireEvent, render, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { keyboardSensor } from './keyboard-sensor.js'
import type { DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent, Rect } from './types.js'
import { useDraggable } from './use-draggable.js'
import { useDroppable } from './use-droppable.js'

/**
 * The same end-to-end proof as the pointer flow, for the keyboard — including the announcements,
 * which are the part a sighted developer never notices breaking.
 *
 * A consumer should not be able to tell which sensor drove a drag from the events alone, so the
 * callback sequence here is deliberately the same shape as `integration.pointer.test.tsx`'s.
 */

const rectAt = (top: number): Rect => ({ left: 0, top, width: 200, height: 60 })

const CARD_RECT = rectAt(0)
const INBOX_RECT = rectAt(200)
const ARCHIVE_RECT = rectAt(400)

const Card = () => {
  const { setNodeRef, handleProps } = useDraggable({ id: 'Invoice', data: { title: 'Invoice' } })
  return (
    <button
      type="button"
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
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={id}
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
  const sensors = [keyboardSensor()]

  const view = render(
    <StrictMode>
      <DndProvider
        sensors={sensors}
        onDragStart={(event) => recorded.push({ name: 'start', event })}
        onDragOver={(event) => recorded.push({ name: 'over', event })}
        onDragEnd={(event) => recorded.push({ name: 'end', event })}
        onDragCancel={(event) => recorded.push({ name: 'cancel', event })}
      >
        <Card />
        <Column id="Inbox" rect={INBOX_RECT} />
        <Column id="Archive" rect={ARCHIVE_RECT} />
      </DndProvider>
    </StrictMode>,
  )

  const card = view.getByTestId('card')
  card.focus()

  return {
    view,
    recorded,
    card,
    sequence: () => recorded.map((entry) => entry.name),
    announcement: () => within(view.container).getByRole('status').textContent,
  }
}

const pressKey = (element: Element, key: string) => {
  act(() => {
    fireEvent.keyDown(element, { key })
  })
}

describe('a whole keyboard drag', () => {
  it('runs start → over → end, the same shape a pointer drag produces', () => {
    const board = renderBoard()

    pressKey(board.card, ' ')
    // The card already sits nearest Inbox, so the first step is not a change of target — the
    // initial target rides on the start event, exactly as it does for a pointer drag.
    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, ' ')

    expect(board.sequence()).toEqual(['start', 'over', 'end'])
  })

  it('reports the target the drag began over on the start event', () => {
    const board = renderBoard()

    pressKey(board.card, ' ')

    expect((board.recorded[0] as { event: DragStartEvent }).event.over?.id).toBe('Inbox')
  })

  it('carries the same payloads', () => {
    const board = renderBoard()

    pressKey(board.card, ' ')
    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, ' ')

    const start = board.recorded[0] as { event: DragStartEvent }
    const end = board.recorded.at(-1) as { event: DragEndEvent }

    expect(start.event.active.id).toBe('Invoice')
    expect(start.event.active.data).toEqual({ title: 'Invoice' })
    expect(end.event.over?.id).toBe('Inbox')
    expect(end.event.translate).toEqual({ x: 0, y: 200 })
  })

  it('picks up with Enter as readily as with Space', () => {
    const board = renderBoard()

    pressKey(board.card, 'Enter')
    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, 'Enter')

    expect(board.sequence()).toEqual(['start', 'over', 'end'])
  })

  it('leaves the target unchanged when there is nothing in that direction', () => {
    const board = renderBoard()
    pressKey(board.card, ' ')
    pressKey(board.card, 'ArrowDown')
    const afterFirstStep = board.sequence().length

    pressKey(board.card, 'ArrowUp')
    pressKey(board.card, 'ArrowUp')

    expect(board.sequence().length).toBe(afterFirstStep)
  })
})

describe('what a screen reader hears — accessibility invariants 1 and 2', () => {
  it('announces the pickup, naming the item', () => {
    const board = renderBoard()

    pressKey(board.card, ' ')

    expect(board.announcement()).toContain('Picked up Invoice')
  })

  it('announces each target change as it happens, in both directions', () => {
    const board = renderBoard()
    pressKey(board.card, ' ')

    pressKey(board.card, 'ArrowDown')
    pressKey(board.card, 'ArrowDown')
    expect(board.announcement()).toContain('Archive')

    pressKey(board.card, 'ArrowUp')
    expect(board.announcement()).toContain('Inbox')
  })

  it('announces where the item landed', () => {
    const board = renderBoard()
    pressKey(board.card, ' ')
    pressKey(board.card, 'ArrowDown')

    pressKey(board.card, ' ')

    expect(board.announcement()).toContain('Dropped Invoice on Inbox')
  })

  it('announces a cancel, and reports it as a cancel rather than a drop', () => {
    const board = renderBoard()
    pressKey(board.card, ' ')
    pressKey(board.card, 'ArrowDown')

    pressKey(board.card, 'Escape')

    expect(board.sequence().at(-1)).toBe('cancel')
    expect(board.announcement()).toMatch(/Movement cancelled/i)
  })

  it('cancels and announces when focus leaves mid-drag', () => {
    const board = renderBoard()
    pressKey(board.card, ' ')
    pressKey(board.card, 'ArrowDown')

    act(() => {
      fireEvent.blur(board.card)
    })

    expect(board.sequence().at(-1)).toBe('cancel')
    expect((board.recorded.at(-1) as { event: DragCancelEvent }).event.reason).toBe('blur')
    expect(board.announcement()).toMatch(/Movement cancelled/i)
  })

  it('describes the drag with the instructions element while the handle has focus', () => {
    const board = renderBoard()
    const describedBy = board.card.getAttribute('aria-describedby')

    const instructions = describedBy ? document.getElementById(describedBy) : null

    expect(instructions?.textContent).toMatch(/Space or Enter/i)
    expect(instructions?.textContent).toMatch(/Escape/i)
  })
})
