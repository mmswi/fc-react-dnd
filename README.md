# fc-react-dnd

A React drag-and-drop library with **first-class tree support**.

Every general-purpose React DnD library stops at the same boundary: it tells you what gesture you
made relative to *one row* — "you are above this item", "you are in its middle" — and leaves you
to work out what that means for your data. This one returns the answer:

```ts
{
  parentId: 'handbook', index: 0, depth: 1,
  mode: 'between', afterId: null, beforeId: 'on-call',
  indicator: { rowId: 'handbook', edge: 'below', depth: 1 },  // where to draw it
}
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
  const { setNodeRef, handleProps, isDragging, style } = useSortable({ id })

  return (
    <li ref={setNodeRef} {...handleProps} style={{ ...style, opacity: isDragging ? 0.4 : 1 }}>
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

### `style` is the whole thing, and you should pass it

`style` carries `transform`, the settle `transition`, and `touch-action`. Hand-assembling those
is three ways to get a drag wrong, and I made all three in this repo's own demo before moving
the decision into the hook:

- **No `transform`** and nothing moves.
- **No `transition`**, or the wrong one, and a dropped row glides in from wherever it was
  instead of landing. The hook applies it only to rows being *displaced* — never to the row
  under your hand, and never in the commit that ends the drag. That last case is the subtle
  one: the drop commit reorders the DOM and zeroes the transforms *at once*, so a transition
  still live there animates the zeroing.
- **Forgetting to merge `handleProps.style`** loses `touch-action: none`, which breaks dragging
  on touch devices and nowhere else — so it survives every desktop test you run. Carrying it in
  `style` makes `{...handleProps} style={style}` correct instead of subtly broken.

Everything after the spread is yours:

```tsx
style={{ ...style, opacity: isDragging ? 0.4 : 1, background: isOver ? '#eef' : '#fff' }}
```

Opacity is deliberately **not** in there. Ghosting the source row is a design choice, and an
overlay-driven list wants the opposite.

To change the easing, pass it — or `null` to turn it off:

```tsx
useSortable({ id, transition: 'transform 300ms cubic-bezier(.2,0,0,1)' })
useSortable({ id, transition: null })
```

`translate` and `transition` stay exposed for driving your own animation.

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
import { DragOverlay } from 'fc-react-dnd/drag-overlay'
import { applyTreeDrop, flattenTree, type TreeItem } from 'fc-react-dnd/tree'
import { useActiveDrag } from 'fc-react-dnd/use-active-drag'
import { useDndMonitor } from 'fc-react-dnd/use-dnd-monitor'
import { useTreeDrop } from 'fc-react-dnd/use-tree-drop'
import { useMemo, useState } from 'react'

type Doc = { title: string }

const INDENT_PX = 24

const INITIAL_TREE: readonly TreeItem<Doc>[] = [
  { id: 'handbook', title: 'Handbook', children: [{ id: 'onboarding', title: 'Onboarding' }] },
  { id: 'roadmap', title: 'Roadmap' },
]

const Tree = () => {
  const [items, setItems] = useState<readonly TreeItem<Doc>[]>(INITIAL_TREE)
  const { projection, getRowProps } = useTreeDrop({ items, indentPx: INDENT_PX })
  const rows = useMemo(() => flattenTree(items).rows, [items])

  useDndMonitor({
    onDragEnd: (event) => {
      // `applyTreeDrop` is pure — it returns the new tree and mutates nothing.
      if (projection) setItems((current) => applyTreeDrop(current, event.active.id, projection))
    },
  })

  const indicator = projection?.indicator

  return (
    <>
      <ul role="tree">
        {rows.map((row) => {
          const { ref, handleProps, isDragging, style } = getRowProps(row.id)
          const anchored = indicator?.rowId === row.id ? indicator : null

          return (
            <li
              key={row.id}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-posinset={row.index + 1}
              aria-setsize={rows.filter((sibling) => sibling.parentId === row.parentId).length}
              // The line is positioned against this row, so nothing here needs to know a row
              // height or share a positioned ancestor with the rest of the list.
              style={{
                position: 'relative',
                paddingLeft: row.depth * INDENT_PX,
                opacity: isDragging ? 0.4 : 1,
                outline: anchored?.edge === 'over' ? '2px solid #2563eb' : undefined,
              }}
            >
              <button type="button" ref={ref} {...handleProps} style={style}>
                {String(row.id)}
              </button>

              {anchored && anchored.edge !== 'over' ? (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: anchored.depth * INDENT_PX,
                    right: 0,
                    height: 2,
                    background: '#2563eb',
                    ...(anchored.edge === 'above' ? { top: -1 } : { bottom: -1 }),
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      {/* Tree rows never move, so this is the only thing that follows the cursor. */}
      <DragOverlay>
        <TreeDragPreview />
      </DragOverlay>
    </>
  )
}

const TreeDragPreview = () => {
  const active = useActiveDrag()
  return active ? <div className="drag-preview">{String(active.id)}</div> : null
}
```

