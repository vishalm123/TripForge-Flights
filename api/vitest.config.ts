import { defineConfig } from 'vitest/config';
// import { processError } from 'vitest/internal/browser';

// Load the test database settings before any test file imports config.ts.
// try/catch: in CI there's no .env.test; the workflow sets env vars directly.
try { process.loadEnvFile('../.env.test'); } catch {  }

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,   // all test files share ONE database → run them one at a time
  },
});