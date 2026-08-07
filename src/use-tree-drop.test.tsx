import { act, fireEvent, render, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { useDndContext } from './internal/context.js'
import type { DragStore } from './internal/store.js'
import { keyboardSensor } from './keyboard-sensor.js'
import { pointerSensor } from './pointer-sensor.js'
import { flattenTree, type TreeDropProjection, type TreeItem } from './tree.js'
import type { CollisionArgs, DndId, Rect } from './types.js'
import { useTreeDrop } from './use-tree-drop.js'

const ROW_HEIGHT_PX = 40
const INDENT_PX = 24
const ACTIVATION_DISTANCE_PX = 4

/**
 * ```
 * docs
 *   guide
 *     install
 *     usage
 *   api
 * changelog
 * ```
 */
const DOC_TREE: readonly TreeItem[] = Object.freeze([
  {
    id: 'docs',
    children: [{ id: 'guide', children: [{ id: 'install' }, { id: 'usage' }] }, { id: 'api' }],
  },
  { id: 'changelog' },
])

const VISIBLE_ORDER = ['docs', 'guide', 'install', 'usage', 'api', 'changelog'] as const

const rowRect = (position: number, depth: number): Rect => ({
  left: depth * INDENT_PX,
  top: position * ROW_HEIGHT_PX,
  width: 300,
  height: ROW_HEIGHT_PX,
})

const depthOf = (id: DndId): number => flattenTree(DOC_TREE).locationById.get(id)?.depth ?? 0

type SceneOptions = {
  items?: readonly TreeItem[]
  onProjectionRender?: (projection: TreeDropProjection | null) => void
  extraRowId?: string | null
  strict?: boolean
}

const renderTree = ({
  items = DOC_TREE,
  onProjectionRender,
  extraRowId = null,
  strict = false,
}: SceneOptions = {}) => {
  let store: DragStore | null = null
  let latestProjection: TreeDropProjection | null = null
  const sensors = [
    pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX }),
    keyboardSensor({ indentPx: INDENT_PX }),
  ]
  const collisionCandidateCounts: number[] = []
  const collisionDetection = (args: CollisionArgs) => {
    collisionCandidateCounts.push(args.droppables.length)
    return args.droppables[0]?.id ?? null
  }

  const StoreProbe = () => {
    store = useDndContext('StoreProbe').store
    return null
  }

  const Tree = ({ withExtraRow }: { withExtraRow: boolean }) => {
    const { projection, getRowProps } = useTreeDrop({ items, indentPx: INDENT_PX })
    latestProjection = projection
    onProjectionRender?.(projection)

    const ids = withExtraRow && extraRowId ? [...VISIBLE_ORDER, extraRowId] : VISIBLE_ORDER

    return (
      <ul>
        {ids.map((id, position) => {
          const { ref, handleProps, isDragging } = getRowProps(id)
          return (
            <li
              key={id}
              ref={(node) => {
                if (node) mockElementRect(node, rowRect(position, depthOf(id)))
                return ref(node)
              }}
              data-testid={`row-${id}`}
              data-dragging={isDragging}
              {...handleProps}
            >
              {id}
            </li>
          )
        })}
      </ul>
    )
  }

  const Scene = ({ withExtraRow = false }: { withExtraRow?: boolean }) => (
    <DndProvider sensors={sensors} collisionDetection={collisionDetection}>
      <StoreProbe />
      <Tree withExtraRow={withExtraRow} />
    </DndProvider>
  )

  const view = render(strict ? <StrictMode>{<Scene />}</StrictMode> : <Scene />)

  return {
    view,
    collisionCandidateCounts,
    getStore: () => store as unknown as DragStore,
    projection: () => latestProjection,
    // Scoped: a test that renders two scenes would otherwise find both trees' rows.
    row: (id: string) => within(view.container).getByTestId(`row-${id}`),
    showExtraRow: () =>
      view.rerender(
        strict ? <StrictMode>{<Scene withExtraRow />}</StrictMode> : <Scene withExtraRow />,
      ),
  }
}

/** Picks up a row and moves the pointer to an absolute y, as a pointer drag would. */
const dragRowTo = (element: Element, fromY: number, toY: number, toX = 0) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: fromY,
    button: 0,
    isPrimary: true,
  })
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: toX, clientY: toY })
  })
}

const movePointerTo = (y: number, x = 0) => {
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y })
  })
}

const CHANGELOG_ROW_CENTRE = 5 * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2

