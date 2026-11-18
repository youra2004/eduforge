'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { sendJson } from '@/lib/client';
import { toast } from './Toaster';

/** An admin picks the expert for a course under review (D-03, D-10). */
export function ReviewAssign({
  versionId,
  experts,
  currentExpertName,
  decided,
}: {
  versionId: string;
  experts: { id: string; displayName: string }[];
  currentExpertName: string | null;
  decided: boolean;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setErrors([]);
    const res = await sendJson('/api/admin/reviews', 'POST', {
      versionId,
      expertId: String(data.get('expertId')),
    });
    setBusy(false);
    if (!res.ok) return setErrors(res.errors);
    toast('Експерта призначено');
    router.refresh();
  }

  if (decided) return <span className="muted">Рішення ухвалено</span>;
  if (experts.length === 0)
    return <span className="muted">Немає користувачів з роллю «Експерт»</span>;
  return (
    <form onSubmit={submit} className="inline-form" data-testid="assign-form">
      <label>
        Експерт
        <select name="expertId" required>
          {experts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.displayName}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {currentExpertName ? 'Перепризначити' : 'Призначити'}
      </button>
      {errors.length > 0 && (
        <ul role="alert" className="error">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
