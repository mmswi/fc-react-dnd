import type { KeyboardEventHandler, PointerEventHandler } from 'react'

/**
 * The shared vocabulary every other module in this library speaks.
 *
 * Deliberately free of `'use client'`: nothing here touches React state, effects, or the DOM
 * at render time, so a server component can import these types and the one constant object
 * without pulling the client runtime in behind them.
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
 * conflating "where the pointer is" with "how far it has moved" is the bug this separation
 * exists to make unspellable in a signature.
 */
export type Translate = {
  readonly x: number
  readonly y: number
}

/**
 * `right` and `bottom` are deliberately absent: they are derivable, and a rect that carries
 * them can be constructed inconsistent with itself.
 */
export type Rect = {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/**
 * Consumer payloads ride along with a draggable or droppable and reach every event unchanged.
 * `unknown` values rather than `any`: a consumer narrows their own data, and nothing this
 * library does can silently turn off their type checking.
 */
export type DndData = Record<string, unknown>

export const DRAG_CANCEL_REASONS = {
  escape: 'escape',
  blur: 'blur',
  pointerCancelled: 'pointer-cancelled',
  itemRemoved: 'item-removed',
} as const

/**
 * Why a drag ended without dropping. Public API — a consumer showing "another editor changed
 * this list" needs to tell `'item-removed'` from a user pressing Escape, so adding a member
 * later breaks anyone who wrote an exhaustive `switch`.
 *
 * `'item-removed'` is the library forcing a cancel because a registered node disappeared
 * mid-drag; `'pointer-cancelled'` is the browser revoking the interaction.
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
 * The half of a drag that does not move: which item, what it carried, and where it sat when the
 * drag began. `useActiveDrag` returns this, and its identity survives every pointermove — which
 * is what keeps a component reading it from re-rendering at pointer frequency.
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
   * What the drag began over, if anything.
   *
   * A drag frequently starts already over a target — a sortable row is over itself. Reporting it
   * here rather than as an immediate `onDragOver` keeps a consumer that tracks the target from
   * `onDragOver` alone from starting one target behind, without the second event stepping on the
   * pickup announcement.
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
   * Registration order, with disabled and measure-only entries already removed. An array
   * rather than a map because tie-breaking on equidistant candidates is asserted behaviour,
   * so a strategy has to be able to see that order.
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
 * Handed to a sensor when it activates, and valid for exactly one interaction. A session
 * captured before the drag ended is inert afterwards — the store guards it with a token, so a
 * late listener firing after `end` cannot resurrect a finished drag.
 */
export type DragSession = {
  /**
   * Whether this session is still the live one.
   *
   * A drag can end without the sensor being told: the store cancels when a registered node
   * disappears (§ A6), and the keyboard path has no trailing event that would reveal it. A
   * sensor that goes on believing a drag is running swallows the user's next pickup.
   */
  readonly isActive: () => boolean
  readonly move: (translate: Translate) => void
  readonly end: () => void
  readonly cancel: (reason: DragCancelReason) => void
  /**
   * Keyboard targeting, answered from the store's rect cache. The sensor asks "what is the
   * next target upward?" rather than reading rects itself, which is what keeps perf invariant
   * 1 (no DOM reads in the move path) true for the keyboard path too.
   */
  readonly findTargetInDirection: (direction: DragDirection) => DirectionalTarget | null
}

export type DragBeginInit = {
  /**
   * Where the pointer was when the drag started, or `null` for a drag with no pointer at all.
   * Auto-scroll needs an edge distance to compute, so a null origin turns it off by
   * construction rather than by a switch a future sensor could forget to set.
   */
  readonly pointer: Point | null
}

export type SensorContext = {
  readonly draggableId: DndId
  readonly beginDrag: (init: DragBeginInit) => DragSession | null
}

/**
 * Handlers a sensor contributes to a drag handle. Every sensor's props are merged, so two
 * sensors asking for `onKeyDown` both get called. Adding a member is a public API decision.
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
 * Assembling this by hand is three chances to get a drag wrong, and every one of them has been
 * taken in this repo's own demo. Forget `transform` and nothing moves. Forget `transition` and
 * a dropped row glides in from wherever it was instead of landing. Forget to merge
 * `handleProps.style` and `touch-action` is lost, which breaks dragging on touch devices and
 * nowhere else — so it survives every desktop test the author runs.
 *
 * `touchAction` rides along for that last reason: the node and the handle are usually the same
 * element, and `style={...}` after `{...handleProps}` overwrites the handle's own style object.
 * Carrying it here makes the common spread correct instead of subtly broken.
 *
 * Both motion properties are optional and absent at rest. An identity `translate3d(0,0,0)`
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
 * The texts a screen reader hears. Builders rather than strings so an announcement can name
 * the item and the target; every one is overridable through `DndProvider`'s `accessibility`
 * prop, because none of them should be hard-coded English inside a component.
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
 * `useDndMonitor` takes it directly, so a listener that re-renders nothing sees exactly what a
 * provider callback sees.
 *
 * Lives here rather than in `use-dnd-monitor.ts` because the store fans events out to these
 * listeners, and a type defined in the hook would make the internal store import a public
 * React module to describe its own contract.
 */
export type DndMonitorListeners = {
  readonly onDragStart?: (event: DragStartEvent) => void
  readonly onDragMove?: (event: DragMoveEvent) => void
  readonly onDragOver?: (event: DragOverEvent) => void
  readonly onDragEnd?: (event: DragEndEvent) => void
  readonly onDragCancel?: (event: DragCancelEvent) => void
}
