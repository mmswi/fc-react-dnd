import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { type PointerSensorOptions, pointerSensor } from './pointer-sensor.js'
import { type DndMonitorListeners, DRAG_CANCEL_REASONS, type Rect } from './types.js'
import { useDraggable } from './use-draggable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

/**
 * Counts window and document listeners by balance, so "nothing survived the drag" is a number
 * rather than a hope. Installed per test and restored afterwards.
 */
const trackGlobalListeners = () => {
  // Tracked as (type, function) pairs rather than per-type counts: teardown removes every
  // listener type unconditionally, and removing one that was never added is a no-op in the DOM
  // — a counter would go negative on it and read as a leak.
  const live: { type: string; listener: unknown }[] = []
  // A permanent log of every registration, so passivity can be asserted after the fact.
  const registrations: { type: string; passive: unknown }[] = []
  const targets = [window, document] as const
  const originals = targets.map((target) => ({
    target,
    add: target.addEventListener.bind(target),
    remove: target.removeEventListener.bind(target),
  }))

  for (const { target, add, remove } of originals) {
    // Cast once, at the assignment: the DOM's overloaded signature cannot be satisfied by a
    // single implementation, and narrowing the parameters instead pushes `never` into the body.
    target.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      live.push({ type, listener })
      const isOptionsObject = typeof options === 'object'
      registrations.push({ type, passive: isOptionsObject ? options.passive : undefined })
      add(type, listener, options)
    }) as typeof target.addEventListener

    target.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      const index = live.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index !== -1) live.splice(index, 1)
      remove(type, listener, options)
    }) as typeof target.removeEventListener
  }

  return {
    countOf: (type: string) => live.filter((entry) => entry.type === type).length,
    total: () => live.length,
    registrationsOf: (type: string) => registrations.filter((entry) => entry.type === type),
    restore: () => {
      for (const { target, add, remove } of originals) {
        target.addEventListener = add
        target.removeEventListener = remove
      }
    },
  }
}

const Draggable = ({ id, rect }: { id: string; rect: Rect }) => {
  const { setNodeRef, handleProps } = useDraggable({ id })
  return (
    <button
      type="button"
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`handle-${id}`}
      {...handleProps}
    >
      {id}
    </button>
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

const renderScene = (options: PointerSensorOptions = {}, monitor: DndMonitorListeners = {}) => {
  let store: DragStore | null = null
  const sensors = [pointerSensor(options)]
  const view = render(
    <DndProvider sensors={sensors} {...monitor}>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Draggable id="item" rect={rectAt(0, 0)} />
      <div
        ref={(node) => {
          if (node) mockElementRect(node, rectAt(0, 100))
        }}
      />
    </DndProvider>,
  )
  return {
    view,
    getStore: () => store as unknown as DragStore,
    handle: () => view.getByTestId('handle-item'),
    isDragging: () => (store as unknown as DragStore).getState().origin !== null,
  }
}

const pressAt = (element: Element, x: number, y: number, pointerId = 1) => {
  fireEvent.pointerDown(element, { pointerId, clientX: x, clientY: y, button: 0, isPrimary: true })
}

const moveTo = (x: number, y: number, pointerId = 1) => {
  act(() => {
    fireEvent.pointerMove(document, { pointerId, clientX: x, clientY: y })
  })
}

const release = (x: number, y: number, pointerId = 1) => {
  act(() => {
    fireEvent.pointerUp(document, { pointerId, clientX: x, clientY: y })
  })
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0))

let listeners: ReturnType<typeof trackGlobalListeners>

beforeEach(() => {
  listeners = trackGlobalListeners()
})

afterEach(() => {
  listeners.restore()
  vi.useRealTimers()
})

describe('activation by distance', () => {
  it('starts nothing for a press that moves less than the threshold', () => {
    const scene = renderScene({ activationDistancePx: 8 })

    pressAt(scene.handle(), 0, 0)
    moveTo(3, 3)

    expect(scene.isDragging()).toBe(false)
  })

  it('starts exactly one drag when the threshold is crossed', () => {
    const onDragStart = vi.fn()
    const scene = renderScene({ activationDistancePx: 8 }, { onDragStart })

    pressAt(scene.handle(), 0, 0)
    moveTo(20, 0)
    moveTo(30, 0)

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(scene.isDragging()).toBe(true)
  })

  it('reports the translate measured from where the press started', () => {
    const onDragMove = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 }, { onDragMove })

    pressAt(scene.handle(), 100, 50)
    moveTo(130, 70)

    expect(onDragMove.mock.calls.at(-1)?.[0].translate).toEqual({ x: 30, y: 20 })
  })

  it('ignores a press with a non-primary mouse button', () => {
    const scene = renderScene({ activationDistancePx: 1 })

    fireEvent.pointerDown(scene.handle(), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 2,
      isPrimary: true,
    })
    moveTo(50, 50)

    expect(scene.isDragging()).toBe(false)
  })
})

describe('activation by delay and tolerance', () => {
  it('activates once the delay elapses without the pointer straying', () => {
    vi.useFakeTimers()
    const scene = renderScene({ activationDelayMs: 200, activationTolerancePx: 5 })

    pressAt(scene.handle(), 0, 0)
    moveTo(2, 2)
    expect(scene.isDragging()).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(scene.isDragging()).toBe(true)
  })

  it('aborts instead of activating when the pointer strays past the tolerance first', () => {
    vi.useFakeTimers()
    const scene = renderScene({ activationDelayMs: 200, activationTolerancePx: 5 })

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(scene.isDragging()).toBe(false)
  })

  it('leaves no listener behind after aborting', () => {
    vi.useFakeTimers()
    const scene = renderScene({ activationDelayMs: 200, activationTolerancePx: 5 })
    const before = listeners.total()

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)

    expect(listeners.total()).toBe(before)
  })
})

