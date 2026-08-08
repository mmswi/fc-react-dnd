import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { DragOverlay } from 'fc-react-dnd/drag-overlay'
import {
  applyTreeDrop,
  flattenTree,
  type TreeItem,
  type TreeNestPredicate,
} from 'fc-react-dnd/tree'
import { useActiveDrag } from 'fc-react-dnd/use-active-drag'
import { useDndMonitor } from 'fc-react-dnd/use-dnd-monitor'
import { useTreeDrop } from 'fc-react-dnd/use-tree-drop'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { panelStyle } from './theme.js'

/**
 * A document tree, not a folder tree.
 *
 * Any document can become a parent: dropping one onto another gives that document a `children`
 * array. There is no separate "folder" kind, which is § A7 D2 made visible.
 */
type Doc = { title: string }

const INDENT_PX = 24
const ROW_HEIGHT_PX = 34
const AUTO_EXPAND_DELAY_MS = 600

const INITIAL_TREE: readonly TreeItem<Doc>[] = [
  {
    id: 'handbook',
    title: 'Handbook',
    children: [
      { id: 'onboarding', title: 'Onboarding' },
      {
        id: 'engineering',
        title: 'Engineering',
        children: [
          { id: 'style-guide', title: 'Style guide' },
          { id: 'on-call', title: 'On-call' },
        ],
      },
    ],
  },
  { id: 'roadmap', title: 'Roadmap', children: [{ id: 'q3', title: 'Q3' }] },
  { id: 'meeting-notes', title: 'Meeting notes' },
]

/** Everything can be a parent — except, for the demo, one deliberately locked document. */
const canNest: TreeNestPredicate = (candidateParent) => candidateParent.id !== 'on-call'

/**
 * The last visible row belonging to the row at `index` — itself when it has no visible children.
 *
 * Descendants are exactly the rows that follow it while staying deeper than it, which is the one
 * fact a flattened tree gives you for free.
 */
const lastRowOfSubtree = (rows: readonly { depth: number }[], index: number): number => {
  if (index < 0) return index

  const depth = rows[index]?.depth ?? 0
  let last = index
  while (last + 1 < rows.length && (rows[last + 1]?.depth ?? 0) > depth) last++
  return last
}

