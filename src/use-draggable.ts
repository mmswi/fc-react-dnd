'use client'

import { type RefCallback, useCallback, useEffect, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import { buildDragHandleProps } from './internal/drag-handle-props.js'
import { buildNodeStyle } from './internal/node-style.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type {
  DndData,
  DndId,
  DragHandleProps,
  DragNodeStyle,
  SensorActivatorProps,
  Translate,
} from './types.js'

/**
 * Turn any element into a drag source.
 *
 * Registration is deliberately split in two, and both halves exist to avoid cancelling a live
 * drag (`internal/store.ts` cancels when a registered node disappears — `ANALYSIS.md` § A6):
 *
 * - the **ref callback** registers whatever node it is handed and *never* unregisters, because a
 *   consumer writing `ref={(node) => { myRef.current = node; setNodeRef(node) }}` hands React a
 *   new function every render, so React detaches and re-attaches on every render — including the
 *   per-move ones of the row being dragged.
 * - the **effect**, keyed on `[store, id]` alone, owns the registration's lifetime. Keying it on
 *   `data` too would re-run it on an ordinary `data={{ index }}`, unregistering mid-drag on a
 *   routine parent re-render (§ A9.4).
 */

const NO_DATA: DndData = {}

export type UseDraggableOptions = {
  readonly id: DndId
  readonly data?: DndData
  readonly disabled?: boolean
  /**
   * Subscribe to the live translate so the source element moves with the pointer. On by default.
   *
   * Tracking costs one render per pointermove; not tracking costs two renders for the whole drag.
   * Turn it **off** when a `DragOverlay` carries the motion and the source stays put.
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
  /**
   * `transform` and `touch-action` in one object — pass it straight to `style`. No `transition`:
   * easing would fight the pointer, and a plain draggable has no displaced neighbours to settle.
   */
  readonly style: DragNodeStyle
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

  // Registers on setup as well as unregistering on cleanup, because StrictMode runs
  // setup → cleanup → setup and the middle cleanup would otherwise leave a mounted draggable
  // unregistered for good.
  useEffect(() => {
    const node = nodeRef.current
    if (node !== null) store.registerDraggable(id, node)
    return () => {
      store.unregisterDraggable(id)
    }
  }, [store, id])

  // Mutable options are patched into the existing entry. Registries never notify (perf invariant
  // 5), so this costs no render and cancels nothing — which is what makes it safe to re-run as
  // often as an inline `data` object demands.
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
      sensorContext: {
        draggableId: id,
        // What a sensor calls once it decides the gesture is a real drag — `pointer-sensor.ts`
        // after its activation threshold, `keyboard-sensor.ts` on Space/Enter. It hands back a
        // `DragSession`, or `null` when the store refuses (already dragging, or disabled).
        beginDrag: (init) => store.beginDrag(id, init),
      },
      sensors,
      instructionsId,
      draggableRoleDescription,
      disabled,
      extraActivators: activatorProps,
    }),
    isDragging,
    transform,
    style: buildNodeStyle(transform, undefined),
  }
}
