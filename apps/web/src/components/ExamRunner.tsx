'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendJson } from '@/lib/client';
import { examSkillLevelLabels } from '@/lib/messages';
import { QuestionForm, type StudentQuestion } from './QuestionForm';

export interface ExamViewData {
  id: string;
  versionId: string;
  status: 'in_progress' | 'passed' | 'failed' | 'interrupted' | 'submitted' | 'annulled';
  roundNo: number;
  attemptNo: number;
  attemptsPerRound: number;
  interruptions: number;
  maxInterruptions: number;
  total: number;
  answered: number;
  serverNow: string;
  deadlineAt: string | null;
  current: {
    itemId: string;
    position: number;
    question: StudentQuestion;
    deadlineAt: string;
    draft: { optionIndex?: number; text?: string } | null;
  } | null;
  canResume: boolean;
  result: {
    passed: boolean;
    scorePct: number | null;
    passPct: number;
    perSkill: {
      skillId: string;
      name: string;
      pct: number;
      level: keyof typeof examSkillLevelLabels;
    }[];
    reason: string | null;
    attemptsLeft: number;
    cooldownUntil: string | null;
  } | null;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Answer = { optionIndex: number } | { text: string };

/**
 * One question at a time, no way back (D-18b). The clocks shown here only mirror the server's deadlines, measured
 * from the server time in each response; the server decides what is still in time (P1).
 */
export function ExamRunner({ initial }: { initial: ExamViewData }) {
  const router = useRouter();
  const [exam, setExam] = useState(initial);
  // The server's "now" at the moment the view arrived, and when that was here: enough to tick without trusting this clock.
  const received = useRef({ server: Date.parse(initial.serverNow), local: Date.now() });
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshing = useRef(false);

  const apply = useCallback((next: ExamViewData) => {
    received.current = { server: Date.parse(next.serverNow), local: Date.now() };
    setExam(next);
  }, []);
  const serverNow = () => received.current.server + (Date.now() - received.current.local);

  const reload = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const res = await fetch(`/api/exams/${exam.id}`);
      const json = (await res.json()) as { exam?: ExamViewData };
      if (res.ok && json.exam) apply(json.exam);
    } catch {
      // offline: the 'online' handler deals with it
    } finally {
      refreshing.current = false;
    }
  }, [exam.id, apply]);

  // Tick the clocks; when the question's time is over, ask the server what comes next.
  useEffect(() => {
    if (exam.status !== 'in_progress') return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (exam.current && serverNow() > Date.parse(exam.current.deadlineAt) + 300) void reload();
    }, 250);
    return () => clearInterval(id);
  }, [exam, reload]);

  const interrupt = useCallback(
    async (reason: 'network' | 'camera' | 'other') => {
      setBusy(true);
      const res = await sendJson<{ exam: ExamViewData }>(
        `/api/exams/${exam.id}/interrupt`,
        'POST',
        {
          reason,
        },
      );
      if (res.ok && res.data) apply(res.data.exam);
      else setError(res.errors.join(' '));
      setBusy(false);
    },
    [exam.id, apply],
  );

  // A lost connection stops the test without a strike (F8-R6): the server is told once the line is back.
  useEffect(() => {
    if (exam.status !== 'in_progress') return;
    const off = () => setOffline(true);
    const on = () => {
      setOffline((was) => {
        if (was) void interrupt('network');
        return false;
      });
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, [exam.status, interrupt]);

  function autosave(answer: Answer) {
    if (!exam.current) return;
    const itemId = exam.current.itemId;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void sendJson(`/api/exams/${exam.id}/draft`, 'PUT', { itemId, answer });
    }, 600);
  }

  async function answer(value: Answer) {
    if (!exam.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setBusy(true);
    setError(null);
    const res = await sendJson<{ exam: ExamViewData }>(`/api/exams/${exam.id}/answer`, 'POST', {
      itemId: exam.current.itemId,
      answer: value,
    });
    if (res.ok && res.data) apply(res.data.exam);
    else {
      setError(res.errors.join(' '));
      await reload();
    }
    setBusy(false);
  }

  async function resume() {
    setBusy(true);
    const res = await sendJson<{ exam: { id: string } }>(
      `/api/courses/versions/${exam.versionId}/exam`,
      'POST',
    );
    if (res.ok && res.data) router.push(`/exams/${res.data.exam.id}`);
    else {
      setError(res.errors.join(' '));
      setBusy(false);
    }
  }

  if (exam.status === 'interrupted') {
    return (
      <div data-testid="exam-interrupted">
        <h1>Іспит перервано</h1>
        <p>
          Технічну перерву зафіксовано без штрафу (перерв: {exam.interruptions} з{' '}
          {exam.maxInterruptions}). Після відновлення питання буде підібрано наново, а час, що
          залишався, збережено.
        </p>
        <button type="button" onClick={resume} disabled={busy} data-testid="exam-resume">
          Відновити іспит
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (exam.result) {
    const r = exam.result;
    return (
      <div data-testid="exam-result">
        <h1 data-testid="exam-verdict">{r.passed ? 'Іспит складено' : 'Іспит не складено'}</h1>
        <p className="muted">
          Раунд {exam.roundNo}, спроба {exam.attemptNo} з {exam.attemptsPerRound} · набрано{' '}
          <strong data-testid="exam-score">{Math.round(r.scorePct ?? 0)} %</strong> з потрібних{' '}
          {Math.round(r.passPct)} %
        </p>
        {r.reason === 'interruptions_exceeded' && (
          <p className="error" data-testid="exam-reason">
            Перевищено ліміт технічних перерв ({exam.maxInterruptions}): спробу зараховано як
            використану.
          </p>
        )}
        <h2>Результат за навичками</h2>
        <ul className="skills" data-testid="exam-skills">
          {r.perSkill.map((s) => (
            <li key={s.skillId} data-testid="exam-skill">
              <span>
                {s.name}{' '}
                <span className={`level ${s.level}`} data-testid="exam-skill-level">
                  {examSkillLevelLabels[s.level]}
                </span>
              </span>
              <span className="bar" aria-hidden>
                <span
                  className={s.pct + 1e-9 >= r.passPct ? 'fill ok' : 'fill'}
                  style={{ width: `${Math.round(s.pct)}%` }}
                />
              </span>
              <strong>{Math.round(s.pct)} %</strong>
            </li>
          ))}
        </ul>
        {!r.passed && r.attemptsLeft > 0 && (
          <p data-testid="exam-next">
            Залишилась спроба в цьому раунді. Повторіть матеріал і спробуйте ще раз.
          </p>
        )}
        {!r.passed && r.attemptsLeft === 0 && r.cooldownUntil && (
          <p className="error" data-testid="exam-next">
            Спроби раунду вичерпано. Новий раунд почнеться після паузи, до{' '}
            {new Date(r.cooldownUntil).toLocaleString('uk-UA')}.
          </p>
        )}
        <p>
          <Link href={`/courses/${exam.versionId}`}>До графа курсу</Link> ·{' '}
          <Link href={`/courses/${exam.versionId}/exam`}>До сторінки іспиту</Link>
        </p>
      </div>
    );
  }

  if (!exam.current) return <p>Завершення…</p>;
  const now = serverNow();
  const totalLeft = exam.deadlineAt ? Date.parse(exam.deadlineAt) - now : 0;
  const questionLeft = Date.parse(exam.current.deadlineAt) - now;
  return (
    <div data-testid="exam-runner">
      <h1>Фінальний іспит</h1>
      <p className="muted" data-testid="exam-progress">
        Питання {exam.current.position} з {exam.total} · раунд {exam.roundNo}, спроба{' '}
        {exam.attemptNo}
      </p>
      <p className="exam-timers" aria-live="off">
        <span>
          Усього залишилось: <strong data-testid="exam-total-timer">{clock(totalLeft)}</strong>
        </span>
        <span>
          На це питання:{' '}
          <strong
            data-testid="exam-question-timer"
            className={questionLeft < 15000 ? 'urgent' : undefined}
          >
            {clock(questionLeft)}
          </strong>
        </span>
      </p>
      {offline && (
        <p className="error" role="alert" data-testid="exam-offline">
          Зʼєднання втрачено. Коли воно відновиться, іспит буде перервано без штрафу.
        </p>
      )}
      <QuestionForm
        key={exam.current.itemId}
        question={exam.current.question}
        busy={busy}
        submitLabel="Відповісти й далі"
        onSubmit={answer}
        initial={exam.current.draft}
        onChange={autosave}
      />
      {error && (
        <p role="alert" className="error" data-testid="exam-error">
          {error}
        </p>
      )}
      <p className="hint">Повертатися до попередніх питань не можна.</p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        data-testid="exam-interrupt"
        onClick={() => {
          if (
            window.confirm(
              `Повідомити про технічну проблему? Перерв за спробу не більше ${exam.maxInterruptions}; питання після відновлення будуть інші.`,
            )
          )
            void interrupt('other');
        }}
      >
        Технічна проблема
      </button>
    </div>
  );
}
