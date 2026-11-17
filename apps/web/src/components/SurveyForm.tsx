'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export interface SurveyItem {
  key: string;
  text: string;
}

/** The short Likert questionnaire after a module (RESEARCH.md §2): every item, 1–5. */
export function SurveyForm({
  module,
  items,
  labels,
}: {
  module: string;
  items: readonly SurveyItem[];
  labels: readonly string[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = items.every((i) => answers[i.key]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/experiment/modules/${module}/survey`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (res.ok) router.refresh();
    else {
      setError(
        ((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
          'Не вдалося надіслати анкету.',
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="survey-form" className="survey">
      <p className="hint">
        1 — «{labels[0]}», 5 — «{labels[labels.length - 1]}».
      </p>
      {items.map((item) => (
        <fieldset key={item.key} className="likert" data-testid="survey-item">
          <legend>{item.text}</legend>
          {labels.map((label, i) => (
            <label key={i} className="check likert-option" title={label}>
              <input
                type="radio"
                name={item.key}
                checked={answers[item.key] === i + 1}
                onChange={() => setAnswers((a) => ({ ...a, [item.key]: i + 1 }))}
              />
              {i + 1}
            </label>
          ))}
        </fieldset>
      ))}
      <button type="submit" disabled={!complete || busy} data-testid="submit-survey">
        Надіслати
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
