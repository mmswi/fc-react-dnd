# fc-react-dnd

A React drag-and-drop library with **first-class tree support**.

Every general-purpose React DnD library stops at the same boundary: it tells you what gesture you
made relative to *one row* — "you are above this item", "you are in its middle" — and leaves you
to work out what that means for your data. This one returns the answer:

```ts
{ parentId: 'handbook', index: 0, depth: 1, mode: 'between', afterId: null, beforeId: 'on-call' }
```

A position, clamped against both neighbours, with the dragged subtree removed from the maths so a
cycle is never *offered* rather than being offered and then rejected.

**Requirements: React 19 or newer, ESM only.** No CommonJS build, no bundler in the chain, zero
runtime dependencies.

---

## Install

```bash
npm install fc-react-dnd
```

`react` and `react-dom` are peer dependencies at `>=19.0.0`. That range is a support statement:
19 is the only version this library is tested against, so claiming 18 would be a lie in the
manifest. It may well work on 18 — we don't claim it, test it, or document it.

## There is no root entry, on purpose

```ts
import { useDraggable } from 'fc-react-dnd'            // ✗ does not resolve, and never will
import { useDraggable } from 'fc-react-dnd/use-draggable' // ✓
```

Every public module is its own subpath. A barrel file pulls the whole library into your module
graph the moment you import one thing from it, and defeats tree-shaking for everyone downstream.
Deep imports into internals don't resolve either — `fc-react-dnd/internal/store` fails at
resolution time, not in review.

## Quickstart

```tsx
import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { SortableList } from 'fc-react-dnd/sortable-list'
import { useSortable } from 'fc-react-dnd/use-sortable'
import { useMemo, useState } from 'react'

const Row = ({ id }: { id: string }) => {
  const { setNodeRef, handleProps, isDragging, translate } = useSortable({ id })

  return (
    <li
      ref={setNodeRef}
      {...handleProps}
      style={{
        ...handleProps.style,
        transform: `translate3d(${translate.x}px, ${translate.y}px, 0)`,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {id}
    </li>
  )
}

export const TaskList = () => {
  const [items, setItems] = useState(['write', 'review', 'ship'])
  // Referentially stable unless the order actually changes — see "Consumer contracts".
  const itemIds = useMemo(() => items, [items])

  return (
    <DndProvider>
      <SortableList
        items={itemIds}
        onSortEnd={({ fromIndex, toIndex }) =>
          setItems((current) => {
            const next = [...current]
            const [moved] = next.splice(fromIndex, 1)
            if (moved) next.splice(toIndex, 0, moved)
            return next
          })
        }
      >
        <ul>
          {items.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      </SortableList>
    </DndProvider>
  )
}
```

Pointer and keyboard both work out of the box. `DndProvider` defaults `sensors` to
`[pointerSensor(), keyboardSensor()]`.

---

## Trees

This is what the library is for.

### The problem

"Where does this drop?" has two answers at once in a tree — *into* a node, or *between* two nodes
— and several genuinely different outcomes occupy the **same pixels**, told apart only by how far
right you are. Dropping at the bottom edge of a nested row could mean "next sibling", "uncle",
"great-uncle", or "first child of the row below", depending on horizontal position alone. And a
careless implementation will happily drop a node inside its own subtree.

### The answer

