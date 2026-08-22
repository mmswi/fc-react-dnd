# How this drag-and-drop library works, traced through one tree

Making a `<div>` draggable is solved everywhere. That is not the hard part.

The hard part is what happens *after you let go*.

Here is a document tree. Keep it in your head — the whole post follows this one tree, and every number below is traced from the real implementation, not invented for the example.

```
Handbook          depth 0
  Onboarding      depth 1
  Engineering     depth 1
    Style guide   depth 2
    On-call       depth 2
Roadmap           depth 0
  Q3              depth 1
Meeting notes     depth 0
```

That indentation isn't decoration — it *is* the data. The tree is an array of nodes, and every node has the same shape: an `id`, and an optional `children` array of more nodes. (Your nodes carry their own fields too — a title, an icon — but the library only ever reads `id` and `children`.)

```ts
type TreeItem = { id: string; children?: TreeItem[] }
```

So the outline above is really this:

```ts
const tree = [
  { id: 'Handbook', children: [
    { id: 'Onboarding' },
    { id: 'Engineering', children: [
      { id: 'Style guide' },
      { id: 'On-call' },
    ] },
  ] },
  { id: 'Roadmap', children: [{ id: 'Q3' }] },
  { id: 'Meeting notes' },
]
```

Every step of indentation on the left is one more `children` array deep on the right. And that is the only address a node ever has: **walk down `children` by index.** `On-call` is `tree[0].children[1].children[1]` — the root's *second* child (`Engineering`), then *its* second child (`On-call`). Read any such path left to right: `item.children[0].children[2].children[1]` means "first child, then its third child, then that one's second child." Each `[index]` picks one sibling inside one parent — so *how many* `children` hops you took is the node's **depth**, and the *last* index you picked is its **index** among its siblings. That depth-vs-index distinction is the one the whole library turns on; keep it in view.

Pick up **Onboarding**. Drag it down. Release it in the gap just under **On-call**.

Where did it go?

There are four honest answers, and they occupy the **same pixels**:

```
    On-call (depth 2)
──────────────  ← you released here
    Roadmap (depth 0)
```

First child of On-call — depth 3.

Next sibling of On-call — depth 2.

Next sibling of Engineering — depth 1.

A new root document — depth 0.

Same gap. Same pixel row. Four different trees afterwards. The only thing separating them is how far *right* your cursor was.

That is the question this library answers. Not "what gesture did you make" but *where does the thing land.*

---

## 1 · The state lives outside React

Start with where the drag state is kept, because everything else follows from it.

It is a plain JavaScript object, in a plain closure. Not `useState`, not context. Its whole shape is four fields:

```ts
type DragStoreState = {
  readonly origin: DragOrigin | null          // who you picked up — stable for the whole drag
  readonly overId: DndId | null               // an id, not an object
  readonly translate: Translate               // the only part that changes as you move
  readonly measuredRects: ReadonlyMap<DndId, Rect>
}
```

Created **once per `<DndProvider>`**, never at module scope. That is not fussiness: a module-level store is shared across requests on a server, and two providers on one page would fight over a single drag. Per-provider is SSR-safe and multi-provider-safe by construction.

React reads this object through `useSyncExternalStore` — the hook that exists precisely for state React does not own.

Now follow one `pointermove` from the browser to the pixel. This is the spine of the whole library:

```
pointermove                          the browser, on the document
↓
sensor turns it into a translate     client code, reads no DOM
↓
store.move(translate)                updates the store's `translate` — a plain object, outside React
↓
collision against CACHED rects       arithmetic — no getBoundingClientRect
↓
a brand-new immutable state object   minted on every move
↓
subscribers are notified             every mounted row gave the store a callback — each is called
↓
each subscriber's selector runs, its result is compared
↓
only the slices that CHANGED reach React
```

Two of those steps do the real work.

