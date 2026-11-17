'use client';

import Link from 'next/link';
import { useState } from 'react';
import { QuestionForm, type StudentQuestion } from './QuestionForm';

export interface AssessmentView {
  id: string;
  nodeId: string;
  versionId: string;
  status: 'in_progress' | 'passed' | 'failed' | 'submitted' | 'interrupted' | 'annulled';
  roundNo: number;
  attemptNo: number;
  attemptsPerRound: number;
  items: {
    id: string;
    ord: number;
    answered: boolean;
    isCorrect: boolean | null;
    question: StudentQuestion;
  }[];
  result: {
    passed: boolean;
    scorePct: number | null;
    threshold: number;
    perSkill: { skillId: string; name: string; pKnown: number }[];
    node: { state: string; attemptsInRound: number; cooldownUntil: string | null } | null;
  } | null;
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

export function TestRunner({ initial, serverNow }: { initial: AssessmentView; serverNow: string }) {
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = a.items.find((i) => !i.answered);

  async function answer(value: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/assessments/${a.id}/items/${current!.id}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: value }),
    });
    const json = (await res.json().catch(() => null)) as {
      assessment?: AssessmentView;
      message?: string;
    } | null;
    if (res.ok && json?.assessment) setA(json.assessment);
    else setError(json?.message ?? 'Щось пішло не так. Спробуйте ще раз.');
    setBusy(false);
  }

  if (a.result) {
    const r = a.result;
    const node = r.node;
    return (
      <div data-testid="test-result">
        <h1 data-testid="result-verdict">{r.passed ? 'Вузол пройдено' : 'Поки що не пройдено'}</h1>
        <p className="muted">
          Раунд {a.roundNo}, спроба {a.attemptNo} з {a.attemptsPerRound} · правильних відповідей{' '}
          {Math.round(r.scorePct ?? 0)} %
        </p>
        <h2>Рівень навичок</h2>
        <p className="hint">Для проходження кожна навичка має досягти {pct(r.threshold)}.</p>
        <ul className="skills" data-testid="skill-levels">
          {r.perSkill.map((s) => (
            <li key={s.skillId} data-testid="skill-level">
              <span>{s.name}</span>
              <span className="bar" aria-hidden>
                <span
                  className={s.pKnown >= r.threshold ? 'fill ok' : 'fill'}
                  style={{ width: pct(s.pKnown) }}
                />
              </span>
              <strong>{pct(s.pKnown)}</strong>
            </li>
          ))}
        </ul>
        <h2>Відповіді</h2>
        <ol data-testid="answer-list">
          {a.items.map((i) => (
            <li key={i.id}>
              {i.question.promptMd} — {i.isCorrect ? 'вірно' : 'невірно'}
            </li>
          ))}
        </ol>
        {r.passed && (
          <p data-testid="next-step">Наступні вузли, для яких пройдено всі попередні, відкрито.</p>
        )}
        {!r.passed && node?.state === 'cooldown' && node.cooldownUntil && (
          <p className="error" data-testid="next-step">
            Обидві спроби раунду використано. Нова спроба буде доступна після паузи, ще приблизно{' '}
            {Math.ceil(
              (new Date(node.cooldownUntil).getTime() - new Date(serverNow).getTime()) / 1000,
            )}{' '}
            с. Тим часом повторіть матеріал і потренуйтесь.
          </p>
        )}
        {!r.passed && node?.state === 'in_progress' && (
          <p data-testid="next-step">
            Повернутись до матеріалів і спробувати ще раз можна одразу: залишилась спроба{' '}
            {node.attemptsInRound + 1} з {a.attemptsPerRound}. Нові питання буде підібрано з пулу.
          </p>
        )}
        <p>
          <Link href={`/courses/${a.versionId}`}>До графа курсу</Link> ·{' '}
          <Link href={`/courses/${a.versionId}/nodes/${a.nodeId}`}>До вузла</Link>
        </p>
      </div>
    );
  }

  if (!current) return <p>Завершення…</p>;
  const answered = a.items.filter((i) => i.answered).length;
  return (
    <div data-testid="test-runner">
      <h1>Тест вузла</h1>
      <p className="muted" data-testid="progress">
        Питання {answered + 1} з {a.items.length} · раунд {a.roundNo}, спроба {a.attemptNo} з{' '}
        {a.attemptsPerRound}
      </p>
      <QuestionForm
        key={current.id}
        question={current.question}
        busy={busy}
        submitLabel="Відповісти"
        onSubmit={answer}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
