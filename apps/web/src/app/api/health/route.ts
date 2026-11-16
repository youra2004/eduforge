import { loadConfig } from '@eduforge/core';
import { checkHealth } from '@eduforge/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await checkHealth(loadConfig().databaseUrl);
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
