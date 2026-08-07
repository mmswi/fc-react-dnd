import { act, render } from '@testing-library/react'
import { memo, useMemo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { closestCenter } from '../collision.js'
import type { Sensor } from '../types.js'
import { DndContext, type DndContextValue, useDndContext } from './context.js'
import { createDragStore } from './store.js'

const NO_SENSORS: readonly Sensor[] = []

const createContextValue = (): DndContextValue => ({
  store: createDragStore({ collisionDetection: closestCenter }),
  instructionsId: 'instructions-1',
  draggableRoleDescription: 'draggable',
  sensors: NO_SENSORS,
})

describe('useDndContext outside a provider', () => {
  it('throws a message naming the library and the hook that asked', () => {
    const Orphan = () => {
      useDndContext('useDraggable')
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Orphan />)).toThrow(/fc-react-dnd/)
    expect(() => render(<Orphan />)).toThrow(/useDraggable/)
    expect(() => render(<Orphan />)).toThrow(/DndProvider/)

    consoleError.mockRestore()
  })
})

describe('two providers on one page', () => {
  it('hand their subtrees different stores — nothing is module-level', () => {
    const stores: unknown[] = []
    const Consumer = () => {
      stores.push(useDndContext('useDraggable').store)
      return null
    }
    const left = createContextValue()
    const right = createContextValue()

    render(
      <>
        <DndContext value={left}>
          <Consumer />
        </DndContext>
        <DndContext value={right}>
          <Consumer />
        </DndContext>
      </>,
    )

    expect(stores).toHaveLength(2)
    expect(stores[0]).toBe(left.store)
    expect(stores[1]).toBe(right.store)
    expect(stores[0]).not.toBe(stores[1])
  })
})

describe('why the context value must be stable — ANALYSIS.md A3.5', () => {
  // These two tests are a matched pair. Together they say: context stability is the whole
  // architecture's floor, and there is no downstream rescue if it is lost.

  it('re-renders every consumer when the value churns — even one wrapped in memo', () => {
    let consumerRuns = 0
    const Consumer = memo(() => {
      consumerRuns += 1
      useDndContext('useDraggable')
      return null
    })
    let forceParentRender: (() => void) | null = null
    const store = createDragStore({ collisionDetection: closestCenter })
    const ChurningProvider = () => {
      const [, setTick] = useState(0)
      forceParentRender = () => setTick((tick) => tick + 1)
      // A fresh object every render — the mistake this test exists to make expensive.
      const value: DndContextValue = {
        store,
        instructionsId: 'instructions-1',
        draggableRoleDescription: 'draggable',
        sensors: NO_SENSORS,
      }
      return (
        <DndContext value={value}>
          <Consumer />
        </DndContext>
      )
    }
    render(<ChurningProvider />)
    const runsAfterMount = consumerRuns

    act(() => {
      forceParentRender?.()
    })

    expect(consumerRuns).toBe(runsAfterMount + 1)
  })

  it('leaves consumers alone when the value is stable across a parent re-render', () => {
    let consumerRuns = 0
    const Consumer = memo(() => {
      consumerRuns += 1
      useDndContext('useDraggable')
      return null
    })
    let forceParentRender: (() => void) | null = null
    const store = createDragStore({ collisionDetection: closestCenter })
    const StableProvider = () => {
      const [, setTick] = useState(0)
      forceParentRender = () => setTick((tick) => tick + 1)
      const value = useMemo<DndContextValue>(
        () => ({
          store,
          instructionsId: 'instructions-1',
          draggableRoleDescription: 'draggable',
          sensors: NO_SENSORS,
        }),
        [],
      )
      return (
        <DndContext value={value}>
          <Consumer />
        </DndContext>
      )
    }
    render(<StableProvider />)
    const runsAfterMount = consumerRuns

    act(() => {
      forceParentRender?.()
    })

    expect(consumerRuns).toBe(runsAfterMount)
  })
})
