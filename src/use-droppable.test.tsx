import { act, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { DRAG_CANCEL_REASONS, type DragSession, type Rect } from './types.js'
import { useDraggable } from './use-draggable.js'
import { type UseDroppableOptions, useDroppable } from './use-droppable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const Droppable = ({
  options,
  rect,
  onBodyRun,
}: {
  options: UseDroppableOptions
  rect: Rect
  onBodyRun?: () => void
}) => {
  onBodyRun?.()
  const { setNodeRef, isOver } = useDroppable(options)
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`droppable-${options.id}`}
      data-over={isOver}
    />
  )
}

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

/** Renders a draggable plus the given droppables and hands the test the store. */
const renderScene = (children: React.ReactNode) => {
  let store: DragStore | null = null
  const view = render(
    <DndProvider>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Draggable id="item" rect={rectAt(0, 0)} />
      {children}
    </DndProvider>,
  )
  return { view, getStore: () => store as unknown as DragStore }
}

describe('registration', () => {
  it('registers without notifying, and becomes a collision candidate', () => {
    const listener = vi.fn()
    let store: DragStore | null = null
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
            readyStore.subscribe(listener)
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        <Droppable options={{ id: 'slot' }} rect={rectAt(0, 100)} />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore

    expect(listener).not.toHaveBeenCalled()
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })
    expect(readyStore.getState().overId).toBe('slot')
  })

  it('unregisters on unmount, leaving no dangling candidate', () => {
    let store: DragStore | null = null
    const Host = ({ mounted }: { mounted: boolean }) => (
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        {mounted ? <Droppable options={{ id: 'slot' }} rect={rectAt(0, 100)} /> : null}
      </DndProvider>
    )
    const view = render(<Host mounted />)

    view.rerender(<Host mounted={false} />)
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(readyStore.getState().overId).toBeNull()
  })

  it('registers exactly once under StrictMode', () => {
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
          <Droppable options={{ id: 'slot', data: { column: 2 } }} rect={rectAt(0, 100)} />
        </DndProvider>
      </StrictMode>,
    )
    const readyStore = store as unknown as DragStore
    const onDragCancel = vi.fn()
    readyStore.addMonitor({ onDragCancel })

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(onDragCancel).not.toHaveBeenCalled()
    expect(readyStore.getState().overId).toBe('slot')
  })
})

