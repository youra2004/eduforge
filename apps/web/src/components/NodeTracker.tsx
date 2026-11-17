'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/track';

/**
 * Research logging for a node page (P5): `content_opened` once, and a `session_heartbeat` every
 * `heartbeatSeconds` while the tab is visible, which is how learning time is measured. Renders nothing.
 */
export function NodeTracker({
  nodeId,
  heartbeatSeconds,
}: {
  nodeId: string;
  heartbeatSeconds: number;
}) {
  useEffect(() => {
    trackEvent({ name: 'content_opened', nodeId });
    const beat = () => {
      if (document.visibilityState === 'visible') trackEvent({ name: 'session_heartbeat', nodeId });
    };
    const timer = setInterval(beat, heartbeatSeconds * 1000);
    return () => clearInterval(timer);
  }, [nodeId, heartbeatSeconds]);
  return null;
}
