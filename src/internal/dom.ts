'use client'

import type { Rect, Translate } from '../types.js'

/**
 * The library's only DOM read, behind a seam.
 *
 * Two reasons it lives alone in its own module: the store can be handed a substitute in tests so
 * measurement calls are countable (perf invariant 1 is asserted, not hoped for), and there is
 * exactly one place to look when asking "where does this library touch layout?".
 */

const NO_TRANSLATION: Translate = { x: 0, y: 0 }

/**
 * The translation baked into a computed `transform`.
 *
 * Both shapes are handled because the two environments disagree: a browser resolves everything to
 * `matrix()`/`matrix3d()`, while jsdom hands back whatever was written. Matching only the matrix
 * forms would make this silently do nothing in the environment the geometry is tested in.
 *
 * Parsed by hand rather than through `DOMMatrixReadOnly`, which jsdom does not implement.
 */
export const translationOfTransform = (transform: string): Translate => {
  const matrix = transform.match(/^matrix(3d)?\(([^)]+)\)$/)
  if (matrix) {
    const parts = (matrix[2] ?? '').split(',').map((part) => Number.parseFloat(part))
    // `matrix(a, b, c, d, tx, ty)`; `matrix3d` puts them at m41/m42, indices 12 and 13.
    const isMatrix3d = matrix[1] === '3d'
    return finiteTranslation(isMatrix3d ? parts[12] : parts[4], isMatrix3d ? parts[13] : parts[5])
  }

  const translate = transform.match(/^translate(3d|X|Y)?\(([^)]+)\)$/)
  if (!translate) return NO_TRANSLATION

  const parts = (translate[2] ?? '').split(',').map((part) => Number.parseFloat(part))
  const axis = translate[1]
  if (axis === 'X') return finiteTranslation(parts[0], 0)
  if (axis === 'Y') return finiteTranslation(0, parts[0])
  return finiteTranslation(parts[0], parts[1])
}

const finiteTranslation = (x: number | undefined, y: number | undefined): Translate =>
  Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : NO_TRANSLATION

/**
 * Where the element **rests**, not where it currently appears.
 *
 * We subtract the element's own translation because `getBoundingClientRect` reports the visual
 * box, transform included, and this library asks consumers to animate rows with `transform`. A
 * drag begun while the previous drop's transition is still running would otherwise measure every
 * row mid-flight and build the projection on geometry that is about to stop being true — the
 * second drag of a session displacing the wrong rows.
 */
export const readElementRect = (element: HTMLElement): Rect => {
  const { top, left, width, height } = element.getBoundingClientRect()
  const translation = translationOfTransform(getComputedStyle(element).transform)

  return { top: top - translation.y, left: left - translation.x, width, height }
}
