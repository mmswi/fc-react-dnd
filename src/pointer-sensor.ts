'use client'

import { ESCAPE_KEY } from './internal/keys.js'
import {
  DRAG_CANCEL_REASONS,
  type DragSession,
  type Point,
  type Sensor,
  type SensorContext,
} from './types.js'

/**
 * Turns pointer events into store lifecycle calls.
 *
 * An activation threshold is what keeps a click a click. Everything after activation is owned
 * by this sensor for exactly one interaction — window listeners, pointer capture, the
 * `user-select` lock, and the suppression of the click that trails a real drag — and all of it
 * is torn down on end, on cancel, and when the store cancels the drag underneath us.
 */

const DEFAULT_ACTIVATION_DISTANCE_PX = 5
const DEFAULT_ACTIVATION_TOLERANCE_PX = 5
const PRIMARY_MOUSE_BUTTON = 0
const CLICK_SUPPRESSION_WINDOW_MS = 0

export type PointerSensorOptions = {
  /** How far the pointer must travel before a press becomes a drag. */
  readonly activationDistancePx?: number
  /**
   * Hold-to-drag instead of move-to-drag. When set, the drag begins after this long **unless**
   * the pointer strays further than `activationTolerancePx` first — which is what lets a touch
   * scroll the page instead of dragging a row.
   */
  readonly activationDelayMs?: number
  readonly activationTolerancePx?: number
}

type Press = {
  readonly pointerId: number
  readonly point: Point
  readonly button: number
  readonly isPrimary: boolean
  readonly captureTarget: Element
}

type Interaction = {
  readonly context: SensorContext
  readonly pointerId: number
  readonly startPoint: Point
  readonly captureTarget: Element
  session: DragSession | null
  delayTimer: ReturnType<typeof setTimeout> | null
}

const distanceBetween = (from: Point, to: Point): number => Math.hypot(to.x - from.x, to.y - from.y)

const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

/**
 * Swallows exactly one `click`, the one the browser fires after a real drag's `pointerup`.
 *
 * Registered in the capture phase so it lands before any consumer handler, and removed on the
 * next macrotask whether or not a click arrived — otherwise a drag that ended over nothing
 * clickable would go on to eat the user's next legitimate click.
 */
const suppressNextClick = (): void => {
  const swallowClick = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    window.removeEventListener('click', swallowClick, true)
  }

  window.addEventListener('click', swallowClick, true)
  setTimeout(() => {
    window.removeEventListener('click', swallowClick, true)
  }, CLICK_SUPPRESSION_WINDOW_MS)
}

