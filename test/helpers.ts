import { vi } from 'vitest'

// The harness keeps its own rect shape rather than importing the library's `Rect`. This is the
// input to a jsdom stub, not a library value, and the four numbers a test author actually types
// are top/left/width/height — right and bottom are derived here so no test can state them
// inconsistently.
export type ElementRect = {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Position an element in a world with no layout engine.
 *
 * jsdom reports every rect as zero, so without this every collision test would be comparing
 * identical rects and passing for the wrong reason.
 */
export const mockElementRect = (element: HTMLElement, rect: ElementRect): void => {
  const { top, left, width, height } = rect
  const domRect: DOMRect = {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({ top, left, width, height, right: left + width, bottom: top + height }),
  }

  element.getBoundingClientRect = () => domRect

  // offsetWidth/offsetHeight are prototype getters, so they need redefining per element rather
  // than assigning. Auto-scroll and the overlay read them where a rect would be overkill.
  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true })
  Object.defineProperty(element, 'offsetTop', { value: top, configurable: true })
  Object.defineProperty(element, 'offsetLeft', { value: left, configurable: true })
}

/**
 * Advance exactly one animation frame under `vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })`.
 *
 * Callbacks a frame schedules land in the *next* frame, so a self-rescheduling rAF loop (the
 * overlay's write loop, auto-scroll) can be stepped one frame at a time instead of spinning.
 */
export const nextFrame = async (): Promise<void> => {
  vi.advanceTimersToNextFrame()
  await Promise.resolve()
}