**Rects are measured once.** When the drag begins, every droppable's rectangle is read in one batched pass and cached in `measuredRects`. After that, every move is *arithmetic* against the cache — the active rect is `origin.rect + translate`, and collision compares numbers. Nothing calls `getBoundingClientRect` in the move path. Reading layout mid-move — read, write, read, write — is the classic drag-and-drop performance trap; this library reads once and never again, until a scroll or resize marks the cache dirty and the next move re-measures lazily.

**A new state object is minted every move.** The store never mutates `state`; it replaces it wholesale:

```ts
state = {
  origin,
  overId: detectOver(origin, translate, measuredRects),
  translate,
  measuredRects,
}
```

That immutability looks optional but it's actually essential. When I talk below about re-renders, you will find out why.

So the answer to "where does the work run" is: all of it on the client, none of it in React's render loop. React is a *reader* of a store it does not drive.

---

## 2 · Turning a gesture into a position

A flat sortable list has an easy mapping: dropping "on item 3" means item 3 is an element, it has a rectangle, the pointer is inside it. Geometry answers the whole question.

A tree breaks that. As the four answers above showed, several outcomes share the same pixels, told apart by horizontal position — which corresponds to no element's box. So a tree drop is not an element you hit — it is a **position** you compute. Picture the movement first. You pick up **Onboarding** and release it right below Engineering's children — under **On-call**, the last row of Engineering's subtree — but held at **Engineering's own indent**, not pushed deeper:

```
Handbook
  Onboarding            ← picked up
  Engineering
    Style guide
    On-call
  ────────────          ← lands here: below Engineering's subtree, at Engineering's indent
Roadmap
Meeting notes
```

It comes to rest below Engineering's whole subtree, but at the *same level* as Engineering — so Onboarding becomes Engineering's **sibling**, not its child. That movement is exactly this position:

```ts
{
  parentId: 'handbook',                        // depth 1 sits under a depth-0 parent
  index: 2,                                    // Engineering's next sibling — still a Handbook child
  depth: 1,
  mode: 'between',
  afterId: 'engineering', beforeId: null,      // neighbours, by id
  indicator: { rowId: 'on-call', edge: 'below', depth: 1 },   // draw below Engineering's subtree
}
```

That tuple is the thing this library returns and general-purpose libraries do not. It is built in three moves, all **pure functions over plain data** — no React, no DOM, testable under plain Node in milliseconds.

### Move 1 — flatten, and cycles disappear here

You can't do geometry on a nested structure. The rows on screen are a flat list, so the math runs on a flat list. `flattenTree` turns the nested array into one row per visible line, each carrying its depth and its **sibling index**:

```
screen row                                    sibling index
 1 │ Handbook          depth 0   parent null          index 0
 2 │   Onboarding      depth 1   parent handbook      index 0
 3 │   Engineering     depth 1   parent handbook      index 1
 4 │     Style guide   depth 2   parent engineering   index 0
 5 │     On-call       depth 2   parent engineering   index 1
 6 │ Roadmap           depth 0   parent null          index 1
 7 │   Q3              depth 1   parent roadmap       index 0
 8 │ Meeting notes     depth 0   parent null          index 2
```

