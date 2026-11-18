import { createLLMClient, issueCertificate } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The student asks for the certificate of a passed exam; asking again returns the same one (F10). */
export const POST = route(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = getDb();
    const certificate = await issueCertificate(db, createLLMClient(db), await getCurrentUser(), id);
    return Response.json({ certificate });
  },
);
