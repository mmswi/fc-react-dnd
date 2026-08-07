import { describe, expect, it } from 'vitest'
import { DRAG_DIRECTIONS, type Rect } from '../types.js'
import {
  centerOf,
  distanceBetweenPoints,
  findNearestRectInDirection,
  type RectCandidate,
  translateRect,
} from './geometry.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

describe('centerOf', () => {
  it('is the midpoint of the rect, not its origin', () => {
    expect(centerOf(rectAt(20, 10, 100, 40))).toEqual({ x: 70, y: 30 })
  })

  it('handles a zero-sized rect without producing NaN', () => {
    expect(centerOf(rectAt(5, 7, 0, 0))).toEqual({ x: 5, y: 7 })
  })
})

describe('translateRect', () => {
  it('moves the origin and leaves the size alone', () => {
    expect(translateRect(rectAt(20, 10, 100, 40), { x: 5, y: -3 })).toEqual({
      left: 25,
      top: 7,
      width: 100,
      height: 40,
    })
  })

  it('returns a new rect rather than mutating the one it was given', () => {
    const original = rectAt(0, 0)

    const moved = translateRect(original, { x: 10, y: 10 })

    expect(original.left).toBe(0)
    expect(moved).not.toBe(original)
  })

  it('is a no-op for a zero translate', () => {
    expect(translateRect(rectAt(4, 8), { x: 0, y: 0 })).toEqual(rectAt(4, 8))
  })
})

describe('distanceBetweenPoints', () => {
  it('measures a 3-4-5 triangle as 5', () => {
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('is zero for coincident points rather than undefined', () => {
    expect(distanceBetweenPoints({ x: 9, y: 9 }, { x: 9, y: 9 })).toBe(0)
  })

  it('is symmetric', () => {
    const a = { x: 2, y: 11 }
    const b = { x: -6, y: 4 }

    expect(distanceBetweenPoints(a, b)).toBe(distanceBetweenPoints(b, a))
  })
})

describe('findNearestRectInDirection', () => {
  const from = rectAt(0, 0)

  it('excludes candidates behind the direction of travel', () => {
    const above: RectCandidate = { id: 'above', rect: rectAt(0, -100) }
    const below: RectCandidate = { id: 'below', rect: rectAt(0, 100) }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [above, below],
    })

    expect(found?.id).toBe('below')
  })

  it('excludes a candidate sharing the start centre — it is not ahead of anything', () => {
    const sameSpot: RectCandidate = { id: 'same', rect: from }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [sameSpot],
    })

    expect(found).toBeNull()
  })

  it('returns nothing when no candidate lies ahead, rather than the nearest anywhere', () => {
    const behind: RectCandidate = { id: 'behind', rect: rectAt(0, -20) }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [behind],
    })

    expect(found).toBeNull()
  })

  it('prefers a candidate directly ahead over a nearer one off to the side', () => {
    // Straight down at 100px versus diagonal at the same euclidean distance. Picking by raw
    // distance would tie; picking by the movement axis alone would pick the diagonal, since
    // it is only 60px down. Keyboard navigation has to feel like "the next item down".
    const straightAhead: RectCandidate = { id: 'straight', rect: rectAt(0, 100) }
    const offAxis: RectCandidate = { id: 'diagonal', rect: rectAt(80, 60) }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [offAxis, straightAhead],
    })

    expect(found?.id).toBe('straight')
  })

  it('still takes the off-axis candidate when nothing is ahead on the axis', () => {
    const offAxis: RectCandidate = { id: 'diagonal', rect: rectAt(300, 60) }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [offAxis],
    })

    expect(found?.id).toBe('diagonal')
  })

  it('picks the nearest of several candidates on the same axis', () => {
    const near: RectCandidate = { id: 'near', rect: rectAt(0, 50) }
    const far: RectCandidate = { id: 'far', rect: rectAt(0, 500) }

    const found = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [far, near],
    })

    expect(found?.id).toBe('near')
  })

  it('resolves an exact tie by registration order, not by object iteration order', () => {
    const first: RectCandidate = { id: 'first', rect: rectAt(-100, 100) }
    const second: RectCandidate = { id: 'second', rect: rectAt(100, 100) }

    const forwards = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [first, second],
    })
    const backwards = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates: [second, first],
    })

    expect(forwards?.id).toBe('first')
    expect(backwards?.id).toBe('second')
  })

  it('is deterministic — the same input twice gives the same winner', () => {
    const candidates = [
      { id: 'a', rect: rectAt(10, 100) },
      { id: 'b', rect: rectAt(-10, 100) },
      { id: 'c', rect: rectAt(0, 140) },
    ]

    const first = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates,
    })
    const second = findNearestRectInDirection({
      from,
      direction: DRAG_DIRECTIONS.down,
      candidates,
    })

    expect(first?.id).toBe(second?.id)
  })

  it('works in all four directions', () => {
    const up: RectCandidate = { id: 'up', rect: rectAt(0, -100) }
    const down: RectCandidate = { id: 'down', rect: rectAt(0, 100) }
    const left: RectCandidate = { id: 'left', rect: rectAt(-300, 0) }
    const right: RectCandidate = { id: 'right', rect: rectAt(300, 0) }
    const candidates = [up, down, left, right]

    expect(
      findNearestRectInDirection({ from, direction: DRAG_DIRECTIONS.up, candidates })?.id,
    ).toBe('up')
    expect(
      findNearestRectInDirection({ from, direction: DRAG_DIRECTIONS.down, candidates })?.id,
    ).toBe('down')
    expect(
      findNearestRectInDirection({ from, direction: DRAG_DIRECTIONS.left, candidates })?.id,
    ).toBe('left')
    expect(
      findNearestRectInDirection({ from, direction: DRAG_DIRECTIONS.right, candidates })?.id,
    ).toBe('right')
  })

  it('returns nothing for an empty candidate list', () => {
    expect(
      findNearestRectInDirection({ from, direction: DRAG_DIRECTIONS.down, candidates: [] }),
    ).toBeNull()
  })
})
