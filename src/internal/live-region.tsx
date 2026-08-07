'use client'

import type { CSSProperties } from 'react'

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
