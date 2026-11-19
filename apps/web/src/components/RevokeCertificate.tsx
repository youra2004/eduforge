'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendJson } from '@/lib/client';
import { toast } from './Toaster';

/** Admin: revoke with a reason (F10-R4). The reason is kept for admins; the public page only says "revoked". */
export function RevokeCertificate({ certificateId }: { certificateId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function revoke() {
    setBusy(true);
    setErrors([]);
    const res = await sendJson(`/api/admin/certificates/${certificateId}/revoke`, 'POST', {
      reason,
    });
    if (res.ok) {
      toast('Сертифікат відкликано');
      router.refresh();
    } else setErrors(res.errors);
    setBusy(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void revoke();
      }}
    >
      <label>
        Причина відкликання
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          data-testid="revoke-reason"
        />
      </label>
      <button
        type="submit"
        className="secondary"
        disabled={busy || reason.trim().length < 3}
        data-testid="revoke-submit"
      >
        Відкликати
      </button>
      {errors.map((e) => (
        <p key={e} role="alert" className="error">
          {e}
        </p>
      ))}
    </form>
  );
}
