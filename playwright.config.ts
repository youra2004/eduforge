import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

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
    },
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
