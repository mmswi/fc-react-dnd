'use client'

import { type RefCallback, useCallback } from 'react'
import { useDndContext } from './internal/context.js'
import { translatesAreEqual } from './internal/geometry.js'
import { LIST_DIRECTIONS, projectList } from './internal/list-projection.js'
import { buildNodeStyle } from './internal/node-style.js'
import { useSortableListContext } from './internal/sortable-context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { DndData, DndId, DragHandleProps, DragNodeStyle, Translate } from './types.js'
import { useDraggable } from './use-draggable.js'
import { useDroppable } from './use-droppable.js'

/**
 * The hook a list item uses: one node registered as both a draggable and a droppable, plus the
 * translate that moves it out of the way.
 *
 * The translate is read off the **memoised** list projection through an O(1) map lookup. That
 * is perf invariant 9 in its load-bearing form: this selector runs for every item on every
 * notification whether or not anything re-renders, so computing the projection here instead of
 * reading it would make the move path O(N²) and lose the frame no matter how few items rendered.
 */

const NO_TRANSLATE: Translate = { x: 0, y: 0 }

/** What a displaced row's transform eases with while a drag is active. */
export const SORTABLE_SETTLE_TRANSITION = 'transform 200ms ease'

type TranslateSlice = {
  readonly translate: Translate
  /**
   * Whether a drag was active when `translate` last changed. Needed alongside the translate
   * because zero means two different things: mid-drag it is a row gliding home and should ease,
   * at drop it is the commit that also reorders the DOM and must not.
   */
  readonly isDragActive: boolean
}

const NO_DRAG_SLICE: TranslateSlice = { translate: NO_TRANSLATE, isDragActive: false }

/**
 * Compared on `translate` alone. `isDragActive` flips for every row at every drag start and end,
 * so comparing it too would re-render all N rows at both moments. It can therefore go stale on a
 * row whose translate never changed — harmlessly, since a transition only matters in the commit
 * where the transform changes, and that commit re-renders the row with a fresh flag.
 */
const translateSlicesAreEqual = (a: TranslateSlice, b: TranslateSlice): boolean =>
  translatesAreEqual(a.translate, b.translate)

export type UseSortableOptions = {
  readonly id: DndId
  readonly data?: DndData
  readonly disabled?: boolean
  /**
   * The easing a **displaced** row settles with, as a CSS `transition` value.
   *
   * `null` turns it off. It is never applied to the row under the pointer, or in the commit
   * that ends a drag — see `UseSortableResult.transition` for why that second one matters.
   */
  readonly transition?: string | null
  /**
   * Whether the dragged row follows the pointer. **On by default — it is what makes a drag feel
   * like a drag.** Off, the row is drawn at its projected landing slot instead, which jumps a
   * whole row-height at a time and reads as teleporting.
   *
   * It costs one render per pointermove, for one component; the other rows still re-render only
   * when they actually move. Turn it **off** when a `DragOverlay` carries the motion.
   */
  readonly trackTransform?: boolean
}

export type UseSortableResult = {
  readonly setNodeRef: RefCallback<HTMLElement>
  readonly handleProps: DragHandleProps
  readonly isDragging: boolean
  /**
   * Whether this row is the current drop target. Exposed rather than swallowed: composing
   * `useDroppable` already pays for the subscription, and a row that re-renders for a slice its
   * consumer cannot read is a render spent on nothing.
   */
  readonly isOver: boolean
  /** Where this item sits relative to its resting position. `{ x: 0, y: 0 }` when it has not moved. */
  readonly translate: Translate
  /**
   * The `transition` to put next to the transform: `SORTABLE_SETTLE_TRANSITION` for a row being
   * displaced by an active drag, `undefined` otherwise.
   *
   * Both `undefined` cases are load-bearing. Easing the dragged row makes it lag behind the hand.
   * And the commit that ends a drag reorders the DOM and zeroes the transforms **at once**, so a
   * transition still active there animates the zeroing — every moved row paints offset from its
   * new slot and glides in, which is "the dropped row comes in from above" instead of landing.
   */
  readonly transition: string | undefined
  /**
   * `transform`, `transition` and `touch-action` in one object — pass it straight to `style`.
   *
   * `translate` and `transition` stay exposed for consumers driving their own animation; this
   * is the path that is correct by default.
   */
  readonly style: DragNodeStyle
}

export const useSortable = (options: UseSortableOptions): UseSortableResult => {
  const {
    id,
    data,
    disabled,
    trackTransform = true,
    transition: settleTransition = SORTABLE_SETTLE_TRANSITION,
  } = options
  const { store } = useDndContext('useSortable')
  const { items, direction } = useSortableListContext('useSortable')

  // `trackTransform: false` either way: this hook needs the live translate for the active row
  // *and* the projection translate for every other row, and the one selector below already knows
  // which is which — cheaper than two subscriptions that each fire separately.
  const draggable = useDraggable({ id, data, disabled, trackTransform: false })
  const droppable = useDroppable({ id, data, disabled })

  const setNodeRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      draggable.setNodeRef(node)
      droppable.setNodeRef(node)
    },
    [draggable.setNodeRef, droppable.setNodeRef],
  )

  const slice = useStoreSelector(
    store,
    (state): TranslateSlice => {
      if (state.origin === null) return NO_DRAG_SLICE

      // The dragged row follows the pointer. Its projected landing slot is *not* where it should
      // be drawn — the gap the other rows open up is the preview, and the row itself belongs
      // under the cursor.
      const isBeingDragged = state.origin.id === id
      if (isBeingDragged) {
        if (!trackTransform) return { translate: NO_TRANSLATE, isDragActive: true }

        // Constrained to the list's own axis. The pointer delta has both components, and a
        // vertical list that honoured the horizontal one lets the dragged row wander out of the
        // list sideways — which is what it looks like when a sortable "breaks".
        const translate =
          direction === LIST_DIRECTIONS.vertical
            ? { x: 0, y: state.translate.y }
            : { x: state.translate.x, y: 0 }
        return { translate, isDragActive: true }
      }

      return {
        translate:
          projectList(state, { itemIds: items, direction })?.translateById.get(id) ?? NO_TRANSLATE,
        isDragActive: true,
      }
    },
    // By value. Memoising the projection buys one computation per move, not stable `Translate`
    // objects inside it — so on `Object.is` every row would re-render on every pointermove.
    translateSlicesAreEqual,
  )

  const isDisplacedByActiveDrag = slice.isDragActive && !draggable.isDragging
  const transition =
    isDisplacedByActiveDrag && settleTransition !== null ? settleTransition : undefined

  return {
    setNodeRef,
    handleProps: draggable.handleProps,
    isDragging: draggable.isDragging,
    isOver: droppable.isOver,
    translate: slice.translate,
    transition,
    style: buildNodeStyle(slice.translate, transition),
  }
}
