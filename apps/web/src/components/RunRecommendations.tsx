'use client';

import { useState } from 'react';
import type { RecommendationRun } from '@eduforge/core';
import { sendJson } from '@/lib/client';
import { recommendationOutcomeLabels } from '@/lib/messages';

const SHOWN = 30;
const order = { created: 0, failed: 1, unchanged: 2, already_today: 3, no_data: 4 } as const;

/** Admin: runs the daily recommendation job now and shows what it did for every student (F7-R3, D-32). */
export function RunRecommendations() {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RecommendationRun | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function start() {
    setBusy(true);
    setErrors([]);
    const res = await sendJson<{ run: RecommendationRun }>(
      '/api/admin/recommendations/run',
      'POST',
    );
    if (res.ok) setRun(res.data!.run);
    else setErrors(res.errors);
    setBusy(false);
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={busy} data-testid="run-recommendations">
        {busy ? 'Виконується…' : 'Запустити зараз'}
      </button>
      {errors.map((e) => (
        <p key={e} role="alert" className="error">
          {e}
        </p>
      ))}
      {run && (
        <div data-testid="run-result">
          <p>
            Створено: <strong data-testid="run-created">{run.counts.created}</strong> · без змін:{' '}
            {run.counts.unchanged} · вже є на сьогодні: {run.counts.already_today} · замало даних:{' '}
            {run.counts.no_data} · помилок: {run.counts.failed}
          </p>
          <table>
            <thead>
              <tr>
                <th>Студент</th>
                <th>Email</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {[...run.users]
                .sort((a, b) => order[a.outcome] - order[b.outcome])
                .slice(0, SHOWN)
                .map((u) => (
                  <tr key={u.userId} data-testid="run-row">
                    <td>{u.displayName}</td>
                    <td>{u.email}</td>
                    <td>{recommendationOutcomeLabels[u.outcome]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {run.users.length > SHOWN && (
            <p className="hint">
              Показано {SHOWN} із {run.users.length} студентів: спершу створені поради та помилки.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
