import { type DndAnnouncements, type DndId, DRAG_CANCEL_REASONS } from '../types.js'

/**
 * The default texts a screen reader hears during a drag.
 *
 * Pure builders rather than strings, so an announcement can name the item and the target.
 * Every one is overridable through `DndProvider`'s `accessibility` prop — none of this is
 * hard-coded English inside a component, and a consumer localising the library replaces the
 * whole set rather than patching around it.
 */

const nameOf = (id: DndId): string => String(id)

export const DEFAULT_ANNOUNCEMENTS: DndAnnouncements = {
  describeDragStart: ({ active }) =>
    `Picked up ${nameOf(active.id)}. Use the arrow keys to move it, then press Space or Enter to drop, or Escape to cancel.`,

  describeDragOver: ({ active, over }) =>
    over
      ? `${nameOf(active.id)} is over ${nameOf(over.id)}.`
      : `${nameOf(active.id)} is not over a drop target.`,

  describeDragEnd: ({ active, over }) =>
    over
      ? `Dropped ${nameOf(active.id)} on ${nameOf(over.id)}.`
      : `Dropped ${nameOf(active.id)}. It was not over a drop target, so nothing moved.`,

  describeDragCancel: ({ active, reason }) => {
    // 'movement cancelled' would be a lie for a forced cancel: the user cancelled nothing, and
    // a screen-reader user has no other way to learn why the drag stopped.
    const wasForcedByAnEdit = reason === DRAG_CANCEL_REASONS.itemRemoved
    if (wasForcedByAnEdit) {
      return `The list changed while you were dragging. ${nameOf(active.id)} returned to its starting position.`
    }

    // Escape, blur, and a browser-revoked pointer are one thing from the user's point of view:
    // the drag simply stopped. Three near-identical strings would be noise.
    return `Movement cancelled. ${nameOf(active.id)} returned to its starting position.`
  },
}