describe('isOver granularity — perf invariant 4', () => {
  it('re-renders only the two droppables whose isOver flipped, and none of the others', () => {
    const runs = { first: 0, second: 0, third: 0 }
    let store: DragStore | null = null
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        <Droppable
          options={{ id: 'first' }}
          rect={rectAt(0, 0)}
          onBodyRun={() => {
            runs.first += 1
          }}
        />
        <Droppable
          options={{ id: 'second' }}
          rect={rectAt(0, 400)}
          onBodyRun={() => {
            runs.second += 1
          }}
        />
        <Droppable
          options={{ id: 'third' }}
          rect={rectAt(0, 4000)}
          onBodyRun={() => {
            runs.third += 1
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    let session: DragSession | null = null
    act(() => {
      session = readyStore.beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    const afterStart = { ...runs }

    act(() => {
      ;(session as unknown as DragSession).move({ x: 0, y: 390 })
    })

    expect(runs.first).toBe(afterStart.first + 1)
    expect(runs.second).toBe(afterStart.second + 1)
    expect(runs.third).toBe(afterStart.third)
  })

  it('does not re-render anything for moves that stay inside the same target', () => {
    const runs = { first: 0, second: 0 }
    let store: DragStore | null = null
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        <Droppable
          options={{ id: 'first' }}
          rect={rectAt(0, 0)}
          onBodyRun={() => {
            runs.first += 1
          }}
        />
        <Droppable
          options={{ id: 'second' }}
          rect={rectAt(0, 4000)}
          onBodyRun={() => {
            runs.second += 1
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    let session: DragSession | null = null
    act(() => {
      session = readyStore.beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    const afterStart = { ...runs }

    for (let step = 1; step <= 15; step += 1) {
      act(() => {
        ;(session as unknown as DragSession).move({ x: 0, y: step })
      })
    }

    expect(runs).toEqual(afterStart)
  })

  it('reports isOver to the element', () => {
    const { view, getStore } = renderScene(
      <Droppable options={{ id: 'slot' }} rect={rectAt(0, 10)} />,
    )
    act(() => {
      getStore().beginDrag('item', { pointer: null })
    })

    expect(view.getByTestId('droppable-slot').dataset.over).toBe('true')
  })
})

describe('data', () => {
  it('reaches the over payload of a drag event unchanged', () => {
    let store: DragStore | null = null
    const onDragEnd = vi.fn()
    render(
      <DndProvider onDragEnd={onDragEnd}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable id="item" rect={rectAt(0, 0)} />
        <Droppable
          options={{ id: 'slot', data: { column: 3, title: 'Done' } }}
          rect={rectAt(0, 10)}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore

    act(() => {
      readyStore.beginDrag('item', { pointer: null })?.end()
    })

    expect(onDragEnd.mock.calls[0]?.[0].over.data).toEqual({ column: 3, title: 'Done' })
  })
})

describe('disabled', () => {
  it('is never selected by collision, even when it is the nearest', () => {
    const { getStore } = renderScene(
      <>
        <Droppable options={{ id: 'disabled', disabled: true }} rect={rectAt(0, 10)} />
        <Droppable options={{ id: 'enabled' }} rect={rectAt(0, 900)} />
      </>,
    )

    act(() => {
      getStore().beginDrag('item', { pointer: null })
    })

    expect(getStore().getState().overId).toBe('enabled')
  })

  it('becomes eligible again when it stops being disabled', () => {
    let store: DragStore | null = null
    let enable: (() => void) | null = null
    const Host = () => {
      const [disabled, setDisabled] = useState(true)
      enable = () => setDisabled(false)
      return (
        <DndProvider>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          <Droppable options={{ id: 'near', disabled }} rect={rectAt(0, 10)} />
          <Droppable options={{ id: 'far' }} rect={rectAt(0, 900)} />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore

    act(() => {
      enable?.()
    })
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(readyStore.getState().overId).toBe('near')
  })
})

describe('mounting and unmounting during a drag — ANALYSIS.md A6', () => {
  it('measures a droppable that appears mid-drag and lets it win, without cancelling', () => {
    let store: DragStore | null = null
    let addLazyRow: (() => void) | null = null
    const onDragCancel = vi.fn()
    const Host = () => {
      const [lazyRowLoaded, setLazyRowLoaded] = useState(false)
      addLazyRow = () => setLazyRowLoaded(true)
      return (
        <DndProvider onDragCancel={onDragCancel}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          <Droppable options={{ id: 'far' }} rect={rectAt(0, 900)} />
          {lazyRowLoaded ? <Droppable options={{ id: 'lazy' }} rect={rectAt(0, 10)} /> : null}
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })
    expect(readyStore.getState().overId).toBe('far')

    act(() => {
      addLazyRow?.()
    })

    expect(onDragCancel).not.toHaveBeenCalled()
    expect(readyStore.getState().overId).toBe('lazy')
  })

  it('re-measures the rows that stayed, not only the one that arrived', () => {
    // The geometry consequence is the one that matters: an insertion shifts every rect below
    // it, so `over` has to be recomputed against re-measured rects rather than merely having a
    // new candidate added to a stale cache.
    let store: DragStore | null = null
    let insertRowAndShift: (() => void) | null = null
    const Host = () => {
      const [inserted, setInserted] = useState(false)
      const [shiftedRect, setShiftedRect] = useState(rectAt(0, 900))
      insertRowAndShift = () => {
        setShiftedRect(rectAt(0, 9000))
        setInserted(true)
      }
      return (
        <DndProvider>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          <Droppable options={{ id: 'shifted' }} rect={shiftedRect} />
          {inserted ? <Droppable options={{ id: 'inserted' }} rect={rectAt(0, 5000)} /> : null}
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })
    expect(readyStore.getState().overId).toBe('shifted')

    // The insertion pushes 'shifted' out of reach. Only a re-measure of the *existing* row can
    // see that; adding the new candidate to a stale cache would leave 'shifted' winning.
    act(() => {
      insertRowAndShift?.()
    })

    expect(readyStore.getState().overId).toBe('inserted')
  })

  it('cancels with item-removed when a droppable unmounts mid-drag, leaving over null', () => {
    let store: DragStore | null = null
    let removeRow: (() => void) | null = null
    const onDragCancel = vi.fn()
    const Host = () => {
      const [present, setPresent] = useState(true)
      removeRow = () => setPresent(false)
      return (
        <DndProvider onDragCancel={onDragCancel}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable id="item" rect={rectAt(0, 0)} />
          {present ? <Droppable options={{ id: 'slot' }} rect={rectAt(0, 10)} /> : null}
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    act(() => {
      removeRow?.()
    })

    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
    expect(readyStore.getState().overId).toBeNull()
  })
})
