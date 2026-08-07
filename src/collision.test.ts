import { describe, expect, it } from 'vitest'
import { closestCenter } from './collision.js'
import type { CollisionArgs, DroppableCandidate, Rect } from './types.js'

const rectAt = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
})

const candidate = (id: string, rect: Rect, data: DroppableCandidate['data'] = {}) => ({
  id,
  rect,
  data,
})

const collideWith = (droppables: readonly DroppableCandidate[], activeRect: Rect) =>
  closestCenter({ active: { id: 'active', rect: activeRect }, droppables } satisfies CollisionArgs)

describe('closestCenter', () => {
  it('picks the droppable whose centre is nearest the active rect centre', () => {
    const near = candidate('near', rectAt(0, 100))
    const far = candidate('far', rectAt(0, 400))

    expect(collideWith([far, near], rectAt(0, 90))).toBe('near')
  })

  it('measures from centres, not from overlap — a wide neighbour does not win by covering it', () => {
    // 'overlapping' spans the active rect entirely, but its centre is 200px away. 'separate'
    // does not touch the active rect at all, and its centre is 60px away. A strategy that
    // scored by intersection would pick the first; this one has to pick the second.
    const active = rectAt(480, 0, 40, 40)
    const overlapping = candidate('overlapping', rectAt(0, 0, 600, 40))
    const separate = candidate('separate', rectAt(480, 60, 40, 40))

    expect(collideWith([overlapping, separate], active)).toBe('separate')
  })

  it('returns nothing for an empty candidate list', () => {
    expect(collideWith([], rectAt(0, 0))).toBeNull()
  })

  it('returns the only candidate however far away it is — range limiting is not its job', () => {
    const distant = candidate('distant', rectAt(9000, 9000))

    expect(collideWith([distant], rectAt(0, 0))).toBe('distant')
  })

  it('resolves an exact tie by registration order', () => {
    const above = candidate('above', rectAt(0, -100))
    const below = candidate('below', rectAt(0, 100))

    expect(collideWith([above, below], rectAt(0, 0))).toBe('above')
    expect(collideWith([below, above], rectAt(0, 0))).toBe('below')
  })

  it('does not let candidate order flip a genuine winner', () => {
    const winner = candidate('winner', rectAt(0, 10))
    const loser = candidate('loser', rectAt(0, 300))

    expect(collideWith([winner, loser], rectAt(0, 0))).toBe('winner')
    expect(collideWith([loser, winner], rectAt(0, 0))).toBe('winner')
  })

  it('is deterministic — the same input twice gives the same winner', () => {
    const droppables = [
      candidate('a', rectAt(10, 100)),
      candidate('b', rectAt(-10, 100)),
      candidate('c', rectAt(0, 101)),
    ]

    expect(collideWith(droppables, rectAt(0, 0))).toBe(collideWith(droppables, rectAt(0, 0)))
  })

  it('considers every candidate it is handed, including ones a consumer marked disabled', () => {
    // Filtering disabled droppables is the store's job (ANALYSIS.md A9.6). This test exists so
    // nobody "fixes" the strategy by teaching it to read policy out of the data payload — a
    // strategy that sniffs `data` cannot be swapped for a custom one that uses `data` for
    // something else entirely.
    const disabledButNearest = candidate('disabled', rectAt(0, 10), { disabled: true })
    const enabledButFurther = candidate('enabled', rectAt(0, 300))

    expect(collideWith([disabledButNearest, enabledButFurther], rectAt(0, 0))).toBe('disabled')
  })
})
