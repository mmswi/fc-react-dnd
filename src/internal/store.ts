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
import { DRAG_CANCEL_REASONS } from '../types.js'
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
 * providers on one page cannot see each other's drag. Rects are measured once at `beginDrag`
 * and every move afterwards is arithmetic against that cache (perf invariant 1), and every
 * notifying transition mints a **new state object**, which is what makes the WeakMap
 * memoization in the list and tree projections sound (`ANALYSIS.md` § A9.3).
 */

export type RectReader = (element: HTMLElement) => Rect

const DROPPABLE_KINDS = {
  /** Takes part in collision detection and can become `over`. */
  collidable: 'collidable',
  /**
   * Measured for the rect cache and reachable by keyboard targeting, but invisible to
   * collision. Tree rows register this way: element hit-testing is the wrong question for a
   * tree (`ANALYSIS.md` § A1), so it must not run against them at all.
   */
  measureOnly: 'measure-only',
} as const

type DroppableKind = (typeof DROPPABLE_KINDS)[keyof typeof DROPPABLE_KINDS]

type DraggableRegistration = {
  node: HTMLElement
  data: DndData
  disabled: boolean
}

type DroppableRegistration = {
  node: HTMLElement
  data: DndData
  disabled: boolean
  readonly kind: DroppableKind
}

