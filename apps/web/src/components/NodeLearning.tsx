'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { QuestionForm, type StudentQuestion } from './QuestionForm';
import { TutorChat } from './TutorChat';

export interface NodeLearningProps {
  nodeId: string;
  state: 'available' | 'in_progress' | 'passed' | 'cooldown' | 'locked';
  roundNo: number;
  attemptsInRound: number;
  attemptsPerRound: number;
  /** ISO time the pause ends, and the server's "now" when the page was built, so the client never uses its own clock. */
  cooldownUntil: string | null;
  serverNow: string;
  /** Study control condition (D-30): no node test, no tutor; only free self-check practice. */
  control?: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<{ data?: T; error?: string }> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  return res.ok
    ? { data: json as T }
    : { error: json?.message ?? 'Щось пішло не так. Спробуйте ще раз.' };
}

function remaining(until: string, now: string) {
  const s = Math.max(0, Math.ceil((new Date(until).getTime() - new Date(now).getTime()) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} год ${Math.floor((s % 3600) / 60)} хв`;
  if (s >= 60) return `${Math.floor(s / 60)} хв ${s % 60} с`;
  return `${s} с`;
}

export function NodeLearning(p: NodeLearningProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<StudentQuestion | null>(null);
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [given, setGiven] = useState<string | undefined>();

  async function startTest() {
    setBusy(true);
    setError(null);
    const { data, error } = await call<{ assessment: { id: string } }>(
      `/api/nodes/${p.nodeId}/test`,
      { method: 'POST' },
    );
    if (data) router.push(`/assessments/${data.assessment.id}`);
    else {
      setError(error!);
      setBusy(false);
    }
  }

  async function nextPractice(exclude = shown) {
    setError(null);
    setVerdict(null);
    setGiven(undefined);
    const { data, error } = await call<{ question: StudentQuestion | null }>(
      `/api/nodes/${p.nodeId}/practice?exclude=${exclude.join(',')}`,
    );
    if (error) return setError(error);
    if (!data?.question && exclude.length > 0) {
      // every question was shown once: start over
      setShown([]);
      return nextPractice([]);
    }
    setQuestion(data?.question ?? null);
    if (data?.question) setShown([...exclude, data.question.id]);
  }

  async function answerPractice(answer: unknown) {
    setBusy(true);
    const { data, error } = await call<{ isCorrect: boolean }>(`/api/nodes/${p.nodeId}/practice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: question!.id, answer }),
    });
    if (data) {
      setVerdict(data.isCorrect);
      const a = answer as { optionIndex?: number; text?: string };
      setGiven(a.text ?? question!.options?.[a.optionIndex ?? -1]);
    } else setError(error!);
    setBusy(false);
  }

  const canTest = p.state === 'available' || p.state === 'in_progress';
  return (
    <section className="learning" data-testid="node-learning">
      {!p.control && <h2>Тест вузла</h2>}
      {!p.control && p.state === 'passed' && (
        <p data-testid="node-state-note">Вузол пройдено. Наступні вузли розблоковано.</p>
      )}
      {!p.control && p.state === 'cooldown' && p.cooldownUntil && (
        <p data-testid="cooldown-note" className="error">
          Обидві спроби раунду {p.roundNo} невдалі. Пауза ще{' '}
          {remaining(p.cooldownUntil, p.serverNow)}; потім почнеться новий раунд. Повторіть матеріал
          і скористайтесь практикою нижче.
        </p>
      )}
      {!p.control && canTest && (
        <>
          <p className="muted" data-testid="attempt-note">
            Раунд {p.roundNo}, спроба {Math.min(p.attemptsInRound + 1, p.attemptsPerRound)} з{' '}
            {p.attemptsPerRound}.
            {p.attemptsInRound > 0 && ' Перед наступною спробою перегляньте матеріал вище.'} Вузол
            вважається пройденим, коли кожна навичка вузла досягне 80 %.
          </p>
          <button type="button" onClick={startTest} disabled={busy} data-testid="start-test">
            {p.state === 'in_progress' && p.attemptsInRound === 0
              ? 'Продовжити тест'
              : 'Пройти тест вузла'}
          </button>
        </>
      )}

      <h2>{p.control ? 'Самоперевірка' : 'Практика'}</h2>
      <p className="hint">
        Вільні вправи без обмежень. Вони не впливають на рівень навичок і прогрес.
      </p>
      {question ? (
        <>
          <QuestionForm
            key={question.id}
            question={question}
            busy={busy || verdict !== null}
            submitLabel="Перевірити"
            onSubmit={answerPractice}
          />
          {verdict !== null && (
            <p data-testid="practice-verdict" className={verdict ? '' : 'error'}>
              {verdict
                ? 'Вірно!'
                : 'Поки що невірно. Перегляньте матеріал і спробуйте інше питання.'}{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setBusy(false);
                  void nextPractice();
                }}
              >
                Наступне питання
              </button>
            </p>
          )}
          {verdict === false && !p.control && (
            <TutorChat
              nodeId={p.nodeId}
              questionId={question.id}
              studentAnswer={given}
              title="Репетитор: допомога з цим питанням"
            />
          )}
        </>
      ) : (
        <button type="button" onClick={() => nextPractice()} data-testid="start-practice">
          Почати практику
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!p.control && p.state !== 'locked' && <TutorChat nodeId={p.nodeId} />}
    </section>
  );
}
