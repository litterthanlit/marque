import { defineConfig } from 'vitest/config'

// Engine and store tests run in plain Node: Paper.js geometry works there
// without a DOM, so nothing needs jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
