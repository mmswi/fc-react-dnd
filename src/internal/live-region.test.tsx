import { act, fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../../test/helpers.js'
import { DndProvider, type DndProviderProps } from '../dnd-provider.js'
import { pointerSensor } from '../pointer-sensor.js'
import { DRAG_CANCEL_REASONS, type Rect } from '../types.js'
import { useDraggable } from '../use-draggable.js'
import { useDroppable } from '../use-droppable.js'
import { useDndContext } from './context.js'
import type { DragStore } from './store.js'

const ACTIVATION_DISTANCE_PX = 4

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
    />
  )
}

const StoreProbe = ({ onReady }: { onReady: (store: DragStore) => void }) => {
  onReady(useDndContext('StoreProbe').store)
  return null
}

const renderScene = (props: Partial<DndProviderProps> = {}) => {
  let store: DragStore | null = null
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
  const view = render(
    <DndProvider sensors={sensors} {...props}>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Handle id="Invoices" rect={rectAt(0, 0)} />
      <Slot id="Inbox" rect={rectAt(0, 0)} />
      <Slot id="Archive" rect={rectAt(0, 400)} />
    </DndProvider>,
  )
  // Scoped to this render's own container: a test that renders two scenes would otherwise find
  // both providers' live regions, since RTL queries default to the whole document body.
  const scope = () => within(view.container)

  return {
    view,
    getStore: () => store as unknown as DragStore,
    liveRegion: () => scope().getByRole('status'),
    announcement: () => scope().getByRole('status').textContent,
    handle: () => scope().getByTestId('handle-Invoices'),
  }
}

const pressAndMove = (element: Element, y: number) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    isPrimary: true,
  })
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: y })
  })
}

describe('the live region', () => {
  it('is silent before anything happens', () => {
    const scene = renderScene()

    expect(scene.announcement()).toBe('')
  })

  it('is visually hidden but not display:none or hidden — assistive tech must reach it', () => {
    const scene = renderScene()
    const region = scene.liveRegion()

    expect(region.style.display).not.toBe('none')
    expect(region.hasAttribute('hidden')).toBe(false)
    expect(region.style.position).toBe('fixed')
    expect(region.getAttribute('aria-live')).toBe('assertive')
  })

  it('gives each provider its own region, so two drags cannot narrate over each other', () => {
    const view = render(
      <>
        <DndProvider>
          <div data-testid="left" />
        </DndProvider>
        <DndProvider>
          <div data-testid="right" />
        </DndProvider>
      </>,
    )

    expect(view.getAllByRole('status')).toHaveLength(2)
  })
})

describe('announcements through a real drag', () => {
  it('announces the pickup', () => {
    const scene = renderScene()

    pressAndMove(scene.handle(), 10)

    expect(scene.announcement()).toContain('Picked up Invoices')
  })

  it('announces a change of target', () => {
    const scene = renderScene()
    pressAndMove(scene.handle(), 10)

    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: 400 })
    })

    expect(scene.announcement()).toContain('Archive')
  })

  it('does not re-announce for moves inside the same target', () => {
    const scene = renderScene()
    pressAndMove(scene.handle(), 10)
    const afterPickup = scene.announcement()

    for (let step = 11; step <= 20; step += 1) {
      act(() => {
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: step })
      })
    }

    expect(scene.announcement()).toBe(afterPickup)
  })

  it('announces the drop and where it landed', () => {
    const scene = renderScene()
    pressAndMove(scene.handle(), 400)

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 400 })
    })

    expect(scene.announcement()).toContain('Dropped Invoices on Archive')
  })

  it('announces a cancel as a cancel', () => {
    const scene = renderScene()
    pressAndMove(scene.handle(), 10)

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(scene.announcement()).toMatch(/Movement cancelled/i)
  })

  it('announces a forced cancel differently, because the user cancelled nothing', () => {
    const scene = renderScene()
    pressAndMove(scene.handle(), 10)

    act(() => {
      scene.getStore().cancelActiveDrag(DRAG_CANCEL_REASONS.itemRemoved)
    })

    expect(scene.announcement()).toMatch(/list changed/i)
    expect(scene.announcement()).not.toMatch(/cancelled/i)
  })

  it('says the same things for a keyboard drag as for a pointer drag', () => {
    const pointerScene = renderScene()
    pressAndMove(pointerScene.handle(), 400)
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 400 })
    })
    const afterPointerDrop = pointerScene.announcement()

    const keyboardScene = renderScene({ sensors: undefined })
    act(() => {
      fireEvent.keyDown(keyboardScene.handle(), { key: ' ' })
    })
    act(() => {
      fireEvent.keyDown(keyboardScene.handle(), { key: 'ArrowDown' })
    })
    act(() => {
      fireEvent.keyDown(keyboardScene.handle(), { key: ' ' })
    })

    expect(keyboardScene.announcement()).toBe(afterPointerDrop)
  })
})

describe('overriding the texts — accessibility invariant 2', () => {
  it('replaces every default that is supplied and keeps the ones that are not', () => {
    const scene = renderScene({
      accessibility: {
        announcements: {
          describeDragStart: ({ active }) => `CUSTOM pickup ${active.id}`,
          describeDragEnd: () => 'CUSTOM drop',
        },
      },
    })

    pressAndMove(scene.handle(), 10)
    expect(scene.announcement()).toBe('CUSTOM pickup Invoices')

    act(() => {
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: 400 })
    })
    // Not overridden, so the default still applies.
    expect(scene.announcement()).toContain('is over Archive')

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 400 })
    })
    expect(scene.announcement()).toBe('CUSTOM drop')
  })

  it('lets the cancel text be overridden per reason', () => {
    const scene = renderScene({
      accessibility: {
        announcements: {
          describeDragCancel: ({ reason }) => `CUSTOM ${reason}`,
        },
      },
    })

    pressAndMove(scene.handle(), 10)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(scene.announcement()).toBe('CUSTOM escape')
  })
})

describe('the instructions element — accessibility invariant 3', () => {
  it('is what every draggable handle points aria-describedby at', () => {
    const scene = renderScene()
    const describedBy = scene.handle().getAttribute('aria-describedby')

    const instructions = describedBy ? document.getElementById(describedBy) : null
    expect(instructions).not.toBeNull()
    expect(instructions?.textContent).toMatch(/press Space or Enter/i)
  })

  it('is separate from the live region, so focusing a handle announces nothing', () => {
    const scene = renderScene()
    const describedBy = scene.handle().getAttribute('aria-describedby')

    expect(within(scene.liveRegion()).queryByText(/press Space/i)).toBeNull()
    expect(document.getElementById(describedBy as string)).not.toBe(scene.liveRegion())
  })
})
