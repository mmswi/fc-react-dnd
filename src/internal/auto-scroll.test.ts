import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect, nextFrame } from '../../test/helpers.js'
import { closestCenter } from '../collision.js'
import type { Point, Rect } from '../types.js'
import {
  AUTO_SCROLL_EDGE_PX,
  computeScrollIntent,
  createAutoScroller,
  findScrollableAncestor,
  type ScrollBoxMetrics,
} from './auto-scroll.js'
import { createDragStore } from './store.js'

/** A 400×400 box at the origin, scrolled to the middle of a 2000×2000 canvas. */
const scrollBox = (overrides: Partial<ScrollBoxMetrics> = {}): ScrollBoxMetrics => ({
  rect: { left: 0, top: 0, width: 400, height: 400 },
  scrollLeft: 800,
  scrollTop: 800,
  scrollWidth: 2000,
  scrollHeight: 2000,
  clientWidth: 400,
  clientHeight: 400,
  ...overrides,
})

const intentAt = (pointer: Point, overrides: Partial<ScrollBoxMetrics> = {}) =>
  computeScrollIntent({ pointer, box: scrollBox(overrides) })

describe('computeScrollIntent', () => {
  it('is still when the pointer is well inside the box', () => {
    expect(intentAt({ x: 200, y: 200 })).toEqual({ x: 0, y: 0 })
  })

  it('scrolls up near the top edge and down near the bottom edge', () => {
    expect(intentAt({ x: 200, y: 5 }).y).toBeLessThan(0)
    expect(intentAt({ x: 200, y: 395 }).y).toBeGreaterThan(0)
  })

  it('scrolls left near the left edge and right near the right edge', () => {
    expect(intentAt({ x: 5, y: 200 }).x).toBeLessThan(0)
    expect(intentAt({ x: 395, y: 200 }).x).toBeGreaterThan(0)
  })

  it('scrolls on both axes in a corner', () => {
    const corner = intentAt({ x: 2, y: 2 })

    expect(corner.x).toBeLessThan(0)
    expect(corner.y).toBeLessThan(0)
  })

  it('ramps with proximity — deeper into the edge band means faster', () => {
    const justInside = Math.abs(intentAt({ x: 200, y: AUTO_SCROLL_EDGE_PX - 1 }).y)
    const halfway = Math.abs(intentAt({ x: 200, y: AUTO_SCROLL_EDGE_PX / 2 }).y)
    const atTheEdge = Math.abs(intentAt({ x: 200, y: 0 }).y)

    expect(justInside).toBeLessThan(halfway)
    expect(halfway).toBeLessThan(atTheEdge)
  })

  it('is still exactly at the inner boundary of the edge band', () => {
    expect(intentAt({ x: 200, y: AUTO_SCROLL_EDGE_PX }).y).toBe(0)
  })

  it('does not scroll up when the box is already at the top', () => {
    expect(intentAt({ x: 200, y: 5 }, { scrollTop: 0 }).y).toBe(0)
  })

  it('does not scroll down when the box is already at the bottom', () => {
    expect(intentAt({ x: 200, y: 395 }, { scrollTop: 1600 }).y).toBe(0)
  })

  it('does not scroll horizontally in a box with nothing to scroll to', () => {
    const unscrollable = { scrollWidth: 400, scrollLeft: 0 }

    expect(intentAt({ x: 395, y: 200 }, unscrollable).x).toBe(0)
    expect(intentAt({ x: 5, y: 200 }, unscrollable).x).toBe(0)
  })

  it('still scrolls the axis that can move when the other one cannot', () => {
    const intent = intentAt({ x: 2, y: 2 }, { scrollWidth: 400, scrollLeft: 0 })

    expect(intent.x).toBe(0)
    expect(intent.y).toBeLessThan(0)
  })

  it('is still when the pointer is outside the box entirely', () => {
    expect(intentAt({ x: 200, y: -50 })).toEqual({ x: 0, y: 0 })
    expect(intentAt({ x: 900, y: 200 })).toEqual({ x: 0, y: 0 })
  })
})

