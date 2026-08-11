'use client'

import type {
  ActiveDragInfo,
  CollisionDetection,
  DirectionalTarget,
  DndData,
  DndId,
  DndMonitorListeners,
  DragActive,
  DragBeginInit,
  DragCancelEvent,
  DragCancelReason,
  DragDirection,
  DragEndEvent,
  DragMoveEvent,
  DragOver,
  DragOverEvent,
  DragSession,
  DragStartEvent,
  Point,
  Rect,
  Translate,
} from '../types.js'
import { DRAG_CANCEL_REASONS, DRAG_DIRECTIONS } from '../types.js'
import { readElementRect } from './dom.js'
import {
  centerOf,
  findNearestRectInDirection,
  type RectCandidate,
  translateRect,
} from './geometry.js'

/**
 * All drag state, in a plain store outside React.
 *
 * Created **per `DndProvider` instance** — never at module level, so it is SSR-safe and two
 * providers on one page cannot see each other's drag.
 *
 * The file is ordered the way a drag runs, and every function is defined before it is used:
 * telling subscribers → measuring → collision → the begin/move/end/cancel lifecycle → the session
 * a sensor holds → registration → the returned API, which is a flat manifest of everything above.
 */

export type RectReader = (element: HTMLElement) => Rect

const DROPPABLE_KINDS = {
  /** Takes part in collision detection and can become `over`. */
  collidable: 'collidable',
  /**
   * Measured for the rect cache and reachable by keyboard targeting, but invisible to collision.
   * Tree rows register this way: element hit-testing is the wrong question for a tree
   * (`ANALYSIS.md` § A1), so it must not run against them at all.
   */
  measureOnly: 'measure-only',
} as const

type DroppableKind = (typeof DROPPABLE_KINDS)[keyof typeof DROPPABLE_KINDS]

/** The parts of a registration a consumer can change after mounting, via the options effect. */
type MutableRegistrationOptions = {
  data: DndData
  disabled: boolean
}

type DraggableRegistration = MutableRegistrationOptions & {
  node: HTMLElement
}

type DroppableRegistration = MutableRegistrationOptions & {
  node: HTMLElement
  readonly kind: DroppableKind
}

/**
 * The public `ActiveDragInfo` plus where the pointer started.
 *
 * Kept out of the translate so its identity survives every move — a component selecting `origin`
 * must not re-render 120 times a second.
 */
export type DragOrigin = ActiveDragInfo & {
  /** `null` for a drag with no pointer — see `ANALYSIS.md` § A9.2. */
  readonly pointer: Point | null
}

export type DragStoreState = {
  readonly origin: DragOrigin | null
  /** Just the id: within one target, many moves change nothing a droppable would re-render for. */
  readonly overId: DndId | null
  readonly translate: Translate
  /** Every measured rect, collidable and measure-only alike — the tree projection reads both. */
  readonly measuredRects: ReadonlyMap<DndId, Rect>
}

export type DragStoreOptions = {
  readonly collisionDetection: CollisionDetection
  readonly readRect?: RectReader
}

export type DragStore = {
  subscribe: (listener: () => void) => () => void
  getState: () => DragStoreState

  registerDraggable: (id: DndId, node: HTMLElement) => void
  unregisterDraggable: (id: DndId) => void
  updateDraggable: (id: DndId, options: { data?: DndData; disabled?: boolean }) => void

  registerDroppable: (id: DndId, node: HTMLElement) => void
  unregisterDroppable: (id: DndId) => void
  updateDroppable: (id: DndId, options: { data?: DndData; disabled?: boolean }) => void

  registerMeasuredRow: (id: DndId, node: HTMLElement) => void
  unregisterMeasuredRow: (id: DndId) => void

  addMonitor: (listeners: DndMonitorListeners) => () => void

  /**
   * Say something to the live region directly.
   *
   * Tree rows are measure-only and so produce no `over` events, which is what the region normally
   * narrates. `useTreeDrop` announces its **projection** through here instead (§ A7 F9).
   */
  announce: (message: string) => void
  subscribeToAnnouncements: (listener: (message: string) => void) => () => void

  /** The element the active drag started from — auto-scroll resolves its scroll container. */
  getActiveNode: () => HTMLElement | null

  beginDrag: (id: DndId, init: DragBeginInit) => DragSession | null
  cancelActiveDrag: (reason: DragCancelReason) => void
  markRectsDirty: () => void

  /**
   * How far one horizontal keyboard step should move, in pixels.
   *
   * Published by whoever authors that number — `useTreeDrop`, from its `indentPx` — so the
   * keyboard sensor can ask instead of guessing. Held outside the state object because it is
   * configuration, not drag state, and changing it must not notify (perf invariant 5). See § A11.
   */
  setCrossAxisStepPx: (px: number) => void

  /** The same number, for `TreeDropIndicator` — so the indent is authored in exactly one place. */
  getCrossAxisStepPx: () => number

  setCollisionDetection: (collisionDetection: CollisionDetection) => void
}

