'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendJson } from '@/lib/client';
import { toast } from './Toaster';

type Outcome = 'confirm' | 'dismiss' | 'overturn' | 'reject';

/** The admin's buttons for one case: a flagged attempt (confirm / dismiss) or an appeal (overturn / reject). */
export function StrikeReview({ strikeId, status }: { strikeId: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(outcome: Outcome) {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/admin/strikes/${strikeId}/review`, 'POST', { outcome, note });
    if (res.ok) {
      toast('Рішення збережено');
      router.refresh();
    } else setError(res.errors.join(' '));
    setBusy(false);
  }

  const buttons: [Outcome, string, boolean][] =
    status === 'appealed'
      ? [
          ['overturn', 'Скасувати порушення', false],
          ['reject', 'Відхилити апеляцію', true],
        ]
      : [
          ['confirm', 'Підтвердити порушення', false],
          ['dismiss', 'Відхилити', true],
        ];

  return (
    <div className="stack">
      <label>
        Примітка
        <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="review-note" />
      </label>
      <p className="actions" style={{ margin: 0 }}>
        {buttons.map(([outcome, label, secondary]) => (
          <button
            key={outcome}
            type="button"
            className={secondary ? 'secondary' : undefined}
            disabled={busy}
            onClick={() => void decide(outcome)}
            data-testid={`strike-${outcome}`}
          >
            {label}
          </button>
        ))}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
