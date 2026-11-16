import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getVideoFile, loadConfig } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Parses a single `bytes=a-b` range. Returns null when it is absent or unsatisfiable. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  start = Math.max(start, 0);
  return start <= end && start < size ? { start, end } : null;
}

export const GET = route(async (req: Request, { params }: { params: Promise<{ key: string }> }) => {
  const { key } = await params;
  const { path, size } = await getVideoFile(
    getDb(),
    await getCurrentUser(),
    loadConfig().storageDir,
    key,
  );
  const headers = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
  };
  const rangeHeader = req.headers.get('range');
  const range = parseRange(rangeHeader, size);
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${size}` },
    });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      ...(range && { 'content-range': `bytes ${start}-${end}/${size}` }),
    },
  });
});
