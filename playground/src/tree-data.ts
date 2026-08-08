import type { TreeItem } from 'fc-react-dnd/tree'
import type { DndId } from 'fc-react-dnd/types'

/**
 * Tree *editing*, which the library deliberately does not own.
 *
 * `fc-react-dnd/tree` answers where a drop lands and applies it; creating and naming nodes is
 * the app's business, so it lives here. Kept pure and free of runtime imports so it can be
 * tested without rendering anything — the same property that makes the library's own tree maths
 * testable under plain Node.
 */

/** A document. There is no separate "folder" kind — any document can gain children. */
export type Doc = { title: string }

/**
 * `parent`'s children with `child` appended, or the root list when `parentId` is `null`.
 *
 * Branches that did not change keep their identity, for the reason `applyTreeDrop` shares
 * structure: a memo'd row must not re-render because an unrelated part of the tree gained a
 * node. An unknown `parentId` returns the original array, so a stale id is a no-op rather than
 * a silent drop.
 */
export const addChild = (
  items: readonly TreeItem<Doc>[],
  parentId: DndId | null,
  child: TreeItem<Doc>,
): readonly TreeItem<Doc>[] => {
  if (parentId === null) return [...items, child]

  let changed = false
  const next = items.map((item) => {
    if (item.id === parentId) {
      changed = true
      return { ...item, children: [...(item.children ?? []), child] }
    }

    if (!item.children) return item

    const children = addChild(item.children, parentId, child)
    if (children === item.children) return item

    changed = true
    return { ...item, children }
  })

  return changed ? next : items
}
