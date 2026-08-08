import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { DragOverlay } from 'fc-react-dnd/drag-overlay'
import {
  applyTreeDrop,
  flattenTree,
  type TreeIndicatorEdge,
  type TreeItem,
  type TreeNestPredicate,
} from 'fc-react-dnd/tree'
import { useActiveDrag } from 'fc-react-dnd/use-active-drag'
import { useDndMonitor } from 'fc-react-dnd/use-dnd-monitor'
import { useTreeDrop } from 'fc-react-dnd/use-tree-drop'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { panelStyle } from './theme.js'
import { addChild, type Doc } from './tree-data.js'

/**
 * A document tree, not a folder tree.
 *
 * Any document can become a parent: dropping one onto another gives that document a `children`
 * array. There is no separate "folder" kind, which is § A7 D2 made visible — and the per-row
 * add button is the same fact from the other direction: every row offers it, including leaves.
 */

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
const LOCKED_ID = 'on-call'
const canNest: TreeNestPredicate = (candidateParent) => candidateParent.id !== LOCKED_ID

/** Wider middle band than the library default — these rows are only 34px tall. */
const NEST_BAND_FRACTION = 0.25

/** The drag handle's DOM id, so a newly added row can be focused by id after it mounts. */
const rowHandleId = (id: string) => `tree-row-${id}`

const addButtonStyle = {
  width: 22,
  height: 22,
  lineHeight: 1,
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  background: '#fff',
  color: '#475569',
  cursor: 'pointer',
} as const

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
    nestBandFraction: NEST_BAND_FRACTION,
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
   * Ids climb monotonically rather than being derived from the tree's size, so a node keeps its
   * id for the life of the page and a drop can never resolve against a reused one.
   */
  const nextDocNumber = useRef(1)

  const addDocument = useCallback((parentId: string | null) => {
    const number = nextDocNumber.current
    nextDocNumber.current += 1
    const id = `doc-${number}`

    setItems((current) => addChild(current, parentId, { id, title: `New document ${number}` }))

    // A child added to a collapsed branch would be invisible, and the button would read as
    // broken. Expanding is a mount, which the A6 policy explicitly survives.
    if (parentId !== null) {
      setCollapsedIds((current) => {
        if (!current.has(parentId)) return current
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }

    setRowToFocus(id)
  }, [])

  /**
   * Focus follows the new row, so adding by keyboard leaves you on the thing you just made
   * rather than on a button three rows away. Applied in an effect because the row does not
   * exist until the commit that renders it.
   */
  const [rowToFocus, setRowToFocus] = useState<string | null>(null)

  useEffect(() => {
    if (rowToFocus === null) return
    document.getElementById(rowHandleId(rowToFocus))?.focus()
    setRowToFocus(null)
  }, [rowToFocus])

  // The projection names the screen row to draw against — deriving it from the sibling ids is
  // the trap this demo fell into three times before the library started answering it (§ A10).
  const indicatorRow = projection
    ? rows.findIndex((row) => String(row.id) === String(projection.indicator.rowId))
    : -1

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
      <p>
        <strong>+</strong> adds a document inside that row — every row offers it, including leaves,
        because there is no folder kind. <em>Add top-level document</em> appends to the root.
      </p>

      <p>
        <button type="button" onClick={() => addDocument(null)}>
          Add top-level document
        </button>
      </p>

      <div style={{ position: 'relative', maxWidth: 460 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row) => {
            const id = String(row.id)
            const { ref, handleProps, isDragging, style } = getRowProps(id)
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
                    id={rowHandleId(id)}
                    ref={ref}
                    {...handleProps}
                    style={{
                      ...style,
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
                    {id === LOCKED_ID ? (
                      <span title="Declines children" aria-hidden="true">
                        {' 🔒'}
                      </span>
                    ) : null}
                  </button>
                  {/*
                    Its own button, not part of the handle: a pointerdown here must add a
                    document rather than begin a drag.
                  */}
                  <button
                    type="button"
                    onClick={() => addDocument(id)}
                    aria-label={`Add a document inside ${titleById.get(id) ?? id}`}
                    style={addButtonStyle}
                  >
                    +
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {projection && indicatorRow !== -1 ? (
          <TreeIndicator
            edge={projection.indicator.edge}
            depth={projection.indicator.depth}
            rowIndex={indicatorRow}
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
          parentTitle={
            projection?.parentId != null
              ? (titleById.get(String(projection.parentId)) ?? String(projection.parentId))
              : null
          }
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
 * What the cursor carries: which document is in hand, the depth it would land at (the indent),
 * and — whenever the drop lands *inside* something — the name of that parent. Naming the parent
 * on every nesting drop, not only in the middle-band case, is what stops "the JSON says between
 * but it became a child" from reading as a contradiction: both paths are drops into a parent.
 */
const TreeDragPreview = ({
  titleById,
  depth,
  parentTitle,
}: {
  titleById: ReadonlyMap<string, string>
  depth: number
  parentTitle: string | null
}) => {
  const active = useActiveDrag()
  if (!active) return null

  const id = String(active.id)
  const isNesting = parentTitle !== null

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
      {isNesting ? (
        <span style={{ color: '#2563eb', fontSize: 12 }}>↳ into {parentTitle}</span>
      ) : (
        <span style={{ color: '#64748b', fontSize: 12 }}>top level</span>
      )}
    </div>
  )
}

const TreeIndicator = ({
  edge,
  depth,
  rowIndex,
}: {
  edge: TreeIndicatorEdge
  depth: number
  rowIndex: number
}) => {
  const isOver = edge === 'over'
  const top = (edge === 'below' ? rowIndex + 1 : rowIndex) * ROW_HEIGHT_PX

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: depth * INDENT_PX + 20,
        right: 0,
        top: isOver ? rowIndex * ROW_HEIGHT_PX : top,
        height: isOver ? ROW_HEIGHT_PX : 2,
        background: isOver ? 'rgba(37,99,235,0.12)' : '#2563eb',
        border: isOver ? '2px solid #2563eb' : undefined,
        borderRadius: isOver ? 4 : 0,
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
