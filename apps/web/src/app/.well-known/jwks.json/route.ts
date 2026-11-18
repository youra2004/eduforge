import { listPublicKeys } from '@eduforge/core';
import { getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The public keys that verify certificates, as a JWK set (F10-R2). Public: no account needed. */
export const GET = route(async () => {
  return Response.json(
    { keys: await listPublicKeys(getDb()) },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
});
