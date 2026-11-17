import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// The study's two topics get fresh slugs per run, so reruns do not collide in the dev database.
const run = Date.now().toString(36);
process.env.EXPERIMENT_COURSE_A ??= `e2e-a-${run}`;
process.env.EXPERIMENT_COURSE_B ??= `e2e-b-${run}`;

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'pnpm --filter @eduforge/web dev',
    // Uploaded videos of the e2e run go to a throwaway directory, not to ~/.eduforge.
    env: {
      PORT: String(port),
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'eduforge-e2e-')),
      // The node pause (24 h) lasts 60 s, so the e2e run can show it.
      TIME_SCALE: '1440',
      EXPERIMENT_COURSE_A: process.env.EXPERIMENT_COURSE_A,
      EXPERIMENT_COURSE_B: process.env.EXPERIMENT_COURSE_B,
      // The 24 h wait before the delayed test lasts 10 s here, and the heartbeat comes every 2 s.
      EXPERIMENT_DELAY_SECONDS: '14400',
      EXPERIMENT_HEARTBEAT_SECONDS: '2',
    },
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