const TreeBoard = () => {
  const [items, setItems] = useState(INITIAL_TREE)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set(['roadmap']))

  /**
   * Ids this drag expanded on hover, so they can be put back.
   *
   * Restored only in `onDragEnd`/`onDragCancel`: collapsing mid-drag unmounts rows, which is a
   * removal, which cancels the drag by design (§ A6). That is the policy working, and this
   * recipe exists so consumers never meet it.
   */
  const autoExpandedIds = useRef(new Set<string>())

  const { projection, getRowProps } = useTreeDrop<Doc>({
    items,
    collapsedIds,
    indentPx: INDENT_PX,
    canNest,
  })

  const rows = useMemo(() => flattenTree(items, { collapsedIds }).rows, [items, collapsedIds])
  // One walk for both lookups. Asking "does this node have children?" per row inside the render
  // loop is the quadratic version of the same question.
  const { titleById, idsWithChildren } = useMemo(() => {
    const titles = new Map<string, string>()
    const withChildren = new Set<string>()
    const walk = (nodes: readonly TreeItem<Doc>[]) => {
      for (const node of nodes) {
        titles.set(String(node.id), node.title)
        if ((node.children?.length ?? 0) > 0) withChildren.add(String(node.id))
        if (node.children) walk(node.children)
      }
    }
    walk(items)
    return { titleById: titles, idsWithChildren: withChildren }
  }, [items])

  const restoreCollapseState = useCallback(() => {
    const expanded = autoExpandedIds.current
    if (expanded.size === 0) return
    setCollapsedIds((current) => new Set([...current, ...expanded]))
    autoExpandedIds.current = new Set()
  }, [])

  /**
   * Auto-expand on hover, § A7 F8's recipe.
   *
   * Held over a collapsed node that will take children, the branch opens so its children become
   * drop targets. Expanding **mounts** rows, which the A6 policy explicitly survives; collapsing
   * would unmount them, which is a removal, which cancels — so the restore waits for the end of
   * the drag.
   *
   * Scheduled from an effect rather than during render: starting a timer while rendering runs it
   * twice under StrictMode and leaks the first one.
   */
  const parentUnderPointer = projection?.mode === 'into' ? String(projection.parentId) : null

  useEffect(() => {
    if (parentUnderPointer === null || !collapsedIds.has(parentUnderPointer)) return

    const timer = setTimeout(() => {
      autoExpandedIds.current.add(parentUnderPointer)
      setCollapsedIds((current) => {
        const next = new Set(current)
        next.delete(parentUnderPointer)
        return next
      })
    }, AUTO_EXPAND_DELAY_MS)

    return () => clearTimeout(timer)
  }, [parentUnderPointer, collapsedIds])

  useDndMonitor({
    onDragEnd: (event) => {
      restoreCollapseState()
      if (!projection) return
      setItems((current) => applyTreeDrop(current, event.active.id, projection))
    },
    onDragCancel: restoreCollapseState,
  })

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Which row the indicator hangs off, and on which side.
   *
   * `afterId` means "below that row"; with no `afterId`, `beforeId` means "above that row" — not
   * below it. An `into` projection sits on the parent row itself.
   *
   * The row it follows among its **siblings** is not the row it follows **on screen**: lifting a
   * document out to the root lands it after that ancestor's entire visible subtree. Drawing the
   * line straight after the ancestor's own row puts it several rows above where the document
   * would really appear, which is what makes an un-nest look like the tree ignoring the drag.
   */
  const indicatorAnchorId = projection?.afterId ?? projection?.beforeId ?? projection?.parentId
  const anchorRow = rows.findIndex((row) => String(row.id) === String(indicatorAnchorId))
  const indicatorSitsBelowItsAnchor = projection?.afterId != null
  const indicatorRow = indicatorSitsBelowItsAnchor ? lastRowOfSubtree(rows, anchorRow) : anchorRow

  return (
    <section>
      <h2>Tree</h2>
      <p>
        Every document can become a parent — drop one onto another and it gains children. Drag a
        document over its own child and the library refuses: the active subtree is removed from the
        maths, so a cycle is never offered rather than being rejected afterwards. <em>On-call</em>{' '}
        declines children, so the depth stops one level short beside it. Hover a collapsed node for{' '}
        {AUTO_EXPAND_DELAY_MS}ms to expand it mid-drag.
      </p>

      <div style={{ position: 'relative', maxWidth: 460 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row) => {
            const id = String(row.id)
            const { ref, handleProps, isDragging } = getRowProps(id)
            const hasChildren = idsWithChildren.has(id)

            return (
              <li key={id} style={{ height: ROW_HEIGHT_PX }}>
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                  <span style={{ width: row.depth * INDENT_PX }} aria-hidden="true" />
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(id)}
                      aria-label={collapsedIds.has(id) ? `Expand ${row.id}` : `Collapse ${row.id}`}
                      style={{ width: 20, border: 0, background: 'none', cursor: 'pointer' }}
                    >
                      {collapsedIds.has(id) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span style={{ width: 20 }} aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    ref={ref}
                    {...handleProps}
                    style={{
                      ...handleProps.style,
                      flex: 1,
                      textAlign: 'left',
                      font: 'inherit',
                      border: 0,
                      background: 'none',
                      cursor: 'grab',
                      opacity: isDragging ? 0.4 : 1,
                    }}
                  >
                    {titleById.get(id) ?? id}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {projection ? (
          <TreeIndicator
            mode={projection.mode}
            depth={projection.depth}
            rowIndex={indicatorRow}
            below={indicatorSitsBelowItsAnchor}
          />
        ) : null}
      </div>

      {/*
        A tree row stays in its slot while it is dragged — rows here are measure-only, and moving
        them would move the very geometry the projection is computed from. So the thing that
        follows the cursor has to be a separate element, and without one the only feedback is a
        thin line jumping around a list that never moves.
      */}
      <DragOverlay>
        <TreeDragPreview
          titleById={titleById}
          depth={projection?.depth ?? 0}
          mode={projection?.mode}
        />
      </DragOverlay>

      <pre style={{ ...panelStyle, marginTop: 16 }}>
        {projection
          ? JSON.stringify(projection, null, 2)
          : 'The live projection appears here: parentId, index, depth, and the neighbours by id.'}
      </pre>
    </section>
  )
}

/**
 * What the cursor carries, showing the two things the indicator alone cannot: which document is
 * in hand, and — through the indent — the depth it would land at.
 */
const TreeDragPreview = ({
  titleById,
  depth,
  mode,
}: {
  titleById: ReadonlyMap<string, string>
  depth: number
  mode?: 'into' | 'between'
}) => {
  const active = useActiveDrag()
  if (!active) return null

  const id = String(active.id)
  const isNesting = mode === 'into'

  return (
    <div
      style={{
        marginLeft: depth * INDENT_PX,
        height: ROW_HEIGHT_PX,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        borderRadius: 4,
        background: '#fff',
        border: `2px solid ${isNesting ? '#2563eb' : '#cbd5e1'}`,
        boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
        cursor: 'grabbing',
        font: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">⠿</span>
      {titleById.get(id) ?? id}
      {isNesting ? <span style={{ color: '#2563eb', fontSize: 12 }}>↳ into</span> : null}
    </div>
  )
}

const TreeIndicator = ({
  mode,
  depth,
  rowIndex,
  below,
}: {
  mode: 'into' | 'between'
  depth: number
  rowIndex: number
  below: boolean
}) => {
  const isInto = mode === 'into'
  const top = (rowIndex + (isInto || !below ? 0 : 1)) * ROW_HEIGHT_PX

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: depth * INDENT_PX + 20,
        right: 0,
        top: Math.max(top, 0),
        height: isInto ? ROW_HEIGHT_PX : 2,
        background: isInto ? 'rgba(37,99,235,0.12)' : '#2563eb',
        border: isInto ? '2px solid #2563eb' : undefined,
        borderRadius: isInto ? 4 : 0,
        pointerEvents: 'none',
      }}
    />
  )
}

/**
 * The board needs a provider above it, because `useTreeDrop` reads the per-provider store —
 * which is also why the hook throws a named error rather than returning nothing when it cannot
 * find one.
 */
export const TreePage = () => (
  <DndProvider>
    <TreeBoard />
  </DndProvider>
)
