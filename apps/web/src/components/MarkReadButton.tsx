'use client';

import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/client';
import { toast } from './Toaster';

export function MarkReadButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await sendJson('/api/notifications/read', 'POST');
        toast('Усі сповіщення позначено прочитаними');
        router.refresh();
      }}
    >
      Позначити всі прочитаними
    </button>
  );
}
