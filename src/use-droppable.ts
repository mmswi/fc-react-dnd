'use client'

import { type RefCallback, useCallback, useEffect, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { DndData, DndId } from './types.js'

/**
 * Turn any element into a drop target.
 *
 * Registration follows the same split as `useDraggable`: the ref callback carries the node, an
 * effect keyed on `[store, id]` owns the registration's lifetime. See that file for why each
 * half exists — both mistakes end in a cancelled drag.
 *
 * The one behaviour that is specific here is what a registration *change* does mid-drag. The
 * store's asymmetric A6 policy handles it: an arrival re-measures every rect and re-collides
 * (an inserted row shifts everything below it, so filtering by id would not be enough), while a
 * departure cancels the drag rather than resolving a drop against geometry that has moved.
 */

const NO_DATA: DndData = {}

export type UseDroppableOptions = {
  readonly id: DndId
  readonly data?: DndData
  readonly disabled?: boolean
}

export type UseDroppableResult = {
  readonly setNodeRef: RefCallback<HTMLElement>
  readonly isOver: boolean
}

export const useDroppable = (options: UseDroppableOptions): UseDroppableResult => {
  const { id, data, disabled = false } = options
  const { store } = useDndContext('useDroppable')

  const nodeRef = useRef<HTMLElement | null>(null)
  const setNodeRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      nodeRef.current = node
      if (node !== null) store.registerDroppable(id, node)
    },
    [store, id],
  )

  useEffect(() => {
    const node = nodeRef.current
    if (node !== null) store.registerDroppable(id, node)
    return () => {
      store.unregisterDroppable(id)
    }
  }, [store, id])

  useEffect(() => {
    store.updateDroppable(id, { data: data ?? NO_DATA, disabled })
  }, [store, id, data, disabled])

  // An id, not an object: many moves inside one target leave this unchanged, so the droppable
  // does not re-render for any of them.
  const isOver = useStoreSelector(store, (state) => state.overId === id)

  return { setNodeRef, isOver }
}
