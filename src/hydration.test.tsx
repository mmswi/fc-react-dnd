import { act, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { mockElementRect } from '../test/helpers.js'
import { DndProvider } from './dnd-provider.js'
import { pointerSensor } from './pointer-sensor.js'
import { SortableList, type SortEndEvent } from './sortable-list.js'
import { flattenTree, type TreeItem } from './tree.js'
import type { Rect } from './types.js'
import { useSortable } from './use-sortable.js'
import { useTreeDrop } from './use-tree-drop.js'

/**
 * The client half of the server story. [`ssr.test.tsx`](./ssr.test.tsx) proves the markup comes
 * out of a server; this proves the client can adopt it.
 *
 * Worth having beyond ceremony, because `DndProvider` and `SortableList` both call `useId` and
 * every drag handle's `aria-describedby` points at the provider's generated id. A tree that
 * differs across the boundary by one node re-keys those ids, and the page still *looks* right —
 * the only thing that breaks is the description a screen reader reads on focus.
 *
 * Every assertion here would also hold if React silently stopped checking, so the deliberate
 * mismatch below is the test that gives the rest of them meaning.
 */

const ACTIVATION_DISTANCE_PX = 8
const ROW_HEIGHT_PX = 60

const SENSORS = [pointerSensor({ activationDistancePx: ACTIVATION_DISTANCE_PX })]

const ROW_IDS = ['write-spec', 'review-pr', 'ship-it'] as const
const ROW_IDS_WITH_AN_EXTRA = [...ROW_IDS, 'post-mortem'] as const

const rowRect = (index: number): Rect => ({
  left: 0,
  top: index * ROW_HEIGHT_PX,
  width: 320,
  height: ROW_HEIGHT_PX,
})

const Row = ({ id, index }: { id: string; index: number }) => {
  const { setNodeRef, handleProps, style } = useSortable({ id })
  return (
    <li
      ref={(node) => {
        // jsdom has no layout engine, so a row hydrated from server HTML measures as a zero rect
        // and every collision below would resolve against identical geometry.
        if (node) mockElementRect(node, rowRect(index))
        return setNodeRef(node)
      }}
      data-testid={id}
      {...handleProps}
      style={style}
    >
      {id}
    </li>
  )
}

type TaskListProps = {
  items?: readonly string[]
  onSortEnd?: (event: SortEndEvent) => void
}

const TaskList = ({ items = ROW_IDS, onSortEnd }: TaskListProps) => (
  <DndProvider sensors={SENSORS}>
    <SortableList items={items} onSortEnd={onSortEnd}>
      <ul>
        {items.map((id, index) => (
          <Row key={id} id={id} index={index} />
        ))}
      </ul>
    </SortableList>
  </DndProvider>
)

const TREE: readonly TreeItem[] = [
  { id: 'docs', children: [{ id: 'api' }, { id: 'guides' }] },
  { id: 'src' },
]

const Tree = () => {
  const { getRowProps } = useTreeDrop({ items: TREE })
  return (
    <ul>
      {flattenTree(TREE).rows.map((row) => {
        const { ref, handleProps, style } = getRowProps(row.id)
        return (
          <li key={row.id} ref={ref} {...handleProps} style={style}>
            {String(row.id)}
          </li>
        )
      })}
    </ul>
  )
}

type Hydration = {
  readonly container: HTMLElement
  /** Where a mismatch surfaces: React 19 reports the whole diff through `onRecoverableError`. */
  readonly recoverable: readonly string[]
  /**
   * Everything else React says **during the hydrating commit** — a missing key, an act
   * violation, an invalid prop. The spy is installed and removed around that commit only, so
   * warnings from a later unmount are not collected here.
   *
   * Empty even on a mismatch, and that is not an accident worth relying on quietly: supplying
   * `onRecoverableError` *replaces* the default handler, and the default is the one that writes
   * to the console.
   */
  readonly consoleErrors: readonly string[]
  readonly root: Root
  readonly unmount: () => void
}

/**
 * Render on a server, hand the HTML to the client, and collect anything React complains about.
 *
 * `client` defaults to the same element, which is the case worth passing. Passing a *different*
 * one is how the mismatch test proves the collection works at all.
 */
const hydrate = (server: ReactElement, client: ReactElement = server): Hydration => {
  const container = document.createElement('div')
  container.innerHTML = renderToString(server)
  document.body.append(container)

  const recoverable: string[] = []
  const consoleErrors: string[] = []
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(String(args[0]))
  })

  let root: Root | undefined
  // Without `act` the commit that runs the registration effects never happens, so every
  // assertion below would read a tree that hydrated but never wired itself up.
  act(() => {
    root = hydrateRoot(container, client, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })
  consoleError.mockRestore()

  if (!root) throw new Error('hydrateRoot never ran')
  const hydrated = root

  return {
    container,
    recoverable,
    consoleErrors,
    root: hydrated,
    unmount: () => {
      act(() => hydrated.unmount())
      container.remove()
    },
  }
}