```tsx
import { DndProvider } from 'fc-react-dnd/dnd-provider'
import { applyTreeDrop, flattenTree, type TreeItem } from 'fc-react-dnd/tree'
import { useDndMonitor } from 'fc-react-dnd/use-dnd-monitor'
import { useTreeDrop } from 'fc-react-dnd/use-tree-drop'
import { useMemo, useState } from 'react'

type Doc = { title: string }

const INDENT_PX = 24

const Tree = ({ items }: { items: readonly TreeItem<Doc>[] }) => {
  const { projection, getRowProps } = useTreeDrop({ items, indentPx: INDENT_PX })
  const rows = useMemo(() => flattenTree(items).rows, [items])

  useDndMonitor({
    onDragEnd: (event) => {
      if (projection) applyTreeDrop(items, event.active.id, projection)
    },
  })

  return (
    <ul role="tree">
      {rows.map((row) => {
        const { ref, handleProps, isDragging } = getRowProps(row.id)
        return (
          <li
            key={row.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-posinset={row.index + 1}
            aria-setsize={rows.filter((sibling) => sibling.parentId === row.parentId).length}
            style={{ paddingLeft: row.depth * INDENT_PX, opacity: isDragging ? 0.4 : 1 }}
          >
            <button type="button" ref={ref} {...handleProps}>
              {String(row.id)}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

`projection` is `TreeDropProjection | null`. `null` means **no legal position here** — the gap
between a node and its own first child, when that node will not take children, admits nothing.
Hide the indicator; a release there moves nothing.

### What you get

- **Drop-into vs drop-between.** A nestable row has three bands: a thin strip at the top and
  bottom for the gaps beside it, and a middle that means "inside this node". A row that refuses
  children has two bands and no middle.
- **Depth from horizontal position**, in `indentPx` steps, clamped against **both** neighbours:
  you cannot go shallower than the row below the gap, nor deeper than one level inside the row
  above — and that deeper bound obeys `canNest` too, because one level inside a row *is* nesting
  into it.
- **Cycles are unrepresentable.** The dragged node and its whole subtree are removed from the
  rows the maths runs over, so "inside your own child" is never a position the projection can
  produce. There is still a defensive guard in `applyTreeDrop` for a hand-built projection, and
  it returns your original array untouched.
- **Any node can be a parent.** There is no "folder" kind. A document you drop something onto
  gains a `children` array; when its last child leaves, `children: []` stays behind rather than
  vanishing, so an expander rendered off `children !== undefined` doesn't flicker.
- **Structural sharing.** `applyTreeDrop` rebuilds only the two ancestor spines it has to. Every
  subtree that didn't change keeps its identity, so your `memo`'d rows bail out after a drop. A
  deep clone would be *correct* and would re-render all 10,000 rows of a 10,000-node tree.
- **The position survives a concurrent edit.** The projection carries `afterId`/`beforeId`
  alongside `index`, and `applyTreeDrop` resolves the final slot against the tree you hand it. If
  a collaborator removed a sibling above the insertion point mid-drag, the item still lands next
  to the neighbour you meant.

### The maths is usable on its own

`fc-react-dnd/tree` is pure: no React, no DOM, no `'use client'`. `flattenTree`,
`projectTreeDrop`, and `applyTreeDrop` run under plain Node, and you can test your own tree logic
against them without rendering anything.

---

## API

| Subpath | Exports |
| --- | --- |
| `fc-react-dnd/dnd-provider` | `DndProvider`, `DndProviderProps` |
| `fc-react-dnd/use-draggable` | `useDraggable`, `UseDraggableOptions`, `UseDraggableResult` |
| `fc-react-dnd/use-droppable` | `useDroppable`, `UseDroppableOptions`, `UseDroppableResult` |
| `fc-react-dnd/use-active-drag` | `useActiveDrag` |
| `fc-react-dnd/use-dnd-monitor` | `useDndMonitor` |
| `fc-react-dnd/drag-overlay` | `DragOverlay`, `DragOverlayProps` |
| `fc-react-dnd/pointer-sensor` | `pointerSensor`, `PointerSensorOptions` |
| `fc-react-dnd/keyboard-sensor` | `keyboardSensor`, `KeyboardSensorOptions` |
| `fc-react-dnd/collision` | `closestCenter` |
| `fc-react-dnd/sortable-list` | `SortableList`, `SortableListProps`, `SortEndEvent` |
| `fc-react-dnd/use-sortable` | `useSortable`, `UseSortableOptions`, `UseSortableResult` |
| `fc-react-dnd/tree` | `TreeItem`, `TreeRow`, `FlattenedTree`, `FlattenTreeOptions`, `flattenTree`, `TREE_DROP_MODES`, `TreeDropMode`, `TreeNestPredicate`, `TreeDropProjection`, `ProjectTreeDropArgs`, `DEFAULT_TREE_INDENT_PX`, `DEFAULT_NEST_BAND_FRACTION`, `projectTreeDrop`, `applyTreeDrop` |
| `fc-react-dnd/use-tree-drop` | `useTreeDrop`, `UseTreeDropOptions`, `UseTreeDropResult`, `TreeRowProps` |
| `fc-react-dnd/types` | `DndId`, `Point`, `Translate`, `Rect`, `DndData`, `DRAG_CANCEL_REASONS`, `DragCancelReason`, `DRAG_DIRECTIONS`, `DragDirection`, `ActiveDragInfo`, `DragActive`, `DragOver`, `DragStartEvent`, `DragMoveEvent`, `DragOverEvent`, `DragEndEvent`, `DragCancelEvent`, `CollisionActive`, `DroppableCandidate`, `CollisionArgs`, `CollisionDetection`, `DirectionalTarget`, `DragSession`, `DragBeginInit`, `SensorContext`, `SensorActivatorProps`, `Sensor`, `DragHandleProps`, `DndAnnouncements`, `DndAccessibility`, `DndMonitorListeners` |

### `DndProvider`

| Prop | Default | |
| --- | --- | --- |
| `sensors` | `[pointerSensor(), keyboardSensor()]` | Must be referentially stable |
| `collisionDetection` | `closestCenter` | |
| `autoScroll` | `true` | Pointer drags only — keyboard drags use `scrollIntoView` |
| `accessibility` | | `{ announcements?, instructions?, draggableRoleDescription? }` |
| `onDragStart` / `onDragMove` / `onDragOver` / `onDragEnd` / `onDragCancel` | | |

`onDragStart` carries `over` as well as `active`: a drag frequently begins already over something
(a sortable row is over itself), and `onDragOver` only fires on *changes*.

`onDragCancel` carries a `DragCancelReason`:

| Reason | |
| --- | --- |
| `'escape'` | The user pressed Escape |
| `'blur'` | Focus left mid-drag during a keyboard drag |
| `'pointer-cancelled'` | The browser revoked the interaction (a touch reinterpreted as a scroll, a device rotation) |
| `'item-removed'` | **The library forced the cancel** because a registered node disappeared mid-drag |

That last one deserves a branch of its own. See *Concurrent edits*, below.

### `pointerSensor(options?)`

`activationDistancePx` (default 5) for move-to-drag, or `activationDelayMs` +
`activationTolerancePx` for hold-to-drag — the second is what lets a touch scroll the page instead
of dragging a row.

### `keyboardSensor(options?)`

`indentPx` (default 24) — how far one ArrowLeft/ArrowRight step moves the item horizontally.

---

## Accessibility

The keyboard path is not a fallback. Arrow keys produce a **translate**, exactly as a pointer
does, so a keyboard drag flows through the same collision and the same tree-depth maths — nothing
downstream can tell which sensor drove a drag.

| Key | |
| --- | --- |
| <kbd>Space</kbd> / <kbd>Enter</kbd> | Pick up, and drop |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move to the nearest target in that direction |
| <kbd>←</kbd> <kbd>→</kbd> | Change depth by one indent (trees) |
| <kbd>Esc</kbd> | Cancel and return to the starting position |
| Losing focus | Cancels — a drag must not survive tabbing away |

**Every legal outcome is reachable by keyboard alone**, including "make this the first child of
that node": a keyboard step lands on a gap boundary, and "into X" is the deepest rung of the gap
below X.

Handles get `role="button"`, `tabIndex={0}`, `aria-roledescription`, `aria-describedby` pointing
at a per-provider instructions element, `draggable={false}` and `touch-action: none`. A disabled
draggable keeps `aria-disabled` and its semantics, and loses only its activation listeners.

### Announcements

A visually-hidden `role="status"` live region announces pickup, each target change, the drop and
any cancel. Target changes announce **on change**, not per pointermove.

```tsx
<DndProvider
  accessibility={{
    instructions: 'Appuyez sur Espace pour saisir cet élément.',
    announcements: {
      describeDragStart: ({ active }) => `${active.id} saisi.`,
      describeDragEnd: ({ active, over }) =>
        over ? `${active.id} déposé sur ${over.id}.` : `${active.id} déposé.`,
    },
  }}
