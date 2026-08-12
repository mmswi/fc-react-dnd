'use client'

import type { CSSProperties } from 'react'
import { useDndContext } from './internal/context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import { TREE_INDICATOR_EDGES, type TreeDropProjection } from './tree.js'

/**
 * Where the drop will land, drawn.
 *
 * Tree rows are measure-only and never move, so **without this a tree drag shows nothing at all**
 * — no row motion, no gap opening. The indicator-only model is deliberate (`ANALYSIS.md` § A7),
 * which makes this feedback the whole interface rather than decoration. It reads
 * `projection.indicator`, already resolved to a screen anchor by `tree.ts`, so no consumer has to
 * derive one from the sibling-space `afterId`/`beforeId` (§ A10).
 *
 * **The one contract:** the element carrying `getRowProps(id).ref` spans the full width of the
 * list, with depth as padding *inside* it. Rows are measured through that ref, so a ref on an
 * already-indented child reports a left edge that moves with depth and leaves no fixed origin to
 * indent from. `handleProps` on an inner button is fine, and is what the playground does.
 */

const LINE_THICKNESS_PX = 2
const INDICATOR_COLOR = '#2563eb'
/** The same blue, as the fill of the `over` box. */
const INDICATOR_FILL_COLOR = 'rgba(37, 99, 235, 0.12)'
const OVER_OUTLINE = `2px solid ${INDICATOR_COLOR}`

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
        background: isOver ? INDICATOR_FILL_COLOR : INDICATOR_COLOR,
        outline: isOver ? OVER_OUTLINE : undefined,
        ...style,
      }}
      {...rest}
    />
  )
}