describe('ending a drag', () => {
  it('ends on pointerup', () => {
    const onDragEnd = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 }, { onDragEnd })

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    release(50, 0)

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(scene.isDragging()).toBe(false)
  })

  it('cancels on Escape with reason escape, and does not fire onDragEnd', () => {
    const onDragCancel = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 }, { onDragCancel, onDragEnd })

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.escape)
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('cancels on pointercancel with its own reason — the browser taking the drag away', () => {
    // Unhandled, this is the leak: activeId stays set, the document listeners stay bound, and
    // the overlay stays on screen until the page reloads. On touch it is not an edge case.
    const onDragCancel = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 }, { onDragCancel })

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    act(() => {
      fireEvent.pointerCancel(document, { pointerId: 1 })
    })

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.pointerCancelled)
    expect(scene.isDragging()).toBe(false)
  })
})

describe('teardown — perf invariant 7', () => {
  it('leaves no listener behind after a completed drag', async () => {
    const scene = renderScene({ activationDistancePx: 4 })
    const before = listeners.total()

    pressAt(scene.handle(), 0, 0)
    expect(listeners.total()).toBeGreaterThan(before)
    moveTo(50, 0)
    release(50, 0)
    // The click swallower is the one listener that deliberately outlives the drag, by exactly
    // one macrotask — long enough to eat the trailing click and no longer.
    await nextMacrotask()

    expect(listeners.total()).toBe(before)
  })

  it('leaves no listener behind after a cancel', () => {
    const scene = renderScene({ activationDistancePx: 4 })
    const before = listeners.total()

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    act(() => {
      fireEvent.pointerCancel(document, { pointerId: 1 })
    })

    expect(listeners.total()).toBe(before)
  })

  it('leaves no listener behind when the draggable unmounts mid-drag', async () => {
    let store: DragStore | null = null
    const sensors = [pointerSensor({ activationDistancePx: 4 })]
    const before = listeners.total()
    const Host = ({ mounted }: { mounted: boolean }) => (
      <DndProvider sensors={sensors}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        {mounted ? <Draggable id="item" rect={rectAt(0, 0)} /> : null}
      </DndProvider>
    )
    const view = render(<Host mounted />)
    pressAt(view.getByTestId('handle-item'), 0, 0)
    moveTo(50, 0)

    view.rerender(<Host mounted={false} />)
    // The store cancels on the removal; the sensor has to notice and let go of its listeners.
    release(50, 0)
    await nextMacrotask()

    expect((store as unknown as DragStore).getState().origin).toBeNull()
    expect(listeners.total()).toBe(before)
  })

  it('restores document user-select, including after a cancel', () => {
    const scene = renderScene({ activationDistancePx: 4 })
    const before = document.body.style.userSelect

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    expect(document.body.style.userSelect).toBe('none')
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(document.body.style.userSelect).toBe(before)
  })
})

describe('click suppression', () => {
  it('suppresses the click that trails a real drag', () => {
    const onClick = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 })
    scene.handle().addEventListener('click', onClick)

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    release(50, 0)
    act(() => {
      fireEvent.click(scene.handle())
    })

    expect(onClick).not.toHaveBeenCalled()
  })

  it('leaves the click alone after a press that never activated', () => {
    // Suppressing a legitimate click is the more annoying of the two bugs.
    const onClick = vi.fn()
    const scene = renderScene({ activationDistancePx: 20 })
    scene.handle().addEventListener('click', onClick)

    pressAt(scene.handle(), 0, 0)
    moveTo(2, 0)
    release(2, 0)
    act(() => {
      fireEvent.click(scene.handle())
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('stops suppressing once the trailing click has passed', () => {
    const onClick = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 })
    scene.handle().addEventListener('click', onClick)

    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)
    release(50, 0)
    act(() => {
      fireEvent.click(scene.handle())
      fireEvent.click(scene.handle())
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('a second pointer', () => {
  it('is ignored, and the first drag continues unaffected', () => {
    const onDragStart = vi.fn()
    const scene = renderScene({ activationDistancePx: 4 }, { onDragStart })
    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)

    pressAt(scene.handle(), 0, 0, 2)
    moveTo(80, 0, 2)

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(scene.getStore().getState().translate).toEqual({ x: 50, y: 0 })
  })

  it('ignores moves belonging to a different pointer id', () => {
    const scene = renderScene({ activationDistancePx: 4 })
    pressAt(scene.handle(), 0, 0)
    moveTo(50, 0)

    moveTo(500, 500, 99)

    expect(scene.getStore().getState().translate).toEqual({ x: 50, y: 0 })
  })
})

describe('listener passivity — perf invariant 6', () => {
  it('registers the pre-activation move listener as passive and the dragging one as not', () => {
    const scene = renderScene({ activationDistancePx: 4 })

    pressAt(scene.handle(), 0, 0)
    const beforeActivation = listeners.registrationsOf('pointermove')
    moveTo(50, 0)
    const afterActivation = listeners.registrationsOf('pointermove')

    expect(beforeActivation).toHaveLength(1)
    expect(beforeActivation[0]?.passive).toBe(true)
    expect(afterActivation).toHaveLength(2)
    expect(afterActivation[1]?.passive).toBe(false)
  })
})
