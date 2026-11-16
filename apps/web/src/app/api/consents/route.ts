import { AuthError, CONSENT_VERSIONS, recordConsent, requireRole } from '@eduforge/core';
import { consentKinds } from '@eduforge/db';
import { z } from 'zod';
import { getCurrentUser, getDb, readJson, route } from '@/lib/server';

// Records that the signed-in user accepted the current version of a consent text.
export const POST = route(async (req: Request) => {
  const user = requireRole(await getCurrentUser(), 'student', 'author', 'expert', 'admin');
  const body = z.object({ kind: z.enum(consentKinds) }).safeParse(await readJson(req));
  if (!body.success) throw new AuthError('invalid_input');
  const row = await recordConsent(getDb(), user.id, body.data.kind);
  return Response.json(
    { kind: row.kind, version: CONSENT_VERSIONS[row.kind], givenAt: row.givenAt },
    { status: 201 },
  );
});
