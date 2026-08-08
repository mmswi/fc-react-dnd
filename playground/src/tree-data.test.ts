import type { TreeItem } from 'fc-react-dnd/tree'
import { describe, expect, it } from 'vitest'
import { addChild, type Doc } from './tree-data.js'

/**
 * ```
 * docs
 *   guide
 *     install
 * notes
 * ```
 */
const TREE: readonly TreeItem<Doc>[] = [
  {
    id: 'docs',
    title: 'Docs',
    children: [{ id: 'guide', title: 'Guide', children: [{ id: 'install', title: 'Install' }] }],
  },
  { id: 'notes', title: 'Notes' },
]

const CHILD: TreeItem<Doc> = { id: 'new', title: 'New' }

const idsOf = (items: readonly TreeItem<Doc>[]) => items.map((item) => item.id)
const childrenOf = (items: readonly TreeItem<Doc>[], id: string): readonly TreeItem<Doc>[] => {
  for (const item of items) {
    if (item.id === id) return item.children ?? []
    const found = item.children ? childrenOf(item.children, id) : []
    if (found.length > 0) return found
  }
  return []
}

describe('addChild', () => {
  it('appends to the root when no parent is named', () => {
    expect(idsOf(addChild(TREE, null, CHILD))).toEqual(['docs', 'notes', 'new'])
  })

  it('appends to a parent that already has children', () => {
    expect(idsOf(childrenOf(addChild(TREE, 'docs', CHILD), 'docs'))).toEqual(['guide', 'new'])
  })

  it('gives a leaf its first children array', () => {
    expect(idsOf(childrenOf(addChild(TREE, 'notes', CHILD), 'notes'))).toEqual(['new'])
  })

  it('reaches a parent nested several levels down', () => {
    expect(idsOf(childrenOf(addChild(TREE, 'install', CHILD), 'install'))).toEqual(['new'])
  })

  it('leaves the rest of the tree alone', () => {
    const next = addChild(TREE, 'guide', CHILD)

    expect(idsOf(childrenOf(next, 'guide'))).toEqual(['install', 'new'])
    expect(idsOf(next)).toEqual(['docs', 'notes'])
  })

  it('keeps the identity of every branch it did not touch', () => {
    // Same reason applyTreeDrop shares structure: a memo'd row that did not change must not
    // re-render because an unrelated part of the tree gained a node.
    const next = addChild(TREE, 'notes', CHILD)

    expect(next[0]).toBe(TREE[0])
  })

  it('returns the tree untouched when the parent does not exist', () => {
    expect(addChild(TREE, 'nowhere', CHILD)).toBe(TREE)
  })
})
