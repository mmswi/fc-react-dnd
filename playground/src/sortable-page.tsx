import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { DragOverlay } from 'fc-react-dnd/drag-overlay'
import { SortableList, type SortEndEvent } from 'fc-react-dnd/sortable-list'
import { useActiveDrag } from 'fc-react-dnd/use-active-drag'
import { useSortable } from 'fc-react-dnd/use-sortable'
import { Profiler, useCallback, useMemo, useRef, useState } from 'react'
import { CommitBadge, useCommitCounter } from './render-counter.js'
import { listStyle, panelStyle, rowStyle } from './theme.js'

const ITEM_COUNT = 24

const initialItems = Array.from({ length: ITEM_COUNT }, (_unused, index) => ({
  id: `task-${index + 1}`,
  title: `Task ${index + 1}`,
}))

const Row = ({ id, title }: { id: string; title: string }) => {
  const { setNodeRef, handleProps, isDragging, isOver, style } = useSortable({
    id,
    data: { title },
  })
  const commits = useCommitCounter()

  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        {...handleProps}
        // `style` already carries transform, the settle easing, and touch-action. Everything
        // after it is this demo's own taste.
        style={{
          ...rowStyle,
          ...style,
          opacity: isDragging ? 0.4 : 1,
          borderColor: isOver ? '#2563eb' : '#e2e8f0',
        }}
      >
        <span aria-hidden="true">⠿</span>
        {title}
        <CommitBadge count={commits} />
      </button>
    </li>
  )
}

const OverlayContents = () => {
  const active = useActiveDrag()
  if (!active) return null

  return (
    <div style={{ ...rowStyle, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', cursor: 'grabbing' }}>
      <span aria-hidden="true">⠿</span>
      {String(active.data.title ?? active.id)}
    </div>
  )
}

export const SortablePage = () => {
  const [items, setItems] = useState(initialItems)
  const [lastSort, setLastSort] = useState<SortEndEvent | null>(null)
  // Remounts the rows so a drag can be measured from zero, as on the comparison page.
  const [runId, setRunId] = useState(0)

  // Referentially stable across renders unless the order actually changes — the contract the
  // projection memo depends on.
  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  /**
   * Monotonic, not `items.length + 1`: reordering leaves the length alone but a future removal
   * would not, and a reused id makes a drop resolve against the wrong row.
   */
  const nextTaskNumber = useRef(ITEM_COUNT + 1)

  const addTask = useCallback(() => {
    const number = nextTaskNumber.current
    nextTaskNumber.current += 1
    setItems((current) => [...current, { id: `task-${number}`, title: `Task ${number}` }])
  }, [])

  const handleSortEnd = useCallback((event: SortEndEvent) => {
    setLastSort(event)
    setItems((current) => {
      const next = [...current]
      const [moved] = next.splice(event.fromIndex, 1)
      if (moved) next.splice(event.toIndex, 0, moved)
      return next
    })
  }, [])

  return (
    <section>
      <h2>Sortable list</h2>
      <p>
        The number on each row counts <strong>how many times React has re-rendered that row</strong>{' '}
        since the page loaded. Lower is better — a re-render is work the browser did that you may
        not have needed.
      </p>
      <p>
        Drag a row and watch. The one you are holding climbs as it follows your pointer; that is
        what makes it feel like dragging rather than teleporting. The rows it pushes out of the way
        tick up only when they actually move. Everything else stays at zero.
      </p>

      <p>
        <button type="button" onClick={addTask}>
          Add task
        </button>{' '}
        <button type="button" onClick={() => setRunId((current) => current + 1)}>
          Reset counters
        </button>
      </p>
      <p>
        <strong>Adding a row re-renders every row, and that is not a bug in the drag store.</strong>{' '}
        The list membership lives in <code>SortableList</code>&apos;s context, so changing it
        changes a context value, and React context has no partial subscription — <code>memo</code>{' '}
        cannot stop it either. That is an <em>edit</em>. The claim this page makes is about{' '}
        <em>dragging</em>: reset the counters, then drag, and watch how few rows find out.
      </p>

      <Profiler id="sortable" onRender={() => {}}>
        <DndProvider>
          <SortableList items={itemIds} onSortEnd={handleSortEnd}>
            <ul style={listStyle}>
              {items.map((item) => (
                <Row key={`${runId}:${item.id}`} id={item.id} title={item.title} />
              ))}
            </ul>
          </SortableList>

          <DragOverlay>
            <OverlayContents />
          </DragOverlay>
        </DndProvider>
      </Profiler>

      <pre style={{ ...panelStyle, marginTop: 16 }}>
        {lastSort
          ? JSON.stringify(lastSort, null, 2)
          : 'onSortEnd fires here — including the id-relative landing position.'}
      </pre>
    </section>
  )
}
