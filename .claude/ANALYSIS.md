# ANALYSIS — fc-react-dnd

Working notes: problem definitions, brainstorming, and research. `.claude/TASKS.md` says
**what** we're building; this file says **why**, and how well-established each reason is.

The scope in [T0.5](tasks/T0.5-scope-lock.md) and the flagship framing in `CLAUDE.md` were
set in an earlier session without the user weighing in. This document exists to *test*
those premises rather than inherit them. If an analysis here undermines a locked decision,
that is a finding — reopen the decision, don't bury it.

## How to use this file

- One numbered entry per question or problem (`A1`, `A2`, …), so tasks and the blog post
  can cite a specific piece of reasoning.
- **Every factual claim about the outside world carries a confidence tag.** This matters
  more than it looks: the first entry below was written from a model's recall, and recall
  about a fast-moving ecosystem is a hypothesis, not evidence.
  - `[verified]` — checked against a primary source *in this repo's history*, with the
    source named. Docs, source code, or a run we performed.
  - `[unverified]` — plausible, from recall or inference. **Never cite one of these in the
    README or the blog post.** Promote it or drop it.
  - `[open]` — a question we haven't answered.
- Structural/logical arguments don't need tags — they stand on their own reasoning. Only
  claims about what other software actually does need evidence.
- When an `[unverified]` claim gets checked, edit it in place to `[verified]` with the
  source and date. Don't append a correction elsewhere; one claim, one place.

---

## A1 — Why tree drag-and-drop is the hard case

*Written 2026-08-07. The argument here is structural and stands on its own reasoning; the
ecosystem claims it implies were checked separately and are now verified — see A2. The
performance consequences are worked out in A4.*

### The core problem: the drop target isn't an element

Every general-purpose DnD library rests on one abstraction: **droppables are DOM elements,
and collision detection finds the element under the pointer.** It's a genuinely good
abstraction — it covers flat sortable lists, kanban columns, upload zones, and trash cans
with a tiny API.

In a flat list the mapping is 1:1. Dropping "on item 3" means item 3 is an element, it has
a rect, the pointer is inside it. Geometry answers the question completely.

In a tree, the outcome is not an element. It is a tuple — `(parentId, index, depth)` — and
**several distinct outcomes occupy identical pixels**:

```
├── Documents
│   └── Projects
│       └── notes.md
│                      ← sibling of notes.md   (parent: Projects, depth 3)
│                      ← last child of Projects (parent: Projects, depth 3)
│                      ← sibling of Projects    (parent: Documents, depth 2)
│                      ← sibling of Documents   (parent: root,      depth 1)
└── Downloads
```

Same y-coordinate, same gap, four outcomes — disambiguated by **horizontal** pointer
position, which corresponds to no element's bounding box.

So "which rect is under the pointer?" is structurally the wrong question. Collision
detection returns an element; the tree needs a tuple the element cannot supply. **This is
the root cause. Everything below follows from it.**

### The consequences

Numbered so tasks and the blog post can cite them.

1. **Depth is a projection, not a hit test.** Pointer X divided by indent width gives a
   candidate depth, then it's clamped to `[next.depth, prev.depth + 1]`. The clamp is
   non-obvious in both directions: deeper than `prev.depth + 1` makes the node a child of
   something that isn't there (a skipped level); shallower than `next.depth` silently
   **reparents the rows below you** — a change the user never asked for. First attempts
   usually get one end wrong, and the bug is subtle enough to ship.

2. **Two semantics compete for one gesture.** A row's height partitions into bands: top
   edge = insert before, middle = become a child, bottom edge = insert after. Flat lists
   have one semantic, so there is nothing to partition and no band-size tuning parameter.

3. **"Into" isn't always legal.** A leaf may refuse children; a file can't contain a file;
   a collapsed node may want to auto-expand on hover. That needs a `canNest` predicate
   threaded into the geometry, not checked afterwards.

4. **The candidate set depends on what you picked up.** Grab a folder and its descendants
   must vanish from the drop candidates — you cannot drop a node inside its own subtree
   without creating a cycle. In a flat list, the droppable set is constant for the entire
   drag. In a tree it is a *function of the drag origin*.

5. **That collides with the standard performance optimization.** Fast DnD libraries cache
   droppable rects once at drag start. In a tree, drag start collapses the dragged subtree,
   shifting every rect below it — so the cache is stale the moment it's written.
   Auto-expand-on-hover invalidates it again mid-drag. Flat lists never do this.

6. **Cycle prevention has a right and a wrong shape.** Validating on drop and rejecting is
   bad UX — the user drags all the way there and is refused. The right shape excludes the
   subtree from candidates at flatten time, so the illegal drop is never offered. That
   requires understanding tree structure, which is exactly what a general DnD library
   declines to know.

7. **Keyboard needs two axes.** Flat-list keyboard DnD is 1D: up/down moves position. A
   tree needs up/down for position *and* left/right for depth, and left/right must route
   through the same projection and clamp as pointer X — otherwise there are two
   implementations of the same rules, and they drift.

### Why the general libraries haven't absorbed this

Three reasons, none of them laziness:

- **The abstraction that makes flat DnD easy is what makes tree DnD impossible.** You
  cannot get from "droppables are elements" to "the target is a computed tuple depending on
  tree structure, both pointer axes, and the drag origin" by adding a prop. It's a
  different core model, and retrofitting means a second collision pathway beside the first.

- **Tree math needs the data model; these libraries deliberately don't have it.** Depth
  clamping requires knowing which rows are siblings, which is parent of which, and what's
  collapsed. Shipping trees first-class means either accepting a tree shape as input —
  coupling the library to a data structure — or exposing enough primitives that consumers
  reimplement the math themselves.

- **Shipping an example instead of an API is a deliberate hedge.** It demonstrates the hard
  case without committing to an API surface to support for a decade. The cost transfers to
  consumers: copy several hundred lines of subtle projection math into your app and own its
  bugs forever.

There is also a plain incentive story: flat sortable lists are overwhelmingly the common
case. Trees — file explorers, nav builders, outliners, org charts — are valuable but a
minority.

### What this implies for the project

The structural argument above is the real foundation, and it holds regardless of what any
competitor ships: **the tree case needs a different core model, and the right place for
that model is a pure, data-only module** with no DOM and no React. That is precisely the
shape [T8.1](tasks/T8.1-tree-math.md) specifies (`flattenTree` / `projectTreeDrop` /
`applyTreeDrop` as pure functions), with [T8.2](tasks/T8.2-use-tree-drop.md) as a thin
binding that contains no tree logic of its own.

Consequence 5 is worth calling out separately: it means the rect-cache design in
[T3.1](tasks/T3.1-store.md) and the tree are in tension by construction. The dirty-flag
re-measure path isn't a nicety for scroll handling — it is what makes trees work at all.
Whoever builds T3.1 should know that before designing the cache.

---

## A2 — Is "the ecosystem punts on the tree case" actually true?

*Researched 2026-08-07 against primary sources.*

> **Verdict: the claim as originally written is false and must not be published.**
> Atlassian ships genuine, first-class tree drag-and-drop primitives. The underlying gap is
> real, but it sits somewhere far more specific — and the precise version is a better
> thesis than the vague one it replaces.

### Findings

