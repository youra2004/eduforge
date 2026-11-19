'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendJson } from '@/lib/client';
import { examSkillLevelLabels } from '@/lib/messages';
import { IssueCertificate } from './IssueCertificate';
import { ExamProctor, type ProctorView } from './ExamProctor';
import { QuestionForm, type StudentQuestion } from './QuestionForm';
import { StrikeAppeal } from './StrikeAppeal';
import { Confetti } from './Confetti';
import { Mascot } from './Mascot';
import { PageHeader, ScoreRing } from './ui';

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
  proctor: ProctorView;
  violation: {
    strikeId: string;
    reason: string;
    status: string;
    level: number;
    banUntil: string | null;
    forever: boolean;
    canAppeal: boolean;
  } | null;
  certificate: { id: string; revoked: boolean } | null;
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

/** A connection drop shorter than this is not reported as an interruption. */
const MIN_DROP_MS = 10_000;

const violationText: Record<string, string> = {
  fullscreen_exit: 'Ви вийшли з повноекранного режиму.',
  focus_lost: 'Вікно іспиту втратило фокус довше за дозволений час.',
  devtools_open: 'Виявлено спробу відкрити інструменти розробника.',
  copy: 'Виявлено копіювання.',
  paste: 'Виявлено вставлення.',
};

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
  // The time a question started with, to draw how much of it is left.
  const budget = useRef({ id: '', ms: 1 });
  const refreshing = useRef(false);
  // The camera gate is passed in this page (a reload asks for it again).
  const [proctorActive, setProctorActive] = useState(false);
  const [confirmInterrupt, setConfirmInterrupt] = useState(false);

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
  // A drop shorter than a few seconds is not an interruption, so it cannot use one up.
  useEffect(() => {
    if (exam.status !== 'in_progress') return;
    let since: number | null = null;
    const off = () => {
      since = Date.now();
      setOffline(true);
    };
    const on = () => {
      setOffline(false);
      if (since !== null && Date.now() - since >= MIN_DROP_MS) void interrupt('network');
      since = null;
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

  if (exam.status === 'annulled') {
    const v = exam.violation;
    return (
      <div data-testid="exam-stopped">
        <PageHeader title="Іспит зупинено" />
        <p className="error" data-testid="exam-stopped-reason">
          {v
            ? (violationText[v.reason] ?? 'Зафіксовано порушення правил іспиту.')
            : 'Спробу анульовано.'}
        </p>
        {v && (
          <p data-testid="exam-strike">
            Порушення №{v.level}.{' '}
            {v.forever
              ? 'Доступ до іспитів закрито назавжди; навчання залишається доступним.'
              : v.banUntil
                ? `Доступ до іспитів закрито до ${new Date(v.banUntil).toLocaleString('uk-UA')}; навчання залишається доступним.`
                : ''}
          </p>
        )}
        {v?.canAppeal && <StrikeAppeal strikeId={v.strikeId} onDone={() => router.refresh()} />}
        {v && v.status === 'appealed' && (
          <p data-testid="exam-appealed">Апеляцію подано, її розгляне адміністратор.</p>
        )}
        <p>
          <Link href={`/courses/${exam.versionId}`} className="btn secondary">
            До графа курсу
          </Link>
        </p>
      </div>
    );
  }

  if (exam.result) {
    const r = exam.result;
    return (
      <div data-testid="exam-result">
        <div className={`result-hero ${r.passed ? 'ok' : 'bad'}`}>
          {r.passed && <Confetti />}
          <ScoreRing pct={r.scorePct ?? 0} />
          <div>
            <h1 data-testid="exam-verdict">{r.passed ? 'Іспит складено' : 'Іспит не складено'}</h1>
            <p className="muted">
              Раунд {exam.roundNo}, спроба {exam.attemptNo} з {exam.attemptsPerRound} · набрано{' '}
              <strong data-testid="exam-score">{Math.round(r.scorePct ?? 0)} %</strong> з потрібних{' '}
              {Math.round(r.passPct)} %
            </p>
          </div>
          <Mascot mood={r.passed ? 'cheer' : 'oops'} size={104} float className="hero-mascot-r" />
        </div>
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
        {r.passed && (
          <div data-testid="exam-certificate">
            <h2>Сертифікат</h2>
            {exam.certificate ? (
              <p>
                <Link
                  href={`/verify/${exam.certificate.id}`}
                  className="btn"
                  data-testid="certificate-link"
                >
                  Відкрити сертифікат
                </Link>
                {exam.certificate.revoked && <span className="error"> · відкликано</span>}
              </p>
            ) : (
              <IssueCertificate examId={exam.id} onDone={() => void reload()} />
            )}
          </div>
        )}
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
        <div className="actions" style={{ marginTop: 24 }}>
          <Link href={`/courses/${exam.versionId}`} className="btn secondary">
            До графа курсу
          </Link>
          <Link href={`/courses/${exam.versionId}/exam`} className="btn secondary">
            До сторінки іспиту
          </Link>
        </div>
      </div>
    );
  }

  // With proctoring on, no question is shown until the camera gate is passed in this page (F9-R1).
  // The proctor stays mounted through the gate and the wait for the first question, or the camera stream would be lost.
  const gated = exam.proctor.enabled && !proctorActive;
  if (!exam.current && !exam.proctor.enabled) return <p>Завершення…</p>;
  const now = serverNow();
  const totalLeft = exam.deadlineAt ? Date.parse(exam.deadlineAt) - now : 0;
  const proctorNode = exam.proctor.enabled && (
    <ExamProctor
      examId={exam.id}
      proctor={exam.proctor}
      running={exam.status === 'in_progress'}
      onActive={setProctorActive}
      onChanged={() => void reload()}
      onCameraLost={() => void interrupt('camera')}
    />
  );
  if (!exam.current || gated) {
    return (
      <div data-testid="exam-runner">
        <PageHeader title="Фінальний іспит" />
        {/* Same place in the tree as in the question view below, so the camera stream survives the gate. */}
        {proctorNode}
        <p className="exam-timers" aria-live="off">
          <span>
            Усього залишилось: <strong data-testid="exam-total-timer">{clock(totalLeft)}</strong>
          </span>
        </p>
      </div>
    );
  }
  const questionLeft = Date.parse(exam.current.deadlineAt) - now;
  if (budget.current.id !== exam.current.itemId) {
    budget.current = { id: exam.current.itemId, ms: Math.max(questionLeft, 1) };
  }
  const timeLeftPct = Math.max(0, Math.min(100, (questionLeft / budget.current.ms) * 100));
  return (
    <div data-testid="exam-runner">
      <PageHeader
        title="Фінальний іспит"
        lead={
          <span data-testid="exam-progress">
            Питання {exam.current.position} з {exam.total} · раунд {exam.roundNo}, спроба{' '}
            {exam.attemptNo}
          </span>
        }
      />
      {proctorNode}
      <span className="question-progress" aria-hidden>
        <span style={{ width: `${((exam.current.position - 1) / exam.total) * 100}%` }} />
      </span>
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
      <span className="time-bar" aria-hidden>
        <span
          className={questionLeft < 15000 ? 'urgent' : undefined}
          style={{ width: `${timeLeftPct}%` }}
        />
      </span>
      {offline && (
        <p className="error" role="alert" data-testid="exam-offline">
          Зʼєднання втрачено. Коли воно відновиться, іспит буде перервано без штрафу.
        </p>
      )}
      <div className="card question-card">
        <Mascot mood="think" size={64} className="question-mascot" />
        <QuestionForm
          key={exam.current.itemId}
          question={exam.current.question}
          busy={busy}
          submitLabel="Відповісти й далі"
          onSubmit={answer}
          initial={exam.current.draft}
          onChange={autosave}
        />
      </div>
      {error && (
        <p role="alert" className="error" data-testid="exam-error">
          {error}
        </p>
      )}
      <p className="hint">Повертатися до попередніх питань не можна.</p>
      {/* Not window.confirm: a native dialog takes the page out of fullscreen, which would count as a violation. */}
      {confirmInterrupt ? (
        <p data-testid="exam-interrupt-ask">
          Повідомити про технічну проблему? Перерв за спробу не більше {exam.maxInterruptions};
          питання після відновлення будуть інші.{' '}
          <button
            type="button"
            disabled={busy}
            data-testid="exam-interrupt-confirm"
            onClick={() => void interrupt('other')}
          >
            Так, перервати
          </button>{' '}
          <button type="button" className="secondary" onClick={() => setConfirmInterrupt(false)}>
            Скасувати
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          data-testid="exam-interrupt"
          onClick={() => setConfirmInterrupt(true)}
        >
          Технічна проблема
        </button>
      )}
    </div>
  );
}
