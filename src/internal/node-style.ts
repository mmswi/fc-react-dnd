import type { DragNodeStyle, Translate } from '../types.js'

/**
 * Builds the style a moving element wears, from a translate and an optional easing.
 *
 * Shared by `useDraggable` and `useSortable` so the two cannot drift: a draggable that composed
 * its transform string differently from a sortable would be a difference nobody could see until
 * a consumer mixed the hooks in one list.
 */

/** No transform at all when nothing has moved — see `DragNodeStyle` for why not identity. */
const hasMoved = (translate: Translate): boolean => translate.x !== 0 || translate.y !== 0

export const buildNodeStyle = (
  translate: Translate | null,
  transition: string | undefined,
): DragNodeStyle => ({
  touchAction: 'none',
  ...(translate !== null &&
    hasMoved(translate) && {
      transform: `translate3d(${translate.x}px, ${translate.y}px, 0)`,
    }),
  ...(transition !== undefined && { transition }),
})