**`[verified]` Pragmatic drag and drop ships real tree instructions — this is a direct
counterexample to the original framing.**
Source: [`packages/hitbox/src/tree-item.ts`](https://raw.githubusercontent.com/atlassian/pragmatic-drag-and-drop/main/packages/hitbox/src/tree-item.ts),
read 2026-08-07. `@atlaskit/pragmatic-drag-and-drop-hitbox` exports
`attachInstruction` / `extractInstruction` over five variants:

```ts
| { type: 'reorder-above';  currentLevel: number; indentPerLevel: number }
| { type: 'reorder-below';  currentLevel: number; indentPerLevel: number }
| { type: 'make-child';     currentLevel: number; indentPerLevel: number }
| { type: 'reparent';       currentLevel: number; indentPerLevel: number; desiredLevel: number }
| { type: 'instruction-blocked'; desired: Exclude<Instruction, { type: 'instruction-blocked' }> }
```

That covers A1.2 (band partitioning into reorder/child zones) and A1.3 (`instruction-blocked`
for illegal nesting) outright, and part of A1.1 — `reparent` carries a `desiredLevel`
derived from horizontal position via `indentPerLevel`.

**`[verified]` But it stops before the outcome.** Same source: `attachInstruction` does
**not** compute a target parent id, does **not** compute an index, and does **not** clamp
depth against neighbouring rows. It reports a gesture relative to one row and leaves the
tree mutation to the caller.

**`[verified]` dnd-kit has no tree package in either generation.**
- Classic: `@dnd-kit/core` 6.3.1. The tree lives at
  [`stories/3 - Examples/Tree/SortableTree.tsx`](https://github.com/clauderic/dnd-kit/blob/master/stories/3%20-%20Examples/Tree/SortableTree.tsx)
  — a Storybook example, not a published package.
- Rewrite: `@dnd-kit/abstract`, `dom`, `react`, `solid`, `svelte`, `vue`, `collision`,
  `geometry`, `helpers`, `state` — **all at 0.5.0, still pre-1.0** (npm registry, checked
  2026-08-07). No tree package. A keyword sweep of all six core packages' registry metadata
  for `tree` / `nested` / `hierarch` returned **zero hits**, and [dndkit.com](https://dndkit.com/)
  documents only Manager / Draggable / Droppable / Sortable.
- The third-party [`dnd-kit-sortable-tree`](https://github.com/Shaddix/dnd-kit-sortable-tree)
  exists and describes itself as "based on an example from dnd-kit" — the copy-paste
  pathway, packaged by someone else.

**`[verified]` react-beautiful-dnd is archived** — 18 August 2025, read-only, deprecated on
npm, README directs users to Pragmatic
([repo](https://github.com/atlassian/react-beautiful-dnd)). It did support nested lists via
`@atlaskit/tree`, with documented limitations on **cross-level** dragging — the hard part
was the restricted part.

### The corrected claim

> **Every general-purpose React DnD library stops at the same boundary: they report what
> gesture the user made relative to *one row*. None computes the resulting *position* —
> `(parentId, index, depth)`, clamped against both neighbours, with the active subtree
> excluded so a cycle cannot be expressed. That final step is the consumer's, every time.**

This is narrower, verifiable, and stronger than "nobody does trees."

**And there's a structural reason, which is the real insight.** `attachInstruction` is
attached per drop target, inside a single row's data. It therefore *cannot see the rows
above and below* — and the clamp in A1.1 requires both. This is not an oversight; it is
A1's root cause resurfacing one level up. Once "droppables are elements," the hitbox is
scoped to an element, and a constraint spanning three rows has nowhere to live. Pragmatic
went as far as that model allows and stopped exactly where it runs out.

That is the sentence [T10.5](tasks/T10.5-blog-post.md) should be built around.

### Re-verified 2026-08-08, before writing T10.5

Same primary source, re-read: the `Instruction` union is unchanged across all five variants,
`attachInstruction` still receives **one element's data**, and it still computes neither a
parent id nor an index. One refinement worth carrying into the post: it does clamp — but only
against the row **above** the gap, via that row's own `currentLevel`. Which is the structural
argument arriving from the other direction. A hitbox attached to one element knows its own
level and cannot know the next row's, so a bound that needs both neighbours is not something
the model declined to compute; it is something the model cannot express.

### Consequences

- **The scope survives, with sharper framing.** The differentiator is not "we do trees" —
  it is that `projectTreeDrop` returns the clamped `(parentId, index, depth)` tuple, and
  `flattenTree` excludes the active subtree so cycles are unrepresentable rather than
  rejected. Nobody else crosses that line.
- **`CLAUDE.md` and [T0.5](tasks/T0.5-scope-lock.md) were corrected** to the claim above.
  The phrase "the ecosystem punts on the tree case" is retired.
- **Comparison baseline for [T9.5](tasks/T9.5-playground-app.md):** dnd-kit classic
  (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable`) is right for the *sortable* render-count
  comparison — it's what people actually ship. The rewrite at 0.5.0 is pre-1.0 and would be
  an unfair and unstable target. For the *tree* case the honest comparison is Pragmatic's
  hitbox, since it is the only real competitor at that boundary.
- `[open]` Should the playground add a third tree panel comparing against Pragmatic's
  `attachInstruction`? It would make the boundary argument visible rather than asserted —
  but it adds an `@atlaskit/*` dependency to `playground/` and is not currently in any task.

### Still unchecked

- `[open]` Do the tree-specific libraries (react-arborist, react-complex-tree) compute the
  full clamped tuple? If one of them does, the claim needs narrowing again — to
  general-purpose DnD libraries specifically, which is how it is currently worded.
- `[open]` Does Pragmatic's `reparent` clamp `desiredLevel` to a legal range internally, or
  is it raw pointer-derived? The type signature suggests the latter, and the per-row
  architecture makes a neighbour-aware clamp impossible — but this was inferred from the
  type, not read from the implementation body.

---

## A3 — Do React's internals actually support the performance invariants?

*Checked 2026-08-07 against the `react-internals` skill, which is traced to **React 19.2.8**
(commit `1dd4ecb`). Citations are `path:line` into the React **source**, not `node_modules`
(which holds built output where line numbers won't match).*

> **Version caveat** *(updated 2026-08-08 — § A8 made React 19 the only target, which
> simplifies this)*: these citations are 19.2.8, and 19.x is now the tested line, so they
> cite the target's own source. File and symbol names survive across 19.2.x; **line numbers
> survive nothing** — on another 19.x patch, grep the symbol rather than trusting the line.
> The original both-18-and-19 assertion-run recommendation is dropped: render counts are
> measured on 19 only, and no 18 behaviour may be claimed anywhere ([T9.1](tasks/T9.1-integration-pointer-flow.md), [T10.5](tasks/T10.5-blog-post.md)).

### A3.1 — An unchanged slice never enters React at all

`[verified]` There are **two independent gates**, and the earlier version of this entry
missed the first one and drew the wrong conclusion from the second. Both are now checked.

**Gate 1 — the subscribe path, which is the one that matters here.** `subscribeToStore`
(`ReactFiberHooks.js:1859-1875`) wraps the callback handed to the store's `subscribe`:

```js
const handleStoreChange = () => {
  if (checkIfSnapshotChanged(inst)) {
    startUpdateTimerByLane(SyncLane, 'updateSyncExternalStore()', fiber);
    forceStoreRerender(fiber);
  }
};
```

`checkIfSnapshotChanged` (`:1877-1886`) is `!is(prevValue, nextValue)`. If the snapshot is
unchanged, **nothing happens at all** — `forceStoreRerender` (`:1888-1893`) is where
`enqueueConcurrentRenderForLane` and `scheduleUpdateOnFiber` live, and it is never reached.
No lane, no root scheduling, no render, no bailout.

The skill is emphatic that this is **a guarantee, not an optimization that might not fire**,
and categorically stronger than the eager-state bailout (Q48/Q49), where an update *is*
enqueued and a render may still occur. **Perf invariant 4 can be relied on.**

**Gate 2 — the late bailout, which applies to a different scenario.** `useSyncExternalStore`
is one of only nine sites that set `didReceiveUpdate = true`, gated on the same compare
(`ReactFiberHooks.js:1764`). When a component renders **for some other reason** — its parent
re-rendered, or a context it reads changed — and its snapshot happens to be unchanged,
`updateFunctionComponent` (`ReactFiberBeginWork.js:1519-1522`) has already run the body and
then discards the output.

**Correction to what this file previously said.** It claimed body-level render counters would
tick on store notifications with unchanged slices, and called that the most likely way to
write a failing test. That was wrong: gate 1 means the body never runs for that path, so a
body counter is accurate for exactly the granularity tests P4/P7/P8 specify (T4.2's
"not once per pointermove", T7.4's boundary crossings, T8.2's projection changes) — those are
all store-notification-driven.

The late bailout is still real, but it only appears when a **parent** re-renders — a consumer
app re-rendering the list around us. Counting commits rather than body executions remains the
more robust choice because it is unambiguous under both gates, but it is a robustness
preference, not a correction of a broken test.

### A3.2 — `getSnapshot` runs on every notification. That is the real cost.

`[verified]` This is the thing to actually design against, and it is the inverse of the
re-render story: **the re-render is avoidable; the `getSnapshot` call is not.** Reaching the
"nothing changed" conclusion in gate 1 *requires calling it*, so it runs on **every store
notification, for every subscriber, regardless of outcome** (skill Q58 gotcha 5).

Three further call sites stack on top:

- **The tearing consistency check re-invokes it** during render
  (`ReactFiberWorkLoop.js:1617-1670`, `:1640`).
- **The passive phase checks a second time** — `updateStoreInstance`
  (`ReactFiberHooks.js:1837-1857`) — because the store can be mutated between render and
  commit. Its comment, typo included: *"we would have used the old snapsho and getSnapshot
  values to bail out. We need to check one more time."*
- **DEV calls it twice on mount** to detect an uncached snapshot (`:1664-1674`).

**Quantify it for this library.** A pointermove notifies the store once; every subscribed
`useDraggable` / `useDroppable` / `useSortable` runs its `getSnapshot`. With 50 sortable rows
at 120 Hz that is ~6,000 selector invocations per second **in the steady state where nothing
re-renders**. If each one recomputes a list projection, the cost is O(N²) per move and the
"no re-renders" headline is worthless — the frame is already gone.

So perf invariant 9 is not an elegance choice and not merely load-bearing for correctness: it
is *the* performance constraint of the architecture. Every selector must be an O(1) read off a
projection memoized once per store-state version, and must return a **cached reference** —
an uncached one is an infinite loop, which is precisely what the DEV warning detects.

### A3.2b — Three consequences of `checkIfSnapshotChanged` worth designing around

`[verified]`, all from `ReactFiberHooks.js`:

1. **A throwing `getSnapshot` returns `true`** (`:1883-1884`) — it forces a re-render rather
   than propagating out of the store's notification. Deliberate: the error then surfaces
   *during render*, where an error boundary can catch it. **Design consequence:** a selector
   that throws will not corrupt or halt the store's notify loop, so the store does not need
   defensive try/catch around subscriber callbacks for this case.
2. **It reads `inst.getSnapshot`, the latest one** (`:1878`), not the one captured when the
   subscription was created. **Design consequence:** a component may change its selector
   between renders and the comparison stays correct — relevant to
   [T3.2](tasks/T3.2-use-store-selector.md)'s generic-selector API.
3. **`forceStoreRerender` always uses `SyncLane`** (`:1889`). External store updates **never
   receive transition priority**. **Design consequence:** drag updates cannot be deprioritized
   with `startTransition`, and should not be documented as if they could. It also means the
   store never itself creates the concurrent-render condition in A3.3.

### A3.3 — Tearing recovery costs a full synchronous re-render of the tree

`[verified]` When a store is mutated during a concurrent render, the recovery is not a merge
— it is a complete do-over:

```js
if (renderWasConcurrent && !isRenderConsistentWithExternalStores(finishedWork)) {
  // A store was mutated in an interleaved event. Render again,
  // synchronously, to block further mutations.
  exitStatus = renderRootSync(root, lanes, false);
```
`packages/react-reconciler/src/ReactFiberWorkLoop.js:1151-1173`

**This is a hazard specific to what this library does.** The whole design mutates an
external store on every pointermove — potentially at 120 Hz — which is precisely the
"mutated in an interleaved event" case.

**But the exposure is narrower than it first looks**, and A3.2b.3 is why. Store updates
always schedule on `SyncLane` (`ReactFiberHooks.js:1889`), and the consistency check is
**skipped for blocking lanes** (`:1691`) with the recovery gated on `if (renderWasConcurrent)`
(`ReactFiberWorkLoop.js:1152`). So the store can never create the condition that traps it —
a drag's own renders are sync and cannot be interleaved with. The residual exposure is a
concurrent render already in flight **from elsewhere in the consuming app** (a
`startTransition`, a `useDeferredValue`) when a pointermove lands. That is a real scenario in
a real app, and entirely outside this library's control.

`[open]` Worth an explicit test in [T3.1](tasks/T3.1-store.md) or
[T9.3](tasks/T9.3-edge-cases.md): drive a drag while a `startTransition` render is in flight
and confirm the result is correct (it will be — React guarantees it) and measure what it
costs. This is a genuinely interesting paragraph for [T10.5](tasks/T10.5-blog-post.md), and
nobody writing about DnD performance covers it.

### A3.4 — StrictMode: effects double-invoke, state does not

`[verified]` Measured in the skill's own repro: **2 setups, 1 cleanup** — setup → cleanup →
setup (`ReactFiberCommitWork.js:5194-5260`, DEV only).

**But the fiber is not recreated.** Instance ids are unchanged across the cycle
(`#1 → UNMOUNT #1 → MOUNT #1`), versus a genuine remount (`#2 → #4`). So **`useState` and
`useRef` are not reset — only effects re-run.**

**Consequence for the store-per-provider design** ([T4.1](tasks/T4.1-dnd-provider.md)):
creating the store in a `useState` initialiser or a ref is StrictMode-safe — there will not
be two stores. The exposure is entirely in the **effects**: registration, subscription, and
listener attachment must be idempotent and must clean up completely. That is what perf
invariant 8 already says, and it is confirmed rather than changed.

`[verified]` And the reason it is not merely a DEV nicety: **every double-invoke behaviour
has a production analogue.** Effect setup → cleanup → setup happens in production via
`<Activity>` hide/reveal, Suspense fallback/reveal, and key changes. Turning StrictMode off
"removes the detector," not the hazard.

### A3.5 — Context stability is load-bearing, and `memo` cannot rescue it

`[verified]` Context comparison is `Object.is` per consumer
(`checkIfContextChanged`, `ReactFiberNewContext.js:465-486`). On a change,
`propagateContextChanges` sets `lanes` **directly on each consumer fiber** and walks up
setting `childLanes` (`ReactFiberNewContext.js:245-254`) — which is exactly the value
`bailoutOnAlreadyFinishedWork` re-checks after `lazilyPropagateParentContextChanges`
(`ReactFiberBeginWork.js:3740-3742`). The skill's summary: *"The bailout is undone by its own
bookkeeping."*

`[verified]` **`memo` does not stop it.** Proven by repro with three barrier kinds — plain
`memo`, `memo(fn, () => true)` (a comparator that unconditionally claims equality), and a
class with `shouldComponentUpdate() { return false }`. All three bailed out; **all three let
the consumer beneath re-render.** `updateSimpleMemoComponent`'s condition is
`shallowEqual(prevProps, nextProps) && current.ref === workInProgress.ref`
(`ReactFiberBeginWork.js:552-557`) — context appears nowhere in it.

**Consequence.** [T3.3](tasks/T3.3-context.md)'s "context value must be referentially
stable across provider re-renders" is not defensive tidiness — it is the single thing
standing between this architecture and a full subtree invalidation on every drag, and there
is **no escape hatch downstream**. No amount of `memo` on list items can compensate. The
skill's own recommendation is the design this project already chose: *"The only way to stop
a context update is not to depend on it — split the context, or select a stable value with
an external store."*

### Net (A3)

The architecture is sound and the invariants survive, with **one wording correction and one
new hazard**:

| Invariant | Verdict |
| --- | --- |
| 4 — store notification re-renders at most the active draggable | **confirmed as a guarantee** — an unchanged slice never enters React: no lane, no schedule, no render (A3.1) |
| 5 — registration never notifies | untouched by this review; a store-side property, not React's |
| 8 — StrictMode-clean | **confirmed**, and confirmed to matter in production (A3.4) |
| 9 — memoize per store-state version | **promoted to *the* performance constraint** — `getSnapshot` runs per subscriber per notification regardless of outcome (A3.2) |
| T3.2 cached snapshot | **promoted** to a correctness requirement — infinite loop otherwise (A3.2) |
| T3.3 stable context value | **promoted** to load-bearing, with no downstream mitigation (A3.5) |
| — | **new hazard**: tearing recovery = full sync re-render, but only from a *consumer's* concurrent render (A3.3) |
| — | **new constraint**: store updates are always `SyncLane`; drag updates can never be deprioritized (A3.2b.3) |

---

## A4 — Can nested (tree) DnD be built on this architecture, and can it be fast?

*Reasoned 2026-08-07 from A1 (why trees are hard) and A3 (what React actually does). No new
external claims; this is design analysis over already-verified facts.*

> **Verdict: yes to both — and the tree case is *cheaper per pointermove* than the flat
> sortable list, not more expensive.** That is counterintuitive enough to be the spine of the
> blog post. What makes trees hard is **correctness**, not performance, and the field has
> conflated the two.

### The insight that decides it: the projection is one value, not N

A flat sortable list has to answer a question **per item**: "how far do *you* translate to
open the gap?" That is N distinct values, so N subscribers with N different slices, and
crossing a boundary changes K of them → K commits.

A tree drop has exactly **one** answer for the whole drag state: given pointer position,
cached row rects, the flattened rows, and the active id, there is a single
`(parentId, index, depth, mode)`. Every row asks the same question — *"is the indicator on
me?"* — against one shared value.

That collapses the per-move work from "N values to recompute and diff" to "one value to
compute, N O(1) comparisons." It is why the conventional tree UI — a single indicator line
indented to the projected depth — is also the fast one. The UX convention and the
performance optimum coincide, which is rare and worth saying out loud.

### The efficient shape, and its per-move cost

Combining perf invariant 9 (memoize once per store-state version) with the `DragOverlay`
technique from [T6.1](tasks/T6.1-drag-overlay.md):

*(Corrected by § A7 F7: this table omitted collision — `closestCenter` over all collidable
droppables per move, O(D). With D3's measure-only rows, D ≈ 0 for tree drags, so the table
below stands; for a design where rows were real droppables it would be the dominant term.)*

| Per pointermove | Cost |
| --- | --- |
| Store state object replaced | O(1) |
| `projectTreeDrop` — binary-search the pointer's y against rows sorted by y, then depth from x + clamp | **O(log N)**, computed **once**, WeakMap-cached on the state object |
| Each subscribed row's `getSnapshot` — WeakMap hit + compare | N × O(1) — **unavoidable**, see A3.2 |
| React renders | **0** if the indicator is written imperatively in rAF; 1 tiny component if not |
| DOM writes | 1 `transform`, rAF-coalesced |

**Zero React renders per move is achievable**, not aspirational. The indicator subscribes to
the store directly in an effect and writes `style.transform` inside `requestAnimationFrame` —
identical to `DragOverlay`. Bypassing `useSyncExternalStore` there is sound precisely because
nothing is rendered *from* the value: tearing is a render-consistency problem, and there is no
render to be inconsistent with.

### The floor you cannot get under

`getSnapshot` runs for **every subscriber on every notification regardless of outcome**
(A3.2). That is the one cost React will not let you avoid, and it scales with row count:

| Rows | @120 Hz | At ~30 ns per O(1) selector |
| ---: | ---: | --- |
| 100 | 12k calls/s | negligible |
| 1,000 | 120k calls/s | ~4 ms/s — fine |
| 10,000 | 1.2M calls/s | ~36 ms/s ≈ 3–4% of a core, before anything else |

So the architecture holds to ~10k rows provided **every** row selector is a genuine O(1) read
off the memoized projection. One row selector that recomputes anything makes the move path
O(N²) and the frame is gone — this is A3.2 restated as a hard design rule, and it is the
single thing most likely to be got wrong in [T8.2](tasks/T8.2-use-tree-drop.md).

Beyond ~10k rows the answer is virtualization, which is already Backlog and genuinely hard
(rects exist only for mounted rows, so the binary search needs a different index).

### Design decisions this forces

1. **The indicator is one element, not per-row state.** A row must not subscribe to "am I the
   drop target" if that can be avoided — one absolutely-positioned indicator driven
   imperatively beats N row subscriptions. Rows may still subscribe to `isDragging`, which is
   O(1) and changes twice per drag.
2. **Do not collapse the dragged subtree out of the DOM on pickup.** A1.5 noted the
   rect-cache conflict: collapsing shifts every rect below, so the "measure once at
   `beginDrag`" optimisation would have to wait for a React commit before measuring. Keeping
   the descendant rows mounted (dimmed) and merely **excluding them from candidates** keeps
   `beginDrag` synchronous, keeps rects valid, and avoids the tree jumping under the cursor.
   `flattenTree(items, activeId)` already models exclusion rather than removal
   ([T8.1](tasks/T8.1-tree-math.md)) — this makes that choice load-bearing rather than
   incidental.
3. **`canNest` and `indentPx` must not churn.** If they travel through context, an inline
   `canNest={(n) => …}` re-creates the context value every parent render, and A3.5 proves
   `memo` cannot stop the propagation — every row re-renders, and the whole design collapses.
   Pass them as hook options held in a latest-ref, or memoize the context value and say so in
   the README.
4. **Auto-expand-on-hover is a discrete event, not a per-move one.** It changes the row set,
   so it must set the rect-dirty flag and re-measure — acceptable once per hover-intent,
   unacceptable per move.
5. **Keyboard depth goes through the same `projectTreeDrop`.** Already specified in
   [T5.2](tasks/T5.2-keyboard-sensor.md)/[T8.2](tasks/T8.2-use-tree-drop.md); A3 adds no
   obstacle, since a keyboard step is just another store update on `SyncLane`.

### What React makes impossible or awkward — the honest list

- **Drag updates can never be deprioritized** (A3.2b.3 — always `SyncLane`). For the
  single-indicator design this is irrelevant. It would matter for a design that re-renders
  many rows per move, which is a further argument against that design.
- **A consumer's concurrent render can still cost a full sync re-render of the tree**
  (A3.3). Outside this library's control; with 10k rows it will be visible. Document it.
- **Nothing else.** No React mechanism blocks the tree case. The obstacles in A1 are all
  *data-model* obstacles — the tuple, the clamp, the cycle exclusion — which is exactly why
  A1's conclusion (put the math in a pure, DOM-free module) is the right shape.

### Open

- `[open]` Measure the selector floor for real. The 30 ns figure above is an estimate, not a
  measurement, and by this repo's own rules it must not reach the blog post unmeasured.
  A microbenchmark belongs in [T9.6](tasks/T9.6-chrome-qa-and-profiler.md): N subscribers,
  unchanged slice, notifications/second vs N.
- `[open]` Confirm the binary search is valid — it assumes flattened rows are sorted by `y`
  and contiguous. True for a normal tree; false under virtualization, and possibly false with
  variable-height rows plus CSS transforms mid-drag. Verify in [T8.1](tasks/T8.1-tree-math.md)
  before relying on O(log N) rather than O(N).

---

## A5 — The id-mirror proposal, and what Slate actually has to teach us

*Reasoned 2026-08-07 from the three Slate write-ups in
`~/Projects/clients/archbee-multi-projects/x-how-slate-works/` (pinned to slate 0.124.1),
plus A3/A4. Slate claims below are `[verified]` against those documents, which are themselves
close reads of a local clone — one level of indirection from the source, and marked as such.*

### First, a correction: dirty paths are not a rendering mechanism

`[verified]` The premise that "React re-renders only the dirty paths" does not hold.
`DIRTY_PATHS` / `DIRTY_PATH_KEYS` are a **normalization worklist** — "which paths might now
violate a schema rule and need normalizing" — and they are drained **synchronously, inside
the transform, before it returns**: *"earlier than the microtask `onChange`, earlier than any
React render. So between user actions, `DIRTY_PATHS` holds an empty array."*

By the time React renders, the list is empty. React never sees it. Dirty paths are about
**schema repair**, not reconciliation.

### But the mechanism next door is exactly the right idea

`[verified]` What actually makes Slate re-render minimally is **immutability with structural
sharing**. Typing one character rebuilds only the spine:

> new text → new paragraph → new cell → new row → new table
> *"Five fresh objects. Five stale ones."*

Every untouched sibling subtree keeps its **object identity**, so `memo` bails out on it for
free. Minimal re-render falls out of *which objects got new identities*, nothing else.

**This is the borrow, and it upgrades [T8.1](tasks/T8.1-tree-math.md) materially.** That task
currently says `applyTreeDrop` performs an "immutable move." Implemented naively — a deep
clone, or `structuredClone`, or a recursive rebuild — **every node gets a new identity and
every row re-renders after a drop.** On a 10k-node tree that is 10k re-renders where ~2×depth
would do. The criterion must say *structural sharing*: rebuild only the ancestor spines of the
removal and insertion points; return the identical array/object reference for every subtree
that did not change. And it needs a test asserting untouched subtrees are `===` to their
originals, because nothing else will catch a regression to deep-clone.

### The proposal itself

Splitting it into the part that already exists, the part that is a trap, and the part that is
genuinely good:

**Already the design.** "Compute on a plain id-only structure outside React, then render once"
is what `flattenTree` → `projectTreeDrop` → `applyTreeDrop` is. `flattenTree` returns exactly
`{ id, parentId, depth, index }[]` — an ids-only mirror — and it lives in the store, outside
React. The instinct is right and is already banked.

**The trap: a *persistent* provider-owned mirror.** Deriving the mirror at `beginDrag` and
discarding it at drop is safe. Keeping it alive across drags is not: the consumer owns the
tree and may add nodes, lazily load children, or collapse a branch between drags, and nothing
tells us. That is **the Slate WeakMap bug in a different costume** — a registry written at one
moment, silently going stale, with no type enforcing the invariant. That bug's own conclusion:
*"It's an invariant you only learn about when you break it."* Keep the mirror per-drag.

**The genuinely good part, but for a different reason than stated.** "Ids only, to keep it
small" optimises the wrong axis — 10k rows of `{id, parentId, depth, index}` is a few hundred
KB, and A4 established the bottleneck is the per-notification selector sweep, not memory. The
real value of ids-only is that **the library never holds references to consumer objects**. It
cannot leak them, cannot go stale on their contents, and `applyTreeDrop` can return
instructions the consumer applies to their own data. That is a strong API property and worth
keeping — just not for the size reason.

**Deferring all computation to drop** would remove the live drop indicator, which is not
viable UX. Reading it charitably as "defer the *mutation* to drop, keep the projection live"
— that is already the split between `projectTreeDrop` (live) and `applyTreeDrop` (on drop).

### Three more concrete borrows

1. **A reverse index, built during the walk you already do.** Slate's `NODE_TO_INDEX` /
   `NODE_TO_PARENT` answer "given this node, where is it?" in O(depth) instead of O(tree),
   populated as a side effect of rendering. `flattenTree` already walks the whole tree at
   `beginDrag` — have it emit an `id → { parentId, index, depth }` Map for free. Then
   `applyTreeDrop` is O(depth), not an O(N) search. Note it should be a plain `Map`, **not**
   a `WeakMap`: we key by id (a string, which WeakMap forbids) and the index is per-drag and
   discarded, so there is nothing to garbage-collect around.

2. **Key by id, never by path — and skip Slate's hardest machinery entirely.** Slate needs
   `Path.transform` ("given this op, where does this position move?") for refs, selection
   survival, and dirty-path remapping, because Slate addresses **positionally**. Everything
   downstream of a positional address has to be remapped on every structural edit. If expanded
   state, scroll anchors, and selection are keyed by **node id**, that entire class of bug
   does not exist for us. Worth stating in the README as a deliberate design choice.

3. **Batch the structural pass.** `batchDirtyPaths` exists because recomputing per-op is
   O(n²) on a large transform — each op remaps the whole growing list. The analogue: never
   re-flatten per pointermove. Flatten once at `beginDrag`, invalidate only on a structural
   change (auto-expand). Already the design; Slate supplies the O(n²) reasoning for why it is
   not optional.

### The hazard the bug doc catches in *our* design

`[verified]` The WeakMap bug's root cause: a **module-global registry keyed by object
identity**, where two live editors rendered the same object and the last writer won.

Perf invariant 9 specifies a module-level WeakMap. Is it exposed to the same failure? **Only
if it is keyed on the wrong thing.**

- Keyed on the **per-provider store state object** — safe by construction. Each `DndProvider`
  creates its own store and therefore its own state objects; two providers can never mint the
  same identity, so their memo entries can never collide.
- Keyed on **consumer-supplied data** (the `items` array, a tree node) — **reproduces the bug
  exactly.** A consumer rendering the same `items` array into two `DndProvider`s (a page and a
  modal — precisely the Slate scenario) would have the two providers overwrite each other's
  memoized projection, and the symptom would be a wrong drop indicator in whichever one
  rendered second. Silent, intermittent, and brutal to diagnose.

[T7.1](tasks/T7.1-list-projection.md) and [T8.2](tasks/T8.2-use-tree-drop.md) now carry this
as an explicit constraint plus a two-provider regression test. It costs nothing to get right
today and would be a multi-day debugging session to find later.

### Net

The dirty-path framing does not transfer — but the question was worth asking, because the
mechanism beside it (structural sharing) fixes a real defect in T8.1's spec, and the bug
report next to it catches a real hazard in perf invariant 9's. The id-mirror instinct is
sound and mostly already built; the one change is to keep it per-drag rather than persistent.

- `[open]` Should `applyTreeDrop` also return a description of the change (a `move_node`-shaped
  op) rather than only the new tree? Slate's op log is overkill for a single move, but it is
  exactly what a consumer needs to build undo/redo cheaply. Backlog, not v0.1 — but it is an
  API-shape decision, so better decided before the signature ships than after.

---

## A6 — Concurrent mutation: what happens when someone else edits the list mid-drag

*Reasoned 2026-08-08 from the store design in [T3.1](tasks/T3.1-store.md), perf invariants
4/5, and A3–A5. Structural analysis over the existing spec; no new external claims.*

> **Finding: the current spec silently produces a wrong drop.** Not a crash — a wrong drop,
> with no error, in the case most likely to occur. Perf invariant 5 ("registration never
> notifies") was written for mount-time and does not carve out unregistration *during an
> active drag*, which is a structural change to both the candidate set and the geometry.
> Two API signatures also address positionally, which is the same class of bug A5 identified
> in Slate's `Path.transform` — and unlike Slate, we have no remapping machinery.

### The trigger, and why we can see it at all

A remote deletion reaches us as the consumer re-rendering with fewer items. React unmounts the
row, its effect cleanup runs, and `unregisterDroppable` / `unregisterDraggable` fire —
**during an active drag**. So the library does get a signal. The question is only what it does
with it, and today the answer is "nothing," because invariant 5 says registration changes
never notify.

### Six cases, ordered by how bad they are

**1. A row *above* the dragged one is deleted. — Silent wrong drop. Worst case.**
Every row below shifts up by one row-height. The rect cache was measured once at `beginDrag`
(invariant 1) and nothing marks it dirty, because a deletion is neither scroll nor resize.
Collision now runs against geometry that is one row stale for every candidate below the
deletion. The indicator points at the wrong gap, and the user drops where the indicator said.
No crash, no warning, no way for the consumer to detect it. **This is the case that must not
ship.**

**2. The `over` target is deleted, then the user releases. — Off-by-N data corruption.**
`onDragEnd` fires carrying an `over.id` that no longer exists, and `onSortEnd({ fromIndex,
toIndex })` hands the consumer indices into a list that no longer has those indices. The
consumer applies the move to the wrong position and the corruption is now persisted and
replicated to everyone else.

**3. The dragged item itself is deleted. — Must cancel; teardown is not obvious.**
There is nothing left to drop, so the only correct outcome is cancel. The subtleties: the
pointer is still physically down, so pointer capture must be released or the next `pointerup`
lands nowhere; the `DragOverlay` is rendering the deleted item and must unmount; sensors still
own document listeners; and `activeId` points at a registration that no longer exists.
[T9.3](tasks/T9.3-edge-cases.md) covers "draggable unmounts mid-drag" but frames it as a local
React event — the remote-deletion framing adds the announcement and the pointer-capture
release.

**4. Tree: an ancestor of the dragged node is deleted.**
Whether descendants are removed or reparented is the consuming app's semantics, not ours. If
removed → case 3. If reparented → the flattened rows, every `depth`, and therefore the
`[next.depth, prev.depth + 1]` clamp are all computing against a tree that no longer exists.
The projection stays internally consistent and externally wrong.

**5. The consumer's list is keyed by index rather than id.**
Then a deletion gives every row below a different React identity, so every one of them
unregisters and re-registers mid-drag. The whole registry churns. Bad practice on the
consumer's part, but common enough that the library should degrade predictably rather than
scramble. Worth a README note.

**6. Tearing — the one case A3.3 predicted.**
Collaborative apps routinely wrap remote updates in `startTransition` to keep them
low-priority. That is precisely the concurrent-render-in-flight condition, and a pointermove
landing during it triggers the full synchronous re-render recovery
(`ReactFiberWorkLoop.js:1151-1173`). A3.3 called this "outside this library's control" and
"a real scenario in a real app" — collaborative editing is that scenario. Performance, not
correctness, but it will be visible on a large tree.

### The two fixes

**Fix 1 — invariant 5 needs a carve-out.** Registration changes must stay silent when no drag
is active; that is what keeps 500 rows mounting from causing 500 notifications. But during an
active drag, unregistration is a structural event and must:

- mark the rect cache dirty, so the next update re-measures (the machinery already exists for
  scroll — this just adds a trigger);
- re-run collision, so `over` is recomputed against real geometry;
- clear `over` if it pointed at the removed node;
- cancel the drag outright if the removed node was the active one, with full teardown
  including pointer-capture release and a live-region announcement.

Registration *during* a drag needs the same dirty-marking — a remote insert shifts rects
exactly as a delete does, and the existing "droppable mounts mid-drag" criterion in
[T4.3](tasks/T4.3-use-droppable.md) already gestures at this without connecting it to
invariant 5.

**Fix 2 — stop addressing positionally at the API boundary.** This is A5's lesson arriving
from a second direction. Slate needs `Path.transform` because it addresses positionally; we
concluded we could avoid that whole class of bug by keying on ids. But two of our own
signatures are positional:

- `onSortEnd({ activeId, fromIndex, toIndex })` — indices captured during the drag, applied to
  a list that may have changed.
- `projectTreeDrop` returns `{ parentId, index, depth, mode }` — `parentId` is an id (good),
  `index` is a slot (vulnerable).

The cheap, robust answer is to carry **id-relative** position alongside the index — the id of
the neighbour the item lands after or before — and have `applyTreeDrop` **resolve the index
from that neighbour against the tree it is handed at apply time**, rather than trusting a
number captured mid-drag. `applyTreeDrop` already receives the current `items`; it simply must
not assume the captured index still refers to the same slot. Same for what `onSortEnd`
reports: give the consumer enough to place the item correctly even if the list moved under
them.

This costs nothing today and is an API-shape decision, so it is far cheaper decided before the
signature ships than after.

### Scope

Full CRDT/OT integration is emphatically not v0.1 and should stay out of scope. But **not
corrupting the consumer's data under a concurrent edit is a correctness requirement, not a
collaboration feature** — and cases 1 and 2 corrupt silently, which is the worst possible
failure mode for a library whose entire pitch is getting the hard case right.

### Decided (user, 2026-08-08): removal cancels

**Any removal of a registered node during an active drag cancels the drag, and the item
returns to its original position.** That covers all of it — the active item, the current
`over` target, and any other row whose disappearance would invalidate the cached geometry.
Chosen over re-colliding because it is trivially safe: there is no window in which the library
can present a drop position derived from a tree that no longer exists.

Two consequences worth recording:

- **The keyboard open question dissolves.** There is no "where does the next arrow key
  navigate from," because there is no next arrow key — the drag is over.
- **"Returns to its original position" is a snap, not an animation.** Cancel resets transforms;
  animating back to the origin rect is a Backlog item (`Drop animation for DragOverlay`). The
  behaviour is identical to an Escape cancel today, which is at least consistent.

### But insertion must not cancel — it would break our own feature

Applying "cancel on any structural change" symmetrically to **insertions** breaks two things:

1. **Tree auto-expand-on-hover** (A1.3, [T6.2](tasks/T6.2-auto-scroll.md)) mounts new rows
   *by design*, as a direct result of the user's own drag. Cancelling on insertion means
   hovering a collapsed folder cancels the drag — the flagship tree feature would be unusable.
2. **Lazy loading during auto-scroll.** Drag toward the bottom of a paginated list, the next
   page resolves, the drag dies. In an infinite list, drags would cancel more often than they
   complete.

So the policy is asymmetric, and deliberately so:

| Mid-drag registry event | Behaviour |
| --- | --- |
| **Removal** of any registered node | **Cancel**, return to origin |
| **Insertion** of a node | Mark rects dirty, re-measure, re-collide — never cancel |

The asymmetry is justified rather than arbitrary: a removal can invalidate the *answer* (the
thing you were aiming at is gone, or everything shifted under a stale cache), while an
insertion only invalidates the *geometry*, which the dirty-flag path already exists to fix.

### Decided (user, 2026-08-08): `onDragCancel` carries a reason

```ts
type DragCancelReason =
  | 'escape'            // the user pressed Escape
  | 'blur'              // the handle lost focus during a keyboard drag
  | 'pointer-cancelled' // the browser took the interaction away (pointercancel)
  | 'item-removed'      // a registered node disappeared mid-drag — this entry's case
```

A consumer showing "another editor changed this list" must be able to tell a user cancelling
from the library forcing one, and a screen-reader user has no other way to learn what happened
(see [T6.3](tasks/T6.3-accessibility-internals.md)).

**Enumerating the reasons found a missing case.** Writing the union out revealed that nothing
in the spec handles **`pointercancel`** — the DOM event the browser fires when it takes over an
interaction (a touch turning into a system gesture or a scroll, a device rotation, a pen
leaving range). [T5.1](tasks/T5.1-pointer-sensor.md) listed Escape, teardown, and second-pointer
handling but never this. Unhandled, a drag interrupted that way **never ends**: the store keeps
`activeId`, the document listeners stay bound, and the overlay stays on screen until the page
is reloaded. On touch devices this is not an edge case — it is what happens whenever the
browser decides a drag was actually a scroll.

T5.1 now requires handling it, routed through the same cancel path as Escape.

Announcement mapping ([T6.3](tasks/T6.3-accessibility-internals.md)): `'escape'`, `'blur'`,
and `'pointer-cancelled'` share the ordinary "movement cancelled" text — from the user's point
of view the drag simply stopped. `'item-removed'` needs its own, because that text would be a
lie.

---

## A7 — Adversarial review: is the tree spec actually final?

*Reviewed 2026-08-08 at the user's request, deliberately hostile, over the fresh state of
A1–A6 and the P8/P3/P5 task files. Question: if T8.1/T8.2 were implemented exactly as
written, would the result actually solve nested DnD?*

> **Verdict: no — the architecture survives, but the tree spec had eleven holes, four of
> them in the math that is the project's whole differentiator.** All are fixed in the task
> files as of this entry. The distance from "final" was not in the big ideas (store-first,
> single projection, pure math, removal-cancels — all held up); it was in exactly the
> boundary conditions the corrected A2 claim brags about handling.

### Decisions made by the user in this review

**D1 — Position follows the drop point (WYSIWYG placement).** Demonstrated on an Archbee
sidebar: a doc dropped in the gap under "Untitled" at one depth deeper lands as Untitled's
child *at that visible position*. The gap you drop in, at the depth you indicated, IS the
`(parentId, index)` — no separate placement rule. `mode: 'into'` (the middle band on a
nestable row) resolves to **index 0**, because the drop point is adjacent to the parent row
and that is the only position the principle can mean when children are hidden or absent.
This also unifies the model: on an expanded parent, 'into' and "the gap below it at
depth+1" are the *same position*, so the keyboard depth ladder is total.

**D2 — Any node can be a parent.** Not folders: documents that gain a `children` array when
their first child arrives. `canNest(candidateParent, active)` defaults to always-true, takes
both nodes, and `applyTreeDrop` must create the `children` array immutably on a childless
target (and leaves `children: []` behind when the last child moves out — documented, not
deleted).

**D3 — Rows are not droppables.** Tree rows register **measure-only** through
`useTreeDrop`'s `getRowProps(id)`: rect cached for the projection and keyboard targeting,
excluded from collision. One hook, no new subpath, no way to hold it wrong.

### The findings

**F1 — The clamp ignored `canNest`.** `[next.depth, prev.depth + 1]` is quoted everywhere,
but depth `prev.depth + 1` in a between-gap *is* nesting into `prev` — without the into-band
ever being consulted. Upper bound must be canNest-aware:
`canNest(prev, active) ? prev.depth + 1 : prev.depth`.

**F2 — No representation for "no legal position here."** With F1 fixed, the clamp interval
can be **empty**: the gap between a node and its own first visible child (`next.depth =
prev.depth + 1`) when `canNest(prev, active)` is false. The projection needs a null/blocked
outcome; the indicator hides; releasing there is an `onDragEnd` with a null projection (a
no-move, matching flat DnD's `over: null`), not a cancel.

**F3 — `parentId`/`index` derivation was never stated.** The differentiator is returning the
tuple, and no rule said how depth becomes a parent. Now specified: `depth = prev.depth + 1`
→ parent is `prev`, index 0 (D1); `depth ≤ prev.depth` → parent is prev's ancestor at
`depth - 1` (O(depth) via the reverse index), index = sibling-index of prev's
ancestor-or-self at `depth`, plus one. When `next.depth === depth` this must equal "before
next" — an equality worth a dedicated test.

**F4 — The active row was a legal neighbour.** `flattenTree` excluded only the active
node's *descendants*, so the active row itself could be `prev` — and `prev.depth + 1` then
means nesting into yourself: a cycle reachable through the front door, with the defensive
guard in `applyTreeDrop` as the only thing catching it. Fix: the math rows exclude the
active node **and** descendants; the two gaps around its origin merge into one no-op
position; `applyTreeDrop` of a no-op returns the **same `items` reference** (structural
sharing's degenerate case, and a test).

**F5 — Boundary gaps unspecified.** Top gap (no `prev`): depth is pinned to `next.depth`
(root-first flatten makes that 0). Bottom gap (no `next`): clamp is `[0, canNest-aware
max]`. Both get tests; both were previously undefined behaviour.

**F6 — T8.2's memo rule was self-contradictory.** It demanded "key on the store state
object, **never on the consumer's tree data**" — but the projection is a *function of* the
consumer's rows. Keyed on state alone, an auto-expand mid-drag (new rows, possibly no new
state) returns a stale projection *by construction*. Fix, preserving both safety properties:
**two-level memo** — outer WeakMap on the per-provider state object (the A5 collision
safety), inner WeakMap on the rows array identity (staleness safety). Three supporting
requirements: `items` must be referentially stable across renders (consumer contract,
documented — the A4.3 footgun again); rows that mounted but are not yet measured are
excluded from candidates until the rect cache has them; and the T3.1 structural path must
mint a **new state version** even when `over` is unchanged, so projections recompute after
an insertion (gate 1 keeps unchanged-slice subscribers from rendering, so this is cheap).

**F7 — Two sources of truth.** Rows as real droppables meant `closestCenter` ran over all N
rows per move, producing an `over` that *disagrees with the projection* — A1's own thesis
("element hit-testing is the wrong question for trees") running as dead code on the hot
path. A4's cost table also silently omitted this O(collidable) per-move term. Resolved by
D3: measure-only rows, no `isOver`, collision cost for trees ~0, and `over`-driven
announcements replaced by projection-driven ones (F9).

**F8 — Spring-loaded collapse fights the cancel policy.** Auto-expand-on-hover mounts rows
(insertion — survives, by design). But *restoring* the collapse mid-drag unmounts them —
removal — **cancel**, per A6. The recipe is therefore: expand on hover during the drag;
restore collapse state only in `onDragEnd`/`onDragCancel`. A collaborator collapsing a
branch mid-drag cancels your drag — that is the policy working, not a bug. Recipe goes in
the demo and README; T9.3 tests both directions.

**F9 — Tree accessibility had no spec.** Two additions. **Reachability invariant**: every
legal outcome — each gap at each legal depth, and 'into' on nestable rows — must be
reachable by keyboard alone; the test enumerates targets and drives arrow keys. (Without
D1's unification this would have needed a separate keyboard rule for 'into'; with it, 'into'
is the deepest rung of the gap below the row.) **Announcements**: tree drags announce from
projection changes ("place inside Untitled" / "place after X, level 3"), since measure-only
rows produce no `over` events; texts overridable like all others; `aria-level` /
`aria-posinset` / `aria-setsize` recipe goes in the README.

**F10 — Cross-tree scoping undefined.** An `activeId` that is not in this tree's `items`
yields a **null projection** (guard, tested). Cross-tree moves join the Backlog beside
cross-list.

**F11 — The retired phrase survived in T8.1.** Its Goal still said "the ecosystem punts on
this case" — the A2 sweep grepped for "punts on the tree" and missed this variant. Fixed to
the corrected claim. Lesson consistent with this file's method: sweeps need the loose match,
not the exact phrase.

### Scope statements this review adds

- **v0.1 tree mode is indicator-only.** Rows do not translate live during a tree drag (that
  is the sortable list's model); the projection drives one indicator. Live reflow in trees →
  Backlog.
- Backlog additions: band-boundary **hysteresis** (pure shape: `projectTreeDrop` takes the
  previous projection and applies a switching threshold — still pure); **cross-tree moves**;
  **live-reflow tree mode**; **op-shaped `applyTreeDrop` return** for undo/redo (A5's open
  question, now parked deliberately).

### What "final" means now

With F1–F11 landed, the tree spec is **final at the specification level**: every function
has stated semantics for every input class the review could construct, every decision is
either made (D1–D3, A6) or explicitly parked in the Backlog, and the remaining `[open]`
items are *measurements* that only implementation can supply (selector floor, binary-search
validity, tearing cost, react-arborist/react-complex-tree comparison, Pragmatic's internal
clamp). Those are gates on the **blog post's claims**, not on starting P1/P2.

---

## A8 — Decided (user, 2026-08-08): React 19+ is the target

*"Make this work on React 19, and not 18. If it works on 18, good, but 19+ is the target."*

**Peer range: `>=19.0.0`.** Not `>=18` — a peer range is a support statement read by every
consumer's package manager, and declaring 18 while testing exclusively on 19 would be an
untested claim in the manifest, exactly the class of thing this project's rules exist to
prevent ("if it works on 18, good" cannot be encoded honestly as `>=18`). Consumers on 18
can override peers at their own risk; we do not claim it, test it, or document it.

### What it simplifies

- **A3's citations now cite the target's own source.** The version caveat shrinks to
  "line numbers don't survive patch releases"; the both-18-and-19 measurement matrix is
  gone (edited in place in A3).
- **One React in CI and devDependencies** (`^19.x`, `@types/react` 19,
  `@testing-library/react` ≥ 16.1 — the React-19-compatible line).
- **No 18-conditional code paths, ever** — no feature detection, no dual documentation.

### What it unlocks — flagged for implementation, not decided here

**Ref callback cleanup functions are 19-only, and they are the natural fit for
registration.** A ref callback may return a cleanup in React 19; attach → register,
cleanup → unregister, no `useEffect` in the loop. That is one fewer effect per
draggable/droppable/row, registration available at commit time (before layout effects),
and the StrictMode attach/detach/attach cycle exercises exactly the idempotency perf
invariant 8 demands. The current spec language ("registration happens in effects" —
`CLAUDE.md` § Architecture, [T4.2](tasks/T4.2-use-draggable.md)/[T4.3](tasks/T4.3-use-droppable.md))
predates this decision. **Whoever builds T4.2/T4.3 — and T8.2's `getRowProps` — must
evaluate ref-cleanup registration against effect registration and record the choice in the
task file.** The invariants are mechanism-agnostic and unchanged either way: idle
registration never notifies (5), teardown is complete (7), StrictMode-clean (8).

Nothing else in React 19 changes the design: no `use()`, actions, or optimistic state
anywhere near this library's needs; `useSyncExternalStore` semantics are the A3-verified
ones.

## A9 — Implementation decisions frozen before P1 (2026-08-08)

Forty files depend on a handful of shapes. Deciding them once, here, is cheaper than
discovering them forty times. Each entry names the decision, the alternative it beat, and
the task that owns it. Anything a test later disproves gets corrected **in place** with a
dated note, not appended as a second opinion.

### A9.1 — `DragSession` is `move` / `end` / `cancel`. `setTransform` is dropped

`CLAUDE.md` § Architecture named four session operations (`move` / `setTransform` / `end` /
`cancel`). The split was going to be "`move` re-collides, `setTransform` doesn't". It does
not survive its own motivating case: the keyboard sensor's ArrowLeft/Right indent step. That
step changes `translate.x` only, and re-running collision over it cannot change `over` —
droppables have not moved, and tree rows are **measure-only** (§ A7 D3), so collision never
sees them at all. There is no observable difference for a consumer or for the overlay, which
means there is no test that can discriminate the two operations. A public method whose
behaviour cannot be pinned by a test is a maintenance liability, not an API.

**Decided:** one translate-changing operation.

```ts
type DragSession = {
  move: (translate: Translate) => void
  end: () => void
  cancel: (reason: DragCancelReason) => void
}
```

Nothing is published yet, so this is a construction-time refinement rather than a breaking
change — but it *is* a change to `CLAUDE.md`'s stated architecture, so `CLAUDE.md` is edited
in the same commit. Owner: [T2.1](tasks/T2.1-public-types.md).

If a sensor is ever written that genuinely needs to move the visual position without
re-collision, the discriminating test exists first and `setTransform` comes back with it.

**Amended 2026-08-08 while writing T2.1 — a fourth member, `findTargetInDirection`.** The
keyboard sensor must answer "what is the next droppable upward?", and there are only two ways
to give it that: a geometry query on the session, or a public rect cache. The query wins on
both counts that matter here — the sensor never reads the DOM, so perf invariant 1 holds for
the keyboard path too, and the measure-only-rows rule (§ A7 D3) stays an internal detail of
[T3.1](tasks/T3.1-store.md) rather than something every sensor author has to know. The
session is therefore `move` / `end` / `cancel` / `findTargetInDirection`.

### A9.2 — `beginDrag` takes a nullable `pointer`, and that is what gates auto-scroll

Auto-scroll ([T6.2](tasks/T6.2-auto-scroll.md)) must run for pointer drags and **not** for
keyboard drags — the keyboard path uses `scrollIntoView`. Rather than a
`activatorType: 'pointer' | 'keyboard'` enum that every future sensor has to classify itself
into, the store takes the pointer position the drag started from:

```ts
beginDrag({ id, pointer: Point | null })
```

A drag with no pointer origin has no edge proximity to compute, so auto-scroll is off by
construction rather than by a switch someone can forget. The store derives the live pointer
position as `initialPointer + translate`, so `move(translate)` remains the only thing a
sensor reports. Owners: [T3.1](tasks/T3.1-store.md), [T6.2](tasks/T6.2-auto-scroll.md).

### A9.3 — The rect cache lives **inside** the immutable state object

Perf invariant 9 memoizes derived projections in a WeakMap keyed on the store's state
object. That is only sound if everything the projection reads is reachable from the key. The
projection reads cached rects. So the cache cannot be a `Map` the store mutates in place
beside the state — a lazy re-measure would leave every memoized projection stale, silently,
with the exact symptom (a drop landing one row off after a scroll) that is hardest to trace.

**Decided:** `state.droppableRects` is a `ReadonlyMap<DndId, Rect>` **replaced** on every
re-measure, and re-measuring mints a new state object like any other transition. Allocating
one Map per re-measure is nothing — re-measures happen at drag start, on the dirty flag, and
on mid-drag registration, not per move. Owner: [T3.1](tasks/T3.1-store.md).

### A9.4 — Registration is a **ref callback with cleanup**, options sync separately

A8 left this open and instructed whoever builds T4.2/T4.3/T8.2 to decide it. Decided: ref
callback (React 19 cleanup form) for the node, a small effect for the mutable options.

The deciding argument is not elegance, it is a bug the effect version has and the ref version
does not. Under the A6 policy, **unregistering mid-drag cancels the drag**. An effect whose
dependency array contains `data` re-runs whenever the consumer passes a fresh object literal —
which is the normal way people write `data={{ index }}` — so an ordinary parent re-render
during a drag would unregister, cancel the drag, and look like a library bug. A ref callback
keyed on the node re-runs only when the node identity actually changes, which is the thing
registration is actually about.

```ts
const setNodeRef = useCallback((node: HTMLElement | null) => {
  store.registerDraggable(id, node)
  return () => store.unregisterDraggable(id)
}, [store, id])
```

Mutable options (`data`, `disabled`) are pushed into the existing registry entry from an
effect; the registries are mutable and non-notifying (perf invariant 5), so this costs no
render and cannot cancel anything. Registration also lands in the **commit phase**, ahead of
passive effects, so a row that mounts mid-drag is measurable before paint. StrictMode's
attach → detach → attach cycle is exactly the idempotency perf invariant 8 asks for; the
observed behaviour is recorded in T4.2's "Where it stands" once the test runs.

Owners: [T4.2](tasks/T4.2-use-draggable.md), [T4.3](tasks/T4.3-use-droppable.md),
[T8.2](tasks/T8.2-use-tree-drop.md).

### A9.5 — Sensors are factories; `handleProps` merges every sensor's activators

```ts
type Sensor = { name: string; activate: (context: SensorContext) => SensorActivatorProps }
pointerSensor(options?: PointerSensorOptions): Sensor
```

A factory is what lets options be per-instance (`pointerSensor({ activationDistancePx: 12 })`)
without a second configuration channel. `useDraggable` calls `activate` for each configured
sensor and merges the returned handlers, so two sensors both wanting `onKeyDown` both get
called — the failure T4.2 has a red test for.

`DndProvider` defaults `sensors` to `[pointerSensor(), keyboardSensor()]`. That imports both
sensor modules from the provider, which a bundle-size-sensitive library would refuse; bundle
size is explicitly not a concern here (`CLAUDE.md` § opening), and a provider that does
nothing until you discover the `sensors` prop is the worse trade. Owners:
[T2.1](tasks/T2.1-public-types.md), [T4.1](tasks/T4.1-dnd-provider.md),
[T4.2](tasks/T4.2-use-draggable.md).

### A9.6 — Collision receives an ordered array of already-filtered candidates

```ts
type CollisionArgs = {
  active: { id: DndId; rect: Rect }        // rect is already translated
  droppables: readonly DroppableCandidate[] // registration order; disabled already removed
}
type CollisionDetection = (args: CollisionArgs) => DndId | null
```

Three boundaries decided at once, each because the alternative hides a bug:

- **The store translates the active rect**, so a custom strategy cannot forget to.
- **The store filters disabled droppables and measure-only rows**, which is the boundary
  [T2.3](tasks/T2.3-collision-closest-center.md) deliberately pins with a test — the math
  must stay dumb about policy.
- **An ordered array, not a Map or an object**, because determinism on equidistant candidates
  is an asserted behaviour and "registration order" has to be a thing the strategy can see.

Owners: [T2.1](tasks/T2.1-public-types.md), [T2.3](tasks/T2.3-collision-closest-center.md),
[T3.1](tasks/T3.1-store.md).

### A9.7 — Test-run discipline inside a task

`bun run typecheck && bun run test` during the red→green loop; the full `bun run verify` once
at the task boundary, before the commit. And `bun run verify` cannot be green until
[T2.1](tasks/T2.1-public-types.md) puts a file in `src/` — `tsc` fails an empty `include` with
`TS18003` — so P1's tasks close on their own criteria, as
[T1.6](tasks/T1.6-install-green.md) already says.

`"types": []` in the base tsconfig ([T1.3](tasks/T1.3-tsconfig.md)) means there are no
ambient Vitest globals: every test imports what it uses from `vitest` explicitly. That is the
same rule as the standards' no-namespace-import line, arriving from the config side.

## A10 — Un-nesting was unreachable, and the clamp everyone copies is why (2026-08-08)

*Opened by the user after hands-on testing: "it's complicated to take a child out of its
parent. if I drag left, it should get out of the parent to the level it is dragged on (brother
with the parent, or even brother with the parent's parent)."* `[verified]` against our own
implementation and test suite; the claim about other libraries below is `[unverified]` and must
not reach the README or the post without a named source.

### The rule that blocked it

`projectTreeDrop` clamped the target depth to `[next.depth, prev.depth + 1]` — the interval
quoted in every tree-DnD write-up, and what A7 F1 refined for `canNest`. The upper bound is
sound. The **lower** bound is the problem:

> every row bounding a gap *inside* a group sits at that group's depth or deeper

so `next.depth` can never offer a way out of the group you are already in. Un-nesting was
reachable only from the **last** gap of a group, where `next` is finally something shallower.
In practice that means: to lift a document out, first shuffle it to the bottom of its parent,
*then* drag left. Nobody discovers that, and it reads as the tree ignoring the gesture.

### Why the floor exists at all, and why lowering it is still safe

The floor is not arbitrary. A row cannot sit at the parent's level *between* that parent's
children — rendered back out, it would appear after the whole subtree, not where it was
dropped. So the position and the depth genuinely constrain each other.

The resolution is that **coming out of a group is a downward move**, and the projection already
knew how to express it. `ancestorOrSelfAtDepth(prev, depth)` walks up to the ancestor at the
requested depth and lands after it — so a shallower depth yields a legal position further down
the list, without any change to how positions are derived. Nothing is re-parented on the way:
`applyTreeDrop` splices the active node into the target parent's children, and no existing node
changes parent, so a subtree cannot be swallowed no matter how far left the pointer goes. That
last point retired a test whose comment feared exactly that; the fear did not survive being
checked against `applyTreeDrop`.

### The rule as shipped

The floor drops to the root **only for a deliberate leftward pull** (`Math.round(offsetX /
indentPx) < 0`), and stays at `next.depth` otherwise.

The asymmetry is load-bearing, and dropping the floor unconditionally is the obvious wrong fix:
a row dragged in from the root requests depth 0, so an unconditional floor of 0 would grant it
— turning every drop *into* a group into a drop past it. The horizontal gesture is what
separates "put this in there" from "take this out of there", and it is the only signal that
can.

The keyboard inherits it for free, ArrowLeft stepping out one enclosing group at a time to the
root, which is what "the keyboard uses the same projection as the pointer" is supposed to buy.

### The demo lied about the outcome, which is what made it feel broken

Two bugs read identically from the outside. `afterId` names the row the drop follows **among
its siblings**, which is not the row it follows **on screen**: lifting a document to the root
lands it after that ancestor's entire visible subtree. The playground drew the indicator
immediately below the ancestor's own row — several rows above where the document would actually
appear. So even the un-nests that *did* work looked like they had gone somewhere else.

Fixed in the playground by advancing the anchor to the last row of its subtree (in a flattened
tree, the rows that follow it while staying deeper). **Resolved by T8.4** (same day): after the
demo mis-derived the anchor a third time — the `into` box landing on the target's first child,
because `into` sets `beforeId` to that child — the projection now carries
`indicator: { rowId, edge, depth }`, the screen-space anchor resolved by the library. Three
failures by the best-placed consumer settled the question.

### Method note

Both halves of this were found by a person dragging a real tree, not by the suite. The 59 tree
tests all passed throughout, because they assert the projection against *the rule as written*.
A rule can be implemented perfectly and still be the wrong rule; only trying it tells you.

## A11 — One indent width: who owns it (2026-08-09)

*Opened by [T11.1](tasks/T11.1-indent-px-single-source.md). The defect is verified, not
theorised — see that task file for the reproduction table.*

`indentPx` is one physical quantity stored twice. The keyboard sensor emits a **pixel** step of
`±its own indentPx`; the tree projection recovers a step count as `round(offsetX / its own
indentPx)`. Both default to 24, so the composition is the identity and the seam is invisible.
Change either and one keypress silently means two levels, or none.

> **Decision: the tree publishes its indent to the store, and the keyboard sensor asks the
> session for it. The sensor's own constant is deleted.**

### Why not the alternatives

**Sensor emits units instead of pixels.** `translate` would then mean pixels for a pointer drag
and levels for a keyboard drag — the same field carrying two units, told apart only by which
sensor is active. Everything downstream that reads `translate.x` (the overlay, a horizontal
sortable list) would have to make the same distinction, and each one is a place to get it
wrong. It also leaks tree vocabulary into a sensor whose whole design is that it knows nothing
about trees (§ A9.1).

**One shared constant, two options.** Deletes the duplicated literal and leaves the defect:
`useTreeDrop({ indentPx: 16 })` alone still breaks the keyboard. It fails T11.1's first
acceptance criterion outright — the two must be configurable *independently* and still agree.

**DEV-mode warning on disagreement.** Deliberately **not** taken, though it composes with the
decision. This library has no `NODE_ENV` branch anywhere, and introducing the first one is its
own decision about build shape and about what the production bundle contains. A warning also
concedes the mismatch is expressible; the point of the chosen fix is that it is not.

### The shape

The store gains a cross-axis step size — the pixel distance one horizontal keyboard step should
cover — published by whoever knows it and read through the session:

```
useTreeDrop({ indentPx })            (the only place the number is authored)
↓  store.setCrossAxisStepPx(px)      (a registration: no notify, no render)
↓
keyboardSensor  ArrowLeft/ArrowRight
↓  session.crossAxisStepPx()
↓  session.move({ x: ±px, … })       (still a real pixel distance)
↓
projectTreeDrop  round(offsetX / indentPx) === ±1   by construction
```

`translate.x` stays what it always was, a pixel distance, so the overlay and every other reader
are untouched. The projection's arithmetic is unchanged. Only the source of the sensor's step
moves.

**This is the same shape as `findTargetInDirection`** (§ A9.1): the sensor states an intent it
cannot resolve alone, and the store — which holds the geometry — answers. Vertical steps already
worked this way. Horizontal ones were the outlier, guessing a number they had no business
knowing.

### What it costs

- **`keyboardSensor`'s `indentPx` becomes a fallback**, used only when nothing has published a
  step, and it no longer has a default constant. It stays because the tree maths is public:
  someone wiring `projectTreeDrop` by hand without `useTreeDrop` needs a lever. The tree wins
  when both exist, because the tree is what interprets the number.
- **Zero published steps means horizontal arrows do nothing**, which is honest: with no tree
  and no explicit option, nothing in the drag interprets a horizontal offset.
- **Two trees under one provider with different indents**: last mount wins. Cross-tree drags
  are already Backlog (§ A7 F10), and one drag belongs to one tree.
