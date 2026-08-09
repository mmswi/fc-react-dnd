'use client'

import type { CSSProperties } from 'react'
import { useDndContext } from './internal/context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import { TREE_INDICATOR_EDGES, type TreeDropProjection } from './tree.js'

/**
 * Where the drop will land, drawn.
 *
 * Tree rows are measure-only and never move, so **without something like this a tree drag shows
 * nothing at all** — not row motion, not a gap opening, nothing. That is the deliberate
 * indicator-only model (`ANALYSIS.md` § A7), and it means the feedback is not optional
 * decoration; it is the whole interface.
 *
 * This ships because the alternative is every consumer deriving a screen position from
 * `afterId`/`beforeId`, which are sibling-space and cannot be turned into one without knowing
 * that an `into` target's `beforeId` is its first child, and that an un-nest belongs below a
 * whole subtree. This repo's own demo got that wrong three separate times before
 * `projection.indicator` existed (§ A10). A component removes the derivation rather than
 * documenting it.
 *
 * **The one contract:** the element you attach `getRowProps(id).ref` to spans the full width of
 * the list, with depth shown as padding *inside* it. Rows are measured through that ref, so a
 * ref on an already-indented child would report a left edge that moves with depth and there
 * would be no fixed origin to indent from. Putting `handleProps` on an inner button while the
 * ref sits on the full-width row is fine, and is what the playground does.
 */

const LINE_THICKNESS_PX = 2

export type TreeDropIndicatorProps = {
  /** Straight from `useTreeDrop`. `null` renders nothing — including the no-legal-position case. */
  readonly projection: TreeDropProjection | null
  readonly className?: string
  readonly style?: CSSProperties
  readonly 'data-testid'?: string
}

export const TreeDropIndicator = ({
  projection,
  className,
  style,
  ...rest
}: TreeDropIndicatorProps) => {
  const { store } = useDndContext('TreeDropIndicator')
  const indicator = projection?.indicator ?? null
  const anchorId = indicator?.rowId ?? null

  // The rect map is replaced only when rects are re-measured — never per move — so this
  // returns the same object for the whole drag and the indicator does not re-render with the
  // pointer. Reading from the cache is also perf invariant 1: no DOM reads in the move path.
  const anchorRect = useStoreSelector(store, (state) =>
    anchorId === null ? null : (state.measuredRects.get(anchorId) ?? null),
  )

  if (!indicator || !anchorRect) return null

  // The same indent `useTreeDrop` published for the keyboard sensor, so the number is authored
  // in exactly one place (§ A11) rather than handed to this component a second time.
  const indentPx = store.getCrossAxisStepPx()
  const isOver = indicator.edge === TREE_INDICATOR_EDGES.over
  const insetPx = isOver ? 0 : indicator.depth * indentPx

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'fixed',
        // Rects are viewport coordinates, and `pointer-events: none` keeps the rows underneath
        // hit-testable — the indicator sits directly over them for the whole drag.
        pointerEvents: 'none',
        left: anchorRect.left + insetPx,
        width: Math.max(anchorRect.width - insetPx, 0),
        top:
          indicator.edge === TREE_INDICATOR_EDGES.below
            ? anchorRect.top + anchorRect.height
            : anchorRect.top,
        height: isOver ? anchorRect.height : LINE_THICKNESS_PX,
        background: isOver ? 'rgba(37, 99, 235, 0.12)' : '#2563eb',
        outline: isOver ? '2px solid #2563eb' : undefined,
        ...style,
      }}
      {...rest}
    />
  )
}
