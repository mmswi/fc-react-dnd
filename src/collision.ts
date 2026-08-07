import { centerOf, distanceBetweenPoints } from './internal/geometry.js'
import type { CollisionArgs, CollisionDetection, DndId } from './types.js'

/**
 * The one collision strategy this library ships: the droppable whose centre sits closest to
 * the centre of the dragged item.
 *
 * Pure and directive-free, so it stays server-importable. It operates only on the rects it is
 * handed — the active rect arrives already translated, and disabled droppables and
 * measure-only rows are already gone. Those are the store's decisions on purpose: a strategy
 * that reads policy out of `data` cannot be swapped for a custom one that uses `data` for
 * something else.
 */
export const closestCenter: CollisionDetection = (args: CollisionArgs): DndId | null => {
  const activeCenter = centerOf(args.active.rect)

  let nearestId: DndId | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const droppable of args.droppables) {
    const distance = distanceBetweenPoints(activeCenter, centerOf(droppable.rect))

    // Strictly less, so an exact tie keeps the earlier candidate — registration order, which
    // is the only tie-break that gives the same answer for the same list every time.
    if (distance < nearestDistance) {
      nearestId = droppable.id
      nearestDistance = distance
    }
  }

  return nearestId
}
