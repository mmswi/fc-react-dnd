'use client'

import { type ReactNode, useEffect, useId, useMemo, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import { LIST_DIRECTIONS, type ListDirection, projectList } from './internal/list-projection.js'
import { SortableListContext, type SortableListContextValue } from './internal/sortable-context.js'
import type { DndId } from './types.js'
import { useDndMonitor } from './use-dnd-monitor.js'

/**
 * Scopes a set of sortable items to one list and hands the consumer the only thing they
 * actually want at the end.
 *
 * The list itself does not re-render during a drag: it computes the result through
 * `useDndMonitor`, which subscribes without rendering.
 */

export type SortEndEvent = {
  readonly activeId: DndId
  readonly fromIndex: number
  readonly toIndex: number
  /**
   * The neighbours the item landed between, by **id**.
   *
   * Indices are positional and the consumer applies them to whatever their list is at drop
   * time — which a concurrent edit may have changed underneath the drag. Ids survive that;
   * a sibling removed before the insertion point shifts every index after it and no id at all
   * (`ANALYSIS.md` § A6).
   */
  readonly afterId: DndId | null
  readonly beforeId: DndId | null
}

export type SortableListProps = {
  children: ReactNode
  /**
   * Must be **referentially stable** across renders. It is the projection memo's key, so an
   * inline array recomputes the projection once per item per pointermove.
   */
  items: readonly DndId[]
  direction?: ListDirection
  id?: string

  onSortEnd?: (event: SortEndEvent) => void
}

export const SortableList = ({
  children,
  items,
  direction = LIST_DIRECTIONS.vertical,
  id,
  onSortEnd,
}: SortableListProps) => {
  const generatedListId = useId()
  const listId = id ?? generatedListId
  const { store } = useDndContext('SortableList')

  const latest = useRef({ items, direction, onSortEnd })
  useEffect(() => {
    latest.current = { items, direction, onSortEnd }
  })

  useDndMonitor({
    onDragEnd: () => {
      const { items: currentItems, direction: currentDirection, onSortEnd: report } = latest.current
      if (!report) return

      // Drag events fire before the store resets, so this is the final projection rather than a
      // reconstruction of one.
      const projection = projectList(store.getState(), {
        itemIds: currentItems,
        direction: currentDirection,
      })
      // Null means the dragged item belongs to another list — or to none.
      if (!projection) return

      const { orderedIds, fromIndex, toIndex } = projection
      // A drop that changes nothing is not a sort. Consumers build undo stacks on this event,
      // and an entry that undoes to the same order is worse than no entry.
      if (fromIndex === toIndex) return

      const withoutActive = orderedIds.filter((_unused, index) => index !== fromIndex)
      const landingIndex = toIndex

      report({
        activeId: orderedIds[fromIndex] as DndId,
        fromIndex,
        toIndex,
        afterId: withoutActive[landingIndex - 1] ?? null,
        beforeId: withoutActive[landingIndex] ?? null,
      })
    },
  })

  const contextValue = useMemo<SortableListContextValue>(
    () => ({ listId, direction, items }),
    [listId, direction, items],
  )

  return <SortableListContext value={contextValue}>{children}</SortableListContext>
}
