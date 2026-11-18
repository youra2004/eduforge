import { examSettings, getEvidenceFrame } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The decrypted frame of a triggered event, for an admin looking at a case (F9-R7). Never cached. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const frame = await getEvidenceFrame(getDb(), await getCurrentUser(), id, examSettings().proctor);
  return new Response(new Uint8Array(frame), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
  });
});
