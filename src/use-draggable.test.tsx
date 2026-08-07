import { act, fireEvent, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import type { DragSession, Rect, Sensor, SensorContext } from './types.js'
import { type UseDraggableOptions, useDraggable } from './use-draggable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

/** A sensor that starts a drag on pointerdown and hands the session back to the test. */
const createTestSensor = (name = 'test') => {
  const sessions: (DragSession | null)[] = []
  const seenContexts: SensorContext[] = []
  const sensor: Sensor = {
    name,
    activate: (context) => {
      seenContexts.push(context)
      return {
        onPointerDown: () => {
          sessions.push(context.beginDrag({ pointer: { x: 0, y: 0 } }))
        },
      }
    },
  }
  return { sensor, sessions, seenContexts, latestSession: () => sessions.at(-1) ?? null }
}

const Draggable = ({
  options,
  onBodyRun,
  rect = rectAt(0, 0),
}: {
  options: UseDraggableOptions
  onBodyRun?: () => void
  rect?: Rect
}) => {
  onBodyRun?.()
  const { setNodeRef, handleProps, isDragging, transform } = useDraggable(options)
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`draggable-${options.id}`}
      data-dragging={isDragging}
      data-transform={transform ? `${transform.x},${transform.y}` : 'none'}
      {...handleProps}
    >
      item
    </div>
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

describe('registration', () => {
  it('registers on mount without notifying any subscriber — perf invariant 5', () => {
    const listener = vi.fn()
    let store: DragStore | null = null
    const view = render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
            readyStore.subscribe(listener)
          }}
        />
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )

    expect(view.getByTestId('draggable-item')).toBeDefined()
    expect(listener).not.toHaveBeenCalled()
    expect((store as unknown as DragStore).beginDrag('item', { pointer: null })).not.toBeNull()
  })

  it('leaves exactly one registration under StrictMode, not two', () => {
    let store: DragStore | null = null
    render(
      <StrictMode>
        <DndProvider>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable options={{ id: 'item', data: { index: 0 } }} />
        </DndProvider>
      </StrictMode>,
    )
    const readyStore = store as unknown as DragStore

    const onDragCancel = vi.fn()
    readyStore.addMonitor({ onDragCancel })
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    // A second registration would mean a second cleanup is still pending; that cleanup firing
    // mid-drag would cancel it under the A6 policy.
    expect(onDragCancel).not.toHaveBeenCalled()
    expect(readyStore.getState().origin?.data).toEqual({ index: 0 })
  })

  it('unregisters on unmount, so a later drag on that id cannot start', () => {
    let store: DragStore | null = null
    const Host = ({ mounted }: { mounted: boolean }) => (
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        {mounted ? <Draggable options={{ id: 'item' }} /> : null}
      </DndProvider>
    )
    const view = render(<Host mounted />)

    view.rerender(<Host mounted={false} />)

    expect((store as unknown as DragStore).beginDrag('item', { pointer: null })).toBeNull()
  })

  it('survives a parent re-render passing a fresh inline data object — ANALYSIS.md A9.4', () => {
    // This is the bug that decided ref-callback registration over effect registration. With
    // `data` in an effect's dependency array, an ordinary `data={{ index }}` re-render during a
    // drag unregisters and re-registers, and under the A6 policy that cancels the drag.
    let store: DragStore | null = null
    let forceRender: (() => void) | null = null
    const onDragCancel = vi.fn()
    const Host = () => {
      const [tick, setTick] = useState(0)
      forceRender = () => setTick((current) => current + 1)
      return (
        <DndProvider onDragCancel={onDragCancel}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
          <Draggable options={{ id: 'item', data: { tick } }} />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    act(() => {
      forceRender?.()
    })

    expect(onDragCancel).not.toHaveBeenCalled()
    expect(readyStore.getState().origin?.id).toBe('item')
  })

  it('keeps the consumer data across a node swap', () => {
    let store: DragStore | null = null
    const Host = ({ tag }: { tag: 'div' | 'section' }) => {
      const { setNodeRef } = useDraggable({ id: 'item', data: { kind: 'card' } })
      return tag === 'div' ? <div ref={setNodeRef} /> : <section ref={setNodeRef} />
    }
    const view = render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Host tag="div" />
      </DndProvider>,
    )

    view.rerender(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Host tag="section" />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(readyStore.getState().origin?.data).toEqual({ kind: 'card' })
  })
})

