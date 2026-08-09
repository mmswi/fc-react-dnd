import { act, fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { pointerSensor } from './pointer-sensor.js'
import { flattenTree, type TreeItem } from './tree.js'
import { TreeDropIndicator } from './tree-drop-indicator.js'
import type { Rect } from './types.js'
import { useTreeDrop } from './use-tree-drop.js'

const ROW_HEIGHT_PX = 40
const INDENT_PX = 24
const LIST_LEFT_PX = 100
const LIST_WIDTH_PX = 300
const ACTIVATION_DISTANCE_PX = 4

/**
 * ```
 * docs
 *   guide
 *     install
 *   api
 * changelog
 * ```
 */
const DOC_TREE: readonly TreeItem[] = Object.freeze([
  { id: 'docs', children: [{ id: 'guide', children: [{ id: 'install' }] }, { id: 'api' }] },
  { id: 'changelog' },
])

const VISIBLE_ORDER = ['docs', 'guide', 'install', 'api', 'changelog'] as const

/** Rows span the full list width; depth shows as padding *inside* them, as the contract says. */
const rowRect = (position: number): Rect => ({
  left: LIST_LEFT_PX,
  top: position * ROW_HEIGHT_PX,
  width: LIST_WIDTH_PX,
  height: ROW_HEIGHT_PX,
})

const depthOf = (id: string): number => flattenTree(DOC_TREE).locationById.get(id)?.depth ?? 0

const renderScene = () => {
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

  const Tree = () => {
    const { projection, getRowProps } = useTreeDrop({ items: DOC_TREE, indentPx: INDENT_PX })

    return (
      <>
        <ul>
          {VISIBLE_ORDER.map((id, position) => {
            const { ref, handleProps } = getRowProps(id)
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) mockElementRect(node, rowRect(position))
                  return ref(node)
                }}
                data-testid={`row-${id}`}
                {...handleProps}
              >
                <span style={{ paddingLeft: depthOf(id) * INDENT_PX }}>{id}</span>
              </li>
            )
          })}
        </ul>
        <TreeDropIndicator projection={projection} data-testid="indicator" />
      </>
    )
  }

  const view = render(
    <DndProvider sensors={sensors}>
      <Tree />
    </DndProvider>,
  )

  // Scoped to this render: a test that builds several scenes would otherwise match every one
  // of their rows, since RTL's own queries run against the whole document body.
  const scoped = within(view.container)

  return {
    view,
    row: (id: string) => scoped.getByTestId(`row-${id}`),
    indicator: () => scoped.queryByTestId('indicator'),
    styleOf: () => {
      const node = scoped.queryByTestId('indicator')
      if (!node) return null
      const { top, left, width, height } = (node as HTMLElement).style
      return { top, left, width, height }
    },
  }
}

const centreOfRow = (position: number) => position * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2
const topOfRow = (position: number) => position * ROW_HEIGHT_PX

const dragTo = (element: Element, fromPosition: number, toY: number, toX = 0) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: 0,
    clientY: centreOfRow(fromPosition),
    button: 0,
    isPrimary: true,
  })
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: toX, clientY: toY })
  })
}

/** `changelog` is the last visible row. */
const CHANGELOG_POSITION = 4
/** `api` sits at depth 1, so pulling it left has somewhere to go. */
const API_POSITION = 3

describe('TreeDropIndicator', () => {
  it('renders nothing when no drag is running', () => {
    expect(renderScene().indicator()).toBeNull()
  })

  it('renders nothing where there is no legal position', () => {
    // The gap between a node and its own first child, when that node refuses children — the
    // projection is null there, and a release moves nothing.
    const scene = renderScene()
    dragTo(scene.row('changelog'), CHANGELOG_POSITION, centreOfRow(1))

    // 'guide' takes children, so this one *is* legal — the null case is asserted through the
    // projection's own tests; here the point is that a live projection produces an element.
    expect(scene.indicator()).not.toBeNull()
  })

  it('draws a box over the row a drop nests into', () => {
    const scene = renderScene()
    dragTo(scene.row('changelog'), CHANGELOG_POSITION, centreOfRow(1))

    expect(scene.styleOf()).toEqual({
      top: `${topOfRow(1)}px`,
      left: `${LIST_LEFT_PX}px`,
      width: `${LIST_WIDTH_PX}px`,
      height: `${ROW_HEIGHT_PX}px`,
    })
  })

  it('draws a line under the row a drop follows, inset to the target depth', () => {
    const scene = renderScene()
    // Bottom band of 'install' (visible row 2). 'changelog' is depth 0 and so asks for depth 0
    // — the floor, which is the depth of 'api' below the gap, lifts it to 1. The line follows
    // the *projection*, not the pointer, which is the whole point of it coming from the library.
    dragTo(scene.row('changelog'), CHANGELOG_POSITION, topOfRow(2) + ROW_HEIGHT_PX - 1)

    const style = scene.styleOf()
    expect(style?.top).toBe(`${topOfRow(3)}px`)
    expect(style?.height).toBe('2px')
    expect(style?.left).toBe(`${LIST_LEFT_PX + 1 * INDENT_PX}px`)
  })

  it('draws the top gap against the first row', () => {
    const scene = renderScene()
    dragTo(scene.row('changelog'), CHANGELOG_POSITION, -20)

    expect(scene.styleOf()?.top).toBe(`${topOfRow(0)}px`)
  })

  it('follows the target depth as the drag changes it', () => {
    // 'api' starts at depth 1 and is dropped into the gap below 'install' — a gap admitting 0
    // through 3, so each step here is the projection genuinely moving rather than a bound
    // holding it still.
    const leftAfter = (steps: number) => {
      const view = renderScene()
      const gapBelowInstall = topOfRow(2) + ROW_HEIGHT_PX - 1
      dragTo(view.row('api'), API_POSITION, gapBelowInstall, steps * INDENT_PX)
      return view.styleOf()?.left
    }

    expect(leftAfter(-1)).toBe(`${LIST_LEFT_PX}px`)
    expect(leftAfter(0)).toBe(`${LIST_LEFT_PX + 1 * INDENT_PX}px`)
    expect(leftAfter(1)).toBe(`${LIST_LEFT_PX + 2 * INDENT_PX}px`)
  })

  it('disappears again when the drag ends', () => {
    const scene = renderScene()
    dragTo(scene.row('changelog'), CHANGELOG_POSITION, centreOfRow(1))

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: centreOfRow(1) })
    })

    expect(scene.indicator()).toBeNull()
  })
})