/** jsdom reports every scroll metric as zero, so a scrollable element has to be described. */
const makeScrollable = (
  element: HTMLElement,
  {
    overflow,
    contentPx = 2000,
    viewportPx = 400,
  }: { overflow: string; contentPx?: number; viewportPx?: number },
) => {
  element.style.overflow = overflow
  Object.defineProperty(element, 'scrollHeight', { value: contentPx, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: viewportPx, configurable: true })
  Object.defineProperty(element, 'scrollWidth', { value: contentPx, configurable: true })
  Object.defineProperty(element, 'clientWidth', { value: viewportPx, configurable: true })
  return element
}

describe('findScrollableAncestor', () => {
  it('finds the nearest ancestor that actually scrolls', () => {
    const outer = makeScrollable(document.createElement('div'), { overflow: 'auto' })
    const inner = makeScrollable(document.createElement('div'), { overflow: 'auto' })
    const leaf = document.createElement('div')
    outer.append(inner)
    inner.append(leaf)
    document.body.append(outer)

    expect(findScrollableAncestor(leaf)).toBe(inner)
  })

  it('skips ancestors whose overflow is visible even when their content overflows', () => {
    const scrollable = makeScrollable(document.createElement('div'), { overflow: 'auto' })
    const passthrough = makeScrollable(document.createElement('div'), { overflow: 'visible' })
    const leaf = document.createElement('div')
    scrollable.append(passthrough)
    passthrough.append(leaf)
    document.body.append(scrollable)

    expect(findScrollableAncestor(leaf)).toBe(scrollable)
  })

  it('skips an overflow:auto ancestor that has nothing to scroll', () => {
    const realScroller = makeScrollable(document.createElement('div'), { overflow: 'auto' })
    const emptyScroller = makeScrollable(document.createElement('div'), {
      overflow: 'auto',
      contentPx: 400,
    })
    const leaf = document.createElement('div')
    realScroller.append(emptyScroller)
    emptyScroller.append(leaf)
    document.body.append(realScroller)

    expect(findScrollableAncestor(leaf)).toBe(realScroller)
  })

  it('falls back to the viewport when no ancestor scrolls', () => {
    // `document.scrollingElement` is the right answer in a browser and is undefined in jsdom,
    // so this asserts the fallback the implementation actually reaches.
    const leaf = document.createElement('div')
    document.body.append(leaf)

    expect(findScrollableAncestor(leaf)).toBe(document.scrollingElement ?? document.documentElement)
  })
})

const CONTAINER_HEIGHT_PX = 400

/**
 * A scrollable container with a draggable inside it. jsdom reports every scroll metric as zero
 * and treats `scrollTop` as read-only, so both are described here.
 */
const buildScrollableScene = () => {
  const container = document.createElement('div')
  container.style.overflow = 'auto'
  mockElementRect(container, { left: 0, top: 0, width: 400, height: CONTAINER_HEIGHT_PX })
  Object.defineProperty(container, 'clientHeight', {
    value: CONTAINER_HEIGHT_PX,
    configurable: true,
  })
  Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true })
  Object.defineProperty(container, 'scrollHeight', { value: 4000, configurable: true })
  Object.defineProperty(container, 'scrollWidth', { value: 400, configurable: true })
  Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true })
  Object.defineProperty(container, 'scrollLeft', { value: 0, writable: true, configurable: true })

  const item = document.createElement('div')
  mockElementRect(item, { left: 0, top: 0, width: 100, height: 40 })
  container.append(item)
  document.body.append(container)

  const store = createDragStore({ collisionDetection: closestCenter })
  store.registerDraggable('item', item)

  return { container, item, store, scroller: createAutoScroller(store) }
}

const droppableAt = (rect: Rect): HTMLElement => {
  const node = document.createElement('div')
  mockElementRect(node, rect)
  document.body.append(node)
  return node
}

