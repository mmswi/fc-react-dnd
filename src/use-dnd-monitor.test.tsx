import { act, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { type DndMonitorListeners, DRAG_CANCEL_REASONS, type Rect } from './types.js'
import { useDndMonitor } from './use-dnd-monitor.js'
import { useDraggable } from './use-draggable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const Draggable = ({ id, rect }: { id: string; rect: Rect }) => {
  const { setNodeRef } = useDraggable({ id })
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

const Monitor = ({
  listeners,
  onBodyRun,
}: {
  listeners: DndMonitorListeners
  onBodyRun?: () => void
}) => {
  onBodyRun?.()
  useDndMonitor(listeners)
  return null
}

const renderWithMonitor = (listeners: DndMonitorListeners, onBodyRun?: () => void) => {
  let store: DragStore | null = null
  const view = render(
    <DndProvider>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Draggable id="item" rect={rectAt(0, 0)} />
      <Monitor listeners={listeners} onBodyRun={onBodyRun} />
    </DndProvider>,
  )
  return { view, getStore: () => store as unknown as DragStore }
}

describe('useDndMonitor', () => {
  it('hears every event without its host component re-rendering even once', () => {
    // This is the entire reason it exists alongside useActiveDrag.
    const heard: string[] = []
    let bodyRuns = 0
    const { getStore } = renderWithMonitor(
      {
        onDragStart: () => heard.push('start'),
        onDragMove: () => heard.push('move'),
        onDragEnd: () => heard.push('end'),
      },
      () => {
        bodyRuns += 1
      },
    )
    const runsAfterMount = bodyRuns

    act(() => {
      const session = getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
      session?.move({ x: 0, y: 5 })
      session?.move({ x: 0, y: 10 })
      session?.end()
    })

    expect(heard).toEqual(['start', 'move', 'move', 'end'])
    expect(bodyRuns).toBe(runsAfterMount)
  })

  it('covers start, move, over, end, and cancel', () => {
    const heard: string[] = []
    let store: DragStore | null = null
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        <Monitor
          listeners={{
            onDragStart: () => heard.push('start'),
            onDragMove: () => heard.push('move'),
            onDragOver: () => heard.push('over'),
            onDragEnd: () => heard.push('end'),
            onDragCancel: () => heard.push('cancel'),
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    readyStore.registerDroppable(
      'first',
      (() => {
        const node = document.createElement('div')
        mockElementRect(node, rectAt(0, 0))
        document.body.append(node)
        return node
      })(),
    )
    readyStore.registerDroppable(
      'second',
      (() => {
        const node = document.createElement('div')
        mockElementRect(node, rectAt(0, 400))
        document.body.append(node)
        return node
      })(),
    )

    act(() => {
      const session = readyStore.beginDrag('item', { pointer: { x: 0, y: 0 } })
      session?.move({ x: 0, y: 390 })
      session?.end()
    })
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.escape)
    })

    expect(heard).toEqual(['start', 'move', 'over', 'end', 'start', 'cancel'])
  })

  it('sees the drag it is being told about, before the state is cleared', () => {
    let seenDuringEnd: unknown
    const { getStore } = renderWithMonitor({
      onDragEnd: () => {
        seenDuringEnd = getStore().getState().origin?.id
      },
    })

    act(() => {
      getStore().beginDrag('item', { pointer: null })?.end()
    })

    expect(seenDuringEnd).toBe('item')
  })

  it('reads listeners through a latest-ref, so new inline closures do not resubscribe', () => {
    // A resubscribe per render would be invisible until it either dropped an event or leaked a
    // subscription. Counted from the store's side: subscriptions, not renders.
    let store: DragStore | null = null
    let forceRender: (() => void) | null = null
    const calls: number[] = []
    const Host = () => {
      const [tick, setTick] = useState(0)
      forceRender = () => setTick((current) => current + 1)
      return (
        <DndProvider>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          <Monitor listeners={{ onDragStart: () => calls.push(tick) }} />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore

    act(() => {
      forceRender?.()
    })
    act(() => {
      forceRender?.()
    })
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    // Exactly one call proves one subscription; the value proves it was the latest closure.
    expect(calls).toEqual([2])
  })

  it('leaves exactly one subscription under StrictMode', () => {
    const onDragStart = vi.fn()
    let store: DragStore | null = null
    render(
      <StrictMode>
        <DndProvider>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          <Monitor listeners={{ onDragStart }} />
        </DndProvider>
      </StrictMode>,
    )

    act(() => {
      ;(store as unknown as DragStore).beginDrag('item', { pointer: null })
    })

    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const onDragStart = vi.fn()
    let store: DragStore | null = null
    const Host = ({ monitoring }: { monitoring: boolean }) => (
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        {monitoring ? <Monitor listeners={{ onDragStart }} /> : null}
      </DndProvider>
    )
    const view = render(<Host monitoring />)

    view.rerender(<Host monitoring={false} />)
    act(() => {
      ;(store as unknown as DragStore).beginDrag('item', { pointer: null })
    })

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('throws the named out-of-provider error', () => {
    const Orphan = () => {
      useDndMonitor({})
      return null
    }

    expect(() => render(<Orphan />)).toThrow(/useDndMonitor/)
  })
})
