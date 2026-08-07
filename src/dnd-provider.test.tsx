import { act, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect, nextFrame } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { DRAG_CANCEL_REASONS, type DragSession, type Rect, type Sensor } from './types.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const nodeAt = (rect: Rect): HTMLElement => {
  const element = document.createElement('div')
  mockElementRect(element, rect)
  document.body.append(element)
  return element
}

/**
 * Reaches the store the provider created and hands it to the test.
 *
 * `useDraggable` does not exist yet (T4.2), and the pointer sensor does not exist yet (T5.1),
 * so a drag is driven through the store the provider owns. T4.5 and T9.1 drive the same flows
 * through the fully public API once both are in place.
 */
const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  const { store } = useDndContext('StoreProbe')
  onReady(store)
  return null
}

const renderProviderAndDrag = (children: React.ReactNode = null) => {
  let store: DragStore | null = null
  const view = render(
    <DndProvider>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      {children}
    </DndProvider>,
  )
  return { view, getStore: () => store as unknown as DragStore }
}

describe('the store instance', () => {
  it('is created once and survives re-renders', () => {
    const seen: DragStore[] = []
    let forceRender: (() => void) | null = null
    const Host = () => {
      const [, setTick] = useState(0)
      forceRender = () => setTick((tick) => tick + 1)
      return (
        <DndProvider>
          <StoreProbe onReady={(store) => seen.push(store)} />
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

  it('is created once under StrictMode, not twice', () => {
    const seen: DragStore[] = []

    render(
      <StrictMode>
        <DndProvider>
          <StoreProbe onReady={(store) => seen.push(store)} />
        </DndProvider>
      </StrictMode>,
    )

    expect(new Set(seen).size).toBe(1)
  })

  it('gives nested providers separate stores', () => {
    const seen: DragStore[] = []

    render(
      <DndProvider>
        <StoreProbe onReady={(store) => seen.push(store)} />
        <DndProvider>
          <StoreProbe onReady={(store) => seen.push(store)} />
        </DndProvider>
      </DndProvider>,
    )

    expect(new Set(seen).size).toBe(2)
  })
})

describe('the provider does not re-render during a drag — perf invariant 4', () => {
  it('renders once for the whole of a drag', () => {
    // Counted in the body of a component rendered *inside* the provider, which is what would
    // re-render if the provider did. Nothing re-renders it from above during this test, so the
    // body count is unambiguous.
    let subtreeRuns = 0
    let store: DragStore | null = null
    const Subtree = () => {
      subtreeRuns += 1
      return null
    }
    render(
      <DndProvider>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Subtree />
      </DndProvider>,
    )
    const runsAfterMount = subtreeRuns
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))
    readyStore.registerDroppable('slot', nodeAt(rectAt(0, 100)))

    act(() => {
      const session = readyStore.beginDrag('item', { pointer: { x: 0, y: 0 } })
      for (let step = 1; step <= 20; step += 1) session?.move({ x: 0, y: step })
      session?.end()
    })

    expect(subtreeRuns).toBe(runsAfterMount)
  })
})

describe('drag callbacks', () => {
  it('forwards start, move, over, and end in order with their payloads', () => {
    const order: string[] = []
    let store: DragStore | null = null
    render(
      <DndProvider
        onDragStart={() => order.push('start')}
        onDragMove={() => order.push('move')}
        onDragOver={() => order.push('over')}
        onDragEnd={() => order.push('end')}
      >
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))
    readyStore.registerDroppable('first', nodeAt(rectAt(0, 0)))
    readyStore.registerDroppable('second', nodeAt(rectAt(0, 400)))

    act(() => {
      const session = readyStore.beginDrag('item', { pointer: { x: 0, y: 0 } })
      session?.move({ x: 0, y: 390 })
      session?.end()
    })

    expect(order).toEqual(['start', 'move', 'over', 'end'])
  })

  it('reports every DragCancelReason distinctly, not all of them as escape', async () => {
    const reasons: string[] = []
    let store: DragStore | null = null
    render(
      <DndProvider onDragCancel={(event) => reasons.push(event.reason)}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    const draggableNode = nodeAt(rectAt(0, 0))
    readyStore.registerDraggable('item', draggableNode)

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.escape)

      readyStore.beginDrag('item', { pointer: null })
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.blur)

      readyStore.beginDrag('item', { pointer: null })
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.pointerCancelled)
    })

    // The fourth is not a call anyone makes — it is the library reacting to a node vanishing,
    // which it confirms at the end of the task rather than the instant the entry goes.
    await act(async () => {
      readyStore.beginDrag('item', { pointer: null })
      readyStore.unregisterDraggable('item')
    })

    expect(reasons).toEqual(['escape', 'blur', 'pointer-cancelled', 'item-removed'])
  })

  it('does not fire onDragEnd when a drag is cancelled', () => {
    const onDragEnd = vi.fn()
    let store: DragStore | null = null
    render(
      <DndProvider onDragEnd={onDragEnd}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.escape)
    })

    expect(onDragEnd).not.toHaveBeenCalled()
  })
})

