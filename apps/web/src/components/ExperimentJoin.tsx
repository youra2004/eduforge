'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Informed consent for the study (RESEARCH.md §6). Nothing is recorded until the box is ticked and the button pressed. */
export function ExperimentJoin({ consentVersion }: { consentVersion: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/experiment/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    });
    if (res.ok) router.refresh();
    else {
      setError(
        ((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
          'Не вдалося приєднатися.',
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={join} data-testid="experiment-join">
      <label className="check">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          data-testid="research-consent"
        />
        <span>
          Я прочитав(-ла) опис дослідження і погоджуюся взяти в ньому участь. Я знаю, що можу
          припинити участь будь-коли без наслідків.{' '}
          <span className="hint">(версія {consentVersion})</span>
        </span>
      </label>
      <button
        type="submit"
        disabled={!agreed || busy}
        aria-busy={busy}
        data-testid="join-experiment"
      >
        Взяти участь
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