describe('selector granularity — perf invariant 4', () => {
  it('re-renders on start and end only when the consumer is not tracking the transform', () => {
    const { sensor, latestSession } = createTestSensor()
    let bodyRuns = 0
    const sensors = [sensor]
    render(
      <DndProvider sensors={sensors}>
        <Draggable
          options={{ id: 'item', trackTransform: false }}
          onBodyRun={() => {
            bodyRuns += 1
          }}
        />
      </DndProvider>,
    )
    const runsAfterMount = bodyRuns

    fireEvent.pointerDown(document.querySelector('[data-testid="draggable-item"]') as Element)
    const runsAfterStart = bodyRuns
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        latestSession()?.move({ x: 0, y: step })
      })
    }
    const runsAfterMoves = bodyRuns
    act(() => {
      latestSession()?.end()
    })

    expect(runsAfterStart).toBe(runsAfterMount + 1)
    expect(runsAfterMoves).toBe(runsAfterStart)
    expect(bodyRuns).toBe(runsAfterStart + 1)
  })

  it('re-renders per move when the consumer does track the transform', () => {
    const { sensor, latestSession } = createTestSensor()
    let bodyRuns = 0
    const sensors = [sensor]
    render(
      <DndProvider sensors={sensors}>
        <Draggable
          options={{ id: 'item' }}
          onBodyRun={() => {
            bodyRuns += 1
          }}
        />
      </DndProvider>,
    )
    fireEvent.pointerDown(document.querySelector('[data-testid="draggable-item"]') as Element)
    const runsAfterStart = bodyRuns

    // One act per move: each pointermove is its own discrete event in a browser, and batching
    // five of them into one act would coalesce five renders into one and quietly pass.
    for (let step = 1; step <= 5; step += 1) {
      act(() => {
        latestSession()?.move({ x: 0, y: step })
      })
    }

    expect(bodyRuns).toBe(runsAfterStart + 5)
  })

  it('leaves every other draggable alone while one is dragged', () => {
    const { sensor, latestSession } = createTestSensor()
    let bystanderRuns = 0
    const sensors = [sensor]
    render(
      <DndProvider sensors={sensors}>
        <Draggable options={{ id: 'dragged' }} />
        <Draggable
          options={{ id: 'bystander' }}
          rect={rectAt(0, 200)}
          onBodyRun={() => {
            bystanderRuns += 1
          }}
        />
      </DndProvider>,
    )
    const runsAfterMount = bystanderRuns

    fireEvent.pointerDown(document.querySelector('[data-testid="draggable-dragged"]') as Element)
    for (let step = 1; step <= 10; step += 1) {
      act(() => {
        latestSession()?.move({ x: 0, y: step })
      })
    }
    act(() => {
      latestSession()?.end()
    })

    expect(bystanderRuns).toBe(runsAfterMount)
  })

  it('reports isDragging and the live transform to the element', () => {
    const { sensor, latestSession } = createTestSensor()
    const sensors = [sensor]
    const view = render(
      <DndProvider sensors={sensors}>
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )
    const element = view.getByTestId('draggable-item')

    fireEvent.pointerDown(element)
    act(() => {
      latestSession()?.move({ x: 3, y: 9 })
    })

    expect(element.dataset.dragging).toBe('true')
    expect(element.dataset.transform).toBe('3,9')
  })
})

