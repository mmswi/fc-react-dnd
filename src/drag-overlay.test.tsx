import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect, nextFrame } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { DragOverlay } from './drag-overlay.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { DRAG_CANCEL_REASONS, type DragSession, type Rect } from './types.js'
import { useDraggable } from './use-draggable.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const OVERLAY_TEST_ID = 'overlay'

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

const renderScene = (onChildBodyRun?: () => void) => {
  let store: DragStore | null = null
  const OverlayChild = () => {
    onChildBodyRun?.()
    return <span>dragging</span>
  }
  render(
    <DndProvider>
      <StoreProbe
        onReady={(readyStore) => {
          store = readyStore
        }}
      />
      <Draggable id="item" rect={rectAt(20, 60)} />
      <DragOverlay data-testid={OVERLAY_TEST_ID}>
        <OverlayChild />
      </DragOverlay>
    </DndProvider>,
  )
  return {
    getStore: () => store as unknown as DragStore,
    overlay: () => document.querySelector(`[data-testid="${OVERLAY_TEST_ID}"]`),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('presence', () => {
  it('renders nothing at all when no drag is active', () => {
    const scene = renderScene()

    expect(scene.overlay()).toBeNull()
  })

  it('appears on drag start and disappears on drop', async () => {
    const scene = renderScene()

    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    expect(scene.overlay()).not.toBeNull()
    act(() => {
      ;(session as unknown as DragSession).end()
    })

    expect(scene.overlay()).toBeNull()
  })

  it('disappears on cancel too', () => {
    const scene = renderScene()
    act(() => {
      scene.getStore().beginDrag('item', { pointer: null })
    })

    act(() => {
      scene.getStore().cancelActiveDrag(DRAG_CANCEL_REASONS.escape)
    })

    expect(scene.overlay()).toBeNull()
  })

  it('portals to document.body rather than nesting inside the provider subtree', () => {
    const scene = renderScene()

    act(() => {
      scene.getStore().beginDrag('item', { pointer: null })
    })

    expect(scene.overlay()?.parentElement).toBe(document.body)
  })
})

describe('positioning', () => {
  it('starts fixed over the source element, at its initial rect', () => {
    const scene = renderScene()

    act(() => {
      scene.getStore().beginDrag('item', { pointer: null })
    })
    const style = (scene.overlay() as HTMLElement).style

    expect(style.position).toBe('fixed')
    expect(style.top).toBe('60px')
    expect(style.left).toBe('20px')
    expect(style.width).toBe('100px')
    expect(style.height).toBe('40px')
  })

  it('never blocks hit-testing of what is underneath it', () => {
    const scene = renderScene()

    act(() => {
      scene.getStore().beginDrag('item', { pointer: null })
    })

    expect((scene.overlay() as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('moves by transform only — top and left never change during a drag', async () => {
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })

    act(() => {
      ;(session as unknown as DragSession).move({ x: 30, y: 40 })
    })
    await act(async () => {
      await nextFrame()
    })
    const style = (scene.overlay() as HTMLElement).style

    expect(style.top).toBe('60px')
    expect(style.left).toBe('20px')
    expect(style.transform).toContain('30px')
    expect(style.transform).toContain('40px')
  })
})

describe('zero renders per move — perf invariants 3 and 4', () => {
  it('renders its children once for the whole of a drag', async () => {
    let childBodyRuns = 0
    const scene = renderScene(() => {
      childBodyRuns += 1
    })
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    const runsAfterStart = childBodyRuns

    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        ;(session as unknown as DragSession).move({ x: 0, y: step })
      })
      await act(async () => {
        await nextFrame()
      })
    }

    expect(runsAfterStart).toBe(1)
    expect(childBodyRuns).toBe(runsAfterStart)
  })

  it('schedules one animation frame for several moves inside the same frame', async () => {
    const scheduleFrame = vi.spyOn(globalThis, 'requestAnimationFrame')
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    await act(async () => {
      await nextFrame()
    })
    scheduleFrame.mockClear()

    act(() => {
      ;(session as unknown as DragSession).move({ x: 1, y: 1 })
      ;(session as unknown as DragSession).move({ x: 2, y: 2 })
      ;(session as unknown as DragSession).move({ x: 3, y: 3 })
    })

    expect(scheduleFrame).toHaveBeenCalledTimes(1)
    scheduleFrame.mockRestore()
  })

  it('writes the latest position when that frame runs, not the first of the batch', async () => {
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })

    act(() => {
      ;(session as unknown as DragSession).move({ x: 1, y: 1 })
      ;(session as unknown as DragSession).move({ x: 2, y: 2 })
      ;(session as unknown as DragSession).move({ x: 99, y: 77 })
    })
    await act(async () => {
      await nextFrame()
    })

    const transform = (scene.overlay() as HTMLElement).style.transform
    expect(transform).toContain('99px')
    expect(transform).toContain('77px')
  })

  it('does not write anything before the frame runs', async () => {
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    await act(async () => {
      await nextFrame()
    })
    const beforeMove = (scene.overlay() as HTMLElement).style.transform

    act(() => {
      ;(session as unknown as DragSession).move({ x: 500, y: 500 })
    })

    expect((scene.overlay() as HTMLElement).style.transform).toBe(beforeMove)
  })
})

describe('teardown — perf invariant 7', () => {
  it('cancels the frame it had pending when the drag ends', () => {
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    act(() => {
      ;(session as unknown as DragSession).move({ x: 5, y: 5 })
    })

    act(() => {
      ;(session as unknown as DragSession).end()
    })

    expect(cancelFrame).toHaveBeenCalled()
    cancelFrame.mockRestore()
  })

  it('stops following the store once the drag is over', async () => {
    const scene = renderScene()
    let session: DragSession | null = null
    act(() => {
      session = scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    act(() => {
      ;(session as unknown as DragSession).end()
    })

    // A stale subscription would throw here, writing to a node that is no longer mounted.
    act(() => {
      scene.getStore().beginDrag('item', { pointer: { x: 0, y: 0 } })
    })
    await act(async () => {
      await nextFrame()
    })

    expect(scene.overlay()).not.toBeNull()
  })
})
