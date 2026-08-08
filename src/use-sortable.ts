'use client'

import { type RefCallback, useCallback } from 'react'
import { useDndContext } from './internal/context.js'
import { translatesAreEqual } from './internal/geometry.js'
import { LIST_DIRECTIONS, projectList } from './internal/list-projection.js'
import { useSortableListContext } from './internal/sortable-context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { DndData, DndId, DragHandleProps, Translate } from './types.js'
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

export type UseSortableOptions = {
  readonly id: DndId
  readonly data?: DndData
  readonly disabled?: boolean
  /**
   * Whether the row being dragged follows the pointer.
   *
   * **On by default, and it is what makes a drag feel like a drag.** With it off, the dragged
   * row is given its *projected landing slot* instead — which is a defensible preview and feels
   * like teleporting, because the row jumps a whole row-height at a time instead of moving with
   * your hand.
   *
   * It costs one render per pointermove, for one component. The other rows still only re-render
   * when they actually move, which is the whole point.
   *
   * Turn it **off** when a `DragOverlay` carries the motion and the source row stays put or
   * hidden — then nothing needs to re-render per move at all.
   */
  readonly trackTransform?: boolean
}

export type UseSortableResult = {
  readonly setNodeRef: RefCallback<HTMLElement>
  readonly handleProps: DragHandleProps
  readonly isDragging: boolean
  /**
   * Whether this row is the current drop target.
   *
   * Exposed rather than swallowed: composing `useDroppable` already pays for the subscription,
   * and a row that re-renders for a slice its consumer cannot read is a render spent on nothing.
   */
  readonly isOver: boolean
  /** Where this item sits relative to its resting position. `{ x: 0, y: 0 }` when it has not moved. */
  readonly translate: Translate
}

export const useSortable = (options: UseSortableOptions): UseSortableResult => {
  const { id, data, disabled, trackTransform = true } = options
  const { store } = useDndContext('useSortable')
  const { items, direction } = useSortableListContext('useSortable')

  // `useDraggable`'s own transform subscription stays off either way: this hook needs the live
  // translate for the active row *and* the projection translate for every other row, and one
  // selector that already knows which is which is cheaper than two that each fire separately.
  const draggable = useDraggable({ id, data, disabled, trackTransform: false })
  const droppable = useDroppable({ id, data, disabled })

  const setNodeRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      draggable.setNodeRef(node)
      droppable.setNodeRef(node)
    },
    [draggable.setNodeRef, droppable.setNodeRef],
  )

  const translate = useStoreSelector(
    store,
    (state) => {
      // The dragged row follows the pointer. Its projected landing slot is *not* where it should
      // be drawn — the gap the other rows open up is the preview, and the row itself belongs
      // under the cursor.
      const isBeingDragged = state.origin?.id === id
      if (isBeingDragged) {
        if (!trackTransform) return NO_TRANSLATE

        // Constrained to the list's own axis. The pointer delta has both components, and a
        // vertical list that honoured the horizontal one lets the dragged row wander out of the
        // list sideways — which is what it looks like when a sortable "breaks".
        return direction === LIST_DIRECTIONS.vertical
          ? { x: 0, y: state.translate.y }
          : { x: state.translate.x, y: 0 }
      }

      return (
        projectList(state, { itemIds: items, direction })?.translateById.get(id) ?? NO_TRANSLATE
      )
    },
    // Compared by value, not by reference. The projection is recomputed once per move — that is
    // the point of memoising it — so the `Translate` objects inside it are new every time even
    // when the numbers are not. Left on `Object.is`, every item in the list re-renders on every
    // pointermove: perf invariant 9 satisfied and perf invariant 4 quietly lost.
    translatesAreEqual,
  )

  return {
    setNodeRef,
    handleProps: draggable.handleProps,
    isDragging: draggable.isDragging,
    isOver: droppable.isOver,
    translate,
  }
}
