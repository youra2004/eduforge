'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Reloads the server-rendered page now and then, for a status that the worker will change (an audit in progress). */
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