export const pointerSensor = (options: PointerSensorOptions = {}): Sensor => {
  const activationDistancePx = options.activationDistancePx ?? DEFAULT_ACTIVATION_DISTANCE_PX
  const activationTolerancePx = options.activationTolerancePx ?? DEFAULT_ACTIVATION_TOLERANCE_PX
  const activationDelayMs = options.activationDelayMs ?? null
  const isHoldToDrag = activationDelayMs !== null

  // One interaction at a time, for the whole sensor. A second finger landing while a drag is
  // running must not start a second drag or hijack the first.
  let interaction: Interaction | null = null

  const activate = (pointer: Point): void => {
    const current = interaction
    if (!current || current.session) return

    const session = current.context.beginDrag({ pointer })
    if (!session) {
      teardown()
      return
    }
    current.session = session

    if (current.delayTimer !== null) {
      clearTimeout(current.delayTimer)
      current.delayTimer = null
    }

    // Swap the passive listener for one that can `preventDefault`, which from here on is
    // load-bearing: without it the browser selects text and scrolls under the drag.
    window.removeEventListener('pointermove', onPointerMoveBeforeActivation)
    window.addEventListener('pointermove', onPointerMoveWhileDragging, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    current.captureTarget.setPointerCapture?.(current.pointerId)
    document.body.style.userSelect = 'none'
  }

  const belongsToInteraction = (event: PointerEvent): Interaction | null => {
    const current = interaction
    const isSamePointer = current !== null && event.pointerId === current.pointerId
    return isSamePointer ? current : null
  }

  const onPointerMoveBeforeActivation = (event: Event): void => {
    const pointerEvent = event as PointerEvent
    const current = belongsToInteraction(pointerEvent)
    if (!current) return

    const travelled = distanceBetween(current.startPoint, pointOf(pointerEvent))

    if (isHoldToDrag) {
      // Straying before the timer fires means the user meant to scroll, so the interaction is
      // abandoned rather than activated late under their finger.
      if (travelled > activationTolerancePx) teardown()
      return
    }

    if (travelled < activationDistancePx) return

    // The drag starts from where the press was, not from where the threshold happened to be
    // crossed — otherwise every drag would jump by the activation distance on its first frame.
    activate(current.startPoint)
    // …and the move that crossed the threshold is reported immediately, so the item is already
    // under the pointer on the first rendered frame rather than one event behind it. Reported
    // here rather than by re-entering the dragging handler, because this listener is passive
    // and calling `preventDefault` from it would only earn a console warning.
    current.session?.move({
      x: pointerEvent.clientX - current.startPoint.x,
      y: pointerEvent.clientY - current.startPoint.y,
    })
  }

  const onPointerMoveWhileDragging = (event: Event): void => {
    const pointerEvent = event as PointerEvent
    const current = belongsToInteraction(pointerEvent)
    if (!current?.session) return

    pointerEvent.preventDefault()
    current.session.move({
      x: pointerEvent.clientX - current.startPoint.x,
      y: pointerEvent.clientY - current.startPoint.y,
    })
  }

  const onPointerUp = (event: Event): void => {
    const current = belongsToInteraction(event as PointerEvent)
    if (!current) return

    const wasRealDrag = current.session !== null
    current.session?.end()
    teardown()
    if (wasRealDrag) suppressNextClick()
  }

  const onPointerCancel = (event: Event): void => {
    const current = belongsToInteraction(event as PointerEvent)
    if (!current) return

    current.session?.cancel(DRAG_CANCEL_REASONS.pointerCancelled)
    teardown()
  }

  const onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== ESCAPE_KEY) return

    interaction?.session?.cancel(DRAG_CANCEL_REASONS.escape)
    teardown()
  }

  const teardown = (): void => {
    const current = interaction
    if (!current) return
    interaction = null

    if (current.delayTimer !== null) clearTimeout(current.delayTimer)

    window.removeEventListener('pointermove', onPointerMoveBeforeActivation)
    window.removeEventListener('pointermove', onPointerMoveWhileDragging)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown)

    const hadActivated = current.session !== null
    if (hadActivated) {
      current.captureTarget.releasePointerCapture?.(current.pointerId)
      document.body.style.userSelect = ''
    }
  }

  const beginInteraction = (context: SensorContext, press: Press): void => {
    const isSecondPointer = interaction !== null
    const isPrimaryPress = press.button === PRIMARY_MOUSE_BUTTON && press.isPrimary
    if (isSecondPointer || !isPrimaryPress) return

    const current: Interaction = {
      context,
      pointerId: press.pointerId,
      startPoint: press.point,
      captureTarget: press.captureTarget,
      session: null,
      delayTimer: null,
    }
    interaction = current

    // Passive until the drag is real: before activation this sensor never calls
    // `preventDefault`, so saying so up front keeps scrolling on the compositor.
    window.addEventListener('pointermove', onPointerMoveBeforeActivation, { passive: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    if (isHoldToDrag) {
      current.delayTimer = setTimeout(() => {
        activate(current.startPoint)
      }, activationDelayMs)
    }
  }

  return {
    name: 'pointer',
    activate: (context) => ({
      onPointerDown: (event) => {
        beginInteraction(context, {
          pointerId: event.pointerId,
          point: { x: event.clientX, y: event.clientY },
          button: event.button,
          isPrimary: event.isPrimary,
          captureTarget: event.currentTarget,
        })
      },
    }),
  }
}
