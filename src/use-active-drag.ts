'use client'

import { useDndContext } from './internal/context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { ActiveDragInfo } from './types.js'

/**
 * What is being dragged, for any component in the subtree that wants to *render* from it —
 * a header saying "Moving: Invoices", a sidebar highlighting a valid region.
 *
 * It reports only the half of a drag that does not move, so it re-renders its host **twice per
 * drag** (start and end) rather than once per pointermove. Live position is deliberately not
 * here: `DragOverlay` moves without any React render at all, and `useDraggable`'s
 * `trackTransform` is the opt-in for a source element that should follow the pointer. A
 * component that wants to *react* to a drag without rendering at all wants `useDndMonitor`.
 */
export const useActiveDrag = (): ActiveDragInfo | null => {
  const { store } = useDndContext('useActiveDrag')

  // `state.origin` keeps its identity for the whole drag, so this comparison is `Object.is` on
  // a reference that only changes twice.
  return useStoreSelector(store, (state) => state.origin)
}