const ZERO_TRANSLATE: Translate = { x: 0, y: 0 }
const NO_DATA: DndData = {}

const createIdleState = (): DragStoreState => ({
  origin: null,
  overId: null,
  translate: ZERO_TRANSLATE,
  measuredRects: new Map(),
})

export const createDragStore = (options: DragStoreOptions): DragStore => {
  const readRect = options.readRect ?? readElementRect
  let collisionDetection = options.collisionDetection

  const draggables = new Map<DndId, DraggableRegistration>()
  // One registry for both droppable kinds, so insertion order — the tie-break every collision
  // strategy resolves against — is a single sequence rather than two interleaved ones.
  const droppables = new Map<DndId, DroppableRegistration>()

  const listeners = new Set<() => void>()
  const monitors = new Set<DndMonitorListeners>()
  const announcementListeners = new Set<(message: string) => void>()

  // ---------------------------------------------------------------------------------------------
  // What React reads. Replaced wholesale on every notifying transition, never mutated — which is
  // what lets the list and tree projections memoize against the state object's identity (§ A9.3).
  // ---------------------------------------------------------------------------------------------

  let state = createIdleState()

  // ---------------------------------------------------------------------------------------------
  // Private bookkeeping. Mutated in place, and no subscriber ever sees it.
  // ---------------------------------------------------------------------------------------------

  let rectsAreDirty = false

  /**
   * Zero until something publishes one, and zero is the honest default: with no tree and no
   * explicit sensor option, nothing in the drag interprets a horizontal offset, so a horizontal
   * keyboard step has nowhere to land.
   */
  let crossAxisStepPx = 0

  /**
   * Ids whose registration has gone, waiting to see whether it comes back.
   *
   * We need to tell a real removal from React re-attaching a ref, because both leave the registry
   * for an instant and only one of them may cancel the drag: a consumer's inline ref re-attaches
   * on every render, and StrictMode runs a new component's refs as attach → detach → attach.
   * Checking at the end of the current task instead means a registration that came straight back
   * was never gone.
   */
  const pendingRemovals = new Set<DndId>()
  let removalCheckIsScheduled = false

  /** Bumped on every begin and every end/cancel, so a session outlives nothing. */
  let sessionToken = 0

  // ---------------------------------------------------------------------------------------------
  // Telling everyone. `emit` always runs before `notifySubscribedListeners`, so a monitor
  // listener reading the store during an event sees the drag it is being told about, not the next.
  // ---------------------------------------------------------------------------------------------

  /** React's `onStoreChange`, one per `useStoreSelector` — see `use-store-selector.ts`. */
  const notifySubscribedListeners = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** Consumer callbacks registered through `useDndMonitor`, `SortableList`, and the live region. */
  const emit = <EventName extends keyof DndMonitorListeners>(
    eventName: EventName,
    event: Parameters<NonNullable<DndMonitorListeners[EventName]>>[0],
  ): void => {
    for (const monitor of [...monitors]) {
      const listener = monitor[eventName] as ((payload: typeof event) => void) | undefined
      listener?.(event)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Measuring and colliding
  // ---------------------------------------------------------------------------------------------

  const measureAllRects = (): ReadonlyMap<DndId, Rect> => {
    // One pass of reads with no writes between them — the whole point of caching (perf invariants
    // 1 and 2).
    const measured = new Map<DndId, Rect>()
    for (const [id, registration] of droppables) measured.set(id, readRect(registration.node))
    return measured
  }

  const detectOver = (
    origin: DragOrigin,
    translate: Translate,
    rects: ReadonlyMap<DndId, Rect>,
  ): DndId | null => {
    const candidates = []
    for (const [id, registration] of droppables) {
      const isCollidable = registration.kind === DROPPABLE_KINDS.collidable
      if (!isCollidable || registration.disabled) continue

      const rect = rects.get(id)
      if (!rect) continue

      candidates.push({ id, data: registration.data, rect })
    }

    return collisionDetection({
      active: { id: origin.id, rect: translateRect(origin.rect, translate) },
      droppables: candidates,
    })
  }

  // ---------------------------------------------------------------------------------------------
  // The event payloads every lifecycle step hands out
  // ---------------------------------------------------------------------------------------------

  const buildActive = (origin: DragOrigin, translate: Translate): DragActive => ({
    id: origin.id,
    data: origin.data,
    initialRect: origin.rect,
    rect: translateRect(origin.rect, translate),
  })

  const buildOver = (): DragOver | null => {
    if (state.overId === null) return null

    const registration = droppables.get(state.overId)
    const rect = state.measuredRects.get(state.overId)
    if (!registration || !rect) return null

    return { id: state.overId, data: registration.data, rect }
  }

  // ---------------------------------------------------------------------------------------------
  // The drag lifecycle: move → end → cancel, then begin (which needs the session, below)
  // ---------------------------------------------------------------------------------------------

  /**
   * The one path every mid-drag change flows through — a pointer move, a scroll, a row appearing.
   *
   * Always mints a new state object, even when `over` is unchanged, because the projections
   * memoize against that object's identity and a stale one would be served forever (§ A9.3). A
   * subscriber whose own slice did not change still does not render.
   */
  const applyUpdate = (translate: Translate, reportMove: boolean): void => {
    const { origin } = state
    if (!origin) return

    const measuredRects = rectsAreDirty ? measureAllRects() : state.measuredRects
    rectsAreDirty = false

    const previousOverId = state.overId
    state = {
      origin,
      overId: detectOver(origin, translate, measuredRects),
      translate,
      measuredRects,
    }

    const active = buildActive(origin, translate)
    if (reportMove)
      emit('onDragMove', { active, over: buildOver(), translate } satisfies DragMoveEvent)
    if (state.overId !== previousOverId) {
      emit('onDragOver', { active, over: buildOver() } satisfies DragOverEvent)
    }

    notifySubscribedListeners()
  }

  const resetToIdle = (): void => {
    sessionToken += 1
    rectsAreDirty = false
    state = createIdleState()
  }

  const endDrag = (): void => {
    const { origin, translate } = state
    if (!origin) return

    emit('onDragEnd', {
      active: buildActive(origin, translate),
      over: buildOver(),
      translate,
    } satisfies DragEndEvent)

    resetToIdle()
    notifySubscribedListeners()
  }

  const cancelDrag = (reason: DragCancelReason): void => {
    const { origin, translate } = state
    if (!origin) return

    emit('onDragCancel', {
      active: buildActive(origin, translate),
      over: buildOver(),
      reason,
    } satisfies DragCancelEvent)

    resetToIdle()
    notifySubscribedListeners()
  }

  // ---------------------------------------------------------------------------------------------
  // Rows appearing and disappearing mid-drag (`ANALYSIS.md` § A6)
  // ---------------------------------------------------------------------------------------------

  /**
   * Runs a microtask after a removal, once the re-attach that might undo it has had its chance.
   *
   * We cancel when something really is gone because every rect below it has shifted, so a drop
   * resolved against the cached geometry would land somewhere else with nothing reporting an
   * error. Returning the item to its origin leaves no window in which a wrong position is shown.
   */
  const confirmRemovals = (): void => {
    removalCheckIsScheduled = false
    const candidates = [...pendingRemovals]
    pendingRemovals.clear()
    if (!state.origin) return

    const somethingIsActuallyGone = candidates.some(
      (id) => !droppables.has(id) && !draggables.has(id),
    )
    if (somethingIsActuallyGone) cancelDrag(DRAG_CANCEL_REASONS.itemRemoved)
  }

  const onRegistrationRemoved = (id: DndId): void => {
    if (!state.origin) return

    pendingRemovals.add(id)
    if (removalCheckIsScheduled) return
    removalCheckIsScheduled = true
    queueMicrotask(confirmRemovals)
  }

  /**
   * Insertion re-measures and re-collides but never cancels, because the tree's own
   * auto-expand-on-hover mounts rows as a *result* of the user's drag, and so does a lazily-loaded
   * list reached by auto-scroll.
   */
  const onRegistrationAdded = (): void => {
    if (!state.origin) return
    rectsAreDirty = true
    applyUpdate(state.translate, false)
  }

  // ---------------------------------------------------------------------------------------------
  // The session a sensor holds for exactly one interaction
  // ---------------------------------------------------------------------------------------------

  /**
   * Handed to whichever sensor started the drag, and stale the moment the token moves on — so a
   * sensor that missed an end or a cancel calls into no-ops rather than a drag it no longer owns.
   *
   * `pointer-sensor.ts` and `keyboard-sensor.ts` are the two holders.
   */
  const createSession = (token: number): DragSession => {
    const isCurrent = (): boolean => token === sessionToken

    return {
      isActive: () => isCurrent() && state.origin !== null,
      crossAxisStepPx: () => crossAxisStepPx,
      move: (translate) => {
        if (isCurrent()) applyUpdate(translate, true)
      },
      end: () => {
        if (isCurrent()) endDrag()
      },
      cancel: (reason) => {
        if (isCurrent()) cancelDrag(reason)
      },
      findTargetInDirection: (direction: DragDirection): DirectionalTarget | null => {
        const { origin, translate } = state
        if (!isCurrent() || !origin) return null

        const candidates: RectCandidate[] = []
        for (const [id, rect] of state.measuredRects) {
          if (id !== origin.id) candidates.push({ id, rect })
        }

        // A directional step is answered from where the item is **along that axis** only, and with
        // no cross-axis penalty on a vertical one. Tree rows sit at different horizontal offsets
        // by design, so letting indentation weigh in makes ArrowUp prefer a shallow row further
        // away over the deep row directly above — and the rows it skips are exactly the "first
        // child of X" positions.
        const isVertical = direction === DRAG_DIRECTIONS.up || direction === DRAG_DIRECTIONS.down
        const from = translateRect(
          origin.rect,
          isVertical ? { x: 0, y: translate.y } : { x: translate.x, y: 0 },
        )

        const target = findNearestRectInDirection({
          from,
          direction,
          candidates,
          ...(isVertical && { crossAxisPenalty: 0 }),
        })
        if (!target) return null

        const originCenter = centerOf(origin.rect)
        const targetCenter = centerOf(target.rect)

        return {
          id: target.id,
          translate: { x: targetCenter.x - originCenter.x, y: targetCenter.y - originCenter.y },
          node: droppables.get(target.id)?.node ?? null,
        }
      },
    }
  }

  /**
   * Where every drag starts. Reached from a sensor's `SensorContext.beginDrag`, which
   * `use-draggable.ts` and `use-tree-drop.ts` bind to this with the row's own id.
   *
   * Returns `null` — and the sensor abandons the gesture — when a drag is already running or the
   * draggable is disabled.
   */
  const beginDrag = (id: DndId, init: DragBeginInit): DragSession | null => {
    const isAlreadyDragging = state.origin !== null
    const registration = draggables.get(id)
    const canDrag = !isAlreadyDragging && registration !== undefined && !registration.disabled
    if (!canDrag) return null

    const origin: DragOrigin = {
      id,
      data: registration.data,
      rect: readRect(registration.node),
      pointer: init.pointer,
    }
    const measuredRects = measureAllRects()
    rectsAreDirty = false

    state = {
      origin,
      overId: detectOver(origin, ZERO_TRANSLATE, measuredRects),
      translate: ZERO_TRANSLATE,
      measuredRects,
    }

    sessionToken += 1
    const session = createSession(sessionToken)

    // The initial target rides on the start event rather than arriving as a separate `onDragOver`
    // right behind it, because firing both would overwrite the pickup announcement with a target
    // announcement before a screen reader could speak it — and a consumer treating `onDragOver` as
    // the single source of "current target" must not start blind.
    emit('onDragStart', {
      active: buildActive(origin, ZERO_TRANSLATE),
      over: buildOver(),
    } satisfies DragStartEvent)
    notifySubscribedListeners()

    return session
  }

  // ---------------------------------------------------------------------------------------------
  // Registration. Both kinds of droppable share one registry, so both share these two functions.
  // ---------------------------------------------------------------------------------------------

  const registerDroppableOfKind = (id: DndId, node: HTMLElement, kind: DroppableKind): void => {
    // A node swap re-runs the ref callback, and the options effect has no changed dependency that
    // would restore `data`/`disabled` afterwards — so carry them across.
    const existing = droppables.get(id)
    droppables.set(id, {
      node,
      data: existing?.data ?? NO_DATA,
      disabled: existing?.disabled ?? false,
      kind,
    })

    // Re-registering the *same* node changes no geometry, and we need to skip it so that a
    // consumer's inline `ref={(node) => …}` — a new function every render, so React re-attaches it
    // on every render including the per-move ones — does not put a full re-measure in the move
    // path and give every droppable a second render per boundary crossing.
    const isSameNode = existing?.node === node && existing.kind === kind
    if (!isSameNode) onRegistrationAdded()
  }

  const unregisterDroppableOfAnyKind = (id: DndId): void => {
    if (!droppables.delete(id)) return
    onRegistrationRemoved(id)
  }

  const registerDraggable = (id: DndId, node: HTMLElement): void => {
    const existing = draggables.get(id)
    draggables.set(id, {
      node,
      data: existing?.data ?? NO_DATA,
      disabled: existing?.disabled ?? false,
    })
    // A draggable is not measured or collided against, so its arrival changes no geometry. Nothing
    // to notify, and nothing to re-collide.
  }

  const unregisterDraggable = (id: DndId): void => {
    if (!draggables.delete(id)) return
    onRegistrationRemoved(id)
  }

  // The two mutable fields both registrations share. Named as a shape rather than a union of the
  // two concrete types, so this says what it needs instead of listing who happens to have it.
  const applyRegistrationPatch = (
    registration: MutableRegistrationOptions | undefined,
    patch: Partial<MutableRegistrationOptions>,
  ): void => {
    if (!registration) return
    if (patch.data !== undefined) registration.data = patch.data
    if (patch.disabled !== undefined) registration.disabled = patch.disabled
  }

  // ---------------------------------------------------------------------------------------------
  // The API, as a manifest of everything above
  // ---------------------------------------------------------------------------------------------

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getState: () => state,

    getActiveNode: () => {
      const activeId = state.origin?.id
      if (activeId === undefined) return null
      return draggables.get(activeId)?.node ?? null
    },

    registerDraggable,
    unregisterDraggable,
    updateDraggable: (id, patch) => applyRegistrationPatch(draggables.get(id), patch),

    registerDroppable: (id, node) => registerDroppableOfKind(id, node, DROPPABLE_KINDS.collidable),
    unregisterDroppable: unregisterDroppableOfAnyKind,
    updateDroppable: (id, patch) => applyRegistrationPatch(droppables.get(id), patch),

    registerMeasuredRow: (id, node) =>
      registerDroppableOfKind(id, node, DROPPABLE_KINDS.measureOnly),
    unregisterMeasuredRow: unregisterDroppableOfAnyKind,

    addMonitor: (monitor) => {
      monitors.add(monitor)
      return () => {
        monitors.delete(monitor)
      }
    },

    announce: (message) => {
      for (const listener of [...announcementListeners]) listener(message)
    },

    subscribeToAnnouncements: (listener) => {
      announcementListeners.add(listener)
      return () => {
        announcementListeners.delete(listener)
      }
    },

    beginDrag,
    cancelActiveDrag: cancelDrag,

    markRectsDirty: () => {
      if (!state.origin) return
      rectsAreDirty = true
      applyUpdate(state.translate, false)
    },

    setCrossAxisStepPx: (px) => {
      crossAxisStepPx = px
    },

    getCrossAxisStepPx: () => crossAxisStepPx,

    setCollisionDetection: (next) => {
      collisionDetection = next
    },
  }
}
