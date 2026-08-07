'use client'

import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDndContext } from './internal/context.js'
import { useStoreSelector } from './internal/use-store-selector.js'
import type { Translate } from './types.js'

/**
 * An element that follows the pointer with **zero React renders per move**.
 *
 * It subscribes to the store *outside* React's render cycle and writes `style.transform`
 * straight to its own node inside `requestAnimationFrame`. React is involved exactly twice per
 * drag — once to mount it, once to unmount it — and the pointer stream in between never reaches
 * the reconciler at all.
 *
 * Drop animation is deliberately out of scope for v0.1 (Backlog).
 */

const OVERLAY_BASE_STYLE: CSSProperties = {
  position: 'fixed',
  margin: 0,
  // Never intercept a pointer event: the droppables underneath have to stay hit-testable, and
  // the overlay sits directly under the cursor for the whole drag.
  pointerEvents: 'none',
}

export type DragOverlayProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  'data-testid'?: string
}

const transformFor = (translate: Translate): string =>
  `translate3d(${translate.x}px, ${translate.y}px, 0)`

export const DragOverlay = ({ children, className, style, ...rest }: DragOverlayProps) => {
  const { store } = useDndContext('DragOverlay')
  // The origin's identity survives every move, so this re-renders on drag start and drag end
  // and at no other time.
  const origin = useStoreSelector(store, (state) => state.origin)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!origin) return

    let pendingFrame: number | null = null

    const writeLatestPosition = (): void => {
      pendingFrame = null
      const node = nodeRef.current
      if (node) node.style.transform = transformFor(store.getState().translate)
    }

    // Coalesced to one write per frame at most: a 120 Hz pointer stream produces at most 60
    // style writes a second, each carrying the newest position rather than a queued old one.
    const scheduleWrite = (): void => {
      if (pendingFrame === null) pendingFrame = requestAnimationFrame(writeLatestPosition)
    }

    scheduleWrite()
    const unsubscribe = store.subscribe(scheduleWrite)

    return () => {
      unsubscribe()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
    }
  }, [store, origin])

  if (!origin) return null

  return createPortal(
    <div
      ref={nodeRef}
      className={className}
      style={{
        ...OVERLAY_BASE_STYLE,
        top: origin.rect.top,
        left: origin.rect.left,
        width: origin.rect.width,
        height: origin.rect.height,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  )
}
