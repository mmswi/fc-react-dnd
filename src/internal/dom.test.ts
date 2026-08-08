import { describe, expect, it } from 'vitest'
import { readElementRect, translationOfTransform } from './dom.js'

describe('translationOfTransform', () => {
  it('reads the translation out of a 2D matrix', () => {
    expect(translationOfTransform('matrix(1, 0, 0, 1, 12, -34)')).toEqual({ x: 12, y: -34 })
  })

  it('reads it out of a 3D matrix, where it sits at m41 and m42', () => {
    expect(
      translationOfTransform('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 9, 0, 1)'),
    ).toEqual({ x: 7, y: 9 })
  })

  it('reads the shorthand forms jsdom hands back instead of a matrix', () => {
    // A browser resolves every transform to a matrix; jsdom returns what was written. Handling
    // only the matrix forms would make the correction silently do nothing under test.
    expect(translationOfTransform('translate3d(0px, 120px, 0px)')).toEqual({ x: 0, y: 120 })
    expect(translationOfTransform('translate(8px, -3px)')).toEqual({ x: 8, y: -3 })
    expect(translationOfTransform('translateY(42px)')).toEqual({ x: 0, y: 42 })
    expect(translationOfTransform('translateX(-11px)')).toEqual({ x: -11, y: 0 })
  })

  it('treats an untransformed element as untranslated', () => {
    expect(translationOfTransform('none')).toEqual({ x: 0, y: 0 })
    expect(translationOfTransform('')).toEqual({ x: 0, y: 0 })
  })

  it('does not guess at a transform it cannot parse', () => {
    expect(translationOfTransform('rotate(45deg)')).toEqual({ x: 0, y: 0 })
    expect(translationOfTransform('matrix(nonsense)')).toEqual({ x: 0, y: 0 })
  })
})

describe('readElementRect', () => {
  it('reports where a row rests, not where a running animation has it', () => {
    // The bug this exists to prevent: a drag started while the previous drop's transition is
    // still animating measures every row mid-flight, and the projection is then built on
    // geometry that is about to stop being true. It reads as "the second drag broke".
    const element = document.createElement('div')
    element.getBoundingClientRect = () =>
      ({ top: 300, left: 40, width: 200, height: 50 }) as DOMRect
    element.style.transform = 'matrix(1, 0, 0, 1, 0, 120)'
    document.body.append(element)

    expect(readElementRect(element)).toEqual({ top: 180, left: 40, width: 200, height: 50 })
  })

  it('leaves an untransformed rect alone', () => {
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({ top: 10, left: 20, width: 100, height: 40 }) as DOMRect
    document.body.append(element)

    expect(readElementRect(element)).toEqual({ top: 10, left: 20, width: 100, height: 40 })
  })
})
