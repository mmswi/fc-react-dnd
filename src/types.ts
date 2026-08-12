import type { KeyboardEventHandler, PointerEventHandler } from 'react'

/**
 * The shared vocabulary every other module in this library speaks.
 *
 * Deliberately free of `'use client'`: nothing here touches React state, effects, or the DOM at
 * render time, so a server component can import these types and the two constant objects without
 * pulling the client runtime in behind them.
 */

/** Matches what React accepts as a key, so a consumer's existing ids work unchanged. */
export type DndId = string | number

/** A position in client coordinates. */
export type Point = {
  readonly x: number
  readonly y: number
}

/**
 * A displacement from where the drag started. Structurally a `Point`, but a different idea —
 * separated so that "where the pointer is" and "how far it has moved" cannot be swapped in a
 * signature without the reader noticing.
 */
export type Translate = {
  readonly x: number
  readonly y: number
}

/** No `right`/`bottom`: they are derivable, and carrying them allows a self-contradicting rect. */
export type Rect = {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/**
 * Consumer payloads, carried unchanged from a draggable or droppable to every event. `unknown`
 * values rather than `any`, so nothing this library does can turn off a consumer's type checking.
 */
export type DndData = Record<string, unknown>

export const DRAG_CANCEL_REASONS = {
  escape: 'escape',
  blur: 'blur',
  pointerCancelled: 'pointer-cancelled',
  itemRemoved: 'item-removed',
} as const

/**
 * Why a drag ended without dropping. `'item-removed'` is this library forcing a cancel because a
 * registered node disappeared mid-drag; `'pointer-cancelled'` is the browser revoking the
 * interaction. Adding a member breaks anyone who wrote an exhaustive `switch`.
 */
export type DragCancelReason = (typeof DRAG_CANCEL_REASONS)[keyof typeof DRAG_CANCEL_REASONS]

export const DRAG_DIRECTIONS = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
} as const

/** The step a keyboard drag takes. Vertical steps change target; horizontal steps change depth. */
export type DragDirection = (typeof DRAG_DIRECTIONS)[keyof typeof DRAG_DIRECTIONS]

/**
 * The half of a drag that does not move. Its identity survives every pointermove, so a component
 * reading it through `useActiveDrag` does not re-render at pointer frequency.
 */
export type ActiveDragInfo = {
  readonly id: DndId
  readonly data: DndData
  /** Where the item sat when the drag began. */
  readonly rect: Rect
}

export type DragActive = {
  readonly id: DndId
  readonly data: DndData
  /** Where the item sat when the drag began — what the overlay positions itself from. */
  readonly initialRect: Rect
  /** `initialRect` moved by the current translate. */
  readonly rect: Rect
}

export type DragOver = {
  readonly id: DndId
  readonly data: DndData
  readonly rect: Rect
}

export type DragStartEvent = {
  readonly active: DragActive
  /**
   * What the drag began over — a sortable row starts over itself. Reported here rather than as an
   * immediate second event, so a consumer tracking the target from `onDragOver` alone does not
   * start one target behind and no target announcement lands on top of the pickup one.
   */
  readonly over: DragOver | null
}

export type DragMoveEvent = {
  readonly active: DragActive
  readonly over: DragOver | null
  readonly translate: Translate
}

export type DragOverEvent = {
  readonly active: DragActive
  readonly over: DragOver | null
}

export type DragEndEvent = {
  readonly active: DragActive
  readonly over: DragOver | null
  readonly translate: Translate
}

export type DragCancelEvent = {
  readonly active: DragActive
  readonly over: DragOver | null
  readonly reason: DragCancelReason
}

export type CollisionActive = {
  readonly id: DndId
  /** Already translated by the store, so a custom strategy cannot forget to. */
  readonly rect: Rect
}

export type DroppableCandidate = {
  readonly id: DndId
  readonly data: DndData
  readonly rect: Rect
}

export type CollisionArgs = {
  readonly active: CollisionActive
  /**
   * Registration order, with disabled and measure-only entries already removed. An array rather
   * than a map because tie-breaking equidistant candidates is asserted behaviour, so a strategy
   * has to be able to see that order.
   */
  readonly droppables: readonly DroppableCandidate[]
}

/**
 * The seam that keeps custom strategies pluggable even though the library ships exactly one.
 * Returns an id or nothing — resolving that id back to a candidate is the store's job.
 */
export type CollisionDetection = (args: CollisionArgs) => DndId | null

/** What a keyboard step found: where to go, and the node to scroll into view on arrival. */
export type DirectionalTarget = {
  readonly id: DndId
  readonly translate: Translate
  readonly node: HTMLElement | null
}

/**
 * What a sensor holds for exactly one interaction, handed to it by `SensorContext.beginDrag`.
 * Every method is guarded by a token, so a session kept past the drag's end is inert rather than
 * able to resurrect it.
 */
