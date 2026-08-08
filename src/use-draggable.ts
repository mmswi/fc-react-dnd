'use client'

import { type RefCallback, useCallback, useEffect, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import { buildDragHandleProps } from './internal/handle-props.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { DndData, DndId, DragHandleProps, SensorActivatorProps, Translate } from './types.js'

/**
 * Turn any element into a drag source.
 *
 * Registration is split across a ref callback and an effect, and the split is load-bearing.
 *
 * The **ref callback** carries the node: it registers whatever element it is handed, and never
 * unregisters. The **effect**, keyed on `[store, id]` alone, owns the registration's *lifetime*
 * — its cleanup is the only thing that unregisters, and it fires only on unmount or an id
 * change.
 *
 * Both halves exist to avoid a cancelled drag, from two different directions. An effect with
 * `data` in its dependency array re-runs on the ordinary `data={{ index }}`, so a routine
 * parent re-render mid-drag would unregister the item — and under the A6 policy that cancels
 * the drag (`ANALYSIS.md` § A9.4). But unregistering from the ref *cleanup* is just as bad for
 * a different reason: a consumer writing `ref={(node) => { myRef.current = node; setNodeRef(node) }}`
 * hands React a new function every render, so React detaches and re-attaches the ref on every
 * re-render — including the per-move re-renders of the item currently being dragged. That
 * detach is not a row disappearing, and treating it as one cancels the drag on its first
 * pointermove.
 */

const NO_DATA: DndData = {}

export type UseDraggableOptions = {
  readonly id: DndId
  readonly data?: DndData
  readonly disabled?: boolean
  /**
   * Subscribe to the live translate so the source element can move with the pointer.
   *
   * On by default, because a draggable that does not move is a surprising default. Turn it
   * **off** when a `DragOverlay` carries the motion instead and the source element stays put:
   * tracking costs this component one render per pointermove, and not tracking costs it two
   * renders for the entire drag. `useSortable` turns it off for exactly that reason — its
   * translate comes from the memoised list projection instead.
   */
  readonly trackTransform?: boolean
  /** Merged with the sensors' activators rather than replacing them. */
  readonly activatorProps?: SensorActivatorProps
}

export type UseDraggableResult = {
  readonly setNodeRef: RefCallback<HTMLElement>
  readonly handleProps: DragHandleProps
  readonly isDragging: boolean
  /** `null` unless this item is the one being dragged and `trackTransform` is on. */
  readonly transform: Translate | null
}

export const useDraggable = (options: UseDraggableOptions): UseDraggableResult => {
  const { id, data, disabled = false, trackTransform = true, activatorProps } = options
  const { store, instructionsId, draggableRoleDescription, sensors } = useDndContext('useDraggable')

  const nodeRef = useRef<HTMLElement | null>(null)
  const setNodeRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      nodeRef.current = node
      if (node !== null) store.registerDraggable(id, node)
    },
    [store, id],
  )

  // Re-registers on setup as well as unregistering on cleanup, because StrictMode runs
  // setup → cleanup → setup: without the re-register, the middle cleanup would leave a mounted
  // draggable permanently unregistered.
  useEffect(() => {
    const node = nodeRef.current
    if (node !== null) store.registerDraggable(id, node)
    return () => {
      store.unregisterDraggable(id)
    }
  }, [store, id])

  // Mutable options are pushed into the existing registry entry. The registries do not notify
  // (perf invariant 5), so this costs no render and cannot cancel anything — which is what
  // makes it safe to re-run on every render as an inline `data` object demands.
  useEffect(() => {
    store.updateDraggable(id, { data: data ?? NO_DATA, disabled })
  }, [store, id, data, disabled])

  const isDragging = useStoreSelector(store, (state) => state.origin?.id === id)
  const transform = useStoreSelector(store, (state) => {
    const isActive = trackTransform && state.origin?.id === id
    return isActive ? state.translate : null
  })

  return {
    setNodeRef,
    handleProps: buildDragHandleProps({
      id,
      store,
      sensors,
      instructionsId,
      draggableRoleDescription,
      disabled,
      extraActivators: activatorProps,
    }),
    isDragging,
    transform,
  }
}
