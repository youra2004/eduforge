'use client';

import ReactPlayer from 'react-player';

export function VideoPlayer({ src, title }: { src: string; title: string }) {
  return (
    <div className="video-player" data-testid="video-player">
      <ReactPlayer src={src} controls title={title} width="100%" height="100%" />
    </div>
  );
}
