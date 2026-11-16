import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Next only reads .env from apps/web; the shared one lives at the repo root.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@eduforge/core', '@eduforge/db'],
  serverExternalPackages: ['pg'],
  agentRules: false,
};

export default nextConfig;
