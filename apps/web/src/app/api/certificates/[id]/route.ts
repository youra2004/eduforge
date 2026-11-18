import { getPublicCertificate } from '@eduforge/core';
import { getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The signed certificate and its status, for anyone with the link (F10-R3). `scripts/verify-certificate.mjs` reads this. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const cert = await getPublicCertificate(getDb(), id);
  if (!cert) return Response.json({ error: 'certificate_not_found' }, { status: 404 });
  return Response.json(cert);
});
