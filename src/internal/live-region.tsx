'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { DndAnnouncements } from '../types.js'
import type { DragStore } from './store.js'

/**
 * Off-screen but **not** `display: none` and **not** `hidden`. Either of those removes the
 * element from the accessibility tree as well as from the page, which for a description target
 * and a live region means removing exactly the users they exist for.
 */
const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  margin: -1,
  border: 0,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
}

type InstructionsProps = {
  id: string
  text: string
}

/**
 * The description every drag handle's `aria-describedby` points at, read out when a handle
 * receives focus. One per provider, with a provider-scoped id, so two providers on a page
 * cannot point their handles at each other's text.
 */
export const DragInstructions = ({ id, text }: InstructionsProps) => (
  <div id={id} style={VISUALLY_HIDDEN_STYLE}>
    {text}
  </div>
)

type LiveRegionProps = {
  store: DragStore
  announcements: DndAnnouncements
}

/**
 * Announces the drag as it happens.
 *
 * It subscribes to the store itself rather than being handed a message as a prop, which is what
 * keeps the provider out of the drag: this leaf re-renders per announcement and nothing above
 * it does. Announcements ride on the store's own events, so `onDragOver` firing **only on a
 * change** is what stops the region turning into noise on every pointermove.
 *
 * `role="status"` with `aria-live="assertive"`: a drag is a direct response to the user's own
 * action, so it should interrupt rather than queue behind whatever else is being read.
 */
export const DndLiveRegion = ({ store, announcements }: LiveRegionProps) => {
  const [message, setMessage] = useState('')

  const latestAnnouncements = useRef(announcements)
  useEffect(() => {
    latestAnnouncements.current = announcements
  })

  useEffect(
    () =>
      store.addMonitor({
        onDragStart: (event) => setMessage(latestAnnouncements.current.describeDragStart(event)),
        onDragOver: (event) => setMessage(latestAnnouncements.current.describeDragOver(event)),
        onDragEnd: (event) => setMessage(latestAnnouncements.current.describeDragEnd(event)),
        onDragCancel: (event) => setMessage(latestAnnouncements.current.describeDragCancel(event)),
      }),
    [store],
  )

  return (
    <div role="status" aria-live="assertive" aria-atomic="true" style={VISUALLY_HIDDEN_STYLE}>
      {message}
    </div>
  )
}
