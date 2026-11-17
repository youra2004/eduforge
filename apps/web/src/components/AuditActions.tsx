'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendJson } from '@/lib/client';

type Action = 'audit' | 'publish' | 'reopen' | 'improve' | 'publish_9' | 'new-version';

/** The author's buttons for the current status: send to the audit, publish, go back to editing, choose after a rejection, start a new version. */
export function AuditActions({
  versionId,
  status,
  canSubmit,
  attemptsLeft,
  awaitingChoice,
  exhausted,
}: {
  versionId: string;
  status: string;
  canSubmit: boolean;
  attemptsLeft: number;
  awaitingChoice: boolean;
  /** An editable version whose audit runs are used up: it can only be copied. */
  exhausted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run(action: Action) {
    setBusy(action);
    setErrors([]);
    const base = `/api/courses/versions/${versionId}`;
    const res =
      action === 'audit'
        ? await sendJson(`${base}/audit`, 'POST')
        : action === 'publish'
          ? await sendJson(`${base}/publish`, 'POST')
          : action === 'reopen'
            ? await sendJson(`${base}/reopen`, 'POST')
            : action === 'new-version'
              ? await sendJson<{ versionId: string }>(`${base}/new-version`, 'POST')
              : await sendJson(`${base}/rejection`, 'POST', { choice: action });
    if (!res.ok) {
      setErrors(res.errors);
      setBusy(null);
      return;
    }
    if (action === 'new-version') {
      router.push(`/courses/${(res.data as { versionId: string }).versionId}`);
      return;
    }
    router.refresh();
    setBusy(null);
  }

  const button = (action: Action, label: string, testId: string, className?: string) => (
    <button
      type="button"
      className={className}
      onClick={() => run(action)}
      disabled={busy !== null}
      data-testid={testId}
    >
      {label}
    </button>
  );

  return (
    <div className="actions" data-testid="audit-actions">
      {(status === 'draft' || status === 'changes_requested') &&
        (canSubmit ? (
          <>
            {button('audit', 'Надіслати на аудит', 'submit-audit')}
            <span className="hint">Залишилось запусків аудиту: {attemptsLeft}</span>
          </>
        ) : (
          exhausted && (
            <>
              <span className="error">Ліміт аудитів цієї версії вичерпано.</span>
              {button('new-version', 'Продовжити в новій версії (копія)', 'new-version')}
            </>
          )
        ))}
      {status === 'ready_to_publish' && (
        <>
          {button('publish', 'Опублікувати', 'publish')}
          {attemptsLeft > 0 &&
            button('reopen', 'Повернутися до редагування', 'reopen', 'secondary')}
        </>
      )}
      {awaitingChoice && (
        <>
          {attemptsLeft > 0 &&
            button('improve', 'Продовжити покращення курсу', 'choose-improve', 'secondary')}
          {button('publish_9', 'Опублікувати з рейтингом 9', 'choose-publish-9')}
        </>
      )}
      {status === 'published' && button('new-version', 'Створити нову версію', 'new-version')}
      {errors.length > 0 && (
        <ul role="alert" className="error" data-testid="audit-errors">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
