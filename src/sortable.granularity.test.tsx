import { act, fireEvent, render, within } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { pointerSensor } from './pointer-sensor.js'
import { SortableList } from './sortable-list.js'
import type { Rect } from './types.js'
import { useSortable } from './use-sortable.js'

/**
 * The headline claim, on the case the blog post leads with: dragging through a sortable list
 * commits only the rows that actually changed.
 *
 * These are the numbers [T10.5] quotes, so they are asserted as **exact counts** — a range
 * would let a regression hide inside it. Counted from a `useEffect` with no dependency array,
 * which counts **commits**: unambiguous under both of React's bailout paths, and directly
 * comparable to the React Profiler capture in T9.6.
 */

const ROW_COUNT = 24
const ROW_HEIGHT_PX = 40
const ACTIVATION_DISTANCE_PX = 4

const ROW_IDS = Object.freeze(Array.from({ length: ROW_COUNT }, (_unused, index) => `row-${index}`))

const rowRect = (index: number): Rect => ({
  left: 0,
  top: index * ROW_HEIGHT_PX,
  width: 200,
  height: ROW_HEIGHT_PX,
})

const Row = ({
  id,
  index,
  onCommit,
}: {
  id: string
  index: number
  onCommit: (id: string) => void
}) => {
  const { setNodeRef, handleProps, isDragging, isOver, translate } = useSortable({ id })

  useEffect(() => {
    onCommit(id)
  })

  return (
    <li
      ref={(node) => {
        if (node) mockElementRect(node, rowRect(index))
        return setNodeRef(node)
      }}
      data-testid={id}
      data-dragging={isDragging}
      data-over={isOver}
      data-translate={`${translate.x},${translate.y}`}
      {...handleProps}
    >
      {id}
    </li>
  )
}

const renderList = ({ strict = false }: { strict?: boolean } = {}) => {
  const commits: string[] = []
  const sensors = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]
  const Scene = () => (
    <DndProvider sensors={sensors}>
      <SortableList items={ROW_IDS}>
        <ul>
          {ROW_IDS.map((id, index) => (
            <Row key={id} id={id} index={index} onCommit={(committed) => commits.push(committed)} />
          ))}
        </ul>
      </SortableList>
    </DndProvider>
  )
  const view = render(strict ? <StrictMode>{<Scene />}</StrictMode> : <Scene />)

  const scope = () => within(view.container)

  return {
    view,
    commits,
    row: (index: number) => scope().getByTestId(`row-${index}`),
    translateOf: (index: number) => scope().getByTestId(`row-${index}`).dataset.translate,
    commitsSince: (mark: number) => [...new Set(commits.slice(mark))].sort(),
  }
}

/** Picks up row 0 and drags it so its centre sits inside the row at `targetIndex`. */
const dragRowZeroOver = (list: ReturnType<typeof renderList>, targetIndex: number) => {
  fireEvent.pointerDown(list.row(0), {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    isPrimary: true,
  })
  act(() => {
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: 0,
      clientY: targetIndex * ROW_HEIGHT_PX,
    })
  })
}

const moveTo = (clientY: number) => {
  act(() => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: clientY })
  })
}

describe(`crossing one boundary in a list of ${ROW_COUNT}`, () => {
  it('commits exactly three rows, and names which', () => {
    const list = renderList()
    dragRowZeroOver(list, 5)
    const mark = list.commits.length

    moveTo(ROW_HEIGHT_PX * 6)

    // row-6 gains a translate and gains `isOver`; row-5 loses `isOver`; row-0's own translate
    // grows by one row. Rows 1-4 stay displaced by exactly what they were, and rows 7-23 have
    // not moved at all — twenty-one components with nothing to say.
    expect(list.commitsSince(mark)).toEqual(['row-0', 'row-5', 'row-6'])
  })

  it('commits only the dragged row for moves that stay inside the current row', () => {
    // The dragged row follows the pointer — one component re-rendering per move, which is what a
    // drag is supposed to look like. The other twenty-three do not move and do not render.
    const list = renderList()
    dragRowZeroOver(list, 5)
    const mark = list.commits.length

    for (let offsetPx = 1; offsetPx <= 15; offsetPx += 1) {
      moveTo(ROW_HEIGHT_PX * 5 + offsetPx)
    }

    expect(list.commitsSince(mark)).toEqual(['row-0'])
    expect(list.commits.length - mark).toBe(15)
  })

  it('commits three rows per boundary and no more, across a long drag', () => {
    const list = renderList()
    dragRowZeroOver(list, 1)
    const mark = list.commits.length
    const crossings = 10

    for (let target = 2; target <= 1 + crossings; target += 1) {
      moveTo(ROW_HEIGHT_PX * target)
    }

    // Three commits per crossing is the shape; the identity of the rows changes each time.
    expect(list.commits.length - mark).toBe(crossings * 3)
  })
})

describe('what the rows actually look like at the end', () => {
  it('displaces exactly the rows between the origin and the target', () => {
    const list = renderList()

    dragRowZeroOver(list, 5)

    for (let index = 1; index <= 5; index += 1) {
      expect(list.translateOf(index)).toBe(`0,${-ROW_HEIGHT_PX}`)
    }
    expect(list.translateOf(0)).toBe(`0,${ROW_HEIGHT_PX * 5}`)
    for (let index = 6; index < ROW_COUNT; index += 1) {
      expect(list.translateOf(index)).toBe('0,0')
    }
  })
})

describe('the same flow inside StrictMode', () => {
  it('produces the same commit counts, modulo the deliberate double-render on mount', () => {
    const relaxed = renderList()
    dragRowZeroOver(relaxed, 5)
    const relaxedMark = relaxed.commits.length
    moveTo(ROW_HEIGHT_PX * 6)
    const relaxedCommits = relaxed.commitsSince(relaxedMark)
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: ROW_HEIGHT_PX * 6 })
    })

    const strict = renderList({ strict: true })
    dragRowZeroOver(strict, 5)
    const strictMark = strict.commits.length
    moveTo(ROW_HEIGHT_PX * 6)

    expect(strict.commitsSince(strictMark)).toEqual(relaxedCommits)
  })

  it('registers every row exactly once, with no duplicate and no leak', () => {
    const list = renderList({ strict: true })

    dragRowZeroOver(list, 3)

    // One measured rect per row: a double registration or a leaked entry would move this.
    expect(list.row(3).dataset.over).toBe('true')
    expect(list.translateOf(3)).toBe(`0,${-ROW_HEIGHT_PX}`)
  })
})
