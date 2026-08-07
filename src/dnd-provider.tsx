'use client'

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { closestCenter } from './collision.js'
import { createAutoScroller } from './internal/auto-scroll.js'
import { DndContext, type DndContextValue } from './internal/context.js'
import { DragInstructions } from './internal/live-region.js'
import { createDragStore } from './internal/store.js'
import { keyboardSensor } from './keyboard-sensor.js'
import { pointerSensor } from './pointer-sensor.js'
import type {
  CollisionDetection,
  DndAccessibility,
  DndMonitorListeners,
  DragCancelEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  Sensor,
} from './types.js'

/**
 * The single component a consumer mounts. It owns one store, wires collision and
 * accessibility, and forwards drag events — while never itself re-rendering during a drag.
 *
 * That last part is the whole architectural claim, and it holds because the provider
 * subscribes to nothing: state lives in the store, and components read narrow slices of it
 * through `useSyncExternalStore`.
 */

const DEFAULT_INSTRUCTIONS =
  'To pick up a draggable item, press Space or Enter. While dragging, use the arrow keys to move the item. Press Space or Enter again to drop, or press Escape to cancel.'

const DEFAULT_ROLE_DESCRIPTION = 'draggable'

/**
 * Both sensors, constructed once at module level so the default is referentially stable for
 * every consumer who does not customise it.
 *
 * Defaulting means this module imports both sensors, which a bundle-size-sensitive library
 * would refuse. Bundle size is explicitly not a concern here, and a provider that silently does
 * nothing until you discover the `sensors` prop is the worse trade (`ANALYSIS.md` § A9.5).
 *
 * A consumer who *does* pass `sensors` owns keeping that array stable — an inline literal
 * re-renders the whole subtree on every parent render, because the context value depends on it
 * (§ A3.5).
 */
const DEFAULT_SENSORS: readonly Sensor[] = Object.freeze([pointerSensor(), keyboardSensor()])

export type DndProviderProps = {
  children: ReactNode
  sensors?: readonly Sensor[]
  collisionDetection?: CollisionDetection
  /** Scroll the nearest scrollable ancestor when a *pointer* drag nears its edge. */
  autoScroll?: boolean
  accessibility?: DndAccessibility

  onDragStart?: (event: DragStartEvent) => void
  onDragMove?: (event: DragMoveEvent) => void
  onDragOver?: (event: DragOverEvent) => void
  onDragEnd?: (event: DragEndEvent) => void
  onDragCancel?: (event: DragCancelEvent) => void
}

export const DndProvider = ({
  children,
  sensors = DEFAULT_SENSORS,
  collisionDetection = closestCenter,
  autoScroll = true,
  accessibility,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragEnd,
  onDragCancel,
}: DndProviderProps) => {
  // `useState` with an initialiser rather than `useRef`, so the store is constructed exactly
  // once even under StrictMode's double-invoked render.
  const [store] = useState(() => createDragStore({ collisionDetection }))
  const [autoScroller] = useState(() => createAutoScroller(store))
  const instructionsId = useId()

  const instructions = accessibility?.instructions ?? DEFAULT_INSTRUCTIONS
  const draggableRoleDescription =
    accessibility?.draggableRoleDescription ?? DEFAULT_ROLE_DESCRIPTION

  // Latest-props ref, updated after every commit. The monitor below reads through it, so a
  // consumer can swap a handler mid-drag without the subscription being torn down and rebuilt —
  // which, under the A6 policy, would look indistinguishable from a row disappearing.
  const latestListeners = useRef<DndMonitorListeners>({})
  useEffect(() => {
    latestListeners.current = { onDragStart, onDragMove, onDragOver, onDragEnd, onDragCancel }
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

  useEffect(() => {
    store.setCollisionDetection(collisionDetection)
  }, [store, collisionDetection])

  useEffect(() => {
    if (!autoScroll) return

    const removeMonitor = store.addMonitor({
      onDragStart: () => autoScroller.start(),
      onDragEnd: () => autoScroller.stop(),
      onDragCancel: () => autoScroller.stop(),
    })

    // Stopping in the cleanup covers the two cases the monitor cannot: the provider unmounting
    // mid-drag, and `autoScroll` being turned off while a loop is running.
    return () => {
      removeMonitor()
      autoScroller.stop()
    }
  }, [store, autoScroller, autoScroll])

  // Every dependency is either the store, a `useId` result, a plain string, or an array the
  // consumer owns — so nothing here churns on an ordinary parent re-render.
  const contextValue = useMemo<DndContextValue>(
    () => ({ store, instructionsId, draggableRoleDescription, sensors }),
    [store, instructionsId, draggableRoleDescription, sensors],
  )

  return (
    <DndContext value={contextValue}>
      {children}
      <DragInstructions id={instructionsId} text={instructions} />
    </DndContext>
  )
}