describe('latest-props sync', () => {
  it('calls the handler the consumer passed most recently, not the one from drag start', () => {
    const original = vi.fn()
    const replacement = vi.fn()
    let store: DragStore | null = null
    let swapHandler: (() => void) | null = null
    const Host = () => {
      const [onDragEnd, setOnDragEnd] = useState(() => original)
      swapHandler = () => setOnDragEnd(() => replacement)
      return (
        <DndProvider onDragEnd={onDragEnd}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))

    let session: DragSession | null = null
    act(() => {
      session = readyStore.beginDrag('item', { pointer: null })
    })
    act(() => {
      swapHandler?.()
    })
    act(() => {
      ;(session as unknown as DragSession).end()
    })

    expect(original).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledTimes(1)
  })

  it('swapping a handler mid-drag does not tear the drag down', () => {
    let store: DragStore | null = null
    let swapHandler: (() => void) | null = null
    const onDragCancel = vi.fn()
    const Host = () => {
      const [onDragMove, setOnDragMove] = useState(() => () => {})
      swapHandler = () => setOnDragMove(() => () => {})
      return (
        <DndProvider onDragMove={onDragMove} onDragCancel={onDragCancel}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })
    act(() => {
      swapHandler?.()
    })

    expect(onDragCancel).not.toHaveBeenCalled()
    expect(readyStore.getState().origin?.id).toBe('item')
  })

  it('registers exactly one monitor under StrictMode, so callbacks do not double-fire', () => {
    const onDragStart = vi.fn()
    let store: DragStore | null = null
    render(
      <StrictMode>
        <DndProvider onDragStart={onDragStart}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
        </DndProvider>
      </StrictMode>,
    )
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(onDragStart).toHaveBeenCalledTimes(1)
  })
})

describe('collision detection', () => {
  it('defaults to closestCenter', () => {
    const { getStore } = renderProviderAndDrag()
    const store = getStore()
    store.registerDraggable('item', nodeAt(rectAt(0, 0)))
    store.registerDroppable('near', nodeAt(rectAt(0, 10)))
    store.registerDroppable('far', nodeAt(rectAt(0, 900)))

    act(() => {
      store.beginDrag('item', { pointer: null })
    })

    expect(store.getState().overId).toBe('near')
  })

  it('honours a replacement passed as a prop, and a later replacement without a remount', () => {
    const alwaysFirst = vi.fn(({ droppables }) => droppables[0]?.id ?? null)
    const alwaysLast = vi.fn(({ droppables }) => droppables.at(-1)?.id ?? null)
    let store: DragStore | null = null
    let useLast: (() => void) | null = null
    const Host = () => {
      const [collisionDetection, setCollisionDetection] = useState(() => alwaysFirst)
      useLast = () => setCollisionDetection(() => alwaysLast)
      return (
        <DndProvider collisionDetection={collisionDetection}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
        </DndProvider>
      )
    }
    render(<Host />)
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))
    readyStore.registerDroppable('first', nodeAt(rectAt(0, 10)))
    readyStore.registerDroppable('last', nodeAt(rectAt(0, 900)))

    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })
    expect(readyStore.getState().overId).toBe('first')

    act(() => {
      readyStore.cancelActiveDrag(DRAG_CANCEL_REASONS.escape)
      useLast?.()
    })
    act(() => {
      readyStore.beginDrag('item', { pointer: null })
    })

    expect(readyStore.getState().overId).toBe('last')
  })
})

