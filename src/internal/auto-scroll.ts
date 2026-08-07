import type { Point, Rect, Translate } from '../types.js'
import type { DragStore } from './store.js'

/**
 * Scroll the container when the pointer nears its edge, without turning the move path into a
 * layout-thrashing loop.
 *
 * The whole trick is separating the decision from the effect: `computeScrollIntent` is pure and
 * exhaustively testable, and the loop below is a thin thing that reads once, decides, then
 * writes — never interleaving the two (perf invariant 2).
 */

/** How close to an edge the pointer has to be before the container starts moving. */
export const AUTO_SCROLL_EDGE_PX = 60

/** Speed at the very edge, per frame. Roughly 840 px/s at 60 Hz — fast, but still followable. */
const AUTO_SCROLL_MAX_SPEED_PX_PER_FRAME = 14

/** Everything the decision needs, and nothing that would drag the DOM into a pure function. */
export type ScrollBoxMetrics = {
  readonly rect: Rect
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly scrollWidth: number
  readonly scrollHeight: number
  readonly clientWidth: number
  readonly clientHeight: number
}

type AxisIntentArgs = {
  readonly pointerOffset: number
  readonly viewportLength: number
  readonly scrollOffset: number
  readonly contentLength: number
}

const speedForDepth = (depthIntoBand: number): number => {
  const ramp = Math.min(depthIntoBand, AUTO_SCROLL_EDGE_PX) / AUTO_SCROLL_EDGE_PX
  return ramp * AUTO_SCROLL_MAX_SPEED_PX_PER_FRAME
}

const intentForAxis = (args: AxisIntentArgs): number => {
  const { pointerOffset, viewportLength, scrollOffset, contentLength } = args

  const isOutsideBox = pointerOffset < 0 || pointerOffset > viewportLength
  if (isOutsideBox) return 0

  const distanceToStart = pointerOffset
  const distanceToEnd = viewportLength - pointerOffset
  const maxScrollOffset = contentLength - viewportLength

  const canScrollBack = scrollOffset > 0
  if (distanceToStart < AUTO_SCROLL_EDGE_PX && canScrollBack) {
    return -speedForDepth(AUTO_SCROLL_EDGE_PX - distanceToStart)
  }

  const canScrollForward = scrollOffset < maxScrollOffset
  if (distanceToEnd < AUTO_SCROLL_EDGE_PX && canScrollForward) {
    return speedForDepth(AUTO_SCROLL_EDGE_PX - distanceToEnd)
  }

  // Either the pointer is nowhere near an edge, or the box is already at that end — in which
  // case reporting a speed would spin the loop for nothing.
  return 0
}

export const computeScrollIntent = (args: {
  readonly pointer: Point
  readonly box: ScrollBoxMetrics
}): Translate => {
  const { pointer, box } = args

  return {
    x: intentForAxis({
      pointerOffset: pointer.x - box.rect.left,
      viewportLength: box.clientWidth,
      scrollOffset: box.scrollLeft,
      contentLength: box.scrollWidth,
    }),
    y: intentForAxis({
      pointerOffset: pointer.y - box.rect.top,
      viewportLength: box.clientHeight,
      scrollOffset: box.scrollTop,
      contentLength: box.scrollHeight,
    }),
  }
}

const SCROLLING_OVERFLOW_VALUES = ['auto', 'scroll', 'overlay'] as const

const canElementScroll = (element: Element): boolean => {
  // The shorthand is read alongside the longhands on purpose. A browser resolves `overflow:
  // auto` into both longhands, but jsdom leaves them empty and reports only the shorthand — so
  // checking longhands alone finds nothing in the test environment and checking the shorthand
  // alone misses a consumer who set `overflow-y` directly.
  const { overflow, overflowX, overflowY } = getComputedStyle(element)
  const allowsScrolling = (SCROLLING_OVERFLOW_VALUES as readonly string[]).some(
    (value) => overflow === value || overflowY === value || overflowX === value,
  )
  if (!allowsScrolling) return false

  // `overflow: auto` on a box whose content fits is not a scroll container in any useful sense,
  // and treating it as one would stop the search before the box that can actually move.
  const hasSomewhereToGo =
    element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
  return hasSomewhereToGo
}

/**
 * The nearest ancestor that genuinely scrolls, or the viewport.
 *
 * A drag near the bottom of a page with no scrolling container should still scroll the page, so
 * this falls back to the viewport rather than giving up. `document.scrollingElement` is the
 * right answer and is `undefined` in jsdom, hence the documentElement fallback.
 */
export const findScrollableAncestor = (element: Element): Element => {
  let candidate = element.parentElement

  while (candidate && candidate !== document.body) {
    if (canElementScroll(candidate)) return candidate
    candidate = candidate.parentElement
  }

  return document.scrollingElement ?? document.documentElement
}

const readMetrics = (element: Element): ScrollBoxMetrics => {
  // One batch of reads, no writes among them.
  const { top, left, width, height } = element.getBoundingClientRect()
  return {
    rect: { top, left, width, height },
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  }
}

export type AutoScroller = {
  start: () => void
  stop: () => void
}

/**
 * The loop. Runs only while a **pointer** drag is active: a drag with no pointer origin has no
 * edge distance to compute, so a keyboard drag never enters here and uses `scrollIntoView`
 * instead (`ANALYSIS.md` § A9.2).
 */
export const createAutoScroller = (store: DragStore): AutoScroller => {
  let frame: number | null = null
  let container: Element | null = null

  const livePointer = (): Point | null => {
    const { origin, translate } = store.getState()
    if (!origin?.pointer) return null
    return { x: origin.pointer.x + translate.x, y: origin.pointer.y + translate.y }
  }

  const step = (): void => {
    frame = null
    const pointer = livePointer()
    if (!pointer || !container) return

    const intent = computeScrollIntent({ pointer, box: readMetrics(container) })
    const shouldScroll = intent.x !== 0 || intent.y !== 0

    if (shouldScroll) {
      container.scrollLeft += intent.x
      container.scrollTop += intent.y
      // Everything below the scroll just moved, so `over` computed against the cached rects is
      // now wrong. This is the step naive autoscroll skips, and it is why the drop lands one
      // row off after a scroll.
      store.markRectsDirty()
    }

    frame = requestAnimationFrame(step)
  }

  return {
    start: () => {
      const activeNode = store.getActiveNode()
      const isPointerDrag = store.getState().origin?.pointer != null
      if (frame !== null || !activeNode || !isPointerDrag) return

      container = findScrollableAncestor(activeNode)
      frame = requestAnimationFrame(step)
    },
    stop: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      container = null
    },
  }
}
