'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { sendJson } from '@/lib/client';
import { checklistLabels } from '@/lib/messages';
import { toast } from './Toaster';

/** The expert's checklist and decision (D-10). Approval needs every item ticked; a rejection needs a comment for the author. */
export function ReviewForm({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setErrors([]);
    const res = await sendJson(`/api/reviews/${reviewId}/decision`, 'POST', {
      decision: submitter?.value,
      items: Object.fromEntries(Object.keys(checklistLabels).map((k) => [k, data.get(k) === 'on'])),
      comment: String(data.get('comment') ?? ''),
    });
    setBusy(false);
    if (!res.ok) return setErrors(res.errors);
    toast('Рішення збережено');
    router.refresh();
  }

  return (
    <form onSubmit={decide} data-testid="review-form">
      <fieldset className="options">
        <legend>Чек-лист експерта</legend>
        {Object.entries(checklistLabels).map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" name={key} />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        Коментар для автора (обовʼязковий, якщо відхиляєте)
        <textarea name="comment" rows={4} maxLength={5000} />
      </label>
      {errors.length > 0 && (
        <ul role="alert" className="error">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="submit" name="decision" value="approved" disabled={busy}>
          Схвалити рейтинг 10
        </button>
        <button
          type="submit"
          name="decision"
          value="rejected"
          className="secondary"
          disabled={busy}
        >
          Відхилити
        </button>
      </div>
    </form>
  );
}
