import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Everything below needs a DOM, and one suite deliberately runs without one.
 *
 * `ssr.test.tsx` asks for the `node` environment to prove the library renders on a server, and
 * setup files run there too — so `class … extends MouseEvent` at module scope would throw
 * before that suite could execute a line. Bailing out is what lets the SSR claim be tested at
 * all.
 */
const hasDom = typeof window !== 'undefined'

// jsdom has no layout engine and no pointer input, so a drag-and-drop suite running on it
// would be testing the absence of browser features rather than the library. Everything here
// is applied only when the real implementation is missing, so a future jsdom that ships one
// is used instead of being masked by ours.

if (hasDom) {
  type PointerEventInit = MouseEventInit & {
    pointerId?: number
    pointerType?: string
    isPrimary?: boolean
    width?: number
    height?: number
    pressure?: number
  }

  // A polyfilled DOM constructor has to be a class — `new PointerEvent(…)` is the contract.
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean
    readonly width: number
    readonly height: number
    readonly pressure: number

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? 'mouse'
      this.isPrimary = init.isPrimary ?? true
      this.width = init.width ?? 1
      this.height = init.height ?? 1
      this.pressure = init.pressure ?? 0.5
    }
  }

  const hasPointerEvent = typeof window.PointerEvent === 'function'
  if (!hasPointerEvent) {
    window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent
    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof globalThis.PointerEvent
  }

  // The pointer sensor captures the pointer so a drag survives the cursor leaving the element.
  // jsdom implements none of the three methods, and the set has to behave as a set: a captured
  // id must read back as captured, or a test can never tell capture from a silent no-op.
  const capturedPointerIds = new WeakMap<Element, Set<number>>()

  const pointerIdsCapturedBy = (element: Element): Set<number> => {
    const existing = capturedPointerIds.get(element)
    if (existing) return existing

    const created = new Set<number>()
    capturedPointerIds.set(element, created)
    return created
  }

  const hasPointerCaptureSupport = typeof Element.prototype.setPointerCapture === 'function'
  if (!hasPointerCaptureSupport) {
    Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number): void {
      pointerIdsCapturedBy(this).add(pointerId)
    }
    Element.prototype.releasePointerCapture = function releasePointerCapture(
      pointerId: number,
    ): void {
      pointerIdsCapturedBy(this).delete(pointerId)
    }
    Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number): boolean {
      return pointerIdsCapturedBy(this).has(pointerId)
    }
  }

  // The keyboard sensor calls this on every target change. Missing, it surfaces as a confusing
  // "not a function" from inside the sensor rather than as a harness gap.
  const hasScrollIntoView = typeof Element.prototype.scrollIntoView === 'function'
  if (!hasScrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {}
  }
}

afterEach(() => {
  cleanup()
})
