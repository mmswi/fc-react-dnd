import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import type { DragSession, Rect } from './types.js'
import { useActiveDrag } from './use-active-drag.js'
import { useDraggable } from './use-draggable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const Draggable = ({
  id,
  rect,
  data,
}: {
  id: string
  rect: Rect
  data?: Record<string, unknown>
}) => {
  const { setNodeRef } = useDraggable({ id, data })
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
    />
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

const renderWithActiveDragReadout = (onBodyRun?: () => void) => {
  let store: DragStore | null = null
  let lastRead: ReturnType<typeof useActiveDrag> = null
  const Readout = () => {
    onBodyRun?.()
    lastRead = useActiveDrag()
    return <span data-testid="readout">{lastRead ? String(lastRead.id) : 'idle'}</span>
  }
  const view = render(
    <DndProvider>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Draggable id="item" rect={rectAt(10, 20)} data={{ kind: 'card' }} />
      <Readout />
    </DndProvider>,
  )
  return { view, getStore: () => store as unknown as DragStore, read: () => lastRead }
}

describe('useActiveDrag', () => {
  it('is null outside a drag and reports the item during one', () => {
    const { view, getStore } = renderWithActiveDragReadout()
    expect(view.getByTestId('readout').textContent).toBe('idle')

    act(() => {
      getStore().beginDrag('item', { pointer: null })
    })

    expect(view.getByTestId('readout').textContent).toBe('item')
  })

  it('carries the payload and the rect the item started from', () => {
    const { getStore, read } = renderWithActiveDragReadout()

    act(() => {
      getStore().beginDrag('item', { pointer: null })
    })

    expect(read()?.data).toEqual({ kind: 'card' })
    expect(read()?.rect).toEqual(rectAt(10, 20))
  })

  it('re-renders on start and end, and not once per move — perf invariant 4', () => {
    let bodyRuns = 0
    const { getStore } = renderWithActiveDragReadout(() => {
      bodyRuns += 1
    })
    const runsAfterMount = bodyRuns
    let session: DragSession | null = null

    act(() => {
      session = getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    const runsAfterStart = bodyRuns
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        ;(session as unknown as DragSession).move({ x: 0, y: step })
      })
    }
    const runsAfterMoves = bodyRuns
    act(() => {
      ;(session as unknown as DragSession).end()
    })

    expect(runsAfterStart).toBe(runsAfterMount + 1)
    expect(runsAfterMoves).toBe(runsAfterStart)
    expect(bodyRuns).toBe(runsAfterStart + 1)
  })

  it('hands back the identical object across moves, which is what makes that true', () => {
    const { getStore, read } = renderWithActiveDragReadout()
    let session: DragSession | null = null
    act(() => {
      session = getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    const atStart = read()

    act(() => {
      ;(session as unknown as DragSession).move({ x: 0, y: 50 })
    })

    expect(read()).toBe(atStart)
  })

  it('goes back to null after a drop', () => {
    const { view, getStore } = renderWithActiveDragReadout()
    act(() => {
      getStore().beginDrag('item', { pointer: null })?.end()
    })

    expect(view.getByTestId('readout').textContent).toBe('idle')
  })

  it('throws the named out-of-provider error', () => {
    const Orphan = () => {
      useActiveDrag()
      return null
    }

    expect(() => render(<Orphan />)).toThrow(/useActiveDrag/)
  })
})
