import { revokeCertificate } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** An admin revokes a certificate with a reason (F10-R4). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const revoked = await revokeCertificate(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  return Response.json({ certificate: revoked });
});
