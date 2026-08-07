'use client'

import {
  DRAG_CANCEL_REASONS,
  DRAG_DIRECTIONS,
  type DragDirection,
  type DragSession,
  type Sensor,
  type SensorContext,
  type Translate,
} from './types.js'

/**
 * A first-class keyboard drag, not an afterthought.
 *
 * The design that makes it cheap: arrow keys produce a **translate**, exactly as a pointer
 * would, so a keyboard drag flows through the same collision and the same tree-depth maths
 * rather than a parallel code path. Nothing downstream can tell which sensor drove a drag.
 *
 * This sensor knows nothing about trees. ArrowLeft/ArrowRight emit a horizontal step, and it is
 * the tree projection that decides a horizontal step means a change of depth.
 */

const DEFAULT_INDENT_PX = 24
const ACTIVATION_KEYS = [' ', 'Enter'] as const
const ESCAPE_KEY = 'Escape'

const DIRECTION_BY_ARROW_KEY: Record<string, DragDirection> = {
  ArrowUp: DRAG_DIRECTIONS.up,
  ArrowDown: DRAG_DIRECTIONS.down,
  ArrowLeft: DRAG_DIRECTIONS.left,
  ArrowRight: DRAG_DIRECTIONS.right,
}

export type KeyboardSensorOptions = {
  /** How far one ArrowLeft/ArrowRight step moves the item horizontally. */
  readonly indentPx?: number
}

type KeyboardDrag = {
  readonly session: DragSession
  readonly handle: HTMLElement
  readonly onBlur: () => void
  translate: Translate
}

export const keyboardSensor = (options: KeyboardSensorOptions = {}): Sensor => {
  const indentPx = options.indentPx ?? DEFAULT_INDENT_PX

  let drag: KeyboardDrag | null = null

  const teardown = (): void => {
    const current = drag
    if (!current) return
    drag = null
    current.handle.removeEventListener('blur', current.onBlur)
  }

  const beginDrag = (context: SensorContext, handle: HTMLElement): void => {
    // No pointer origin: a keyboard drag has no edge distance to compute, so auto-scroll is off
    // by construction and the keyboard path uses `scrollIntoView` instead.
    const session = context.beginDrag({ pointer: null })
    if (!session) return

    const onBlur = (): void => {
      drag?.session.cancel(DRAG_CANCEL_REASONS.blur)
      teardown()
    }

    drag = { session, handle, onBlur, translate: { x: 0, y: 0 } }
    handle.addEventListener('blur', onBlur)
  }

  const stepToTarget = (current: KeyboardDrag, direction: DragDirection): void => {
    const target = current.session.findTargetInDirection(direction)
    // Nothing that way: stay put rather than wrapping around or jumping across the page.
    if (!target) return

    current.translate = target.translate
    current.session.move(target.translate)
    target.node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const stepDepth = (current: KeyboardDrag, direction: DragDirection): void => {
    const stepPx = direction === DRAG_DIRECTIONS.right ? indentPx : -indentPx
    const next: Translate = { x: current.translate.x + stepPx, y: current.translate.y }

    current.translate = next
    current.session.move(next)
  }

  const handleArrowKey = (current: KeyboardDrag, direction: DragDirection): void => {
    const isVertical = direction === DRAG_DIRECTIONS.up || direction === DRAG_DIRECTIONS.down
    if (isVertical) {
      stepToTarget(current, direction)
      return
    }

    stepDepth(current, direction)
  }

  return {
    name: 'keyboard',
    activate: (context) => ({
      onKeyDown: (event) => {
        // The store can end a drag without telling this sensor — a row disappearing cancels
        // through the A6 policy, and there is no keyboard event that would reveal it. Left
        // believing a drag is running, the sensor would consume the user's next pickup ending
        // one that is already over.
        if (drag && !drag.session.isActive()) teardown()
        const current = drag
        const isActivationKey = (ACTIVATION_KEYS as readonly string[]).includes(event.key)

        if (!current) {
          if (!isActivationKey) return
          // Without this, Space scrolls the page out from under the drag being started.
          event.preventDefault()
          beginDrag(context, event.currentTarget)
          return
        }

        if (isActivationKey) {
          event.preventDefault()
          current.session.end()
          teardown()
          return
        }

        if (event.key === ESCAPE_KEY) {
          event.preventDefault()
          current.session.cancel(DRAG_CANCEL_REASONS.escape)
          teardown()
          return
        }

        const direction = DIRECTION_BY_ARROW_KEY[event.key]
        if (!direction) return

        event.preventDefault()
        handleArrowKey(current, direction)
      },
    }),
  }
}
