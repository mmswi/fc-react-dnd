'use client'

import { useEffect, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import type { DndMonitorListeners } from './types.js'

/**
 * Hear every drag event without re-rendering at all.
 *
 * The counterpart to `useActiveDrag`: that one is for components that *render* from a drag,
 * this one is for components that *react* to one — computing a result on drop, syncing to a
 * server, logging. It subscribes and returns nothing, so its host never re-renders.
 *
 * Listeners are read through a latest-ref, so passing fresh inline closures every render — the
 * normal way people write this — does not resubscribe. A resubscribe per render would stay
 * invisible until it dropped an event or leaked a subscription.
 */
export const useDndMonitor = (listeners: DndMonitorListeners): void => {
  const { store } = useDndContext('useDndMonitor')

  const latestListeners = useRef(listeners)
  useEffect(() => {
    latestListeners.current = listeners
  })

  useEffect(
    () =>
      store.addMonitor({
        onDragStart: (event) => latestListeners.current.onDragStart?.(event),
        onDragMove: (event) => latestListeners.current.onDragMove?.(event),
        onDragOver: (event) => latestListeners.current.onDragOver?.(event),
        onDragEnd: (event) => latestListeners.current.onDragEnd?.(event),
        onDragCancel: (event) => latestListeners.current.onDragCancel?.(event),
      }),
    [store],
  )
}
