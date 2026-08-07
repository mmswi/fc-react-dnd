import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockElementRect, nextFrame } from './helpers.js'

describe('the jsdom harness', () => {
  it('polyfills PointerEvent so sensors can read pointerId and coordinates', () => {
    const event = new PointerEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 40,
      clientY: 90,
      isPrimary: true,
      button: 0,
    })

    expect(event.pointerId).toBe(7)
    expect(event.pointerType).toBe('mouse')
    expect(event.clientX).toBe(40)
    expect(event.clientY).toBe(90)
    expect(event.isPrimary).toBe(true)
  })

  it('polyfills the pointer-capture methods the pointer sensor calls', () => {
    const element = document.createElement('div')

    expect(() => element.setPointerCapture(1)).not.toThrow()
    expect(element.hasPointerCapture(1)).toBe(true)
    expect(() => element.releasePointerCapture(1)).not.toThrow()
    expect(element.hasPointerCapture(1)).toBe(false)
  })

  it('stubs scrollIntoView, which the keyboard sensor calls on every target change', () => {
    const element = document.createElement('div')

    expect(() => element.scrollIntoView()).not.toThrow()
  })
})

describe('mockElementRect', () => {
  it('is readable back through getBoundingClientRect', () => {
    const element = document.createElement('div')
    mockElementRect(element, { top: 10, left: 20, width: 100, height: 50 })

    const rect = element.getBoundingClientRect()

    expect(rect.top).toBe(10)
    expect(rect.left).toBe(20)
    expect(rect.width).toBe(100)
    expect(rect.height).toBe(50)
  })

  it('derives right and bottom, which collision math reads', () => {
    const element = document.createElement('div')
    mockElementRect(element, { top: 10, left: 20, width: 100, height: 50 })

    const rect = element.getBoundingClientRect()

    expect(rect.right).toBe(120)
    expect(rect.bottom).toBe(60)
  })

  it('mirrors the rect onto the offset properties a layout-free jsdom reports as zero', () => {
    const element = document.createElement('div')
    mockElementRect(element, { top: 10, left: 20, width: 100, height: 50 })

    expect(element.offsetWidth).toBe(100)
    expect(element.offsetHeight).toBe(50)
  })

  it('re-mocking replaces the previous rect rather than layering on it', () => {
    const element = document.createElement('div')
    mockElementRect(element, { top: 0, left: 0, width: 10, height: 10 })
    mockElementRect(element, { top: 5, left: 5, width: 20, height: 20 })

    const rect = element.getBoundingClientRect()

    expect(rect.top).toBe(5)
    expect(rect.width).toBe(20)
  })
})

describe('nextFrame', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a pending requestAnimationFrame callback under faked timers', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    let framesRun = 0
    requestAnimationFrame(() => {
      framesRun += 1
    })

    expect(framesRun).toBe(0)
    await nextFrame()

    expect(framesRun).toBe(1)
  })

  it('runs only the frame that was pending, not one a callback scheduled', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    let framesRun = 0
    const scheduleForever = () => {
      framesRun += 1
      requestAnimationFrame(scheduleForever)
    }
    requestAnimationFrame(scheduleForever)

    await nextFrame()

    expect(framesRun).toBe(1)
  })
})
