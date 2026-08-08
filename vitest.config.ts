import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // The playground carries a little logic of its own (tree editing the library deliberately
    // does not own), and demo code is exactly where an untested off-by-one goes unnoticed.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'test/**/*.test.ts',
      'playground/src/**/*.test.ts',
    ],
  },
})
