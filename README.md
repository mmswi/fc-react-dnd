# fc-react-dnd

A React drag-and-drop library with **first-class tree support**.

**[Try the live demo →](https://fc-react-dnd-demo.vercel.app/)**

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

**Requirements: React 19 or newer, Node 22 or newer, ESM only.** No CommonJS build, no bundler in
the chain, zero runtime dependencies.

---

## Install

```bash
npm install fc-react-dnd
```

`react` and `react-dom` are peer dependencies at `>=19.0.0`. That range is a support statement:
19 is the only version this library is tested against, so claiming 18 would be a lie in the
manifest. It may well work on 18 — we don't claim it, test it, or document it.

## Importing

Everything comes from the root, and every module is also its own subpath:

```ts
import { DndProvider, useSortable, applySortEnd } from 'fc-react-dnd'  // ✓ the usual way
import { useDraggable } from 'fc-react-dnd/use-draggable'              // ✓ also fine
```

Pick whichever reads better — importing from the root costs you nothing. The package is ESM-only
and marked `sideEffects: false`, so your bundler drops everything you don't use.

Internals stay unreachable from either direction — `fc-react-dnd/internal/store` fails at
resolution time, not in review.

## Quickstart

```tsx
import { applySortEnd, DndProvider, SortableList, useSortable } from 'fc-react-dnd'
import { useState } from 'react'

const Row = ({ id }: { id: string }) => {
  const { setNodeRef, handleProps, isDragging, style } = useSortable({ id })

  return (
    <li ref={setNodeRef} {...handleProps} style={{ ...style, opacity: isDragging ? 0.4 : 1 }}>
      {id}
    </li>
  )
}

export const TaskList = () => {
  // Ids straight from state, so this array keeps its identity until the order changes.
  // `readonly` because that is what `applySortEnd` hands back — the same shape `applyTreeDrop` uses.
  const [items, setItems] = useState<readonly string[]>(['write', 'review', 'ship'])

  return (
    <DndProvider>
      <SortableList
        items={items}
        // The array holds the ids themselves, so an item *is* its id.
        onSortEnd={(event) => setItems((current) => applySortEnd(current, event, (id) => id))}
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

### When your state holds objects

Which it usually does. `SortableList` wants ids, so derive them — and derive them **once**:

```tsx
import { applySortEnd, DndProvider, SortableList, useSortable } from 'fc-react-dnd'
import { useMemo, useState } from 'react'

type Task = { id: string; title: string }

const INITIAL_TASKS: readonly Task[] = [
  { id: 'write', title: 'Write the post' },
  { id: 'review', title: 'Review it' },
  { id: 'ship', title: 'Ship it' },
]

const Row = ({ task }: { task: Task }) => {
  const { setNodeRef, handleProps, isDragging, style } = useSortable({ id: task.id })

  return (
    <li ref={setNodeRef} {...handleProps} style={{ ...style, opacity: isDragging ? 0.4 : 1 }}>
      {task.title}
    </li>
  )
}

export const TaskBoard = () => {
  const [tasks, setTasks] = useState<readonly Task[]>(INITIAL_TASKS)

  // The line that matters. Rebuilt only when `tasks` is replaced — which is what makes it a
  // memo, unlike `useMemo(() => tasks, [tasks])`, which hands back the array it was given.
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks])

  return (
    <DndProvider>
      <SortableList
        items={taskIds}
        onSortEnd={(event) =>
          setTasks((current) => applySortEnd(current, event, (task) => task.id))
        }
      >
        <ul>
          {tasks.map((task) => (
            <Row key={task.id} task={task} />
          ))}
        </ul>
      </SortableList>
    </DndProvider>
  )
}
```

`applySortEnd` is the list counterpart of `applyTreeDrop`: pure, and it resolves the landing slot
from `afterId`/`beforeId` **against the array you hand it**, falling back to the captured index
only when both neighbours have gone. Applied inside the updater like this, `current` is whatever
React has queued now — so a sibling removed mid-drag lands your item next to the neighbour you
meant instead of at a stale index. It also returns the *same array reference* when the drop changed
nothing, and React skips a state update that sets the value it already had — so a drop that moves
nothing re-renders nothing, without you checking for it.

Inlining that map — `items={tasks.map((task) => task.id)}` — is the one mistake that costs you
frames. `items` keys the projection memo, so a fresh array every render means the projection is
recomputed **once per row per pointermove** instead of once per move. Nothing errors and no test
goes red; the drag just gets heavy as the list grows.

`useTreeDrop` has no equivalent step — it takes your `TreeItem` objects directly, so the array in
state *is* the one you pass.

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

## Anything that isn't a list

A sortable list is one arrangement of two primitives. `useDraggable` makes an element a source,
`useDroppable` makes one a target, and neither knows anything about ordering — which is what you want for "drag this card onto that bin".

```tsx
import { DndProvider, useDraggable, useDroppable } from 'fc-react-dnd'
import { useState } from 'react'

