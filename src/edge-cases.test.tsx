import { act, fireEvent, render, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider, type DndProviderProps } from './dnd-provider.js'
import { keyboardSensor } from './keyboard-sensor.js'
import { pointerSensor } from './pointer-sensor.js'
import { DRAG_CANCEL_REASONS, type Rect } from './types.js'
import { type UseDraggableOptions, useDraggable } from './use-draggable.js'
import { type UseDroppableOptions, useDroppable } from './use-droppable.js'

/**
 * The situations that separate a demo-quality drag-and-drop library from a production one.
 * Every case here has bitten a real library; each one gets a test that fails loudly.
 *
 * All of it runs through the public API, inside `<StrictMode>`.
 */

const ACTIVATION_DISTANCE_PX = 4

const rectAt = (top: number): Rect => ({ left: 0, top, width: 200, height: 60 })

/** Counts window and document listeners as (type, function) pairs, so a leak is a number. */
const trackGlobalListeners = () => {
  const live: { type: string; listener: unknown }[] = []
  const targets = [window, document] as const
  const originals = targets.map((target) => ({
    target,
    add: target.addEventListener.bind(target),
    remove: target.removeEventListener.bind(target),
  }))

  for (const { target, add, remove } of originals) {
    target.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      live.push({ type, listener })
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
    total: () => live.length,
    restore: () => {
      for (const { target, add, remove } of originals) {
        target.addEventListener = add
        target.removeEventListener = remove
      }
    },
  }
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0))

const Card = ({ options, rect }: { options: UseDraggableOptions; rect: Rect }) => {
  const { setNodeRef, handleProps, transform } = useDraggable(options)
  return (
    <button
      type="button"
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`card-${options.id}`}
      data-transform={transform ? `${transform.x},${transform.y}` : 'none'}
      {...handleProps}
    />
  )
}

const Slot = ({ options, rect }: { options: UseDroppableOptions; rect: Rect }) => {
  const { setNodeRef, isOver } = useDroppable(options)
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`slot-${options.id}`}
      data-over={isOver}
    />
  )
}

const buildSensors = () => [
  pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX }),
  keyboardSensor(),
]

const press = (element: Element, y = 0) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: y,
    button: 0,
    isPrimary: true,
  })
}

const moveTo = (y: number, pointerId = 1) => {
  act(() => {
    fireEvent.pointerMove(document, { pointerId, clientX: 0, clientY: y })
  })
}

let listeners: ReturnType<typeof trackGlobalListeners>

beforeEach(() => {
  listeners = trackGlobalListeners()
})

afterEach(() => {
  listeners.restore()
})

describe('disabled', () => {
  const renderDisabledScene = (props: Partial<DndProviderProps> = {}) => {
    const sensors = buildSensors()
    const view = render(
      <StrictMode>
        <DndProvider sensors={sensors} {...props}>
          <Card options={{ id: 'card', disabled: true }} rect={rectAt(0)} />
          <Slot options={{ id: 'near', disabled: true }} rect={rectAt(60)} />
          <Slot options={{ id: 'far' }} rect={rectAt(600)} />
        </DndProvider>
      </StrictMode>,
    )
    return { view, card: view.getByTestId('card-card') }
  }

  it('keeps a disabled draggable semantically a button, and refuses both sensors', () => {
    const onDragStart = vi.fn()
    const scene = renderDisabledScene({ onDragStart })

    expect(scene.card.getAttribute('aria-disabled')).toBe('true')
    expect(scene.card.getAttribute('role')).toBe('button')

    press(scene.card)
    moveTo(200)
    act(() => {
      fireEvent.keyDown(scene.card, { key: ' ' })
    })

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('never lets a disabled droppable win collision, however near it is', () => {
    const onDragEnd = vi.fn()
    const sensors = buildSensors()
    const view = render(
      <StrictMode>
        <DndProvider sensors={sensors} onDragEnd={onDragEnd}>
          <Card options={{ id: 'card' }} rect={rectAt(0)} />
          <Slot options={{ id: 'near', disabled: true }} rect={rectAt(60)} />
          <Slot options={{ id: 'far' }} rect={rectAt(600)} />
        </DndProvider>
      </StrictMode>,
    )

    press(view.getByTestId('card-card'))
    moveTo(60)
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 60 })
    })

    expect(view.getByTestId('slot-near').dataset.over).toBe('false')
    expect(onDragEnd.mock.calls[0]?.[0].over.id).toBe('far')
  })
})

