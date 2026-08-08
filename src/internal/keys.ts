/**
 * Keyboard values both sensors act on.
 *
 * One declaration rather than two identical string constants: the pointer sensor cancels on
 * Escape while a drag is running, and so does the keyboard sensor. Declared twice, they are two
 * unrelated symbols that happen to spell alike, and a rename touches one of them.
 */
export const ESCAPE_KEY = 'Escape'

export const DRAG_ACTIVATION_KEYS: readonly string[] = [' ', 'Enter']