describe('rows are measure-only — §A7 D3 / F7', () => {
  it('never produces an over, however far the drag goes', () => {
    const tree = renderTree()

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)
    movePointerTo(ROW_HEIGHT_PX * 3)

    expect(tree.getStore().getState().overId).toBeNull()
  })

  it('hands collision detection zero candidates during a tree drag', () => {
    // Element hit-testing is the wrong question for a tree, so it must not run against tree rows
    // at all — not merely be ignored afterwards.
    const tree = renderTree()

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)
    movePointerTo(ROW_HEIGHT_PX * 2)

    expect(tree.collisionCandidateCounts.length).toBeGreaterThan(0)
    expect(new Set(tree.collisionCandidateCounts)).toEqual(new Set([0]))
  })

  it('still measures the rows, because the projection reads their rects', () => {
    const tree = renderTree()

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)

    expect(tree.getStore().getState().measuredRects.size).toBe(VISIBLE_ORDER.length)
  })
})

describe('the projection', () => {
  it('is null outside a drag', () => {
    expect(renderTree().projection()).toBeNull()
  })

  it('appears during a drag and reports a position, not a gesture', () => {
    const tree = renderTree()

    // Aim at the middle of 'guide' (visible row 1).
    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2)

    expect(tree.projection()).toMatchObject({
      mode: 'into',
      parentId: 'guide',
      index: 0,
      depth: 2,
    })
  })

  it('goes back to null after the drop', () => {
    const tree = renderTree()
    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX })
    })

    expect(tree.projection()).toBeNull()
  })

  it('is null when the dragged item belongs to another tree — §A7 F10', () => {
    const tree = renderTree()
    const outsider = document.createElement('div')
    mockElementRect(outsider, rowRect(20, 0))
    document.body.append(outsider)
    tree.getStore().registerDraggable('from-another-tree', outsider)

    act(() => {
      tree.getStore().beginDrag('from-another-tree', { pointer: { x: 0, y: 0 } })
    })

    expect(tree.projection()).toBeNull()
  })
})

describe('render granularity — perf invariant 4', () => {
  it('does not re-render the consumer for moves that stay inside one gap', () => {
    let renders = 0
    const tree = renderTree({
      onProjectionRender: () => {
        renders += 1
      },
    })
    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + 2)
    const rendersAfterStart = renders

    for (let offsetPx = 3; offsetPx <= 10; offsetPx += 1) {
      movePointerTo(ROW_HEIGHT_PX + offsetPx)
    }

    expect(renders).toBe(rendersAfterStart)
  })

  it('re-renders exactly once when the gap changes', () => {
    let renders = 0
    const tree = renderTree({
      onProjectionRender: () => {
        renders += 1
      },
    })
    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + 2)
    const rendersAfterStart = renders

    movePointerTo(ROW_HEIGHT_PX * 2 + 2)

    expect(renders).toBe(rendersAfterStart + 1)
  })

  it('re-renders exactly once when the mode switches between into and between', () => {
    let renders = 0
    const tree = renderTree({
      onProjectionRender: () => {
        renders += 1
      },
    })
    // Middle of 'guide' — mode 'into'.
    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2)
    expect(tree.projection()?.mode).toBe('into')
    const rendersAfterStart = renders

    // Top band of the same row — mode 'between'.
    movePointerTo(ROW_HEIGHT_PX + 1)

    expect(tree.projection()?.mode).toBe('between')
    expect(renders).toBe(rendersAfterStart + 1)
  })
})

