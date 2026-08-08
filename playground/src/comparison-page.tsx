import {
  DndContext,
  type DragEndEvent as DndKitDragEndEvent,
  KeyboardSensor as DndKitKeyboardSensor,
  PointerSensor as DndKitPointerSensor,
  closestCenter as dndKitClosestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable as useDndKitSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { SortableList, type SortEndEvent } from 'fc-react-dnd/sortable-list'
import { useSortable } from 'fc-react-dnd/use-sortable'
import { useCallback, useMemo, useState } from 'react'
import { CommitBadge, ProfiledRow, useCommitCounter } from './render-counter.js'
import { listStyle, panelStyle, rowStyle } from './theme.js'

/**
 * The same list, twice, with identical commit counters — so the numbers are like-for-like.
 *
 * Classic dnd-kit (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0) rather than the pre-1.0
 * rewrite: that is what people actually ship, and benchmarking against an unstable pre-release
 * would be both unfair and unreproducible.
 */

const ITEM_COUNT = 24
const INITIAL_IDS = Array.from({ length: ITEM_COUNT }, (_unused, index) => `item-${index + 1}`)

const OurRow = ({ id }: { id: string }) => {
  const { setNodeRef, handleProps, isDragging, translate, transition } = useSortable({ id })
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
          // The hook's transition: displaced rows ease, the dragged row and the drop commit do
          // not. dnd-kit's `transition` plays the same role on its side of this page.
          transition,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        {id}
        <CommitBadge count={commits} />
      </button>
    </li>
  )
}

const DndKitRow = ({ id }: { id: string }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useDndKitSortable({ id })
  const commits = useCommitCounter()

  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={{
          ...rowStyle,
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        {id}
        <CommitBadge count={commits} />
      </button>
    </li>
  )
}

const OurList = () => {
  const [ids, setIds] = useState(INITIAL_IDS)
  const items = useMemo(() => ids, [ids])

  const handleSortEnd = useCallback((event: SortEndEvent) => {
    setIds((current) => {
      const next = [...current]
      const [moved] = next.splice(event.fromIndex, 1)
      if (moved) next.splice(event.toIndex, 0, moved)
      return next
    })
  }, [])

  return (
    <DndProvider>
      <SortableList items={items} onSortEnd={handleSortEnd}>
        <ul style={listStyle}>
          {ids.map((id) => (
            <ProfiledRow key={id} id={`ours:${id}`}>
              <OurRow id={id} />
            </ProfiledRow>
          ))}
        </ul>
      </SortableList>
    </DndProvider>
  )
}

const DndKitList = () => {
  const [ids, setIds] = useState(INITIAL_IDS)
  const sensors = useSensors(
    useSensor(DndKitPointerSensor),
    useSensor(DndKitKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DndKitDragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setIds((current) =>
      arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id))),
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dndKitClosestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul style={listStyle}>
          {ids.map((id) => (
            <ProfiledRow key={id} id={`dnd-kit:${id}`}>
              <DndKitRow id={id} />
            </ProfiledRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

export const ComparisonPage = () => {
  // The counters only ever climb, so after a few drags both sides read as large numbers whose
  // ratio means nothing. Remounting via `key` is what makes a comparison a comparison: one drag
  // on each side, from zero, is the only reading that answers "how much work per drag?".
  const [runId, setRunId] = useState(0)

  return (
    <section>
      <h2>Comparison</h2>
      <p>
        The same {ITEM_COUNT}-item list, built twice, with the same re-render counter on every row.
        Drag a row a little way down each list and compare the numbers.
      </p>
      <p>
        Both dragged rows climb steadily, and both should — they follow your pointer. The difference
        is everything <em>else</em>: on the left only the rows actually being pushed out of the way
        re-render, and on the right all {ITEM_COUNT} do, on every pointer move.
      </p>
      <p style={panelStyle}>
        Baseline: <code>@dnd-kit/core</code> 6.3.1, <code>@dnd-kit/sortable</code> 10.0.0. Recorded
        because the comparison is only meaningful against a pinned target.
      </p>

      <p>
        <button type="button" onClick={() => setRunId((current) => current + 1)}>
          Reset counters
        </button>{' '}
        Counters accumulate across drags. Reset, then drag <strong>once</strong> on each side — the
        per-drag numbers are the ones worth comparing.
      </p>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div>
          <h3>fc-react-dnd</h3>
          <OurList key={runId} />
        </div>
        <div>
          <h3>dnd-kit</h3>
          <DndKitList key={runId} />
        </div>
      </div>
    </section>
  )
}
