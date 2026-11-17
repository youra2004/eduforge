'use client';

import { useRef } from 'react';
import ReactPlayer from 'react-player';
import { trackEvent } from '@/lib/track';

/** With `track`, playback progress is logged as `video_progress` every 10 s of playing time and at the end. */
export function VideoPlayer({
  src,
  title,
  track,
}: {
  src: string;
  title: string;
  track?: { nodeId: string; contentItemId: string };
}) {
  const lastBucket = useRef(-1);
  const send = (el: HTMLVideoElement, ended: boolean) => {
    if (!track) return;
    trackEvent({
      name: 'video_progress',
      ...track,
      positionSeconds: el.currentTime,
      ...(Number.isFinite(el.duration) ? { durationSeconds: el.duration } : {}),
      ...(ended ? { ended: true } : {}),
    });
  };
  return (
    <div className="video-player" data-testid="video-player">
      <ReactPlayer
        src={src}
        controls
        title={title}
        width="100%"
        height="100%"
        onTimeUpdate={(e) => {
          const el = e.currentTarget as HTMLVideoElement;
          const bucket = Math.floor(el.currentTime / 10);
          if (bucket !== lastBucket.current) {
            lastBucket.current = bucket;
            send(el, false);
          }
        }}
        onEnded={(e) => send(e.currentTarget as HTMLVideoElement, true)}
      />
    </div>
  );
}
