import { defineConfig } from 'vitest/config';

// Root config covers the SDK unit tests and the LiteSVM integration tests.
// The Next.js app has its own config (app/vitest.config.ts).
export default defineConfig({
  test: {
    include: ['sdk/**/*.test.ts', 'tests/**/*.test.ts', 'automation/**/*.test.ts'],
    pool: 'forks', // litesvm is a native addon
    testTimeout: 60_000,
  },
});
