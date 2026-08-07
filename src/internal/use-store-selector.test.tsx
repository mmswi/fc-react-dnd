import { act, render } from '@testing-library/react'
import { Component, type ReactNode, StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type ReadableStore, useStoreSelector } from './use-store-selector.js'

type CounterState = {
  readonly clicks: number
  readonly label: string
}

type CounterStore = ReadableStore<CounterState> & {
  set: (next: CounterState) => void
  notifyWithoutChanging: () => void
  activeSubscriptions: () => number
}

// A minimal store rather than the drag store: the seam under test is the hook's subscription
// behaviour, and a two-field state makes "this slice changed, that one didn't" legible.
const createCounterStore = (): CounterStore => {
  const listeners = new Set<() => void>()
  let state: CounterState = { clicks: 0, label: 'a' }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
    set: (next) => {
      state = next
      for (const listener of [...listeners]) listener()
    },
    notifyWithoutChanging: () => {
      // A new state object carrying the same values — exactly what the drag store produces on
      // a pointermove that changes nobody's slice.
      state = { ...state }
      for (const listener of [...listeners]) listener()
    },
    activeSubscriptions: () => listeners.size,
  }
}

describe('re-render granularity — perf invariant 4', () => {
  it('does not re-render when the selected slice is unchanged', () => {
    // Counted in the component body. There is no parent re-render in this test, so an
    // unchanged slice genuinely never schedules and the body genuinely does not run.
    const store = createCounterStore()
    let bodyRuns = 0
    const Label = () => {
      bodyRuns += 1
      return <span>{useStoreSelector(store, (state) => state.label)}</span>
    }
    render(<Label />)
    const runsAfterMount = bodyRuns

    act(() => {
      store.set({ clicks: 1, label: 'a' })
      store.set({ clicks: 2, label: 'a' })
      store.notifyWithoutChanging()
    })

    expect(bodyRuns).toBe(runsAfterMount)
  })

  it('re-renders exactly once per change of the selected slice', () => {
    const store = createCounterStore()
    let bodyRuns = 0
    const Label = () => {
      bodyRuns += 1
      return <span>{useStoreSelector(store, (state) => state.label)}</span>
    }
    render(<Label />)
    const runsAfterMount = bodyRuns

    act(() => {
      store.set({ clicks: 0, label: 'b' })
    })
    act(() => {
      store.set({ clicks: 0, label: 'c' })
    })

    expect(bodyRuns).toBe(runsAfterMount + 2)
  })
})

describe('the cost model — ANALYSIS.md A3.2', () => {
  it('runs the selector on every notification even when nothing re-renders', () => {
    // This is the architecture's actual cost, and a test that only counted renders would miss
    // a selector that got expensive. Calling the selector is *how* React decides not to render.
    const store = createCounterStore()
    const select = vi.fn((state: CounterState) => state.label)
    let bodyRuns = 0
    const Label = () => {
      bodyRuns += 1
      return <span>{useStoreSelector(store, select)}</span>
    }
    render(<Label />)
    const runsAfterMount = bodyRuns
    const selectorCallsAfterMount = select.mock.calls.length

    act(() => {
      for (let notification = 0; notification < 10; notification += 1) {
        store.notifyWithoutChanging()
      }
    })

    expect(bodyRuns).toBe(runsAfterMount)
    expect(select.mock.calls.length).toBeGreaterThanOrEqual(selectorCallsAfterMount + 10)
  })
})

