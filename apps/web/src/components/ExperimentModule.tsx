'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

export type Step =
  | 'waiting'
  | 'pretest'
  | 'learning'
  | 'posttest'
  | 'survey'
  | 'delayed_wait'
  | 'delayed'
  | 'complete';

const STEPS = [
  { label: 'Вхідний тест', at: 0 },
  { label: 'Навчання', at: 1 },
  { label: 'Підсумковий тест', at: 2 },
  { label: 'Анкета', at: 3 },
  { label: 'Відкладений тест', at: 4 },
] as const;

const position: Record<Step, number> = {
  waiting: -1,
  pretest: 0,
  learning: 1,
  posttest: 2,
  survey: 3,
  delayed_wait: 4,
  delayed: 4,
  complete: 5,
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as {
    message?: string;
    assessment?: { id: string };
  } | null;
  return res.ok ? { json } : { error: json?.message ?? 'Щось пішло не так. Спробуйте ще раз.' };
}

/** One of the participant's two modules: its steps, where they are, and the one thing they can do next. */
export function ExperimentModule({
  module,
  title,
  versionId,
  condition,
  step,
  runningAssessmentId,
  dueLabel,
  survey,
}: {
  module: 'A' | 'B';
  title: string | null;
  versionId: string | null;
  condition: 'method' | 'control';
  step: Step;
  runningAssessmentId: string | null;
  dueLabel: string | null;
  /** The questionnaire, rendered by the server page. */
  survey: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = position[step];

  async function startTest(kind: 'pretest' | 'posttest' | 'delayed_posttest') {
    setBusy(true);
    setError(null);
    const r = await post(`/api/experiment/modules/${module}/test`, { kind });
    if (r.json?.assessment) router.push(`/assessments/${r.json.assessment.id}`);
    else {
      setError(r.error ?? null);
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const r = await post(`/api/experiment/modules/${module}/finish`);
    if (r.error) setError(r.error);
    else router.refresh();
    setBusy(false);
  }

  const testButton = (kind: 'pretest' | 'posttest' | 'delayed_posttest', label: string) => (
    <button
      type="button"
      onClick={() => startTest(kind)}
      disabled={busy}
      data-testid={`start-${kind}`}
    >
      {runningAssessmentId ? 'Продовжити тест' : label}
    </button>
  );

  return (
    <section className="experiment-module" data-testid="experiment-module" data-step={step}>
      <h2>
        Модуль {module}
        {title ? `: ${title}` : ''}{' '}
        <span className="muted" data-testid="module-condition">
          {condition === 'method' ? 'повна платформа' : 'вільний режим'}
        </span>
      </h2>
      <ol className="steps" aria-label="Кроки модуля">
        {STEPS.map((s) => (
          <li
            key={s.label}
            className={s.at < here ? 'done' : s.at === here ? 'current' : ''}
            aria-current={s.at === here ? 'step' : undefined}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {step === 'waiting' && (
        <p className="muted" data-testid="step-note">
          Цей модуль відкриється після завершення першого модуля й анкети до нього.
        </p>
      )}
      {step === 'pretest' && (
        <>
          <p data-testid="step-note">
            Спершу вхідний тест: він показує, що ви знаєте до навчання. Підказок і правильних
            відповідей під час тесту немає.
          </p>
          {testButton('pretest', 'Пройти вхідний тест')}
        </>
      )}
      {step === 'learning' && (
        <>
          <p data-testid="step-note">
            {condition === 'method'
              ? 'Проходьте вузли графа: наступний відкривається, коли ви підтвердите розуміння попередніх. Репетитор допоможе підказками. Модуль завершиться, коли пройдено всі вузли.'
              : 'Вільний режим: усі вузли відкриті, порядок обираєте самі. Тестів вузлів і репетитора тут немає, але можна самоперевірятися практичними вправами. Коли будете готові, завершіть навчання.'}
          </p>
          <p>
            {versionId && (
              <Link href={`/courses/${versionId}`} data-testid="open-course">
                До матеріалів модуля
              </Link>
            )}
          </p>
          {condition === 'control' && (
            <button type="button" onClick={finish} disabled={busy} data-testid="finish-learning">
              Я завершив(-ла) навчання
            </button>
          )}
        </>
      )}
      {step === 'posttest' && (
        <>
          <p data-testid="step-note">Навчання завершено. Тепер підсумковий тест.</p>
          {testButton('posttest', 'Пройти підсумковий тест')}
        </>
      )}
      {step === 'survey' && (
        <>
          <p data-testid="step-note">Остання частина модуля: коротка анкета.</p>
          {survey}
        </>
      )}
      {step === 'delayed_wait' && (
        <p className="muted" data-testid="step-note">
          Модуль пройдено. Відкладений тест буде доступний {dueLabel}.
        </p>
      )}
      {step === 'delayed' && (
        <>
          <p data-testid="step-note">
            Час пройти відкладений тест: він показує, що ви запамʼятали.
          </p>
          {testButton('delayed_posttest', 'Пройти відкладений тест')}
        </>
      )}
      {step === 'complete' && (
        <p data-testid="step-note">Усі кроки цього модуля виконано. Дякуємо!</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
