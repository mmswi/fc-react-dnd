import { Profiler, type ReactNode, useEffect, useRef } from 'react'

/**
 * Counts **commits**, from an effect with no dependency array.
 *
 * Deliberately not a counter in the component body: when a parent re-renders, React can run a
 * body and discard its output, so a body counter ticks for a render that committed nothing. The
 * numbers on this page have to mean the same thing as the ones in the test suite and in the
 * React Profiler, and commits are what all three can agree on.
 */
export const useCommitCounter = (): number => {
  const commits = useRef(0)
  commits.current += 0
  useEffect(() => {
    commits.current += 1
  })
  return commits.current
}

export const CommitBadge = ({ count }: { count: number }) => (
  <span
    style={{
      marginLeft: 'auto',
      fontVariantNumeric: 'tabular-nums',
      fontSize: 12,
      color: count > 0 ? '#b45309' : '#64748b',
      background: '#f1f5f9',
      borderRadius: 4,
      padding: '1px 6px',
    }}
    title="Commits since mount"
  >
    {count}
  </span>
)

type CommitLog = Record<string, number>

declare global {
  interface Window {
    /** Per-row commit counts, straight from React's Profiler. Read by the QA session. */
    __dndCommits?: CommitLog
  }
}

/**
 * Records commits **through React's own Profiler**, keyed by row.
 *
 * `onRender` fires once per commit of the subtree it wraps, so one Profiler per row turns
 * "how many rows re-rendered" into a number React itself produced — the same measurement the
 * React DevTools profiler shows, in a form a QA session can read out of the page.
 */
export const ProfiledRow = ({ id, children }: { id: string; children: ReactNode }) => (
  <Profiler
    id={id}
    onRender={(profilerId) => {
      if (!window.__dndCommits) window.__dndCommits = {}
      window.__dndCommits[profilerId] = (window.__dndCommits[profilerId] ?? 0) + 1
    }}
  >
    {children}
  </Profiler>
)

export const resetCommitLog = (): void => {
  window.__dndCommits = {}
}
