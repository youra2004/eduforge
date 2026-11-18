'use client';

import { useState } from 'react';
import { sendJson } from '@/lib/client';

/** The appeal form (F9-R6): the student explains, an admin decides. */
export function StrikeAppeal({ strikeId, onDone }: { strikeId: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function submit() {
    setBusy(true);
    setErrors([]);
    const res = await sendJson(`/api/strikes/${strikeId}/appeal`, 'POST', { text });
    if (res.ok) onDone();
    else setErrors(res.errors.length ? ['Опишіть ситуацію щонайменше десятьма символами.'] : []);
    setBusy(false);
  }

  return (
    <form
      data-testid="appeal-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Не згодні? Опишіть, що сталося — апеляцію розгляне адміністратор
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="appeal-text"
        />
      </label>
      <button type="submit" disabled={busy || text.trim().length < 10} data-testid="appeal-submit">
        Подати апеляцію
      </button>
      {errors.map((e) => (
        <p key={e} role="alert" className="error">
          {e}
        </p>
      ))}
    </form>
  );
}
