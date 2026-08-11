import type { Translate } from '../types.js'
import { type DndId, DRAG_DIRECTIONS, type DragDirection, type Point, type Rect } from '../types.js'

/**
 * Pure rect arithmetic. Everything expensive in this library reduces to this file: rects are
 * read from the DOM once at drag start and every move afterwards is arithmetic against the
 * cache, so nothing here may touch `document`, `window`, or React.
 */

export type RectCandidate = {
  readonly id: DndId
  readonly rect: Rect
}

export const centerOf = (rect: Rect): Point => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
})

export const translateRect = (rect: Rect, translate: Translate): Rect => ({
  top: rect.top + translate.y,
  left: rect.left + translate.x,
  width: rect.width,
  height: rect.height,
})

// Pythagora's theorem a^2 + b^2 = c^2 - Math.hypot gives you c
export const distanceBetweenPoints = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Value equality for a translate, for use as a selector's comparison.
 *
 * Memoising a projection once per move buys one *computation* per move; it does not make the
 * `Translate` objects inside it stable, because the projection itself is new. Without comparing
 * by value, every subscriber sees a fresh reference and re-renders — perf invariant 9 satisfied
 * and perf invariant 4 quietly lost.
 */
export const translatesAreEqual = (a: Translate, b: Translate): boolean =>
  a.x === b.x && a.y === b.y

/**
 * How much harder a sideways offset counts than distance along the direction of travel.
 *
 * Above 1, an aligned candidate beats a euclidean-closer one that drifts off the axis — which is
 * what makes ArrowDown feel like "the next item down" rather than "the nearest thing that happens
 * to be lower". Only the ordering matters, not the exact figure.
 *
 * This is the default, for candidates on a grid or scattered on a page. A **tree** passes zero,
 * because its rows are offset horizontally *by depth* and any penalty makes ArrowUp prefer a
 * shallow row three positions away over the deep row immediately above. The caller decides, since
 * only the caller knows the layout.
 */
const DEFAULT_CROSS_AXIS_PENALTY = 2

/** `sign` points the main axis the way the key does: +1 is down or right, -1 is up or left. */
type Axis = { readonly main: 'x' | 'y'; readonly cross: 'x' | 'y'; readonly sign: 1 | -1 }

const AXIS_BY_DIRECTION: Record<DragDirection, Axis> = {
  [DRAG_DIRECTIONS.up]: { main: 'y', cross: 'x', sign: -1 },
  [DRAG_DIRECTIONS.down]: { main: 'y', cross: 'x', sign: 1 },
  [DRAG_DIRECTIONS.left]: { main: 'x', cross: 'y', sign: -1 },
  [DRAG_DIRECTIONS.right]: { main: 'x', cross: 'y', sign: 1 },
}

/**
 * The nearest candidate **in a direction** — the keyboard's "next item over".
 *
 * Filtering by direction happens before scoring, so a candidate behind the movement can never
 * win however close it is. Ties keep the first candidate in the array, which is registration
 * order, so the same tree always produces the same keyboard path.
 */
export const findNearestRectInDirection = (args: {
  readonly from: Rect
  readonly direction: DragDirection
  readonly candidates: readonly RectCandidate[]
  readonly crossAxisPenalty?: number
}): RectCandidate | null => {
  const { from, direction, candidates, crossAxisPenalty = DEFAULT_CROSS_AXIS_PENALTY } = args
  const axis = AXIS_BY_DIRECTION[direction]
  const origin = centerOf(from)

  let best: RectCandidate | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const center = centerOf(candidate.rect)
    const alongDirection = (center[axis.main] - origin[axis.main]) * axis.sign
    const isAhead = alongDirection > 0
    if (!isAhead) continue

    const offAxisDistance = Math.abs(center[axis.cross] - origin[axis.cross])
    const score = alongDirection + offAxisDistance * crossAxisPenalty

    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}
