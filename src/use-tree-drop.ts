'use client'

import { type RefCallback, useEffect, useMemo, useRef } from 'react'
import { useDndContext } from './internal/context.js'
import { buildDragHandleProps } from './internal/handle-props.js'
import { buildNodeStyle } from './internal/node-style.js'
import {
  projectTreeForDrag,
  type TreeProjectionArgs,
  treeProjectionsAreEqual,
} from './internal/tree-projection.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import {
  DEFAULT_TREE_INDENT_PX,
  TREE_DROP_MODES,
  type TreeDropProjection,
  type TreeItem,
  type TreeNestPredicate,
} from './tree.js'
import type { DndId, DragHandleProps, DragNodeStyle } from './types.js'

/**
 * Wires the pure tree maths to a live drag.
 *
 * One hook owns the whole tree side of the React seam: it returns the live projection **and**
 * wires every row through `getRowProps(id)`. There is no separate per-row hook, and therefore no
 * way to hold it wrong (`ANALYSIS.md` § A7 D3).
 *
 * Rows register **measure-only**: their rects feed the projection and keyboard targeting, and
 * collision never sees them. Element hit-testing is the wrong question for a tree (§ A1), so it
 * does not run against tree rows at all rather than running and being ignored.
 *
 * **v0.1 is indicator-only.** Rows do not translate during a tree drag — that is the sortable
 * list's model. The projection drives one indicator. Live reflow is a Backlog item.
 */

/** Tree rows never translate, so one frozen object serves every row of every tree. */
const TREE_ROW_STYLE: DragNodeStyle = buildNodeStyle(null, undefined)

export type TreeRowProps = {
  readonly ref: RefCallback<HTMLElement>
  readonly handleProps: DragHandleProps
  readonly isDragging: boolean
  /**
   * Pass it straight to `style`. No `transform` here and there never will be while tree mode is
   * indicator-only — but `touch-action` still has to reach the element, and a consumer who
   * spreads `{...handleProps}` and then sets `style` would drop it. Same object shape as the
   * other hooks so no row type is the odd one out.
   */
  readonly style: DragNodeStyle
}

export type UseTreeDropOptions<Extra> = {
  /**
   * The tree. **Must be referentially stable across renders** — it is the projection memo's
   * inner key, so an inline array recomputes the projection on every notification instead of
   * once per move (§ A7 F6).
   */
  readonly items: readonly TreeItem<Extra>[]
  readonly collapsedIds?: ReadonlySet<DndId>
  readonly indentPx?: number
  readonly nestBandFraction?: number
  /** Must also be referentially stable, for the same reason. Defaults to "any node can parent". */
  readonly canNest?: TreeNestPredicate
  /** Overrides the text the live region announces as the projection moves. */
  readonly describeProjection?: (projection: TreeDropProjection | null) => string
}

export type UseTreeDropResult = {
  readonly projection: TreeDropProjection | null
  readonly getRowProps: (id: DndId) => TreeRowProps
}

const describeProjectionByDefault = (projection: TreeDropProjection | null): string => {
  if (!projection) return 'No valid position here.'

  if (projection.mode === TREE_DROP_MODES.into) {
    return `Place inside ${String(projection.parentId)}, at the top.`
  }

  const level = `level ${projection.depth + 1}`
  if (projection.afterId !== null) return `Place after ${String(projection.afterId)}, ${level}.`
  if (projection.beforeId !== null) return `Place before ${String(projection.beforeId)}, ${level}.`
  return `Place at the start, ${level}.`
}

type CachedRowProps = {
  readonly ref: RefCallback<HTMLElement>
  readonly handleProps: DragHandleProps
  /** The element currently attached, remembered so the lifetime effect can re-register it. */
  node: HTMLElement | null
}