The number on the left is the **screen row**; `index` on the right is the **sibling index** — and they are not the same. Meeting notes is `index 2` (the root's third child) but screen row **8**. Mixing the two up is a silent off-by-one; a `TreeRow` carries the sibling index, never a row number.

Now the elegant part. Drag **Engineering** onto its own child **Style guide**. That must be impossible — a node cannot become its own grandparent.

The bad implementation is: compute the drop, then check for a cycle, then reject it. Drag all the way there, get refused.

This library does something better. `flattenTree` takes the id you are dragging and **leaves that node and its whole subtree out of the rows**:

```
Handbook          ← dragging Engineering
  Onboarding
                  ← Engineering, Style guide, On-call: not rows at all
Roadmap
  ...
```

Style guide is no longer a row. It can't be aimed at. "Inside your own subtree" is never a position the math can *produce*.

A cycle you cannot express beats a cycle you catch. (There is still a defensive guard in `applyTreeDrop` for a hand-built projection — but the library's own path has never reached it, because the illegal state is unreachable.)

### Move 2 — aim at a row, into or between

Every visible row has a cached rectangle. A row that will accept children is cut into three bands:

```
┌────────────────────────────┐
│  top 30%                   │  → the gap ABOVE this row     (between)
├────────────────────────────┤
│  middle 40%   Engineering  │  → INSIDE this row            (into)
├────────────────────────────┤
│  bottom 30%                │  → the gap BELOW this row     (between)
└────────────────────────────┘
```

That 30 / 40 / 30 split is a tunable option — 0.3 of the row's height to each outer band by default. A row that *refuses* children has no middle — two bands, split down the half. That one choice is `mode`: **into** a node, or **between** two of them.

### Move 3 — choose the depth, and let people un-nest

You are in a gap. Which of the four answers did you mean? Your horizontal offset decides, in indent-sized steps (24 px by default):

```
Style guide (depth 2)
On-call (depth 2)
────┬────────┬────────┬────────┬─────
    │        │        │        └─ depth 3 → first child of On-call
    │        │        └────────── depth 2 → sibling of On-call
    │        └─────────────────── depth 1 → sibling of Engineering
    └──────────────────────────── depth 0 → sibling of Handbook
Roadmap (depth 0)
```

Not every depth is legal in every gap, though — the four answers above are the *most* any gap ever offers, and some gaps allow fewer. To see which, first name the two rows the gap sits between: the one just **above** it is `rowAbove`, the one just **below** it is `rowBelow`. That is the whole definition — the names *are* what they mean.

```
On-call     depth 2    ← rowAbove   (the row just above the gap)
──────────             ← the gap you're hovering in
Roadmap     depth 0    ← rowBelow   (the row just below the gap)
```

The legal depths for a gap form a range, `[minDepth … maxDepth]`, and **both ends are read straight off those two rows:**

```
maxDepth = rowAbove.depth + 1   →   On-call is depth 2, so 2 + 1 = 3   →  deepest:    become On-call's first child
minDepth = rowBelow.depth       →   Roadmap is depth 0, so         0   →  shallowest: sit beside Roadmap
```

- **`maxDepth` (deepest) = `rowAbove.depth + 1`.** The deepest this gap can reach is to make the dragged row the **direct child** of the row above — and a direct child sits exactly one level in, at `rowAbove.depth + 1`. It can't go deeper: `rowAbove.depth + 2` would be a *grandchild*, and a grandchild has to hang off one of `rowAbove`'s own children — but sitting in the gap right below `rowAbove`, there is no child row here to hang off yet. You can only nest **one** level into a row you can actually see, so a row's children always live at its depth + 1 — and that is the deepest this position offers. (To reach a grandchild you'd drop in a gap below one of those children, not below `rowAbove`.)
- **`minDepth` (shallowest) = `rowBelow.depth`.** To land *right here* — immediately before `rowBelow` — you have to be at least as deep as `rowBelow`. Go shallower and you no longer belong beside it: you belong to an outer group, and you'd land *after* its whole subtree, not before it.

So in *this* gap you may drop anywhere from depth 0 to depth 3 — exactly the four answers from the top of the post. And `minDepth` is `0` here only because Roadmap happens to be a root; in a gap where the row below is *nested*, `minDepth` is that row's depth, not `0` — which is where things get interesting.

**That `maxDepth` is the uncontroversial half — every tree implementation clamps it the same way.** It also respects the "will you accept children?" rule: if `rowAbove` refuses children, there is nothing to nest into, so `maxDepth` collapses to `rowAbove`'s own depth (no `+ 1`).

**`minDepth` is the half where this library differs from most implementations, on purpose.** In the On-call gap above, `rowBelow` (Roadmap) is a root, so `minDepth` was 0 — you could drop anywhere, out to a brand-new root. But in a gap where the row below is *nested*, the same rule (`minDepth = rowBelow.depth`) stops you from un-nesting. The next example shows the problem, and why this library does *not* use it.

Say you're dragging **Onboarding**, and you want to lift it out of Handbook to become its own top-level document — depth 0. You hold it near the top and pull left, into the gap between **Handbook** and **Engineering**:

```
Handbook        depth 0     ← rowAbove  (the row above the gap)
─────────────               ← the gap you're pulling into
  Engineering   depth 1     ← rowBelow  (the row below the gap)
    Style guide depth 2
```

Trace that bad `minDepth` for this exact gap:

| | the bad rule | value in this gap |
| --- | --- | --- |
| maxDepth | `rowAbove.depth + 1` | `0 + 1` = **1** (a child of Handbook) |
| minDepth | `rowBelow.depth` | **1** (Engineering's level) |
| legal depths | `[minDepth … maxDepth]` | `[1 … 1]` → **only depth 1** |
| you asked for | your depth `1`, minus one step left | **0**, clamped back up to **1** |

`minDepth` 1, `maxDepth` 1. **The only legal depth is 1** — a child of Handbook. Under this rule you can pull left as hard as you like; the `minDepth` is stuck at 1, depth 0 is never offered, and the 0 you asked for is clamped straight back to 1. Onboarding cannot leave Handbook from this gap.

With that bad `minDepth`, un-nesting works in exactly one place: the very last gap of the group — below On-call, above Roadmap — where `rowBelow` is finally a shallow row (Roadmap at depth 0) and drags the `minDepth` to 0. So you'd have to drag Onboarding all the way to the *bottom* of Handbook first, and only then left. Nobody does that. It feels like the tree is ignoring your hand — which is exactly why this library doesn't stop at that `minDepth`.

**What this library does instead: a deliberate pull to the left drops the `minDepth` all the way to the root.**

```ts
const minDepth = isPullingLeft ? 0 : rowBelow.depth       // ← pulling left ⇒ minDepth drops to 0
const maxDepth = canNest(rowAbove, active) ? rowAbove.depth + 1 : rowAbove.depth
```

(`isPullingLeft` just means your cursor has moved left of where the row started — the same horizontal offset that already picks the depth.)

Back in that Handbook↔Engineering gap, pulling left now gives `[0 … 1]` instead of `[1 … 1]`. One indent-step left takes the requested depth to 0, and Onboarding *does* become a top-level document.

Where does it land? Not floating between Handbook's children — a row can't sit at root level in the *middle* of Handbook's subtree. It lands **after Handbook's whole subtree**, as the next root item. Pulling left slides the row down and out. Coming out of a group is a downward move.

And the asymmetry — `minDepth` 0 only when pulling left — is the whole design, not a hack. If the `minDepth` were *always* 0, you could never drop anything *into* a group: a row dragged in from elsewhere already asks for depth 0, so an always-0 `minDepth` would grant it and drop the row *past* the group instead of inside it. The leftward pull is the one signal that tells "put this inside" apart from "take this out."

The keyboard reuses all of it — ArrowLeft/ArrowRight produce the same horizontal `translate` a pointer does, so the same clamp runs. Nothing downstream can tell which sensor drove the drag.

### Applying the drop shares structure

`applyTreeDrop` returns a new tree, but **nearly every node in it is the same object you passed in**. Only two ancestor spines are rebuilt — root-to-where-it-left, root-to-where-it-landed. Everything else keeps its identity. A drop allocates about `2 × depth` nodes whether the tree has three nodes or ten thousand.

The bad version here is a deep clone — `structuredClone`, a JSON round-trip, any recursive copy. It is correct in every value and *new in every reference*, so a drop rebuilds the entire tree and every memoised row re-renders. It looks fine in review and stutters when the tree grows. The sharing is pinned by tests that assert untouched nodes come back `===` identical.

### Where the general libraries stop

To be fair and precise: the ecosystem does **not** ignore trees. Atlassian's Pragmatic drag-and-drop ships a real tree hitbox with five instructions — `reorder-above`, `reorder-below`, `make-child`, `reparent`, `instruction-blocked`. It knows about nesting bands and indentation.

But it stops at the **gesture relative to one row**. The function you call for it, `attachInstruction`, runs on a single row's drop data: it looks at where the pointer sits *inside that one row* and tags it with one of those instructions (`make-child`, `reorder-above`, …). It can't hand back the parent id, the index, or a depth clamped against the neighbours, because it never sees the neighbours — the real position depends on three rows (`rowAbove`, `rowBelow`, and the one in your hand), and a hitbox scoped to a single element sees only that element. That boundary is where **every** general-purpose React DnD library stops: it gives you the gesture, and turning the gesture into a position is left to you, every time. This library is that step.

---

## 3 · Fewer re-renders than dnd-kit, and the map that makes it possible

Now the performance claim, measured.

React `<Profiler>` around **each row**, in Chrome, on a page that renders the same 24-item list twice — once with each library, identical counters. The drag itself is scripted, not done by hand: the pointer events are created in code — a `pointerdown`, 40 `pointermove`s along a fixed path, a `pointerup` — and the *identical* sequence is dispatched to each list in turn. A hand cannot repeat a drag pixel-for-pixel; a script can, which is what makes the two sides comparable and the runs repeatable. The path drags item 1 down onto item 4: **154 px, 3 boundary crossings, 40 pointer moves.** Three runs, identical each time.

| During the drag — the 40 moves before you let go | Rows that re-rendered | Total commits |
| --- | --- | --- |
| **fc-react-dnd** | **4** of 24 | **9** |
| dnd-kit 6.3.1 / sortable 10.0.0 | **24** of 24 | **96** |

Four is the row in your hand plus the three it displaces. dnd-kit re-renders every row in the list on every change.

Then you let go — and the full list re-renders in both libraries, because the drop is your own state update: it fires `onSortEnd`, your `setState` replaces the array, and a list whose data just changed re-renders. That is why every row's counter ends at 1 or more even on the fc-react-dnd side. The drop was measured too, and the two sides are not equal even here:

| On the drop — your own reorder `setState` | Rows that re-rendered | Total commits |
| --- | --- | --- |
| fc-react-dnd | 24 of 24 | 24 — one per row |
| dnd-kit | 24 of 24 | 48 — two per row |

Counting *rows that re-rendered* is the measure that matters, because it is the architecture made visible: when the drag state changes, how many rows have to find out about it? Here, four. That is the whole claim, and the rest of this section is why it is four and not twenty-four.

### Why context re-renders everything

This is not a knock on dnd-kit — it is a property of React.

Put drag state in context, and **every consumer re-renders when the value changes.** There is no "subscribe to just the slice I care about." `memo` does not help; context propagation goes straight through it. So when you cross a boundary and the "who is over what" value changes, every row that reads the context re-renders — and each then works out, inside its own render, whether *it* moved. Most find out they did not, after they already rendered.

`useSyncExternalStore` is the escape — and since this post says "subscribe" and "subscriber" constantly, follow **one row** through the act, because it is concrete enough to show in full.

Row `item-7` renders and calls `useSortable({ id: 'item-7', … })`. Inside, that hook calls `useSyncExternalStore(store.subscribe, getSnapshot)` — and here is the entire `store.subscribe`, not an excerpt:

```ts
const listeners = new Set<() => void>()
// ...
subscribe: (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
```

That is the entire act of subscribing. The store keeps a `Set` of callback functions; item-7's render adds one — a callback React itself hands in, whose meaning is "something may have changed, re-check your snapshot." The returned function removes it again, and React calls that when the row unmounts. Everywhere this post says **"a subscribed row," it means exactly this: a row whose callback is currently in that `Set`.** Twenty-four rows mounted = twenty-four callbacks in the set.

Notifying is just as plain. After minting the new state, the store loops the set:

```ts
for (const listener of [...listeners]) listener()
```

Each call sends React back to that row's **selector** — the second half of a subscription: a function from the whole store state to the small piece this row cares about, its **slice**. item-7's selector ignores almost everything and answers one question — *is a drag active, and how far am I displaced?*

```ts
;(state) => {
  if (state.origin === null) return NO_DRAG_SLICE   // no drag → one shared idle object
  // the dragged row follows the pointer; every other row reads its own
  // shift out of the projection
  return { translate: /* my shift */, isDragActive: true }
}
```

React runs the selector, compares the fresh slice with the previous one, and — this is the guarantee — **if the slice is unchanged, nothing happens.** No lane, no scheduling, no render. The comparison happens *before* React is involved. The whole mechanism is this:

```ts
const next = select(state)
if (cached && areEqual(cached.slice, next)) {
  cache.current = { state, slice: cached.slice, select }
  return cached.slice        // ← the SAME reference, on purpose
}
```

Returning the same reference is what makes React schedule nothing. (It is also *correctness*, not just speed: a selector that built a fresh object every call would look changed every time, React would call it again, and you'd have an infinite loop — exactly what React's DEV "getSnapshot should be cached" warning detects.)

### The cost you can't avoid, and the map that keeps it cheap

First, name the thing being computed. On every move, something has to answer: *if you dropped right now, where would the dragged item land, and how far does every other row shift to make room?* Section 2 built exactly that answer for the tree — the position tuple with `parentId`, `index`, `depth`, and the indicator. The sortable list has its own version of the same answer: which rows translate up or down, and by how much. That per-move answer is called the **projection** — it projects what the drop *would* produce while you are still dragging, and it is what the indicator line and the sliding rows are drawn from. (The types are literally named for it: `TreeDropProjection`, `ListProjection`.)

**The goal: compute that projection once per move, no matter how many rows are listening.**

The previous subsection got the *renders* down to the four rows that move. What it cannot reduce is the *selector calls*: to decide that a row's slice did not change, React has to run that row's selector and compare — the comparison that prevents the render requires the call. So every subscriber's selector runs on **every** store notification. Twenty-four subscribed rows × 40 moves in the measured drag is 960 selector calls, almost all of which conclude "nothing changed, render nothing."

960 calls is fine while each one is a cheap read. But the projection is not cheap to *compute*: it reads every row's cached rect, sorts them along the axis, and builds the per-row shifts. That is O(N) work. If all 24 selectors computed it themselves, every move would repeat that work 24 times. So the projection must be computed **once**, stored where every selector can reach it, and the other 23 calls must *read* it instead of recompute it.

The storage for that is one module-level cache, the same shape in both projection files:

```ts
const projectionCache = new WeakMap<DragStoreState, WeakMap<object, CacheEntry>>()
```

Two WeakMaps, one inside the other. Build it up from what it has to do.

**How a selector knows "this move already has a projection": the state object's identity.** Section 1 set this up — the store never mutates its state; every move mints a brand-new `DragStoreState` object. So the object's identity works as a version number for the drag. Two selector calls that receive the *same* state object are on the same move, and the projection cannot differ between them. A call that receives a *new* object is on a new move, and every older projection is stale. That turns "once per move" into something checkable: **cache the projection under the state object itself.** The first reader of a given state object computes and stores; every later reader of that same object finds the entry and returns it; the next move brings a new object, whose lookup misses, so it computes exactly once. (This is also what keeps two `<DndProvider>`s on one page from colliding in the shared cache: each provider has its own store, so their state objects are never the same object, and their entries never overwrite each other.)

**What a WeakMap is, and why a plain `Map` would leak.** The cache lives at module level for the life of the app, and its keys are state objects the store replaces at a rate of one per move — a few seconds of dragging at pointer frequency makes hundreds. In a plain `Map`, an entry keeps its key alive: long after the store has replaced a state object and nothing else in the program references it, the `Map` still would, holding the dead object and its projection until someone writes eviction code and picks a moment to run it. Nothing here ever would — the cache would only grow.

A `WeakMap` is a key→value map with one different rule: **it does not keep its keys alive.** When the only remaining reference to a key object is the WeakMap itself, the garbage collector is allowed to collect that object — and the entry, key and stored value together, disappears from the map with it. Applied here: the moment the store replaces `state`, the old state object's last reference is the cache, the collector reclaims it, and its projection goes too. Entries expire exactly when their move stops existing, with no eviction code anywhere. That is the entire reason this is a WeakMap and not a Map. The restriction that comes with it — a WeakMap cannot be iterated or counted, only asked "what is stored under this exact object?" — costs nothing here, because that lookup is the only operation this cache performs.

**Why two of them, nested.** One WeakMap keyed by state would be enough if each move had exactly one projection. It does not, because one provider can hold several lists: two `<SortableList>`s under the same `<DndProvider>` share one store, so on any given move they read the *same* state object — while each needs its *own* projection, computed from its own rows. Keyed by state alone, whichever list computed first would win, and the second list's lookup would return the first list's projection.

So under each state object the cache holds another map, one entry per list, keyed by the thing that identifies a list: the `itemIds` array the consumer passed in (the tree projection keys by its `items` array the same way) — each list has its own array, and its reference is stable across a move. The two keys split the two questions:

```
outer key: the state object       → which move is this?
inner key: the itemIds array      → which list is asking?
```

The inner map is a WeakMap for the same reason as the outer one: unmount a list and its array becomes unreachable, so its entries are collected instead of accumulating. And the inner key covers one more case — when the rows themselves change mid-drag (a tree auto-expanding under the cursor mounts new rows), the consumer passes a new array, so the changed list gets a fresh entry instead of a stale projection even while the state object is momentarily the same.

The read is a two-level lookup with one real computation on a miss:

```ts
let byList = projectionCache.get(state)          // this move's bucket
if (!byList) { byList = new WeakMap(); projectionCache.set(state, byList) }

const cached = byList.get(args.itemIds)          // this list's entry
if (cached && cached.direction === args.direction) return cached.projection  // O(1) hit

const projection = computeProjection(state, args)   // the one real computation
byList.set(args.itemIds, { direction: args.direction, projection })
return projection
```

Now — and this is the part I got wrong at first, so it is worth stating carefully — **the payoff is different on the two paths, and they should not be confused.**

On the **sortable list**, each of the 24 rows has its own `useSortable`, and each calls `projectList(state, …)`. On one move, the *first* row to run computes the projection; the other 23 get an O(1) WeakMap hit off the same `state`. One computation, twenty-three cheap reads.

On the **tree**, `useTreeDrop` subscribes **once, in the parent** — tree rows are measure-only and never subscribe to a projection slice. So there is only one projection reader. But React reads a snapshot several times per move — the notify-time compare, the render read afterward (with a *fresh* selector closure each render), plus React's own tearing and DEV re-reads — and without the map, each would re-walk `flattenTree` + `projectTreeDrop`. The map collapses them all to one compute per move.

Different mechanism, same rule:

> The projection is computed **once per store-state version** — no matter how many rows read it, or how many times React asks.

Get that wrong — put the computation *inside* the selector — and the render counts still look perfect while the move path quietly goes O(N²) and the frame is gone. That is why this is the architecture's binding constraint, not a tuning detail.

---

## 4 · The limits

Honesty about the edges.

**v0.1 ships one collision strategy** (`closestCenter`), no cross-list moves, no cross-tree moves, and no drop animation. The tree is **indicator-only** — rows do not reflow live during a tree drag; one indicator line moves. Deliberate scope cuts, not oversights.

**It targets React 19+.** That is the only version tested, so it is the only version claimed.

**Very large trees have a ceiling.** The selector floor scales with row count — every subscriber's selector runs on every notification whether or not it renders — so past the low tens of thousands of rows the honest answer is virtualization, which is genuinely harder because rects exist only for mounted rows.

And the plain trade: if your list is flat and small, a library that re-renders every row on every move feels identical to this one. This architecture makes a measurable difference only when the list is long, or the structure is a tree, or both.

---

The store holds the truth, outside React.

The pure tree math turns a gesture into a position.

The map computes that position once, so React barely notices the drag at all.
