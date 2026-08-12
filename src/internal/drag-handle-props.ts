import type { DragHandleProps, Sensor, SensorActivatorProps, SensorContext } from '../types.js'

/**
 * The props a consumer spreads onto whatever starts a drag.
 *
 * Assembled in one place because two hooks hand them out — `useDraggable` and `useTreeDrop`'s
 * `getRowProps` — and an accessibility attribute that exists on one but not the other is the kind
 * of divergence nobody notices until a screen-reader user does.
 *
 * The store is deliberately not reachable from here: callers pass a ready `SensorContext`, so the
 * line that actually starts a drag sits next to the `store` and `id` it starts it with, instead of
 * being minted here and called back into from a sensor.
 */

const NO_ACTIVATOR_PROPS: SensorActivatorProps = {}

/** Chains every handler for an event, so no sensor's activator is silently dropped. */
const mergeActivators = (activators: readonly SensorActivatorProps[]): SensorActivatorProps => {
  const pointerDownHandlers = activators.map((props) => props.onPointerDown).filter(Boolean)
  const keyDownHandlers = activators.map((props) => props.onKeyDown).filter(Boolean)

  return {
    ...(pointerDownHandlers.length > 0 && {
      onPointerDown: (event) => {
        for (const handler of pointerDownHandlers) handler?.(event)
      },
    }),
    ...(keyDownHandlers.length > 0 && {
      onKeyDown: (event) => {
        for (const handler of keyDownHandlers) handler?.(event)
      },
    }),
  }
}

export type DragHandlePropsArgs = {
  /** Handed to every sensor. The caller builds it, so `beginDrag` reads at its own call site. */
  readonly sensorContext: SensorContext
  readonly sensors: readonly Sensor[]
  readonly instructionsId: string
  readonly draggableRoleDescription: string
  readonly disabled?: boolean
  /** A consumer's own activators, merged alongside the sensors' rather than replacing them. */
  readonly extraActivators?: SensorActivatorProps
}

export const buildDragHandleProps = (args: DragHandlePropsArgs): DragHandleProps => {
  const { sensorContext, sensors, instructionsId, draggableRoleDescription } = args
  const disabled = args.disabled ?? false

  // A disabled handle keeps every semantic it had and loses only the ability to start a drag.
  const activators = disabled
    ? NO_ACTIVATOR_PROPS
    : mergeActivators([
        ...sensors.map((sensor) => sensor.activate(sensorContext)),
        args.extraActivators ?? NO_ACTIVATOR_PROPS,
      ])

  return {
    role: 'button',
    tabIndex: 0,
    'aria-roledescription': draggableRoleDescription,
    'aria-describedby': instructionsId,
    'aria-disabled': disabled || undefined,
    draggable: false,
    style: { touchAction: 'none' },
    ...activators,
  }
}