describe('the hidden instructions element — accessibility invariant 3', () => {
  it('is rendered, carries the default text, and is reachable by id', () => {
    let instructionsId: string | null = null
    const IdProbe = () => {
      instructionsId = useDndContext('IdProbe').instructionsId
      return null
    }
    render(
      <DndProvider>
        <IdProbe />
      </DndProvider>,
    )

    const element = document.getElementById(instructionsId as unknown as string)
    expect(element).not.toBeNull()
    expect(element?.textContent?.length).toBeGreaterThan(0)
  })

  it('is visually hidden but not display:none — assistive tech must still reach it', () => {
    let instructionsId: string | null = null
    const IdProbe = () => {
      instructionsId = useDndContext('IdProbe').instructionsId
      return null
    }
    render(
      <DndProvider>
        <IdProbe />
      </DndProvider>,
    )
    const element = document.getElementById(instructionsId as unknown as string)

    expect(element?.style.display).not.toBe('none')
    expect(element?.hasAttribute('hidden')).toBe(false)
    expect(element?.style.position).toBe('fixed')
  })

  it('takes an override from the accessibility prop', () => {
    let instructionsId: string | null = null
    const IdProbe = () => {
      instructionsId = useDndContext('IdProbe').instructionsId
      return null
    }
    render(
      <DndProvider accessibility={{ instructions: 'Custom pickup instructions.' }}>
        <IdProbe />
      </DndProvider>,
    )

    expect(document.getElementById(instructionsId as unknown as string)?.textContent).toBe(
      'Custom pickup instructions.',
    )
  })

  it('gives two providers different ids, so aria-describedby never crosses them', () => {
    const ids: string[] = []
    const IdProbe = () => {
      ids.push(useDndContext('IdProbe').instructionsId)
      return null
    }

    render(
      <>
        <DndProvider>
          <IdProbe />
        </DndProvider>
        <DndProvider>
          <IdProbe />
        </DndProvider>
      </>,
    )

    expect(new Set(ids).size).toBe(2)
  })
})

describe('the sensors prop', () => {
  it('reaches the context, where useDraggable builds its handle props from it', () => {
    const testSensor: Sensor = { name: 'test', activate: () => ({}) }
    let seenSensors: readonly Sensor[] = []
    const SensorProbe = () => {
      seenSensors = useDndContext('SensorProbe').sensors
      return null
    }

    render(
      <DndProvider sensors={[testSensor]}>
        <SensorProbe />
      </DndProvider>,
    )

    expect(seenSensors).toEqual([testSensor])
  })

  it('lets a sensor start a real drag through the context it is handed', () => {
    let store: DragStore | null = null
    let startDrag: (() => DragSession | null) | null = null
    const activatingSensor: Sensor = {
      name: 'activating',
      activate: (context) => {
        startDrag = () => context.beginDrag({ pointer: { x: 0, y: 0 } })
        return {}
      },
    }
    const SensorRunner = () => {
      const { sensors, store: contextStore } = useDndContext('SensorRunner')
      store = contextStore
      for (const sensor of sensors) {
        sensor.activate({
          draggableId: 'item',
          beginDrag: (init) => contextStore.beginDrag('item', init),
        })
      }
      return null
    }
    render(
      <DndProvider sensors={[activatingSensor]}>
        <SensorRunner />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    readyStore.registerDraggable('item', nodeAt(rectAt(0, 0)))

    let session: DragSession | null = null
    act(() => {
      session = startDrag?.() ?? null
    })

    expect(session).not.toBeNull()
    expect(readyStore.getState().origin?.id).toBe('item')
  })
})

describe('the autoScroll prop', () => {
  it('runs the scroll loop by default and not when switched off', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })

    const buildScene = (autoScroll: boolean) => {
      const container = document.createElement('div')
      container.style.overflow = 'auto'
      mockElementRect(container, rectAt(0, 0, 400, 400))
      for (const [property, value] of [
        ['clientHeight', 400],
        ['clientWidth', 400],
        ['scrollHeight', 4000],
        ['scrollWidth', 400],
      ] as const) {
        Object.defineProperty(container, property, { value, configurable: true })
      }
      Object.defineProperty(container, 'scrollTop', {
        value: 0,
        writable: true,
        configurable: true,
      })
      document.body.append(container)

      let store: DragStore | null = null
      render(
        <DndProvider autoScroll={autoScroll}>
          <StoreProbe
            onReady={(readyStore) => {
              store = readyStore
            }}
          />
        </DndProvider>,
      )
      const item = nodeAt(rectAt(0, 0))
      container.append(item)
      ;(store as unknown as DragStore).registerDraggable('item', item)
      return { container, store: store as unknown as DragStore }
    }

    const enabled = buildScene(true)
    act(() => {
      enabled.store.beginDrag('item', { pointer: { x: 200, y: 395 } })
    })
    await act(async () => {
      await nextFrame()
      await nextFrame()
    })
    expect(enabled.container.scrollTop).toBeGreaterThan(0)

    const disabled = buildScene(false)
    act(() => {
      disabled.store.beginDrag('item', { pointer: { x: 200, y: 395 } })
    })
    await act(async () => {
      await nextFrame()
      await nextFrame()
    })
    expect(disabled.container.scrollTop).toBe(0)

    vi.useRealTimers()
  })
})
