import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { type KeyboardSensorOptions, keyboardSensor } from './keyboard-sensor.js'
import { type DndMonitorListeners, DRAG_CANCEL_REASONS, type Rect } from './types.js'
import { useDraggable } from './use-draggable.js'
import { useDroppable } from './use-droppable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const Handle = ({ id, rect }: { id: string; rect: Rect }) => {
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
    />
  )
}

const Slot = ({ id, rect }: { id: string; rect: Rect }) => {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={(node) => {
        if (node) mockElementRect(node, rect)
        return setNodeRef(node)
      }}
      data-testid={`slot-${id}`}
    />
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

const renderScene = (
  slots: { id: string; rect: Rect }[],
  options: KeyboardSensorOptions = {},
  monitor: DndMonitorListeners = {},
) => {
  let store: DragStore | null = null
  const sensors = [keyboardSensor(options)]
  const view = render(
    <DndProvider sensors={sensors} {...monitor}>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Handle id="item" rect={rectAt(0, 0)} />
      {slots.map((slot) => (
        <Slot key={slot.id} id={slot.id} rect={slot.rect} />
      ))}
    </DndProvider>,
  )
  return {
    view,
    getStore: () => store as unknown as DragStore,
    handle: () => view.getByTestId('handle-item'),
    state: () => (store as unknown as DragStore).getState(),
  }
}

const pressKey = (element: Element, key: string) => {
  act(() => {
    fireEvent.keyDown(element, { key })
  })
}

describe('picking up and dropping', () => {
  it('picks up on Space and drops on the second Space', () => {
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderScene(
      [{ id: 'slot', rect: rectAt(0, 100) }],
      {},
      { onDragStart, onDragEnd },
    )

    pressKey(scene.handle(), ' ')
    expect(onDragStart).toHaveBeenCalledTimes(1)
    pressKey(scene.handle(), ' ')

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(scene.state().origin).toBeNull()
  })

  it('picks up on Enter and drops on the second Enter', () => {
    const onDragEnd = vi.fn()
    const scene = renderScene([{ id: 'slot', rect: rectAt(0, 100) }], {}, { onDragEnd })

    pressKey(scene.handle(), 'Enter')
    expect(scene.state().origin?.id).toBe('item')
    pressKey(scene.handle(), 'Enter')

    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('starts a drag with no pointer origin, which is what keeps auto-scroll off', () => {
    const scene = renderScene([])

    pressKey(scene.handle(), ' ')

    expect(scene.state().origin?.pointer).toBeNull()
  })

  it('prevents the default on the activation keys, so Space does not scroll the page', () => {
    const scene = renderScene([])
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })

    act(() => {
      scene.handle().dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('does not start on an unrelated key', () => {
    const scene = renderScene([])

    pressKey(scene.handle(), 'a')

    expect(scene.state().origin).toBeNull()
  })
})

describe('arrow navigation', () => {
  it('moves to the nearest droppable in that direction', () => {
    const scene = renderScene([
      { id: 'near', rect: rectAt(0, 100) },
      { id: 'far', rect: rectAt(0, 500) },
    ])
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowDown')

    expect(scene.state().overId).toBe('near')
    expect(scene.state().translate).toEqual({ x: 0, y: 100 })
  })

  it('steps again from where it now is, not from where it started', () => {
    const scene = renderScene([
      { id: 'first', rect: rectAt(0, 100) },
      { id: 'second', rect: rectAt(0, 200) },
    ])
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowDown')
    pressKey(scene.handle(), 'ArrowDown')

    expect(scene.state().overId).toBe('second')
    expect(scene.state().translate).toEqual({ x: 0, y: 200 })
  })

  it('stays put when there is nothing in that direction — no wrap, no jump', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }])
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowUp')

    expect(scene.state().translate).toEqual({ x: 0, y: 0 })
    expect(scene.state().overId).toBe('below')
  })

  it('walks measure-only rows too, which is how a tree is navigated', () => {
    let store: DragStore | null = null
    const sensors = [keyboardSensor()]
    const view = render(
      <DndProvider sensors={sensors}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        <Handle id="item" rect={rectAt(0, 0)} />
      </DndProvider>,
    )
    const readyStore = store as unknown as DragStore
    const rowNode = document.createElement('div')
    mockElementRect(rowNode, rectAt(0, 100))
    document.body.append(rowNode)
    readyStore.registerMeasuredRow('tree-row', rowNode)

    pressKey(view.getByTestId('handle-item'), ' ')
    pressKey(view.getByTestId('handle-item'), 'ArrowDown')

    expect(readyStore.getState().translate).toEqual({ x: 0, y: 100 })
    // …and a measure-only row still never becomes `over`.
    expect(readyStore.getState().overId).toBeNull()
  })

  it('scrolls the new target into view on every change', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }])
    const target = scene.view.getByTestId('slot-below')
    const scrollIntoView = vi.spyOn(target, 'scrollIntoView')
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowDown')

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when no drag is in progress', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }])

    pressKey(scene.handle(), 'ArrowDown')

    expect(scene.state().origin).toBeNull()
    expect(scene.state().translate).toEqual({ x: 0, y: 0 })
  })
})

