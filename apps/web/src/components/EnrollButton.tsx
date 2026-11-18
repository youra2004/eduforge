'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from './Toaster';

export function EnrollButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enroll() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/courses/versions/${versionId}/enroll`, { method: 'POST' });
    if (res.ok) {
      toast('Ви записані на курс');
      router.refresh();
    } else
      setError(
        ((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
          'Не вдалося записатися.',
      );
    setBusy(false);
  }
  return (
    <div>
      <button type="button" onClick={enroll} disabled={busy} aria-busy={busy} data-testid="enroll">
        Записатися на курс
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