**Tree rows do not move during a drag, so nothing is visible unless you render it.** That is
deliberate — rows are measure-only, and translating them would move the very geometry the
projection is computed from — but it means a tree wired up without the two pieces above feels
broken rather than minimal. You need both: a **line** (or box) from `projection.indicator`, and
an **overlay** carrying something under the cursor.

The example draws the line by hand to show what the data means. You do not have to — the same
thing ships as a component in `fc-react-dnd/tree-drop-indicator`, and replaces that whole block
with:

```tsx
<TreeDropIndicator projection={projection} />
```

It positions itself from the rects the store already measured, so it needs no positioned
ancestor and no row height, and it takes the indent from the `indentPx` you gave `useTreeDrop`.
One contract: **the element you attach `getRowProps(id).ref` to spans the full width of the
list**, with depth as padding inside it — rows are measured through that ref, so a ref on an
already-indented child has no fixed origin to indent from. Putting `handleProps` on an inner
button is fine.

`projection.indicator` gives you `{ rowId, edge, depth }` already resolved into screen terms:
which visible row to draw against, whether the line goes above it, below it, or as a box over
it, and at what indent. Do not derive that from `afterId`/`beforeId` — those are sibling-space,
an `into` target's `beforeId` is its first child, and an un-nest belongs below a whole subtree.
This library's own demo got it wrong three times before the projection started answering it.

`projection` is `TreeDropProjection | null`. `null` means **no legal position here** — the gap
between a node and its own first child, when that node will not take children, admits nothing.
Hide the indicator; a release there moves nothing.

### What you get

- **Drop-into vs drop-between.** A nestable row has three bands: a thin strip at the top and
  bottom for the gaps beside it, and a middle that means "inside this node". A row that refuses
  children has two bands and no middle.
- **Depth from horizontal position**, in `indentPx` steps. You cannot go deeper than one level
  inside the row above, and that bound obeys `canNest`, because one level inside a row *is*
  nesting into it. Going shallower is where most tree implementations trap you — see below.
