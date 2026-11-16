import {
  AuthError,
  canUploadVideo,
  CourseError,
  loadConfig,
  MAX_VIDEO_BYTES,
  saveVideo,
} from '@eduforge/core';
import { getCurrentUser, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Uploads one mp4 as the raw request body (`Content-Type: video/mp4`) and returns its storage key. */
export const POST = route(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('unauthenticated');
  if (!canUploadVideo(user)) throw new AuthError('forbidden');
  // Browsers cannot send this content type cross-site without a CORS preflight, which blocks CSRF.
  if (req.headers.get('content-type')?.toLowerCase() !== 'video/mp4' || !req.body) {
    throw new CourseError('invalid_content', [
      {
        code: 'schema',
        message: 'Send the mp4 file as the request body with Content-Type: video/mp4.',
      },
    ]);
  }
  if (Number(req.headers.get('content-length')) > MAX_VIDEO_BYTES) {
    throw new CourseError('invalid_content', [
      { code: 'schema', message: 'The video is too large.' },
    ]);
  }
  const saved = await saveVideo(loadConfig().storageDir, req.body);
  return Response.json(saved, { status: 201 });
});
