// Erased at compile time, so the `'use client'` in `sortable-list.tsx` never reaches this module's
// emitted file — which is what keeps it directive-free and importable from a server component.
import type { SortEndEvent } from './sortable-list.js'
import type { DndId } from './types.js'

/**
 * Apply a `SortEndEvent` to your own array — the list counterpart of `applyTreeDrop`.
 *
 * Pure and directive-free, so it stays server-importable and Node-testable.
 */
const clamp = (value: number, lowest: number, highest: number): number =>
  Math.min(Math.max(value, lowest), highest)

/**
 * Where the item lands in the array **as it exists now**, resolved by neighbour id.
 *
 * Ids first, because the event was computed against the list as it was some milliseconds ago and
 * a concurrent edit shifts every index after the row it removed — and no id at all.
 */
const resolveLandingIndex = <Item>(
  remaining: readonly Item[],
  event: SortEndEvent,
  getId: (item: Item) => DndId,
): number => {
  const afterIndex = remaining.findIndex((item) => getId(item) === event.afterId)
  if (afterIndex !== -1) return afterIndex + 1

  const beforeIndex = remaining.findIndex((item) => getId(item) === event.beforeId)
  if (beforeIndex !== -1) return beforeIndex

  // Both neighbours have gone. The captured slot is all that is left, and clamping is what keeps
  // it in range rather than silently appending or throwing.
  return clamp(event.toIndex, 0, remaining.length)
}

export const applySortEnd = <Item>(
  items: readonly Item[],
  event: SortEndEvent,
  getId: (item: Item) => DndId,
): readonly Item[] => {
  const fromIndex = items.findIndex((item) => getId(item) === event.activeId)
  const moved = items[fromIndex]
  if (moved === undefined) return items

  const remaining = [...items.slice(0, fromIndex), ...items.slice(fromIndex + 1)]
  const landingIndex = resolveLandingIndex(remaining, event, getId)

  // Same reference when the drop changes nothing, so a memoised list bails out instead of
  // re-rendering every row to arrive at the order it already had.
  const landsWhereItStarted = landingIndex === fromIndex
  if (landsWhereItStarted) return items

  return [...remaining.slice(0, landingIndex), moved, ...remaining.slice(landingIndex)]
}
