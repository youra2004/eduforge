'use client';

import { useState } from 'react';
import { sendJson } from '@/lib/client';
import { toast } from './Toaster';

/** Shown on the result of a passed exam while no certificate exists yet (no key, or a proctoring flag on hold). */
export function IssueCertificate({ examId, onDone }: { examId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function issue() {
    setBusy(true);
    setErrors([]);
    const res = await sendJson(`/api/exams/${examId}/certificate`, 'POST');
    if (res.ok) {
      toast('Сертифікат отримано');
      onDone();
    } else setErrors(res.errors);
    setBusy(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void issue()}
        disabled={busy}
        data-testid="issue-certificate"
      >
        Отримати сертифікат
      </button>
      {errors.map((e) => (
        <p key={e} role="alert" className="error" data-testid="certificate-error">
          {e}
        </p>
      ))}
    </div>
  );
}