describe('interruptions', () => {
  const renderScene = (props: Partial<DndProviderProps> = {}) => {
    const sensors = buildSensors()
    const view = render(
      <StrictMode>
        <DndProvider sensors={sensors} {...props}>
          <Card options={{ id: 'card' }} rect={rectAt(0)} />
          <Slot options={{ id: 'slot' }} rect={rectAt(200)} />
        </DndProvider>
      </StrictMode>,
    )
    return { view, card: view.getByTestId('card-card') }
  }

  it('resets the transform and fires no end when Escape interrupts', () => {
    const onDragEnd = vi.fn()
    const onDragCancel = vi.fn()
    const scene = renderScene({ onDragEnd, onDragCancel })
    press(scene.card)
    moveTo(200)
    expect(scene.card.dataset.transform).toBe('0,200')

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(onDragEnd).not.toHaveBeenCalled()
    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.escape)
    expect(scene.card.dataset.transform).toBe('none')
  })

  it('ignores a second pointer, leaving the first drag exactly as it was', () => {
    const onDragStart = vi.fn()
    const scene = renderScene({ onDragStart })
    press(scene.card)
    moveTo(200)

    fireEvent.pointerDown(scene.card, {
      pointerId: 2,
      clientX: 0,
      clientY: 0,
      button: 0,
      isPrimary: true,
    })
    moveTo(500, 2)

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(scene.card.dataset.transform).toBe('0,200')
  })

  it('re-collides on a scroll without the pointer moving at all', () => {
    // The bug this prevents is invisible until it lands one row off: the page moves under the
    // drag, the pointer never moves, and the cached rects still describe where things *were*.
    const sensors = buildSensors()
    let nearRect = rectAt(200)
    let rerenderWithScrolledRect: (() => void) | null = null

    const Host = () => {
      const [scrolled, setScrolled] = useState(false)
      rerenderWithScrolledRect = () => setScrolled(true)
      nearRect = scrolled ? rectAt(9000) : rectAt(200)
      return (
        <DndProvider sensors={sensors}>
          <Card options={{ id: 'card' }} rect={rectAt(0)} />
          <Slot options={{ id: 'near' }} rect={nearRect} />
          <Slot options={{ id: 'far' }} rect={rectAt(400)} />
        </DndProvider>
      )
    }

    const view = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    )
    press(view.getByTestId('card-card'))
    moveTo(200)
    expect(view.getByTestId('slot-near').dataset.over).toBe('true')

    // The rect changes and a scroll is announced. The pointer is not touched.
    act(() => {
      rerenderWithScrolledRect?.()
    })
    act(() => {
      fireEvent.scroll(document)
    })

    expect(view.getByTestId('slot-near').dataset.over).toBe('false')
    expect(view.getByTestId('slot-far').dataset.over).toBe('true')
  })
})