export type DragSession = {
  /**
   * Whether this session is still the live one. A drag can end without the sensor being told —
   * the store cancels when a registered node disappears (§ A6) — and a sensor that goes on
   * believing a drag is running swallows the user's next pickup.
   */
  readonly isActive: () => boolean
  /**
   * How far one horizontal step should move, in pixels; `0` when nothing interprets one. In a
   * tree this is the indent width, and the tree publishes it — so the sensor asks rather than
   * carrying a constant of its own that has to happen to match (`ANALYSIS.md` § A11).
   */
  readonly crossAxisStepPx: () => number
  readonly move: (translate: Translate) => void
  readonly end: () => void
  readonly cancel: (reason: DragCancelReason) => void
  /**
   * Keyboard targeting, answered from the store's rect cache rather than by the sensor reading
   * rects — which is what keeps perf invariant 1 true for the keyboard path too.
   */
  readonly findTargetInDirection: (direction: DragDirection) => DirectionalTarget | null
}

export type DragBeginInit = {
  /**
   * Where the pointer was, or `null` for a drag with no pointer. Auto-scroll needs an edge
   * distance to compute, so a null origin turns it off by construction rather than through a
   * switch a future sensor could forget to set.
   */
  readonly pointer: Point | null
}

/**
 * What a sensor is handed when a handle mounts, and what it calls to start a drag.
 *
 * Built by `use-draggable.ts` and `use-tree-drop.ts`, where `beginDrag` is bound to the store and
 * that row's id. It returns `null` when the store refuses — a drag is already running, or the
 * draggable is disabled.
 */
export type SensorContext = {
  readonly draggableId: DndId
  readonly beginDrag: (init: DragBeginInit) => DragSession | null
}

/**
 * Handlers a sensor contributes to a drag handle. Every sensor's props are merged, so two sensors
 * asking for `onKeyDown` both get called. Adding a member is a public API decision.
 */
export type SensorActivatorProps = {
  readonly onPointerDown?: PointerEventHandler<HTMLElement>
  readonly onKeyDown?: KeyboardEventHandler<HTMLElement>
}

export type Sensor = {
  readonly name: string
  readonly activate: (context: SensorContext) => SensorActivatorProps
}

/**
 * The style for the element that **moves** — complete, and meant to be passed as-is.
 *
 * We hand over all three properties together because assembling them by hand is three separate
 * ways to get a drag wrong, and this repo's own demo has hit every one: no `transform` and nothing
 * moves, no `transition` and a dropped row glides in from wherever it was, and a `style={...}`
 * written after `{...handleProps}` overwrites the handle's own object and loses `touch-action` —
 * which breaks dragging on touch devices and nowhere else.
 *
 * Both motion properties are absent at rest rather than zeroed: an identity `translate3d(0,0,0)`
 * would promote every row to its own compositing layer just to say nothing happened.
 */
export type DragNodeStyle = {
  readonly touchAction: 'none'
  readonly transform?: string
  readonly transition?: string
}

/** Everything `useDraggable` asks a consumer to spread onto the element that starts a drag. */
export type DragHandleProps = SensorActivatorProps & {
  readonly role: 'button'
  readonly tabIndex: number
  readonly 'aria-roledescription': string
  readonly 'aria-describedby': string
  readonly 'aria-disabled': boolean | undefined
  readonly draggable: false
  readonly style: { readonly touchAction: 'none' }
}

/**
 * The texts a screen reader hears. Builders rather than strings so an announcement can name the
 * item and the target; all four are overridable through `DndProvider`'s `accessibility` prop.
 */
export type DndAnnouncements = {
  readonly describeDragStart: (event: DragStartEvent) => string
  readonly describeDragOver: (event: DragOverEvent) => string
  readonly describeDragEnd: (event: DragEndEvent) => string
  readonly describeDragCancel: (event: DragCancelEvent) => string
}

export type DndAccessibility = {
  readonly announcements?: Partial<DndAnnouncements>
  /** Read by a screen reader when a handle receives focus, via `aria-describedby`. */
  readonly instructions?: string
  readonly draggableRoleDescription?: string
}

/**
 * Everything an observer can hear about a drag. `DndProvider` takes the same set as props and
 * `useDndMonitor` takes it directly, so a listener that re-renders nothing sees what a provider
 * callback sees.
 *
 * Lives here rather than in `use-dnd-monitor.ts` because `internal/store.ts` fans events out to
 * these listeners, and a type defined in the hook would make the store import a public React
 * module to describe its own contract.
 */
export type DndMonitorListeners = {
  readonly onDragStart?: (event: DragStartEvent) => void
  readonly onDragMove?: (event: DragMoveEvent) => void
  readonly onDragOver?: (event: DragOverEvent) => void
  readonly onDragEnd?: (event: DragEndEvent) => void
  readonly onDragCancel?: (event: DragCancelEvent) => void
}
