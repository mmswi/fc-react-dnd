import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The playground exercises `src/`, never `dist/`.
 *
 * Every `fc-react-dnd/<subpath>` import resolves to the source module, so a change is visible on
 * the next hot update with no build step in between — and so what the demo demonstrates is the
 * code under test rather than an artefact of the build.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^fc-react-dnd\/(.*)$/,
        replacement: fileURLToPath(new URL('../src/$1', import.meta.url)),
      },
    ],
  },
})
