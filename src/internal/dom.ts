import type { Rect } from '../types.js'

/**
 * The library's only DOM read, behind a seam.
 *
 * Two reasons it lives alone in its own module: the store can be handed a substitute in tests
 * so measurement calls are countable (perf invariant 1 is asserted, not hoped for), and
 * there is exactly one place to look when asking "where does this library touch layout?".
 */
export const readElementRect = (element: HTMLElement): Rect => {
  const { top, left, width, height } = element.getBoundingClientRect()
  return { top, left, width, height }
}
