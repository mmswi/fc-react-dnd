'use client'

import { createContext, useContext } from 'react'
import type { DndId } from '../types.js'
import type { ListDirection } from './list-projection.js'

/**
 * Scopes a set of sortable items to one list.
 *
 * Lives in `internal/` rather than in `sortable-list.tsx` so that `useSortable` and
 * `SortableList` can both reach it without one public subpath importing another.
 *
 * Like the provider context, this value must be **stable for the list's lifetime**: it is read
 * by every item, and a churning identity re-renders all of them on every parent render
 * (`ANALYSIS.md` § A3.5).
 */
export type SortableListContextValue = {
  readonly listId: string
  readonly direction: ListDirection
  /**
   * The ids in this list. Doubles as the projection memo's inner key, so a consumer passing an
   * inline array defeats the memo and recomputes the projection once per subscriber per move —
   * a documented contract, with its failure mode.
   */
  readonly items: readonly DndId[]
}

export const SortableListContext = createContext<SortableListContextValue | null>(null)

export const useSortableListContext = (hookName: string): SortableListContextValue => {
  const value = useContext(SortableListContext)

  if (!value) {
    throw new Error(
      `fc-react-dnd: ${hookName}() was called outside a <SortableList>. Wrap the items in <SortableList> from 'fc-react-dnd/sortable-list'.`,
    )
  }

  return value
}
