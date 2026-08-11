'use client'

import { useRef, useSyncExternalStore } from 'react'

/**
 * The one hook that connects React to the store, and the reason a 120 Hz pointer stream
 * re-renders almost nothing.
 *
 * Two facts about `useSyncExternalStore` shape everything here:
 *
 * 1. A notification whose selected slice is unchanged **never enters React** — the subscribe
 *    wrapper compares first and only schedules on a difference. There is no lane, no root
 *    scheduling, and no render (`ReactFiberHooks.js:1859-1893`).
 * 2. Reaching that conclusion requires calling the selector, on every notification, for every
 *    subscriber. So the selector's own cost is unavoidable and must stay O(1) — see
 *    `ANALYSIS.md` § A3.2 and perf invariant 9.
 */

export type ReadableStore<State> = {
  readonly subscribe: (listener: () => void) => () => void
  readonly getState: () => State
}

type SnapshotCache<State, Slice> = {
  state: State
  slice: Slice
  select: (state: State) => Slice
}

/**
 * Subscribe to a slice of a store.
 *
 * The returned slice keeps its **reference** for as long as the comparison says it is unchanged.
 * That is correctness, not an optimisation: React calls `getSnapshot` again outside the render
 * for its tearing check, and twice more on mount in DEV, so a selector returning a fresh object
 * every call is an infinite loop — exactly what React's "getSnapshot should be cached" warning
 * detects.
 */
export const useStoreSelector = <State, Slice>(
  store: ReadableStore<State>,
  select: (state: State) => Slice,
  areEqual: (previous: Slice, next: Slice) => boolean = Object.is,
): Slice => {
  const cache = useRef<SnapshotCache<State, Slice> | null>(null)

  // Deliberately *not* memoised, and deliberately closing over this render's `select`. React
  // re-reads the latest `getSnapshot` when deciding whether a notification matters
  // (`ReactFiberHooks.js:1878`), so a component may swap its selector between renders and the very
  // next comparison uses the new one. A `useCallback` over a ref would leave one render reading
  // the previous selector.
  const getSnapshot = (): Slice => {
    const state = store.getState()
    const cached = cache.current

    // This misses on every move by design — the store mints a new state object per transition. It
    // pays off on React's *repeat* reads of one snapshot, where the same state through the same
    // selector cannot have produced anything different, so a `===` replaces a call. Both halves
    // matter: keyed on state alone, a component that swapped its selector between renders would
    // keep getting the previous selector's answer.
    const isCacheStillValid = cached !== null && cached.state === state && cached.select === select
    if (isCacheStillValid) return cached.slice

    const next = select(state)
    if (cached && areEqual(cached.slice, next)) {
      // Remember the newer state so the identity check above short-circuits next time, but
      // hand back the *old* slice so the reference a consumer holds stays stable.
      cache.current = { state, slice: cached.slice, select }
      return cached.slice
    }

    cache.current = { state, slice: next, select }
    return next
  }

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