describe('ArrowLeft and ArrowRight as a depth step', () => {
  it('emits a horizontal transform of one indent, not a target change', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }], { indentPx: 24 })
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowRight')

    expect(scene.state().translate).toEqual({ x: 24, y: 0 })
  })

  it('steps back the other way, including past zero', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }], { indentPx: 24 })
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowLeft')

    expect(scene.state().translate).toEqual({ x: -24, y: 0 })
  })

  it('accumulates with vertical steps rather than replacing them', () => {
    const scene = renderScene([{ id: 'below', rect: rectAt(0, 100) }], { indentPx: 24 })
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowDown')
    pressKey(scene.handle(), 'ArrowRight')
    pressKey(scene.handle(), 'ArrowRight')

    expect(scene.state().translate).toEqual({ x: 48, y: 100 })
  })

  it('goes through the same move path as the pointer, so downstream cannot tell them apart', () => {
    const onDragMove = vi.fn()
    const scene = renderScene(
      [{ id: 'below', rect: rectAt(0, 100) }],
      { indentPx: 24 },
      { onDragMove },
    )
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'ArrowRight')

    expect(onDragMove).toHaveBeenCalledTimes(1)
    expect(onDragMove.mock.calls[0]?.[0].translate).toEqual({ x: 24, y: 0 })
  })
})

describe('cancelling', () => {
  it('cancels on Escape with reason escape', () => {
    const onDragCancel = vi.fn()
    const onDragEnd = vi.fn()
    const scene = renderScene([], {}, { onDragCancel, onDragEnd })
    pressKey(scene.handle(), ' ')

    pressKey(scene.handle(), 'Escape')

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.escape)
    expect(onDragEnd).not.toHaveBeenCalled()
    expect(scene.state().origin).toBeNull()
  })

  it('cancels on blur with reason blur — a drag must not survive tabbing away', () => {
    const onDragCancel = vi.fn()
    const scene = renderScene([], {}, { onDragCancel })
    pressKey(scene.handle(), ' ')

    act(() => {
      fireEvent.blur(scene.handle())
    })

    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe(DRAG_CANCEL_REASONS.blur)
    expect(scene.state().origin).toBeNull()
  })

  it('stops listening for blur once the drag is over', () => {
    const onDragCancel = vi.fn()
    const scene = renderScene([], {}, { onDragCancel })
    pressKey(scene.handle(), ' ')
    pressKey(scene.handle(), ' ')

    act(() => {
      fireEvent.blur(scene.handle())
    })

    expect(onDragCancel).not.toHaveBeenCalled()
  })

  it('survives the draggable unmounting mid-drag without leaving the drag alive', async () => {
    let store: DragStore | null = null
    const sensors = [keyboardSensor()]
    const Host = ({ mounted }: { mounted: boolean }) => (
      <DndProvider sensors={sensors}>
        <StoreProbe
          onReady={(readyStore) => {
            store = readyStore
          }}
        />
        {mounted ? <Handle id="item" rect={rectAt(0, 0)} /> : null}
      </DndProvider>
    )
    const view = render(<Host mounted />)
    pressKey(view.getByTestId('handle-item'), ' ')

    view.rerender(<Host mounted={false} />)
    await act(async () => {})

    expect((store as unknown as DragStore).getState().origin).toBeNull()
  })
})

describe('when the store cancels the drag underneath the sensor', () => {
  it('does not swallow the next pickup', () => {
    // A row disappearing mid-drag cancels through the A6 policy, with no event the keyboard
    // sensor would otherwise hear. If it goes on believing a drag is running, the user's next
    // Space is consumed ending a drag that is already over.
    const onDragStart = vi.fn()
    const scene = renderScene([{ id: 'slot', rect: rectAt(0, 100) }], {}, { onDragStart })
    pressKey(scene.handle(), ' ')
    act(() => {
      scene.getStore().cancelActiveDrag(DRAG_CANCEL_REASONS.itemRemoved)
    })

    pressKey(scene.handle(), ' ')

    expect(onDragStart).toHaveBeenCalledTimes(2)
    expect(scene.state().origin?.id).toBe('item')
  })

  it('ignores arrow keys rather than moving a drag that no longer exists', () => {
    const scene = renderScene([{ id: 'slot', rect: rectAt(0, 100) }])
    pressKey(scene.handle(), ' ')
    act(() => {
      scene.getStore().cancelActiveDrag(DRAG_CANCEL_REASONS.itemRemoved)
    })

    pressKey(scene.handle(), 'ArrowDown')

    expect(scene.state().origin).toBeNull()
    expect(scene.state().translate).toEqual({ x: 0, y: 0 })
  })
})

describe('two sensors on one handle', () => {
  it('does not stop the other sensor from receiving the same keydown', () => {
    const otherKeyDown = vi.fn()
    const sensors = [
      keyboardSensor(),
      { name: 'other', activate: () => ({ onKeyDown: otherKeyDown }) },
    ]
    const view = render(
      <DndProvider sensors={sensors}>
        <Handle id="item" rect={rectAt(0, 0)} />
      </DndProvider>,
    )

    pressKey(view.getByTestId('handle-item'), ' ')

    expect(otherKeyDown).toHaveBeenCalledTimes(1)
  })
})