describe('things vanishing mid-drag — the A6 policy', () => {
  type SceneShape = {
    cardMounted?: boolean
    rowsMounted?: readonly string[]
  }

  const renderRemovableScene = (props: Partial<DndProviderProps> = {}) => {
    const sensors = buildSensors()
    let setShape: ((shape: SceneShape) => void) | null = null

    const Host = () => {
      const [shape, setLocalShape] = useState<SceneShape>({
        cardMounted: true,
        rowsMounted: ['above', 'target', 'below'],
      })
      setShape = setLocalShape
      return (
        <DndProvider sensors={sensors} {...props}>
          {shape.cardMounted ? <Card options={{ id: 'card' }} rect={rectAt(200)} /> : null}
          {(shape.rowsMounted ?? []).map((id, index) => (
            <Slot key={id} options={{ id }} rect={rectAt(index * 200)} />
          ))}
        </DndProvider>
      )
    }

    const view = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    )
    return {
      view,
      card: () => view.getByTestId('card-card'),
      /**
       * Applies the new shape and lets the store's end-of-task removal check run.
       *
       * A registration disappearing does not cancel on the spot: React re-attaches inline refs
       * every render, and StrictMode attaches/detaches/re-attaches a newly mounted component's
       * refs, so mid-drag both are indistinguishable from a removal until the task ends.
       */
      setShape: async (shape: SceneShape) => {
        await act(async () => {
          setShape?.({ cardMounted: true, rowsMounted: ['above', 'target', 'below'], ...shape })
        })
      },
    }
  }

  const startDrag = (scene: ReturnType<typeof renderRemovableScene>) => {
    press(scene.card(), 200)
    moveTo(220)
  }

  it('cancels when an unrelated row above the drag is removed', async () => {
    // The case that would otherwise resolve silently against a stale rect cache and produce a
    // wrong drop with no error anywhere.
    const onDragCancel = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderRemovableScene({ onDragCancel, onDragEnd })
    startDrag(scene)

    await scene.setShape({ rowsMounted: ['target', 'below'] })

    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('cancels when the current target is removed, reporting no landing position', async () => {
    const onDragCancel = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderRemovableScene({ onDragCancel, onDragEnd })
    startDrag(scene)

    await scene.setShape({ rowsMounted: ['above', 'below'] })

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('cancels when the dragged item itself is removed', async () => {
    const onDragCancel = vi.fn()
    const scene = renderRemovableScene({ onDragCancel })
    startDrag(scene)

    await scene.setShape({ cardMounted: false })

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
  })

  it('survives a row being inserted — lazy loads and auto-expand depend on it', async () => {
    const onDragCancel = vi.fn()
    const scene = renderRemovableScene({ onDragCancel })
    startDrag(scene)

    await scene.setShape({ rowsMounted: ['above', 'target', 'below', 'lazily-loaded'] })

    expect(onDragCancel).not.toHaveBeenCalled()
  })

  it('says what happened, rather than claiming the user cancelled', async () => {
    const scene = renderRemovableScene()
    startDrag(scene)

    await scene.setShape({ rowsMounted: ['target', 'below'] })

    const announcement = within(scene.view.container).getByRole('status').textContent
    expect(announcement).toMatch(/list changed/i)
    expect(announcement).not.toMatch(/cancelled/i)
  })

  it('cancels a keyboard drag the same way, and explains it', async () => {
    // A screen-reader user has no other way to learn the drag ended.
    const onDragCancel = vi.fn()
    const scene = renderRemovableScene({ onDragCancel })
    const card = scene.card()
    card.focus()
    act(() => {
      fireEvent.keyDown(card, { key: ' ' })
    })

    await scene.setShape({ rowsMounted: ['target', 'below'] })

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.itemRemoved)
    expect(within(scene.view.container).getByRole('status').textContent).toMatch(/list changed/i)
  })

  it('leaves no listener behind when the dragged item is removed', async () => {
    const before = listeners.total()
    const scene = renderRemovableScene()
    const listenersWithScene = listeners.total()
    startDrag(scene)

    await scene.setShape({ cardMounted: false })
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 220 })
    })
    await nextMacrotask()

    expect(listenersWithScene).toBeGreaterThanOrEqual(before)
    expect(listeners.total()).toBe(listenersWithScene)
  })
})

describe('the provider unmounting mid-drag', () => {
  it('tears everything down and leaves no listener behind', async () => {
    const before = listeners.total()
    const sensors = buildSensors()
    const Host = ({ mounted }: { mounted: boolean }) =>
      mounted ? (
        <DndProvider sensors={sensors}>
          <Card options={{ id: 'card' }} rect={rectAt(0)} />
          <Slot options={{ id: 'slot' }} rect={rectAt(200)} />
        </DndProvider>
      ) : null

    const view = render(
      <StrictMode>
        <Host mounted />
      </StrictMode>,
    )
    press(view.getByTestId('card-card'))
    moveTo(200)

    view.rerender(
      <StrictMode>
        <Host mounted={false} />
      </StrictMode>,
    )
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 200 })
    })
    await nextMacrotask()

    expect(listeners.total()).toBe(before)
  })
})
