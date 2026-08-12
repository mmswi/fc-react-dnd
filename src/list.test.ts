import { describe, expect, it } from 'vitest'
import { applySortEnd } from './list.js'
import type { SortEndEvent } from './sortable-list.js'
import type { DndId } from './types.js'

type Task = { id: DndId; title: string }

const taskId = (task: Task): DndId => task.id

const tasks = (...ids: readonly string[]): readonly Task[] =>
  ids.map((id) => ({ id, title: id.toUpperCase() }))

const titlesOf = (items: readonly Task[]): readonly string[] => items.map((task) => task.title)

/** A drop that landed between two neighbours, as `SortableList` would report it. */
const landedBetween = (args: {
  activeId: DndId
  afterId: DndId | null
  beforeId: DndId | null
  toIndex: number
}): SortEndEvent => ({
  activeId: args.activeId,
  fromIndex: 0,
  toIndex: args.toIndex,
  afterId: args.afterId,
  beforeId: args.beforeId,
})

describe('applySortEnd', () => {
  it('moves the dragged item to the slot between the neighbours it landed between', () => {
    const items = tasks('a', 'b', 'c', 'd')

    const next = applySortEnd(
      items,
      landedBetween({ activeId: 'a', afterId: 'c', beforeId: 'd', toIndex: 2 }),
      taskId,
    )

    expect(next.map(taskId)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('falls back to the "before" neighbour when the "after" one is gone by drop time', () => {
    // A collaborator removed 'x' — the row the drop landed after — while the drag was running.
    const items = tasks('a', 'b', 'c', 'd')

    const next = applySortEnd(
      items,
      landedBetween({ activeId: 'd', afterId: 'x', beforeId: 'c', toIndex: 2 }),
      taskId,
    )

    expect(next.map(taskId)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('falls back to the captured slot, clamped, when both neighbours are gone', () => {
    const items = tasks('a', 'b', 'c')

    const landedAtTheEnd = applySortEnd(
      items,
      landedBetween({ activeId: 'a', afterId: 'gone', beforeId: 'also-gone', toIndex: 2 }),
      taskId,
    )
    expect(landedAtTheEnd.map(taskId)).toEqual(['b', 'c', 'a'])

    // A slot past the end of what remains is clamped rather than appending nothing or throwing.
    const landedPastTheEnd = applySortEnd(
      items,
      landedBetween({ activeId: 'a', afterId: 'gone', beforeId: 'also-gone', toIndex: 99 }),
      taskId,
    )
    expect(landedPastTheEnd.map(taskId)).toEqual(['b', 'c', 'a'])
  })

  it('hands back the very same array when nothing moved, so a memo can bail out', () => {
    const items = tasks('a', 'b', 'c')

    const landedWhereItStarted = applySortEnd(
      items,
      landedBetween({ activeId: 'b', afterId: 'a', beforeId: 'c', toIndex: 1 }),
      taskId,
    )
    expect(landedWhereItStarted).toBe(items)

    const draggedFromAnotherList = applySortEnd(
      items,
      landedBetween({ activeId: 'elsewhere', afterId: 'a', beforeId: 'b', toIndex: 1 }),
      taskId,
    )
    expect(draggedFromAnotherList).toBe(items)
  })

  it('leaves every item it did not move untouched, by identity', () => {
    const items = tasks('a', 'b', 'c', 'd')

    const next = applySortEnd(
      items,
      landedBetween({ activeId: 'a', afterId: 'c', beforeId: 'd', toIndex: 2 }),
      taskId,
    )

    // Only the order changes — no item is copied, so memoised rows bail out after a drop.
    expect(next).not.toBe(items)
    for (const item of items) expect(next).toContain(item)
    expect(titlesOf(next)).toEqual(['B', 'C', 'A', 'D'])
  })
})
