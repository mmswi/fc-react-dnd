'use client'

import { createContext, useContext } from 'react'
import type { Sensor } from '../types.js'
import type { DragStore } from './store.js'

/**
 * Carries the per-provider handle down the tree, and nothing that changes during a drag.
 *
 * Stability is not a nicety here, it is the floor the whole architecture stands on. Context
 * compares per consumer with `Object.is`; on a change, propagation writes `lanes` directly
 * onto every consumer fiber and walks up setting `childLanes`
 * (`ReactFiberNewContext.js:245-254`) — which is precisely the bookkeeping
 * `bailoutOnAlreadyFinishedWork` re-checks, so the bailout is undone by its own mechanism.
 * And there is **no downstream rescue**: `memo` cannot stop context propagation. If this value
 * churns, no amount of `memo` on list items saves the drag. See `ANALYSIS.md` § A3.5.
 *
 * Everything here is fixed for the provider's lifetime. Drag state is read through
 * `useStoreSelector`, never through context.
 */
export type DndContextValue = {
  readonly store: DragStore
  /** Id of the hidden instructions element every handle's `aria-describedby` points at. */
  readonly instructionsId: string
  readonly draggableRoleDescription: string
  /**
   * `useDraggable` builds its handle props by merging every sensor's activators. A consumer
   * passing this array owns keeping it referentially stable — see `DndProvider`'s note.
   */
  readonly sensors: readonly Sensor[]
}

export const DndContext = createContext<DndContextValue | null>(null)

/**
 * @param hookName the hook the caller is implementing, so the error names what the consumer
 * actually wrote rather than an internal they have never heard of.
 */
export const useDndContext = (hookName: string): DndContextValue => {
  const value = useContext(DndContext)

  if (!value) {
    throw new Error(
      `fc-react-dnd: ${hookName}() was called outside a <DndProvider>. Wrap the tree that contains this component in <DndProvider> from 'fc-react-dnd/dnd-provider'.`,
    )
  }

  return value
}
