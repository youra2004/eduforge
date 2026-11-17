import { AuthError, EXPORT_TABLES, exportCsv, requireRole, type ExportTable } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** `?table=modules|answers|events|tutor`: the de-identified CSV for the analysis (pseudonyms only). Admin only. */
export const GET = route(async (req: Request) => {
  requireRole(await getCurrentUser(), 'admin');
  const table = new URL(req.url).searchParams.get('table') ?? 'modules';
  if (!EXPORT_TABLES.includes(table as ExportTable)) throw new AuthError('invalid_input');
  const csv = await exportCsv(getDb(), table as ExportTable);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="eduforge-${table}.csv"`,
    },
  });
});
