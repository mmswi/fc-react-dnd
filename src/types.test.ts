import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type CollisionDetection,
  type DndData,
  type DndId,
  DRAG_CANCEL_REASONS,
  DRAG_DIRECTIONS,
  type DragCancelEvent,
  type DragCancelReason,
  type DragDirection,
  type DragEndEvent,
  type DragOverEvent,
  type DragSession,
  type DragStartEvent,
  type DroppableCandidate,
  type Rect,
  type Sensor,
  type Translate,
} from './types.js'

// These assertions are checked by `bun run typecheck`, not at runtime — `expectTypeOf` erases.
// They exist so a later widening of a public shape fails the gate here rather than in a
// consumer's codebase.

describe('the identifier and payload vocabulary', () => {
  it('accepts both id flavours React keys come in', () => {
    expectTypeOf<DndId>().toEqualTypeOf<string | number>()
  })

  it('carries consumer payloads as unknown-valued records, never any', () => {
    expectTypeOf<DndData>().toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf<DndData[string]>().toEqualTypeOf<unknown>()
  })

  it('describes a rect by the four numbers a caller can state without contradicting itself', () => {
    expectTypeOf<Rect>().toEqualTypeOf<{
      readonly top: number
      readonly left: number
      readonly width: number
      readonly height: number
    }>()
  })
})

describe('DragCancelReason', () => {
  it('is exactly the four reasons a drag can end without a drop', () => {
    expectTypeOf<DragCancelReason>().toEqualTypeOf<
      'escape' | 'blur' | 'pointer-cancelled' | 'item-removed'
    >()
  })

  it('has a named constant per member, so no consumer writes the bare string', () => {
    expect(Object.values(DRAG_CANCEL_REASONS)).toEqual([
      'escape',
      'blur',
      'pointer-cancelled',
      'item-removed',
    ])
    expectTypeOf<
      (typeof DRAG_CANCEL_REASONS)[keyof typeof DRAG_CANCEL_REASONS]
    >().toEqualTypeOf<DragCancelReason>()
  })
})

describe('drag events', () => {
  it('makes over nullable everywhere it appears — a drag off-target is the normal case', () => {
    expectTypeOf<DragOverEvent['over']>().toBeNullable()
    expectTypeOf<DragEndEvent['over']>().toBeNullable()
    expectTypeOf<DragCancelEvent['over']>().toBeNullable()
  })

  it('never makes active nullable — there is no drag event without a dragged item', () => {
    expectTypeOf<DragStartEvent['active']>().not.toBeNullable()
    expectTypeOf<DragEndEvent['active']>().not.toBeNullable()
  })

  it('carries the payload through to the callbacks unchanged', () => {
    expectTypeOf<DragStartEvent['active']['data']>().toEqualTypeOf<DndData>()
  })

  it('makes the cancel event carry why it fired, so consumers can tell Escape from a forced cancel', () => {
    expectTypeOf<DragCancelEvent['reason']>().toEqualTypeOf<DragCancelReason>()
  })
})

describe('the sensor seam', () => {
  it('gives a sensor exactly move / end / cancel, plus liveness and the two questions it cannot answer alone', () => {
    // `findTargetInDirection` and `crossAxisStepPx` are the same shape: a sensor states an
    // intent, and the store — which holds the geometry and the tree's indent — resolves it.
    expectTypeOf<keyof DragSession>().toEqualTypeOf<
      'isActive' | 'crossAxisStepPx' | 'move' | 'end' | 'cancel' | 'findTargetInDirection'
    >()
  })

  it('reports a move as a translate, so keyboard and pointer drags are indistinguishable downstream', () => {
    expectTypeOf<DragSession['move']>().parameter(0).toEqualTypeOf<Translate>()
  })

  it('requires a cancel to say why', () => {
    expectTypeOf<DragSession['cancel']>().parameter(0).toEqualTypeOf<DragCancelReason>()
  })

  it('names the four directions a keyboard drag can step in', () => {
    expectTypeOf<DragDirection>().toEqualTypeOf<'up' | 'down' | 'left' | 'right'>()
    expect(Object.values(DRAG_DIRECTIONS)).toEqual(['up', 'down', 'left', 'right'])
  })

  it('makes a sensor a named factory product, not a bare function', () => {
    expectTypeOf<Sensor['name']>().toEqualTypeOf<string>()
    expectTypeOf<Sensor['activate']>().toBeFunction()
  })
})

describe('the collision seam', () => {
  it('answers with an id or nothing — never a rect, never a candidate object', () => {
    expectTypeOf<ReturnType<CollisionDetection>>().toEqualTypeOf<DndId | null>()
  })

  it('receives candidates as an ordered array, so ties can resolve by registration order', () => {
    type Candidates = Parameters<CollisionDetection>[0]['droppables']
    expectTypeOf<Candidates>().toEqualTypeOf<readonly DroppableCandidate[]>()
    expectTypeOf<Candidates[number]>().toEqualTypeOf<DroppableCandidate>()
  })
})