describe('snapshot caching — a correctness requirement, not a performance one', () => {
  it('returns the identical reference for an object slice whose contents did not change', () => {
    // React re-reads getSnapshot outside render for the tearing check and twice more on mount
    // in DEV. An uncached selector is an infinite loop, not a slow path.
    const store = createCounterStore()
    const seen: unknown[] = []
    const Label = () => {
      const slice = useStoreSelector(
        store,
        (state) => ({ label: state.label }),
        (a, b) => a.label === b.label,
      )
      seen.push(slice)
      return <span>{slice.label}</span>
    }

    render(<Label />)
    act(() => {
      store.notifyWithoutChanging()
      store.set({ clicks: 5, label: 'a' })
    })

    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen).size).toBe(1)
  })

  it('does not warn about an uncached snapshot, which is React telling us it would loop', () => {
    const store = createCounterStore()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Label = () => {
      const slice = useStoreSelector(store, (state) => ({ label: state.label }))
      return <span>{slice.label}</span>
    }

    render(
      <StrictMode>
        <Label />
      </StrictMode>,
    )

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('custom equality', () => {
  it('does not re-render for a structurally equal new object', () => {
    const store = createCounterStore()
    let bodyRuns = 0
    const Label = () => {
      bodyRuns += 1
      const slice = useStoreSelector(
        store,
        (state) => ({ label: state.label }),
        (a, b) => a.label === b.label,
      )
      return <span>{slice.label}</span>
    }
    render(<Label />)
    const runsAfterMount = bodyRuns

    act(() => {
      store.set({ clicks: 99, label: 'a' })
    })

    expect(bodyRuns).toBe(runsAfterMount)
  })

  it('still re-renders when the custom comparison says the slice differs', () => {
    const store = createCounterStore()
    let bodyRuns = 0
    const Label = () => {
      bodyRuns += 1
      const slice = useStoreSelector(
        store,
        (state) => ({ label: state.label }),
        (a, b) => a.label === b.label,
      )
      return <span>{slice.label}</span>
    }
    render(<Label />)
    const runsAfterMount = bodyRuns

    act(() => {
      store.set({ clicks: 0, label: 'changed' })
    })

    expect(bodyRuns).toBe(runsAfterMount + 1)
  })
})

describe('changing the selector between renders', () => {
  it('reads the latest selector, not the one captured at subscribe time', () => {
    const store = createCounterStore()
    let switchToClicks: (() => void) | null = null
    const Readout = () => {
      const [readClicks, setReadClicks] = useState(false)
      switchToClicks = () => setReadClicks(true)
      const value = useStoreSelector(store, (state) =>
        readClicks ? String(state.clicks) : state.label,
      )
      return <span data-testid="value">{value}</span>
    }
    const view = render(<Readout />)
    expect(view.getByTestId('value').textContent).toBe('a')

    act(() => {
      switchToClicks?.()
    })

    expect(view.getByTestId('value').textContent).toBe('0')
  })

  it('keeps the new selector in effect for subsequent store notifications', () => {
    const store = createCounterStore()
    let switchToClicks: (() => void) | null = null
    const Readout = () => {
      const [readClicks, setReadClicks] = useState(false)
      switchToClicks = () => setReadClicks(true)
      const value = useStoreSelector(store, (state) =>
        readClicks ? String(state.clicks) : state.label,
      )
      return <span data-testid="value">{value}</span>
    }
    const view = render(<Readout />)

    act(() => {
      switchToClicks?.()
    })
    act(() => {
      store.set({ clicks: 42, label: 'a' })
    })

    expect(view.getByTestId('value').textContent).toBe('42')
  })
})

describe('a selector that throws', () => {
  class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    override state = { failed: false }

    static getDerivedStateFromError() {
      return { failed: true }
    }

    override render() {
      return this.state.failed ? <span data-testid="failed">failed</span> : this.props.children
    }
  }

  it('surfaces during render where a boundary catches it, without breaking the notify loop', () => {
    const store = createCounterStore()
    const laterListener = vi.fn()
    let shouldThrow = false
    const Fragile = () => {
      const value = useStoreSelector(store, (state) => {
        if (shouldThrow) throw new Error('selector blew up')
        return state.label
      })
      return <span>{value}</span>
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    store.subscribe(laterListener)

    shouldThrow = true
    act(() => {
      store.notifyWithoutChanging()
    })

    expect(view.queryByTestId('failed')).not.toBeNull()
    expect(laterListener).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('subscription lifecycle — perf invariant 8', () => {
  it('leaves exactly one subscription under StrictMode double-invocation', () => {
    const store = createCounterStore()
    const Label = () => <span>{useStoreSelector(store, (state) => state.label)}</span>

    render(
      <StrictMode>
        <Label />
      </StrictMode>,
    )

    expect(store.activeSubscriptions()).toBe(1)
  })

  it('unsubscribes on unmount, leaving nothing behind', () => {
    const store = createCounterStore()
    const Label = () => <span>{useStoreSelector(store, (state) => state.label)}</span>
    const view = render(
      <StrictMode>
        <Label />
      </StrictMode>,
    )

    view.unmount()

    expect(store.activeSubscriptions()).toBe(0)
  })

  it('gives each of several consumers its own subscription', () => {
    const store = createCounterStore()
    const Label = () => <span>{useStoreSelector(store, (state) => state.label)}</span>

    render(
      <>
        <Label />
        <Label />
        <Label />
      </>,
    )

    expect(store.activeSubscriptions()).toBe(3)
  })
})