export const useTreeDrop = <Extra>(options: UseTreeDropOptions<Extra>): UseTreeDropResult => {
  const {
    items,
    collapsedIds,
    indentPx,
    nestBandFraction,
    canNest,
    describeProjection = describeProjectionByDefault,
  } = options
  const { store, sensors, instructionsId, draggableRoleDescription } = useDndContext('useTreeDrop')

  const projectionArgs = useMemo<TreeProjectionArgs<Extra>>(
    () => ({ items, collapsedIds, indentPx, nestBandFraction, canNest }),
    [items, collapsedIds, indentPx, nestBandFraction, canNest],
  )

  /**
   * The keyboard sensor cannot know how wide one level is, and this is the only place that
   * number is authored — so publish it rather than letting the sensor carry a constant that has
   * to happen to match (`ANALYSIS.md` § A11).
   *
   * A registration, so it never notifies and costs no render (perf invariant 5).
   */
  const resolvedIndentPx = indentPx ?? DEFAULT_TREE_INDENT_PX

  useEffect(() => {
    store.setCrossAxisStepPx(resolvedIndentPx)
  }, [store, resolvedIndentPx])

  const projection = useStoreSelector(
    store,
    (state) => projectTreeForDrag(state, projectionArgs),
    // By value: the projection object is new on every move because the state is, and comparing
    // by reference would re-render the whole tree at pointer frequency.
    treeProjectionsAreEqual,
  )

  const activeId = useStoreSelector(store, (state) => state.origin?.id ?? null)

  /**
   * Row props are cached per id so the `ref` a row receives is the **same function** across
   * renders. A fresh ref every render makes React detach and re-attach on every render, and
   * mid-drag a detach is a removal, which cancels the drag (§ A6).
   *
   * The builder lives inside the memo with the cache, so the dependency list is the honest set
   * of things baked into the closures it produces — change any of them and the cache is thrown
   * away with them.
   */
  const rowCache = useMemo(() => {
    const byId = new Map<DndId, CachedRowProps>()

    const build = (id: DndId): CachedRowProps => ({
      node: null,
      // Registers, and **never** unregisters. A consumer writing
      // `ref={(node) => { myRef.current = node; ref(node) }}` hands React a new function every
      // render, so React detaches and re-attaches on every render — and mid-drag a detach that
      // unregistered would be a removal, which cancels the drag. Unregistration is the lifetime
      // effect's job, below.
      ref: (node) => {
        const cached = byId.get(id)
        if (cached) cached.node = node
        if (node === null) return
        store.registerDraggable(id, node)
        store.registerMeasuredRow(id, node)
      },
      handleProps: buildDragHandleProps({
        id,
        store,
        sensors,
        instructionsId,
        draggableRoleDescription,
      }),
    })

    return { byId, build }
  }, [store, sensors, instructionsId, draggableRoleDescription])

  /**
   * Ids `getRowProps` was asked for since the last commit.
   *
   * A row exists exactly as long as the consumer keeps rendering it, so this is how the hook
   * learns a row is gone — there is no per-row hook whose cleanup could say so. Only ever added
   * to during render and swapped out in the effect below, so a render React discards leaves a
   * row registered one commit longer rather than unregistering one that is still there.
   */
  const requestedSinceLastCommit = useRef(new Set<DndId>())

  const getRowProps = (id: DndId): TreeRowProps => {
    requestedSinceLastCommit.current.add(id)

    let cached = rowCache.byId.get(id)
    if (!cached) {
      cached = rowCache.build(id)
      rowCache.byId.set(id, cached)
    }

    return {
      ref: cached.ref,
      handleProps: cached.handleProps,
      isDragging: activeId === id,
      style: TREE_ROW_STYLE,
    }
  }

  const registeredIds = useRef(new Set<DndId>())

  // Rows the consumer stopped rendering are gone, and gone mid-drag means the A6 policy fires —
  // which is exactly right: a branch collapsing under a drag is a removal.
  useEffect(() => {
    const requested = requestedSinceLastCommit.current
    requestedSinceLastCommit.current = new Set()

    for (const id of [...registeredIds.current]) {
      if (requested.has(id)) continue
      registeredIds.current.delete(id)
      rowCache.byId.delete(id)
      store.unregisterDraggable(id)
      store.unregisterMeasuredRow(id)
    }

    for (const id of requested) registeredIds.current.add(id)
  })

  // Re-registers on setup as well as unregistering on cleanup, so StrictMode's
  // setup → cleanup → setup leaves every row registered rather than none.
  useEffect(() => {
    for (const [id, cached] of rowCache.byId) {
      if (!cached.node) continue
      store.registerDraggable(id, cached.node)
      store.registerMeasuredRow(id, cached.node)
      registeredIds.current.add(id)
    }

    const registered = registeredIds
    return () => {
      for (const id of registered.current) {
        store.unregisterDraggable(id)
        store.unregisterMeasuredRow(id)
      }
      registered.current.clear()
    }
  }, [store, rowCache])

  // Tree rows are measure-only and so emit no `over` events — the live region would otherwise
  // hear nothing at all between pickup and drop. Announced from an effect rather than during
  // render, so it fires once per committed projection change.
  const latestDescribe = useRef(describeProjection)
  useEffect(() => {
    latestDescribe.current = describeProjection
  })
  useEffect(() => {
    if (activeId === null) return
    store.announce(latestDescribe.current(projection))
  }, [store, activeId, projection])

  return { projection, getRowProps }
}
