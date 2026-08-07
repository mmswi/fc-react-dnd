'use client'

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { closestCenter } from './collision.js'
import { DndContext, type DndContextValue } from './internal/context.js'
import { DragInstructions } from './internal/live-region.js'
import { createDragStore } from './internal/store.js'
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
 * Module-level and frozen, so the default is referentially stable for every consumer who does
 * not customise it. A consumer who *does* pass `sensors` owns keeping that array stable — an
 * inline literal re-renders the whole subtree on every parent render, because the context
 * value depends on it (`ANALYSIS.md` § A3.5).
 */
const NO_SENSORS: readonly Sensor[] = Object.freeze([])

export type DndProviderProps = {
  children: ReactNode
  sensors?: readonly Sensor[]
  collisionDetection?: CollisionDetection
  accessibility?: DndAccessibility

  onDragStart?: (event: DragStartEvent) => void
  onDragMove?: (event: DragMoveEvent) => void
  onDragOver?: (event: DragOverEvent) => void
  onDragEnd?: (event: DragEndEvent) => void
  onDragCancel?: (event: DragCancelEvent) => void
}

export const DndProvider = ({
  children,
  sensors = NO_SENSORS,
  collisionDetection = closestCenter,
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
