// @vitest-environment node

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DndProvider } from './dnd-provider.js'
import { DragOverlay } from './drag-overlay.js'
import { SortableList } from './sortable-list.js'
import { flattenTree, type TreeItem } from './tree.js'
import { useSortable } from './use-sortable.js'
import { useTreeDrop } from './use-tree-drop.js'

/**
 * The library renders on a server, with no DOM of any kind.
 *
 * This suite exists because the claim was written down before it was ever run. Every other test
 * file runs under jsdom, where `document` exists and an accidental module-scope DOM touch is
 * invisible — so the one environment that could catch it was the one never used.
 *
 * `@vitest-environment node` is the whole point: `typeof document === 'undefined'` here, and the
 * first assertion checks that rather than assuming it, because a suite that quietly ran under
 * jsdom would pass while testing nothing.
 */

const ROW_IDS = ['a', 'b', 'c'] as const

const SortableRow = ({ id }: { id: string }) => {
  const { setNodeRef, handleProps, style } = useSortable({ id })
  return (
    <li ref={setNodeRef} {...handleProps} style={style}>
      {id}
    </li>
  )
}

const TREE: readonly TreeItem[] = [{ id: 'docs', children: [{ id: 'api' }] }]

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

describe('server rendering', () => {
  it('runs somewhere with no DOM at all', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  it('renders a sortable list, handle semantics and all', () => {
    const html = renderToString(
      <DndProvider>
        <SortableList items={ROW_IDS}>
          <ul>
            {ROW_IDS.map((id) => (
              <SortableRow key={id} id={id} />
            ))}
          </ul>
        </SortableList>
      </DndProvider>,
    )

    // A row that arrives without its semantics is a row a screen reader cannot announce before
    // hydration, so the accessibility surface is asserted rather than just "it did not throw".
    expect(html).toContain('role="button"')
    expect(html).toContain('aria-roledescription="draggable"')
    expect(html).toContain('touch-action:none')
  })

  it('renders a tree', () => {
    expect(
      renderToString(
        <DndProvider>
          <Tree />
        </DndProvider>,
      ),
    ).toContain('docs')
  })

  it('renders the drag instructions, so a screen reader has them before hydration', () => {
    const html = renderToString(
      <DndProvider>
        <Tree />
      </DndProvider>,
    )

    expect(html).toContain('To pick up a draggable')
  })

  it('survives a DragOverlay in the tree', () => {
    // `DragOverlay` calls `createPortal`, which the server renderer does not support — it is
    // reachable only past `if (!origin) return null`, and no drag can be in progress before
    // hydration. That is why this renders rather than throwing, and it is worth pinning: move
    // the null check below the portal and this is the only test that would notice.
    const html = renderToString(
      <DndProvider>
        <DragOverlay>
          <span>ghost</span>
        </DragOverlay>
      </DndProvider>,
    )

    expect(html).not.toContain('ghost')
  })

  it('gives every provider its own store', () => {
    // The reason the store is built in `useState` rather than at module scope. On a server the
    // module is evaluated once and reused for every request, so a module-level store would be
    // one mutable object shared by every concurrent render.
    const twice = renderToString(
      <>
        <DndProvider>
          <Tree />
        </DndProvider>
        <DndProvider>
          <Tree />
        </DndProvider>
      </>,
    )

    expect(twice.match(/aria-roledescription="draggable"/g)).toHaveLength(4)
  })
})