describe('the keyboard path', () => {
  const outcomeOf = (projection: TreeDropProjection | null): string | null =>
    projection && `${projection.parentId}:${projection.index}:${projection.depth}`

  it('changes depth through the same projection the pointer uses', () => {
    const tree = renderTree()
    const changelog = tree.row('changelog')
    changelog.focus()

    act(() => {
      fireEvent.keyDown(changelog, { key: ' ' })
    })
    act(() => {
      fireEvent.keyDown(changelog, { key: 'ArrowUp' })
    })
    const atGap = tree.projection()
    for (let press = 0; press < 4; press += 1) {
      act(() => {
        fireEvent.keyDown(changelog, { key: 'ArrowRight' })
      })
    }
    const deepest = tree.projection()
    for (let press = 0; press < 8; press += 1) {
      act(() => {
        fireEvent.keyDown(changelog, { key: 'ArrowLeft' })
      })
    }

    // The gap above 'api' admits depths 1 (api's own level) through 3 (nested inside usage).
    expect(atGap).not.toBeNull()
    expect(deepest?.depth).toBe(3)
    expect(tree.projection()?.depth).toBe(1)
  })

  it('reaches every outcome the pointer can reach — §A7 F9', () => {
    // The invariant is about **outcomes**, not modes. A keyboard drag never lands in a middle
    // band, so its `mode` is always 'between' — and D1 is what makes that total: "into X" is the
    // same position as the deepest rung of the gap below X.
    const pointerTree = renderTree()
    const byPointer = new Set<string>()
    dragRowTo(pointerTree.row('changelog'), CHANGELOG_ROW_CENTRE, 0)
    for (let y = 0; y <= ROW_HEIGHT_PX * VISIBLE_ORDER.length; y += 5) {
      for (let indent = 0; indent <= 4; indent += 1) {
        movePointerTo(y, indent * INDENT_PX)
        const outcome = outcomeOf(pointerTree.projection())
        if (outcome) byPointer.add(outcome)
      }
    }
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 0 })
    })

    const keyboardTree = renderTree()
    const byKeyboard = new Set<string>()
    const changelog = keyboardTree.row('changelog')
    changelog.focus()
    act(() => {
      fireEvent.keyDown(changelog, { key: ' ' })
    })

    /**
     * Every depth this stop allows, then back to where it started.
     *
     * The rights and lefts have to balance exactly: an unbalanced ladder drifts the indent by a
     * level per stop, and the deepest rung silently stops being sampled a few stops in.
     */
    const INDENT_PRESSES = 5
    const sampleLadder = () => {
      const record = () => {
        const outcome = outcomeOf(keyboardTree.projection())
        if (outcome) byKeyboard.add(outcome)
      }

      record()
      for (let press = 0; press < INDENT_PRESSES; press += 1) {
        act(() => {
          fireEvent.keyDown(changelog, { key: 'ArrowRight' })
        })
        record()
      }
      for (let press = 0; press < INDENT_PRESSES; press += 1) {
        act(() => {
          fireEvent.keyDown(changelog, { key: 'ArrowLeft' })
        })
      }
    }

    sampleLadder()
    for (let step = 0; step < VISIBLE_ORDER.length; step += 1) {
      act(() => {
        fireEvent.keyDown(changelog, { key: 'ArrowUp' })
      })
      sampleLadder()
    }

    expect(byPointer.size).toBeGreaterThan(5)
    expect([...byPointer].filter((outcome) => !byKeyboard.has(outcome))).toEqual([])
  })
})

describe('rows appearing and disappearing mid-drag', () => {
  it('cancels when a row unmounts — a collapsing branch is a removal (§A6)', () => {
    const onDragCancel = vi.fn()
    let store: DragStore | null = null
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const Tree = ({ ids }: { ids: readonly string[] }) => {
      const { getRowProps } = useTreeDrop({ items: DOC_TREE, indentPx: INDENT_PX })
      return (
        <ul>
          {ids.map((id, position) => {
            const { ref, handleProps } = getRowProps(id)
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) mockElementRect(node, rowRect(position, depthOf(id)))
                  return ref(node)
                }}
                data-testid={`row-${id}`}
                {...handleProps}
              />
            )
          })}
        </ul>
      )
    }
    const StoreProbe = () => {
      store = useDndContext('StoreProbe').store
      return null
    }
    const Host = ({ collapsed }: { collapsed: boolean }) => (
      <DndProvider sensors={sensors} onDragCancel={onDragCancel}>
        <StoreProbe />
        <Tree ids={collapsed ? ['docs', 'api', 'changelog'] : [...VISIBLE_ORDER]} />
      </DndProvider>
    )
    const view = render(<Host collapsed={false} />)
    dragRowTo(view.getByTestId('row-changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)

    view.rerender(<Host collapsed />)

    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(onDragCancel.mock.calls[0]?.[0].reason).toBe('item-removed')
    expect((store as unknown as DragStore).getState().origin).toBeNull()
  })

  it('survives a row appearing — auto-expand mounts rows during the drag it belongs to', () => {
    const onDragCancel = vi.fn()
    let store: DragStore | null = null
    let expand: (() => void) | null = null
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const Tree = ({ ids }: { ids: readonly string[] }) => {
      const { getRowProps } = useTreeDrop({ items: DOC_TREE, indentPx: INDENT_PX })
      return (
        <ul>
          {ids.map((id, position) => {
            const { ref, handleProps } = getRowProps(id)
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) mockElementRect(node, rowRect(position, depthOf(id)))
                  return ref(node)
                }}
                data-testid={`row-${id}`}
                {...handleProps}
              />
            )
          })}
        </ul>
      )
    }
    const StoreProbe = () => {
      store = useDndContext('StoreProbe').store
      return null
    }
    const Host = () => {
      const [expanded, setExpanded] = useState(false)
      expand = () => setExpanded(true)
      return (
        <DndProvider sensors={sensors} onDragCancel={onDragCancel}>
          <StoreProbe />
          <Tree ids={expanded ? [...VISIBLE_ORDER] : ['docs', 'guide', 'api', 'changelog']} />
        </DndProvider>
      )
    }
    const view = render(<Host />)
    dragRowTo(view.getByTestId('row-changelog'), 3 * ROW_HEIGHT_PX + 20, ROW_HEIGHT_PX)

    act(() => {
      expand?.()
    })

    expect(onDragCancel).not.toHaveBeenCalled()
    expect((store as unknown as DragStore).getState().origin?.id).toBe('changelog')
  })
})