/**
 * The public `ActiveDragInfo` plus where the pointer started.
 *
 * Kept separate from the translate on purpose. A component selecting `origin` must not
 * re-render 120 times a second, and it does not, because this object's identity survives
 * every move.
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

  /** The element the active drag started from — auto-scroll resolves its scroll container. */
  getActiveNode: () => HTMLElement | null

  beginDrag: (id: DndId, init: DragBeginInit) => DragSession | null
  cancelActiveDrag: (reason: DragCancelReason) => void
  markRectsDirty: () => void

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

  let state = createIdleState()
  let rectsAreDirty = false
  /** Bumped on every begin and every end/cancel, so a session outlives nothing. */
  let sessionToken = 0

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const emit = <EventName extends keyof DndMonitorListeners>(
    eventName: EventName,
    event: Parameters<NonNullable<DndMonitorListeners[EventName]>>[0],
  ): void => {
    for (const monitor of [...monitors]) {
      const listener = monitor[eventName] as ((payload: typeof event) => void) | undefined
      listener?.(event)
    }
  }

  const measureAllRects = (): ReadonlyMap<DndId, Rect> => {
    // One pass of reads with no writes between them — the whole point of caching (perf
    // invariants 1 and 2).
    const measured = new Map<DndId, Rect>()
    for (const [id, registration] of droppables) measured.set(id, readRect(registration.node))
    return measured
  }

  const detectOver = (
    origin: DragOrigin,
    translate: Translate,
    rects: ReadonlyMap<DndId, Rect>,
  ) => {
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

  /**
   * The one path every mid-drag change flows through — a pointer move, a scroll, a row
   * appearing. It always mints a new state object, even when `over` is unchanged: a stale
   * projection memoized against an old state is the failure mode that motivated A9.3, and a
   * subscriber whose slice did not change still does not render.
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

    notify()
  }

  /**
   * A registered node appearing or disappearing mid-drag is a structural event, and the policy
   * is deliberately asymmetric (`ANALYSIS.md` § A6).
   *
   * **Removal cancels.** Any removal — the active row, the current `over`, or an unrelated row
   * above them — shifts every rect below it, so a drop resolved against the cached geometry
   * would land in the wrong place with nothing anywhere reporting an error. Cancelling returns
   * the item to its origin and leaves no window in which a wrong position can be presented.
   *
   * **Insertion does not cancel**, because the tree's own auto-expand-on-hover mounts rows as
   * a *result* of the user's drag, and so does a lazily-loaded list reached by auto-scroll.
   */
  const onRegistrationRemoved = (): void => {
    if (state.origin) cancelDrag(DRAG_CANCEL_REASONS.itemRemoved)
  }

  const onRegistrationAdded = (): void => {
    if (!state.origin) return
    rectsAreDirty = true
    applyUpdate(state.translate, false)
  }

  const resetToIdle = (): void => {
    sessionToken += 1
    rectsAreDirty = false
    state = createIdleState()
  }

  const endDrag = (): void => {
    const { origin, translate } = state
    if (!origin) return

    // Emitted before the reset, so a listener reading the store during onDragEnd sees the drag
    // it is being told about rather than a cleared one.
    emit('onDragEnd', {
      active: buildActive(origin, translate),
      over: buildOver(),
      translate,
    } satisfies DragEndEvent)

    resetToIdle()
    notify()
  }

  function cancelDrag(reason: DragCancelReason): void {
    const { origin, translate } = state
    if (!origin) return

    emit('onDragCancel', {
      active: buildActive(origin, translate),
      over: buildOver(),
      reason,
    } satisfies DragCancelEvent)

    resetToIdle()
    notify()
  }

  const createSession = (token: number): DragSession => {
    const isCurrent = (): boolean => token === sessionToken

    return {
      isActive: () => isCurrent() && state.origin !== null,
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

        const target = findNearestRectInDirection({
          from: translateRect(origin.rect, translate),
          direction,
          candidates,
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

  const registerDroppableOfKind = (id: DndId, node: HTMLElement, kind: DroppableKind): void => {
    // A node swap re-runs the ref callback, and the options effect has no changed dependency
    // that would restore `data`/`disabled` afterwards — so carry them across.
    const existing = droppables.get(id)
    droppables.set(id, {
      node,
      data: existing?.data ?? NO_DATA,
      disabled: existing?.disabled ?? false,
      kind,
    })

    // Re-registering the *same* node changes no geometry, and treating it as an arrival would
    // be expensive and wrong: a consumer's inline `ref={(node) => …}` is a new function every
    // render, so React re-attaches it on every render — including the per-move re-renders
    // during a drag. Re-measuring and notifying there would put a full re-measure inside the
    // move path and give every droppable a second render per boundary crossing.
    const isSameNode = existing?.node === node && existing.kind === kind
    if (!isSameNode) onRegistrationAdded()
  }

  const unregisterDroppableOfAnyKind = (id: DndId): void => {
    if (!droppables.delete(id)) return
    onRegistrationRemoved()
  }

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

    registerDraggable: (id, node) => {
      const existing = draggables.get(id)
      draggables.set(id, {
        node,
        data: existing?.data ?? NO_DATA,
        disabled: existing?.disabled ?? false,
      })
      // A draggable is not measured or collided against, so its arrival changes no geometry.
      // Nothing to notify, and nothing to re-collide.
    },

    unregisterDraggable: (id) => {
      if (!draggables.delete(id)) return
      onRegistrationRemoved()
    },

    updateDraggable: (id, patch) => {
      const registration = draggables.get(id)
      if (!registration) return
      if (patch.data !== undefined) registration.data = patch.data
      if (patch.disabled !== undefined) registration.disabled = patch.disabled
    },

    registerDroppable: (id, node) => registerDroppableOfKind(id, node, DROPPABLE_KINDS.collidable),
    unregisterDroppable: unregisterDroppableOfAnyKind,

    updateDroppable: (id, patch) => {
      const registration = droppables.get(id)
      if (!registration) return
      if (patch.data !== undefined) registration.data = patch.data
      if (patch.disabled !== undefined) registration.disabled = patch.disabled
    },

    registerMeasuredRow: (id, node) =>
      registerDroppableOfKind(id, node, DROPPABLE_KINDS.measureOnly),
    unregisterMeasuredRow: unregisterDroppableOfAnyKind,

    addMonitor: (monitor) => {
      monitors.add(monitor)
      return () => {
        monitors.delete(monitor)
      }
    },

    beginDrag: (id, init) => {
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

      emit('onDragStart', { active: buildActive(origin, ZERO_TRANSLATE) } satisfies DragStartEvent)
      notify()

      return session
    },

    cancelActiveDrag: cancelDrag,

    markRectsDirty: () => {
      if (!state.origin) return
      rectsAreDirty = true
      applyUpdate(state.translate, false)
    },

    setCollisionDetection: (next) => {
      collisionDetection = next
    },
  }
}
