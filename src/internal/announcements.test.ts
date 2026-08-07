import { describe, expect, it } from 'vitest'
import {
  DRAG_CANCEL_REASONS,
  type DragActive,
  type DragCancelReason,
  type DragOver,
} from '../types.js'
import { DEFAULT_ANNOUNCEMENTS } from './announcements.js'

const rect = { top: 0, left: 0, width: 100, height: 40 }
const active: DragActive = { id: 'Invoices', data: {}, initialRect: rect, rect }
const over: DragOver = { id: 'Archive', data: {}, rect }

const cancelTextFor = (reason: DragCancelReason) =>
  DEFAULT_ANNOUNCEMENTS.describeDragCancel({ active, over: null, reason })

describe('DEFAULT_ANNOUNCEMENTS', () => {
  it('names the item on pickup and says how to continue', () => {
    const text = DEFAULT_ANNOUNCEMENTS.describeDragStart({ active, over: null })

    expect(text).toContain('Invoices')
    expect(text).toMatch(/arrow keys/i)
  })

  it('names both sides when over a target, and says so when over nothing', () => {
    expect(DEFAULT_ANNOUNCEMENTS.describeDragOver({ active, over })).toContain('Archive')
    expect(DEFAULT_ANNOUNCEMENTS.describeDragOver({ active, over: null })).toMatch(
      /not over a drop target/i,
    )
  })

  it('reports where the item landed, and that nothing moved when it landed nowhere', () => {
    const dropped = DEFAULT_ANNOUNCEMENTS.describeDragEnd({
      active,
      over,
      translate: { x: 0, y: 0 },
    })
    const droppedNowhere = DEFAULT_ANNOUNCEMENTS.describeDragEnd({
      active,
      over: null,
      translate: { x: 0, y: 0 },
    })

    expect(dropped).toContain('Archive')
    expect(droppedNowhere).toMatch(/nothing moved/i)
  })
})

describe('cancel texts branch on the reason — but only where it matters', () => {
  it('gives item-removed its own text, because "cancelled" would be a lie', () => {
    // The user cancelled nothing, and a screen-reader user has no other way to learn what
    // happened to the drag they were in the middle of.
    const text = cancelTextFor(DRAG_CANCEL_REASONS.itemRemoved)

    expect(text).toMatch(/list changed/i)
    expect(text).not.toMatch(/cancelled/i)
    expect(text).toContain('Invoices')
    expect(text).toMatch(/starting position/i)
  })

  it('shares one text across escape, blur, and a browser-revoked pointer', () => {
    // From the user's point of view the drag simply stopped; three near-identical strings
    // would be noise.
    const escapeText = cancelTextFor(DRAG_CANCEL_REASONS.escape)

    expect(cancelTextFor(DRAG_CANCEL_REASONS.blur)).toBe(escapeText)
    expect(cancelTextFor(DRAG_CANCEL_REASONS.pointerCancelled)).toBe(escapeText)
    expect(escapeText).toMatch(/cancelled/i)
  })

  it('always says the item went back, whichever reason fired', () => {
    for (const reason of Object.values(DRAG_CANCEL_REASONS)) {
      expect(cancelTextFor(reason)).toMatch(/starting position/i)
    }
  })
})