- **Dragging left lifts a row out of its parent**, from anywhere in a group. The clamp everyone
  quotes — `[next.depth, prev.depth + 1]` — makes un-nesting nearly unreachable, because every
  row bounding a gap *inside* a group sits at that group's depth or deeper, so the lower bound
  can never offer a way out. You end up having to shuffle a row to the bottom of its parent
  before you are allowed to lift it. Here, a deliberate leftward pull drops the floor to the
  root: one step left makes the row a sibling of its parent, another a sibling of its
  grandparent. It lands *after* that ancestor's whole subtree, because a row cannot sit at the
  parent's level between that parent's children — coming out of a group is a downward move. A
  drag with no horizontal intent still joins the group it was aimed at.
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
- **You are told where to draw the indicator.** `projection.indicator` is
  `{ rowId, edge: 'above' | 'below' | 'over', depth }` — a **screen-space** anchor, already
  resolved. Deriving one from `afterId`/`beforeId` looks easy and is not: those are
  *sibling*-space, an `into` target's `beforeId` is its first child, "first child via the gap"
  has no neighbour ids at all, and an un-nest belongs below a whole subtree. This library's own
  demo got it wrong three times before the projection started answering it.

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
| `fc-react-dnd/use-sortable` | `useSortable`, `UseSortableOptions`, `UseSortableResult`, `SORTABLE_SETTLE_TRANSITION` |
| `fc-react-dnd/tree` | `TreeItem`, `TreeRow`, `FlattenedTree`, `FlattenTreeOptions`, `flattenTree`, `TREE_DROP_MODES`, `TreeDropMode`, `TreeNestPredicate`, `TreeDropProjection`, `TREE_INDICATOR_EDGES`, `TreeIndicatorEdge`, `TreeDropIndicator`, `ProjectTreeDropArgs`, `DEFAULT_TREE_INDENT_PX`, `DEFAULT_NEST_BAND_FRACTION`, `projectTreeDrop`, `applyTreeDrop` |
| `fc-react-dnd/use-tree-drop` | `useTreeDrop`, `UseTreeDropOptions`, `UseTreeDropResult`, `TreeRowProps` |
| `fc-react-dnd/tree-drop-indicator` | `TreeDropIndicator`, `TreeDropIndicatorProps` |
| `fc-react-dnd/types` | `DndId`, `Point`, `Translate`, `Rect`, `DndData`, `DragNodeStyle`, `DRAG_CANCEL_REASONS`, `DragCancelReason`, `DRAG_DIRECTIONS`, `DragDirection`, `ActiveDragInfo`, `DragActive`, `DragOver`, `DragStartEvent`, `DragMoveEvent`, `DragOverEvent`, `DragEndEvent`, `DragCancelEvent`, `CollisionActive`, `DroppableCandidate`, `CollisionArgs`, `CollisionDetection`, `DirectionalTarget`, `DragSession`, `DragBeginInit`, `SensorContext`, `SensorActivatorProps`, `Sensor`, `DragHandleProps`, `DndAnnouncements`, `DndAccessibility`, `DndMonitorListeners` |

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

**Normally you pass nothing.** ArrowLeft/ArrowRight step by one level, and the sensor gets that
width from `useTreeDrop`'s `indentPx` through the store — so setting the indent in one place is
enough and the two cannot disagree.

`indentPx` exists as a fallback for one case: driving `projectTreeDrop` by hand without
`useTreeDrop`, where nothing publishes a step. Where both exist, the published value wins,
because it belongs to the thing that interprets the number.

```tsx
useTreeDrop({ items, indentPx: 16 })   // the only place to say it
```

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

React `<Profiler>` around **each row**, in Chrome, on the playground's comparison page. 24 items
per list, dragging item 1 down onto item 4 — 154 px, 3 boundary crossings, 40 pointermove events,
the same synthesised pointer path dispatched to both lists in one session. Three runs, identical
each time.

| During the drag | Rows that re-rendered |
| --- | --- |
| **fc-react-dnd** | **4** of 24 |
| dnd-kit 6.3.1 / sortable 10.0.0 | **24** of 24 |

That is the number the architecture is actually about: when something changes, how much of the
list finds out. Ours is the row you are dragging plus the rows it displaces. dnd-kit re-renders
every row in the list on every change.

**The dragged row re-renders on every pointermove in both libraries, and should** — that is what
makes it follow your hand instead of jumping between slots. Turn `trackTransform: false` on
`useSortable` and use a `DragOverlay` instead, and nothing in the list re-renders per move at all;
the overlay moves outside React entirely.

**One caveat on the totals, stated because it cuts against a bigger-sounding claim.** Raw commit
counts are *not* comparable between the two here: dnd-kit schedules part of its per-move work
through `requestAnimationFrame`, and the measurement tab was backgrounded, where Chrome throttles
rAF to zero. Its total is therefore a floor, not a measurement. The "rows that re-rendered"
column above does not depend on scheduling and is the honest comparison.

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