>
  {children}
</DndProvider>
```

Overrides merge per key — supply two and the other two keep their defaults.

`'item-removed'` gets its own default text, and shouldn't be collapsed into the others: "movement
cancelled" is a lie there. The user cancelled nothing, and a screen-reader user has no other way
to learn what happened.

### Trees

Tree rows are **measure-only** — they never become `over`, so they produce no `onDragOver` events
to announce. `useTreeDrop` announces the projection instead, and the text is overridden on the
hook rather than on the provider, because a projection is not a provider-level concept:

```tsx
useTreeDrop({
  items,
  describeProjection: (projection) =>
    projection ? `Niveau ${projection.depth + 1}` : 'Position invalide.',
})
```

Give rows `aria-level`, `aria-posinset` and `aria-setsize` from `flattenTree`'s output, as in the
tree example above.

---

## Consumer contracts

Three things the library asks of you. Each has a specific failure mode rather than a vague
warning.

**1. `items` (and `canNest`) must be referentially stable.**

```tsx
<SortableList items={ids}>              {/* ✓ from useMemo or state */}
<SortableList items={data.map(d => d.id)}>  {/* ✗ new array every render */}
```

These arrays key the projection memo. An inline one recomputes the projection once per subscriber
per pointermove instead of once per move — a green test suite and a dropped frame.

**2. Restore collapse state after the drag, never during it.**

Expanding a branch mid-drag is fine and supported — that's auto-expand-on-hover, and it works.
*Collapsing* one unmounts rows, which is a removal, which cancels the drag. Keep the set of
auto-expanded ids and restore it in `onDragEnd` / `onDragCancel`.

**3. Key lists by id, not by index.**

`<Row key={index}>` makes React reuse the wrong component when the list reorders, and every drag
here reorders lists.

## Concurrent edits

If another user — or a lazy load, or your own state — changes the list **while a drag is in
progress**, the policy is deliberately asymmetric:

- **A row disappearing cancels the drag.** Any row: the dragged one, the current target, or an
  unrelated row above them. Removing a row shifts every rect below it, so a drop resolved against
  the cached geometry lands in the wrong place — with nothing anywhere reporting an error.
  Cancelling returns the item to its origin and leaves no window in which a wrong position can be
  presented. `onDragCancel` fires with `'item-removed'`.
- **A row appearing does not cancel.** Rects are re-measured and collision re-runs, with the drag
  still alive. Cancelling here would break tree auto-expand — which mounts rows as a *result* of
  the user's own drag — and every lazily-loaded list reached by auto-scroll.

Because of that, `SortEndEvent` and `TreeDropProjection` both carry **id-relative** landing
positions (`afterId` / `beforeId`) alongside the numeric index, and `applyTreeDrop` resolves the
final slot from those ids against the tree you hand it.

---

## Performance

All drag state lives in a plain store outside React. Components subscribe to narrow slices through
`useSyncExternalStore`, so a notification whose selected slice is unchanged never enters React at
all — there is no lane, no root scheduling, and no render. Rects are measured **once** at drag
start and every move afterwards is arithmetic against that cache; derived projections are
memoised once per store-state version and read by O(1) selectors.

### Measured

React `<Profiler>` around **each row**, in Chrome, on the playground's comparison page.
24 items per list, dragging item 1 onto item 4 — 154 px, 3 boundary crossings, 40 pointermove
events, the same synthesised pointer path dispatched to both lists in one session. Three runs,
identical each time.

| During the drag | Rows that committed | Total commits |
| --- | --- | --- |
| **fc-react-dnd** | **4** of 24 | **9** |
| dnd-kit 6.3.1 / sortable 10.0.0 | 24 of 24 | 96 |

The three rows per boundary crossing are the row being dragged, the row that gained the drop
target, and the row that lost it. Nothing else has a changed slice, so nothing else renders.

`DragOverlay` writes `style.transform` straight to its own node inside `requestAnimationFrame`,
coalesced to at most one write per frame. Its children render **once** for a whole drag.

## Server components

Modules that touch React state, effects, context, or the DOM carry `'use client'`. These do not:

`fc-react-dnd/types` · `fc-react-dnd/collision` · `fc-react-dnd/tree`

You can import tree types and run the tree maths in a server component. Everything else needs a
client boundary.

## Scope

Shipped: sortable lists, pointer and keyboard sensors, one collision strategy (`closestCenter`),
a drag overlay, and trees.

Not shipped, on purpose: cross-list and cross-tree moves, additional collision strategies, drop
animations, live row reflow during a tree drag (v0.1's tree mode is indicator-only), and
RTL-aware direction.

## License

MIT © Mihai Marinescu
