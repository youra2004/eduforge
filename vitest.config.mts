import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one Postgres, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
