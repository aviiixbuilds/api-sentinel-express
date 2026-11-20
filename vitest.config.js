import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.js'],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
        branches: 85,
      },
    },
  },
});