const BIN_ID = 'bin'

const Card = ({ id, label }: { id: string; label: string }) => {
  // Whatever you put in `data` rides along to every event as `active.data`.
  const { setNodeRef, handleProps, isDragging, style } = useDraggable({ id, data: { label } })

  return (
    <div ref={setNodeRef} {...handleProps} style={{ ...style, opacity: isDragging ? 0.4 : 1 }}>
      {label}
    </div>
  )
}

const Bin = () => {
  const { setNodeRef, isOver } = useDroppable({ id: BIN_ID })

  return (
    <div ref={setNodeRef} style={{ background: isOver ? '#eef' : '#fff' }}>
      Drop here
    </div>
  )
}

export const Desk = () => {
  const [filed, setFiled] = useState<readonly string[]>([])

  return (
    <DndProvider
      onDragEnd={({ active, over }) => {
        if (over?.id === BIN_ID) setFiled((current) => [...current, String(active.data.label)])
      }}
    >
      <Card id="invoice" label="Invoice" />
      <Bin />
      <ul>
        {filed.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </DndProvider>
  )
}
```

`data` is a `Record<string, unknown>` carried unchanged from the draggable or droppable to every
event — it is how you get from an id back to your own object without a lookup table. It is
deliberately not typed further: this library never inspects it, and typing it would mean typing
your domain.

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
import {
  applyTreeDrop,
  DndProvider,
  DragOverlay,
  flattenTree,
  type TreeItem,
  useActiveDrag,
  useDndMonitor,
  useTreeDrop,
} from 'fc-react-dnd'
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

### The two `aria-` attributes on each row

They are what make a **flat list of `<li>`s** read as a tree. Once you write `role="tree"`, the
browser stops inferring structure from your markup — and here there is none to infer anyway: every
row is a sibling in one `<ul>`, so nothing in the DOM says "Onboarding" sits inside "Handbook".
`flattenTree` has already worked out both numbers that do say it:

| Attribute | From | What it tells a screen reader |
| --- | --- | --- |
| `aria-level` | `row.depth + 1` | How deep the row sits. `+1` because ARIA counts levels from 1 and `depth` counts from 0. |
| `aria-posinset` | `row.index + 1` | Which child it is **of its own parent**. `TreeRow.index` is the sibling index, not the row's position on screen — the row 7th from the top can be `aria-posinset={2}`. Also 1-based. |

A screen reader then reads a row as roughly *"Onboarding, level 2, item 1"*. Leave them out and it
falls back to the flattened list — position among every visible row, and no depth at all — which is
a flat list, while a sighted user is looking at a hierarchy.

**If you add collapsing**, rows with children also need `aria-expanded={!collapsedIds.has(row.id)}`
— without it a screen reader cannot tell a leaf from a closed branch, or say that opening one is
possible. The example above has no collapse state, so it has no `aria-expanded`.

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
  nesting into it. Going shallower is the harder direction, and it is the one this library's own
  first implementation got wrong — see below.
- **Dragging left lifts a row out of its parent**, from anywhere in a group. The obvious depth
  clamp — `[next.depth, prev.depth + 1]`, which this library shipped first — makes un-nesting
  nearly unreachable, because every row bounding a gap *inside* a group sits at that group's
  depth or deeper, so the lower bound can never offer a way out. You end up having to shuffle a
  row to the bottom of its parent before you are allowed to lift it. Here, a deliberate leftward
  pull drops the floor to the root: one step left makes the row a sibling of its parent, another
  a sibling of its grandparent. It lands *after* that ancestor's whole subtree, because a row
  cannot sit at the parent's level between that parent's children — coming out of a group is a
  downward move. A drag with no horizontal intent still joins the group it was aimed at.
- **Cycles are unrepresentable.** The dragged node and its whole subtree are removed from the
  rows the maths runs over, so "inside your own child" is never a position the projection can
  produce. There is still a defensive guard in `applyTreeDrop` for a hand-built projection, and
  it returns your original array untouched.
- **Any node can be a parent.** There is no "folder" kind. A document you drop something onto
  gains a `children` array; when its last child leaves, `children: []` stays behind rather than
  vanishing, so an expander rendered off `children !== undefined` doesn't flicker.
- **Structural sharing.** A drop rebuilds a handful of nodes, not the entire tree — see below.
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

### Structural sharing — a drop rebuilds a handful of nodes, not the tree

`applyTreeDrop` hands back a new tree, but **nearly every node in it is the same object you passed
in.** The only ones rebuilt are the two ancestor spines it had to touch: from the root down to
where the row left, and from the root down to where it landed. The moved node keeps its identity,
and so does every subtree on either side of those spines. A drop therefore allocates about
`2 × depth` nodes and copies nothing else — the same handful whether the tree has three nodes or
ten thousand.

A deep clone throws that away. `structuredClone`, a JSON round-trip, or any recursive copy — in your
`onDragEnd`, or anywhere the returned tree passes through — gives you one that is right in every
value and **new in every reference**, so the drop pays to copy every node instead. It looks correct,
which is why it survives review; you notice when the tree grows and drops start to stutter.

Because that broken version is invisible until it isn't, the sharing is pinned by tests rather than
by intention: untouched nodes must come back identical (`toBe`) to the ones passed in, the rebuilt
ancestors must not, the input array is asserted unmutated, and a drop that changes nothing returns
the very array you handed in.

On a very large tree the preserved identity doubles as a render lever. `useTreeDrop` lives in the
parent, so a projection change re-renders the whole visible list — and because untouched nodes keep
their reference, wrapping rows in `memo` lets them bail out of that. You don't reach for it at normal
sizes: a projection changes only when the drop crosses a band or its depth, not on every pointermove,
so re-rendering a screenful of rows that rarely is already cheap — neither demo memoises anything.

### The maths is usable on its own

`fc-react-dnd/tree` is pure: no React, no DOM, no `'use client'`. `flattenTree`,
`projectTreeDrop`, and `applyTreeDrop` run under plain Node, and you can test your own tree logic
against them without rendering anything.

---

## API

Everything below is also exported from the root, `fc-react-dnd`. The subpaths remain the way to
reach a single module without instantiating the rest — see *Importing*.

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
| `fc-react-dnd/list` | `applySortEnd` |
| `fc-react-dnd/sortable-list` | `SortableList`, `SortableListProps`, `SortEndEvent` |
| `fc-react-dnd/use-sortable` | `useSortable`, `UseSortableOptions`, `UseSortableResult`, `SORTABLE_SETTLE_TRANSITION` |
| `fc-react-dnd/tree` | `TreeItem`, `TreeRow`, `FlattenedTree`, `FlattenTreeOptions`, `flattenTree`, `TREE_DROP_MODES`, `TreeDropMode`, `TreeNestPredicate`, `TreeDropProjection`, `TREE_INDICATOR_EDGES`, `TreeIndicatorEdge`, `TreeDropIndicatorType`, `ProjectTreeDropArgs`, `DEFAULT_TREE_INDENT_PX`, `DEFAULT_NEST_BAND_FRACTION`, `projectTreeDrop`, `applyTreeDrop` |
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

### `useDraggable(options)` · `useDroppable(options)`

| Option | Default | |
| --- | --- | --- |
| `id` | | Required. `string \| number` |
| `data` | `{}` | Carried unchanged to every event as `active.data` / `over.data` |
| `disabled` | `false` | Keeps `aria-disabled` and every semantic; loses only activation |
| `trackTransform` | `true` | `useDraggable` only. Off, the source stays put — for overlay-driven drags |
| `activatorProps` | | `useDraggable` only. Your own `onPointerDown`/`onKeyDown`, merged *alongside* the sensors' rather than replacing them |

`useDraggable` returns `{ setNodeRef, handleProps, isDragging, transform, style }`, `useDroppable`
returns `{ setNodeRef, isOver }`.

### `useSortable(options)`

Takes `id`, `data` and `disabled` as above, plus:

| Option | Default | |
| --- | --- | --- |
| `transition` | `SORTABLE_SETTLE_TRANSITION` | The easing a *displaced* row settles with. `null` turns it off |
| `trackTransform` | `true` | Off, the row stays put and a `DragOverlay` carries the motion |

Returns `{ setNodeRef, handleProps, isDragging, isOver, translate, transition, style }`. Must be
called inside a `SortableList`.

### `SortableList`

| Prop | Default | |
| --- | --- | --- |
| `items` | | Required, and **referentially stable** — it keys the projection memo |
| `direction` | `'vertical'` | `'horizontal'` measures and constrains along the x axis instead |
| `id` | auto | Only needed if you want a stable one |
| `onSortEnd` | | `{ activeId, fromIndex, toIndex, afterId, beforeId }`, and only when the order actually changed |

A horizontal list drags and displaces along x. Keyboard depth-stepping is vertical-list shaped
today — ArrowLeft/ArrowRight are the depth step — so a horizontal list's arrow keys are a known
gap, not a supported path.

### `useTreeDrop(options)`

| Option | Default | |
| --- | --- | --- |
| `items` | | Required, and **referentially stable** — it keys the projection memo |
| `collapsedIds` | | Ids whose children are hidden. Collapsed branches are still indexed, so a drop can still resolve against them; only their rows are withheld |
| `indentPx` | `24` | One depth level, in pixels. The single place to say it — the keyboard sensor reads it from here |
| `nestBandFraction` | `0.3` | Share of a nestable row's height given to the *before* and *after* gaps, each. The rest is the "drop inside" band |
| `canNest` | any node can parent | `(candidateParent: TreeRow, active: TreeRow) => boolean`. Must be referentially stable |
| `describeProjection` | | Overrides the live-region text as the projection moves |

Returns `{ projection, getRowProps }`.

`canNest` is the whole "this node refuses children" story — it gates the middle band *and* the
`prev.depth + 1` bound, because one level inside a row is nesting into it:

```tsx
const canNest = useCallback((parent: TreeRow) => parent.id !== 'archive', [])
useTreeDrop({ items, canNest })
```

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

Rows also need `aria-level` and `aria-posinset`, both of which come out of `flattenTree` — see
*The two `aria-` attributes on each row* under the tree example, where they are shown in place and
explained one by one.

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
per pointermove instead of once per move — a green test suite and a dropped frame. Deriving ids
from objects in state is the case this bites; *When your state holds objects*, above, is the whole
pattern.

Two corollaries worth stating, because both look like the rule and are not:

- A value **already stable in state needs no memo**. `useMemo(() => tasks, [tasks])` returns the
  array it was handed, so it is exactly `tasks` — a no-op, not a stabiliser.
- `canNest` is a function, so the same rule applies to it: `useCallback`, or define it at module
  scope where it closes over nothing.

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

`fc-react-dnd/types` · `fc-react-dnd/collision` · `fc-react-dnd/tree` · `fc-react-dnd/list`

You can import tree types and run the tree and list maths in a server component. Everything else
needs a client boundary.

## Scope

Shipped: sortable lists, pointer and keyboard sensors, one collision strategy (`closestCenter`),
a drag overlay, and trees.

Not shipped, on purpose: cross-list and cross-tree moves, additional collision strategies, drop
animations, live row reflow during a tree drag (v0.1's tree mode is indicator-only), and
RTL-aware direction.

## License

MIT © Mihai Marinescu