const handlesIn = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('[aria-roledescription="draggable"]'),
]

const dragFirstRowDown = (container: HTMLElement, byPx: number): void => {
  const handle = handlesIn(container)[0]
  if (!handle) throw new Error('no drag handle in the hydrated markup')

  const at = (y: number) => ({ pointerId: 1, clientX: 0, clientY: y, button: 0, isPrimary: true })

  fireEvent.pointerDown(handle, at(0))
  fireEvent.pointerMove(window, at(ACTIVATION_DISTANCE_PX + 1))
  fireEvent.pointerMove(window, at(byPx))
  fireEvent.pointerUp(window, at(byPx))
}

describe('hydration', () => {
  it('reports a client tree that does not match the server HTML', () => {
    // The red test, and the only one here that fails if React stops checking. Everything else
    // asserts an empty array, which an inert harness produces just as happily.
    const hydration = hydrate(<TaskList />, <TaskList items={ROW_IDS_WITH_AN_EXTRA} />)

    expect(hydration.recoverable.join('\n')).toMatch(/Hydration failed/)
    // And nothing on the console, which is what pins the note on `consoleErrors` above: with a
    // custom handler installed, React 19 routes the entire report through it.
    expect(hydration.consoleErrors).toEqual([])

    hydration.unmount()
  })

  it('adopts a server-rendered sortable list without a word', () => {
    const hydration = hydrate(<TaskList />)

    expect(hydration.recoverable).toEqual([])
    expect(hydration.consoleErrors).toEqual([])

    hydration.unmount()
  })

  it('adopts a server-rendered tree without a word', () => {
    const hydration = hydrate(
      <DndProvider>
        <Tree />
      </DndProvider>,
    )

    expect(hydration.recoverable).toEqual([])
    expect(hydration.consoleErrors).toEqual([])

    hydration.unmount()
  })

  it('keeps every handle pointing at instructions that exist', () => {
    // `aria-describedby` carries a `useId` value generated on the server and regenerated on the
    // client. The ids agreeing is what the silent hydration above already covers; this covers the
    // thing a user would notice — focus a handle and something is actually read out.
    const hydration = hydrate(<TaskList />)

    const handles = handlesIn(hydration.container)
    expect(handles).toHaveLength(ROW_IDS.length)

    for (const handle of handles) {
      const describedBy = handle.getAttribute('aria-describedby') ?? ''
      expect(describedBy).not.toBe('')

      const instructions = document.getElementById(describedBy)
      expect(instructions?.textContent).toContain('press Space or Enter')
    }

    hydration.unmount()
  })

  it('attaches the store to server-rendered DOM, so the first drag after hydration works', () => {
    // The point of the whole exercise. Nothing registered itself during the server render —
    // registration lives in refs and effects, which only run once the client adopts the markup.
    // If that adoption missed, the drag below produces no sort at all rather than a wrong one.
    const sorts: SortEndEvent[] = []
    const hydration = hydrate(<TaskList onSortEnd={(event) => sorts.push(event)} />)

    dragFirstRowDown(hydration.container, ROW_HEIGHT_PX * 2)

    expect(sorts).toHaveLength(1)
    expect(sorts[0]).toMatchObject({ activeId: 'write-spec', fromIndex: 0, toIndex: 2 })

    hydration.unmount()
  })
})