describe('handleProps', () => {
  it('carries the accessibility attributes every handle needs — invariant 3', () => {
    const view = render(
      <DndProvider>
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )
    const element = view.getByTestId('draggable-item')

    expect(element.getAttribute('role')).toBe('button')
    expect(element.getAttribute('tabindex')).toBe('0')
    expect(element.getAttribute('aria-roledescription')).toBe('draggable')
    expect(element.getAttribute('draggable')).toBe('false')
    expect(element.style.touchAction).toBe('none')
  })

  it('points aria-describedby at the provider instructions element that exists', () => {
    const view = render(
      <DndProvider>
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )
    const describedBy = view.getByTestId('draggable-item').getAttribute('aria-describedby')

    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)?.textContent?.length).toBeGreaterThan(0)
  })

  it('merges the activators of every configured sensor — adding one must not drop another', () => {
    const first = createTestSensor('first')
    const secondPointerDown = vi.fn()
    const second: Sensor = {
      name: 'second',
      activate: () => ({ onPointerDown: secondPointerDown }),
    }
    const sensors = [first.sensor, second]
    const view = render(
      <DndProvider sensors={sensors}>
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )

    fireEvent.pointerDown(view.getByTestId('draggable-item'))

    expect(first.sessions).toHaveLength(1)
    expect(secondPointerDown).toHaveBeenCalledTimes(1)
  })

  it("fires the consumer's own activator alongside the sensors', not instead of them", () => {
    const { sensor, sessions } = createTestSensor()
    const consumerPointerDown = vi.fn()
    const sensors = [sensor]
    const view = render(
      <DndProvider sensors={sensors}>
        <Draggable
          options={{ id: 'item', activatorProps: { onPointerDown: consumerPointerDown } }}
        />
      </DndProvider>,
    )

    fireEvent.pointerDown(view.getByTestId('draggable-item'))

    expect(sessions).toHaveLength(1)
    expect(consumerPointerDown).toHaveBeenCalledTimes(1)
  })

  it('tells each sensor which draggable it is activating for', () => {
    const { sensor, seenContexts } = createTestSensor()
    const sensors = [sensor]
    render(
      <DndProvider sensors={sensors}>
        <Draggable options={{ id: 'first' }} />
        <Draggable options={{ id: 'second' }} rect={rectAt(0, 200)} />
      </DndProvider>,
    )

    expect(seenContexts.map((context) => context.draggableId)).toEqual(['first', 'second'])
  })
})

describe('disabled — accessibility invariant 4', () => {
  it('keeps aria-disabled so the semantics survive', () => {
    const view = render(
      <DndProvider>
        <Draggable options={{ id: 'item', disabled: true }} />
      </DndProvider>,
    )

    expect(view.getByTestId('draggable-item').getAttribute('aria-disabled')).toBe('true')
    expect(view.getByTestId('draggable-item').getAttribute('role')).toBe('button')
  })

  it('has no activation listeners at all, so a pointerdown starts nothing', () => {
    const { sensor, sessions } = createTestSensor()
    const sensors = [sensor]
    const view = render(
      <DndProvider sensors={sensors}>
        <Draggable options={{ id: 'item', disabled: true }} />
      </DndProvider>,
    )

    fireEvent.pointerDown(view.getByTestId('draggable-item'))

    expect(sessions).toHaveLength(0)
  })

  it('refuses to start even if something calls beginDrag directly', () => {
    let store: DragStore | null = null
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Draggable options={{ id: 'item', disabled: true }} />
      </DndProvider>,
    )

    expect((store as unknown as DragStore).beginDrag('item', { pointer: null })).toBeNull()
  })

  it('omits aria-disabled entirely when the draggable is enabled', () => {
    const view = render(
      <DndProvider>
        <Draggable options={{ id: 'item' }} />
      </DndProvider>,
    )

    expect(view.getByTestId('draggable-item').hasAttribute('aria-disabled')).toBe(false)
  })
})
