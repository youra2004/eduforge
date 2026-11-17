'use client';

import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/client';

export function MarkReadButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await sendJson('/api/notifications/read', 'POST');
        router.refresh();
      }}
    >
      Позначити всі прочитаними
    </button>
  );
}
