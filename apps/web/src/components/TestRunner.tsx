'use client';

import Link from 'next/link';
import { useState } from 'react';
import { QuestionForm, type StudentQuestion } from './QuestionForm';
import { TutorChat } from './TutorChat';
import { Confetti } from './Confetti';
import { Mascot } from './Mascot';
import { PageHeader, ScoreRing } from './ui';

export interface AssessmentView {
  id: string;
  kind: 'node_test' | 'exam' | 'pretest' | 'posttest' | 'delayed_posttest';
  nodeId: string | null;
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

const studyTitles = {
  pretest: 'Вхідний тест',
  posttest: 'Підсумковий тест',
  delayed_posttest: 'Відкладений тест',
} as const;

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

  const study = a.kind in studyTitles ? studyTitles[a.kind as keyof typeof studyTitles] : null;
  // Study tests measure, so they show no verdicts and no score, only that the answers are in.
  if (study && a.status !== 'in_progress') {
    return (
      <div className="card" data-testid="study-test-done">
        <PageHeader
          title={`${study}: завершено`}
          lead="Дякуємо! Відповіді збережено. Результат не показується, щоб не впливати на дослідження."
        />
        <Link href="/experiment" className="btn" data-testid="back-to-experiment">
          Повернутися до дослідження
        </Link>
      </div>
    );
  }

  if (a.result) {
    const r = a.result;
    const node = r.node;
    return (
      <div data-testid="test-result">
        <div className={`result-hero ${r.passed ? 'ok' : 'bad'}`}>
          {r.passed && <Confetti />}
          <ScoreRing pct={r.scorePct ?? 0} />
          <div>
            <h1 data-testid="result-verdict">
              {r.passed ? 'Вузол пройдено' : 'Поки що не пройдено'}
            </h1>
            <p className="muted">
              Раунд {a.roundNo}, спроба {a.attemptNo} з {a.attemptsPerRound} · правильних відповідей{' '}
              {Math.round(r.scorePct ?? 0)} %
            </p>
          </div>
          <Mascot mood={r.passed ? 'cheer' : 'oops'} size={104} float className="hero-mascot-r" />
        </div>
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
        <ol className="answer-list" data-testid="answer-list">
          {a.items.map((i) => (
            <li key={i.id}>
              <span className={i.isCorrect ? 'badge ok' : 'badge bad'}>
                {i.isCorrect ? 'вірно' : 'невірно'}
              </span>
              <span>{i.question.promptMd}</span>
            </li>
          ))}
        </ol>
        {!r.passed && a.items.some((i) => !i.isCorrect) && (
          <>
            <h2>Розбір помилок</h2>
            <p className="hint">
              Оберіть питання, з яким не вдалося впоратись, і попросіть підказку. Правильні
              відповіді не показуються.
            </p>
            {a.items
              .filter((i) => !i.isCorrect)
              .map((i) => (
                <details key={i.id} data-testid="remediation-item">
                  <summary>{i.question.promptMd}</summary>
                  <TutorChat
                    nodeId={a.nodeId!}
                    questionId={i.question.id}
                    title="Репетитор: допомога з цим питанням"
                  />
                </details>
              ))}
          </>
        )}
        {r.passed && (
          <p className="callout ok" data-testid="next-step">
            Наступні вузли, для яких пройдено всі попередні, відкрито.
          </p>
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
          <p className="callout warn" data-testid="next-step">
            Повернутись до матеріалів і спробувати ще раз можна одразу: залишилась спроба{' '}
            {node.attemptsInRound + 1} з {a.attemptsPerRound}. Нові питання буде підібрано з пулу.
          </p>
        )}
        <div className="actions" style={{ marginTop: 24 }}>
          <Link href={`/courses/${a.versionId}`} className="btn">
            До графа курсу
          </Link>
          <Link href={`/courses/${a.versionId}/nodes/${a.nodeId}`} className="btn secondary">
            До вузла
          </Link>
        </div>
      </div>
    );
  }

  if (!current) return <p>Завершення…</p>;
  const answered = a.items.filter((i) => i.answered).length;
  return (
    <div data-testid="test-runner">
      <PageHeader
        title={study ?? 'Тест вузла'}
        lead={
          <span data-testid="progress">
            Питання {answered + 1} з {a.items.length}
            {!study && ` · раунд ${a.roundNo}, спроба ${a.attemptNo} з ${a.attemptsPerRound}`}
          </span>
        }
      />
      <span className="question-progress" aria-hidden>
        <span style={{ width: `${(answered / a.items.length) * 100}%` }} />
      </span>
      <div className="card question-card">
        <Mascot mood="think" size={64} className="question-mascot" />
        <QuestionForm
          key={current.id}
          question={current.question}
          busy={busy}
          submitLabel="Відповісти"
          onSubmit={answer}
        />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
