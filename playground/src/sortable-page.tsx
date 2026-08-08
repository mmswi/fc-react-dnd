import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { DragOverlay } from 'fc-react-dnd/drag-overlay'
import { SortableList, type SortEndEvent } from 'fc-react-dnd/sortable-list'
import { useActiveDrag } from 'fc-react-dnd/use-active-drag'
import { useSortable } from 'fc-react-dnd/use-sortable'
import { Profiler, useCallback, useMemo, useState } from 'react'
import { CommitBadge, useCommitCounter } from './render-counter.js'
import { listStyle, panelStyle, rowStyle } from './theme.js'

const ITEM_COUNT = 24

const initialItems = Array.from({ length: ITEM_COUNT }, (_unused, index) => ({
  id: `task-${index + 1}`,
  title: `Task ${index + 1}`,
}))

const Row = ({ id, title }: { id: string; title: string }) => {
  const { setNodeRef, handleProps, isDragging, isOver, translate, transition } = useSortable({
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
        style={{
          ...rowStyle,
          ...handleProps.style,
          transform: `translate3d(${translate.x}px, ${translate.y}px, 0)`,
          // The hook decides when to ease: displaced rows glide, the dragged row follows the
          // pointer raw, and the drop commit — which reorders the DOM and zeroes the transform
          // at once — gets no transition, so the row lands dead in its slot.
          transition,
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

  // Referentially stable across renders unless the order actually changes — the contract the
  // projection memo depends on.
  const itemIds = useMemo(() => items.map((item) => item.id), [items])

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

      <Profiler id="sortable" onRender={() => {}}>
        <DndProvider>
          <SortableList items={itemIds} onSortEnd={handleSortEnd}>
            <ul style={listStyle}>
              {items.map((item) => (
                <Row key={item.id} id={item.id} title={item.title} />
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
