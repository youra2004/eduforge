import { AuthError, CONSENT_VERSIONS, recordConsent, requireRole } from '@eduforge/core';
import { consentKinds, type ConsentKind } from '@eduforge/db';
import { getCurrentUser, getDb, readJson, route } from '@/lib/server';

// Records that the signed-in user accepted the current version of a consent text.
export const POST = route(async (req: Request) => {
  const user = requireRole(await getCurrentUser(), 'student', 'author', 'expert', 'admin');
  const { kind } = (await readJson(req)) as { kind?: string };
  if (!consentKinds.includes(kind as ConsentKind)) throw new AuthError('invalid_input');
  const row = await recordConsent(getDb(), user.id, kind as ConsentKind);
  return Response.json(
    { kind: row.kind, version: CONSENT_VERSIONS[row.kind], givenAt: row.givenAt },
    { status: 201 },
  );
});