describe('the auto-scroll loop', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('scrolls the container while the pointer sits near its edge', async () => {
    const scene = buildScrollableScene()
    // Near the bottom edge of the container, so the intent is downward.
    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    scene.scroller.start()

    await nextFrame()
    await nextFrame()

    expect(scene.container.scrollTop).toBeGreaterThan(0)
  })

  it('does not run at all for a keyboard drag, which has no pointer to measure from', async () => {
    const scene = buildScrollableScene()
    scene.store.beginDrag('item', { pointer: null })

    scene.scroller.start()
    await nextFrame()

    expect(scene.container.scrollTop).toBe(0)
  })

  it('re-collides as it scrolls, so over stays honest under a stationary pointer', async () => {
    const scene = buildScrollableScene()
    const near = droppableAt({ left: 0, top: 10, width: 100, height: 40 })
    scene.store.registerDroppable('near', near)
    scene.store.registerDroppable('far', droppableAt({ left: 0, top: 900, width: 100, height: 40 }))
    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    expect(scene.store.getState().overId).toBe('near')
    scene.scroller.start()

    // The scroll carries 'near' out of reach. Only a re-measure inside the loop can see it.
    mockElementRect(near, { left: 0, top: 5000, width: 100, height: 40 })
    await nextFrame()
    await nextFrame()

    expect(scene.store.getState().overId).toBe('far')
  })

  it('stops when told to, leaving no frame scheduled', async () => {
    const scene = buildScrollableScene()
    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    scene.scroller.start()
    await nextFrame()
    await nextFrame()
    const scrolledSoFar = scene.container.scrollTop

    scene.scroller.stop()
    await nextFrame()
    await nextFrame()

    expect(scrolledSoFar).toBeGreaterThan(0)
    expect(scene.container.scrollTop).toBe(scrolledSoFar)
  })

  it('cannot be started twice into two competing loops', async () => {
    const scene = buildScrollableScene()
    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })

    scene.scroller.start()
    await nextFrame()
    const afterOneLoop = scene.container.scrollTop
    scene.scroller.stop()

    const second = buildScrollableScene()
    second.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    second.scroller.start()
    second.scroller.start()
    await nextFrame()

    expect(second.container.scrollTop).toBe(afterOneLoop)
  })

  it('reads every metric before it writes anything — perf invariant 2', async () => {
    // Interleaving a read with a write forces the browser to recompute layout on each pair, and
    // this loop runs every frame of a drag. The ordering is the invariant, so the ordering is
    // what gets asserted — not merely that the scroll happened.
    const scene = buildScrollableScene()
    const order: string[] = []

    const realRect = scene.container.getBoundingClientRect.bind(scene.container)
    scene.container.getBoundingClientRect = () => {
      order.push('read')
      return realRect()
    }
    for (const property of ['scrollTop', 'scrollLeft', 'scrollHeight', 'clientHeight'] as const) {
      const value = scene.container[property]
      Object.defineProperty(scene.container, property, {
        configurable: true,
        get: () => {
          order.push('read')
          return value
        },
        set: () => {
          order.push('write')
        },
      })
    }

    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    scene.scroller.start()
    await nextFrame()

    const firstWrite = order.indexOf('write')
    const lastRead = order.lastIndexOf('read')
    expect(firstWrite).toBeGreaterThan(-1)
    expect(lastRead).toBeLessThan(firstWrite)
  })

  it('stops scrolling once the container reaches its end', async () => {
    const scene = buildScrollableScene()
    Object.defineProperty(scene.container, 'scrollHeight', { value: 400, configurable: true })
    scene.store.beginDrag('item', { pointer: { x: 200, y: CONTAINER_HEIGHT_PX - 5 } })
    scene.scroller.start()

    await nextFrame()
    await nextFrame()

    expect(scene.container.scrollTop).toBe(0)
  })
})