describe('handle props and StrictMode', () => {
  it('gives every row the accessibility attributes a drag handle needs', () => {
    const tree = renderTree()
    const row = tree.row('guide')

    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-roledescription')).toBe('draggable')
    expect(document.getElementById(row.getAttribute('aria-describedby') ?? '')).not.toBeNull()
  })

  it('returns the same ref function for a row across renders', () => {
    // A new ref per render makes React detach and re-attach on every render — which, mid-drag,
    // is a removal, which cancels the drag.
    const refs: unknown[] = []
    const Probe = () => {
      const { getRowProps } = useTreeDrop({ items: DOC_TREE })
      refs.push(getRowProps('docs').ref)
      return null
    }
    let forceRender: (() => void) | null = null
    const Host = () => {
      const [, setTick] = useState(0)
      forceRender = () => setTick((tick) => tick + 1)
      return (
        <DndProvider>
          <Probe />
        </DndProvider>
      )
    }
    render(<Host />)

    act(() => {
      forceRender?.()
    })

    expect(refs.length).toBeGreaterThan(1)
    expect(new Set(refs).size).toBe(1)
  })

  it('reports isDragging for the dragged row only', () => {
    const tree = renderTree()

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)

    expect(tree.row('changelog').dataset.dragging).toBe('true')
    expect(tree.row('docs').dataset.dragging).toBe('false')
  })

  it('registers each row exactly once under StrictMode', () => {
    const tree = renderTree({ strict: true })

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX)

    expect(tree.getStore().getState().measuredRects.size).toBe(VISIBLE_ORDER.length)
    expect(tree.projection()).not.toBeNull()
  })

  it('throws the named out-of-provider error', () => {
    const Orphan = () => {
      useTreeDrop({ items: DOC_TREE })
      return null
    }

    expect(() => render(<Orphan />)).toThrow(/useTreeDrop/)
  })
})

describe('the projection memo — §A7 F6', () => {
  it('computes once per state, however many consumers read it', () => {
    const canNest = vi.fn(() => true)
    const Consumer = () => {
      useTreeDrop({ items: DOC_TREE, indentPx: INDENT_PX, canNest })
      return null
    }
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const Rows = () => {
      const { getRowProps } = useTreeDrop({ items: DOC_TREE, indentPx: INDENT_PX, canNest })
      return (
        <ul>
          {VISIBLE_ORDER.map((id, position) => {
            const { ref, handleProps } = getRowProps(id)
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) mockElementRect(node, rowRect(position, depthOf(id)))
                  return ref(node)
                }}
                data-testid={`row-${id}`}
                {...handleProps}
              />
            )
          })}
        </ul>
      )
    }
    const view = render(
      <DndProvider sensors={sensors}>
        <Rows />
        <Consumer />
        <Consumer />
        <Consumer />
      </DndProvider>,
    )

    canNest.mockClear()
    dragRowTo(view.getByTestId('row-changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + 2)
    const callsAfterOneMove = canNest.mock.calls.length
    movePointerTo(ROW_HEIGHT_PX + 4)

    // Four consumers share one memo entry per state, so the predicate is not called four times
    // over for the same store notification.
    expect(callsAfterOneMove).toBeGreaterThan(0)
    expect(canNest.mock.calls.length).toBeLessThan(callsAfterOneMove * 4)
  })
})

describe('projection-driven announcements', () => {
  it('announces the projection as it changes, since tree rows produce no over events', () => {
    const tree = renderTree()

    dragRowTo(tree.row('changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2)

    expect(tree.view.getByRole('status').textContent).toMatch(/inside guide/i)
  })

  it('takes an override', () => {
    const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
    const Tree = () => {
      const { getRowProps } = useTreeDrop({
        items: DOC_TREE,
        indentPx: INDENT_PX,
        describeProjection: (projection) => `CUSTOM ${projection?.mode ?? 'none'}`,
      })
      return (
        <ul>
          {VISIBLE_ORDER.map((id, position) => {
            const { ref, handleProps } = getRowProps(id)
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) mockElementRect(node, rowRect(position, depthOf(id)))
                  return ref(node)
                }}
                data-testid={`row-${id}`}
                {...handleProps}
              />
            )
          })}
        </ul>
      )
    }
    const view = render(
      <DndProvider sensors={sensors}>
        <Tree />
      </DndProvider>,
    )

    dragRowTo(view.getByTestId('row-changelog'), CHANGELOG_ROW_CENTRE, ROW_HEIGHT_PX + 20)

    expect(view.getByRole('status').textContent).toMatch(/^CUSTOM /)
  })
})
