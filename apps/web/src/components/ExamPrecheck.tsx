'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { sendJson } from '@/lib/client';

export interface ExamStatusView {
  versionId: string;
  title: string;
  nodes: { total: number; passed: number };
  ban: { forever: boolean; until: string | null } | null;
  passed: boolean;
  runningId: string | null;
  interrupted: { id: string; interruptions: number } | null;
  roundNo: number;
  attemptNo: number;
  attemptsPerRound: number;
  attemptsLeft: number;
  cooldownUntil: string | null;
  maxInterruptions: number;
  rules: {
    questions: number;
    minutes: number;
    choiceSeconds: number;
    openSeconds: number;
    passPct: number;
  };
  canStart: boolean;
  blockedBy: string | null;
  history: {
    id: string;
    roundNo: number;
    attemptNo: number;
    status: string;
    scorePct: number | null;
  }[];
}

const blockedText: Record<string, string> = {
  not_enrolled: 'Спочатку запишіться на курс.',
  exam_passed: 'Іспит із цього курсу вже складено.',
  exam_banned: 'Вам тимчасово закрито доступ до іспитів. Навчання залишається доступним.',
  exam_not_eligible: 'Іспит відкриється, коли ви пройдете всі вузли курсу.',
  exam_cooldown: 'Спроби цього раунду вичерпано. Новий раунд почнеться після паузи.',
  test_unavailable: 'Іспит цього курсу ще не готовий: у банку замало перевірених питань.',
};

/**
 * The screen before the exam (F8-R1). The camera, fullscreen, lighting and consent checks are a skeleton here:
 * proctoring connects them in M10. Everything that decides whether the exam may start is the server's answer.
 */
export function ExamPrecheck({ status, serverNow }: { status: ExamStatusView; serverNow: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setNarrow(window.innerWidth < 900);
  }, []);

  async function start() {
    setBusy(true);
    setErrors([]);
    const res = await sendJson<{ exam: { id: string } }>(
      `/api/courses/versions/${status.versionId}/exam`,
      'POST',
    );
    if (res.ok && res.data) router.push(`/exams/${res.data.exam.id}`);
    else {
      setErrors(res.errors);
      setBusy(false);
    }
  }

  const r = status.rules;
  const pauseMinutes = status.cooldownUntil
    ? Math.max(
        1,
        Math.ceil(
          (new Date(status.cooldownUntil).getTime() - new Date(serverNow).getTime()) / 60000,
        ),
      )
    : null;
  const resumable = status.interrupted;

  return (
    <div data-testid="exam-precheck">
      <p>
        <Link href={`/courses/${status.versionId}`}>← До курсу</Link>
      </p>
      <h1>Фінальний іспит</h1>
      <p className="muted">{status.title}</p>

      <h2>Правила</h2>
      <ul data-testid="exam-rules">
        <li>
          Питань: {r.questions}, на весь іспит — {r.minutes} хв. На тестове або коротку відповідь —{' '}
          {r.choiceSeconds} с, на розгорнуту — {Math.round(r.openSeconds / 60)} хв.
        </li>
        <li>Питання показуються по одному; повертатися до попередніх не можна.</li>
        <li>Час рахує сервер. Відповідь після завершення часу не приймається.</li>
        <li>Склали, якщо набрано щонайменше {r.passPct} % балів. Результат — по кожній навичці.</li>
        <li>
          У раунді {status.attemptsPerRound} спроби; після двох невдалих — пауза, потім новий раунд.
        </li>
        <li>
          Технічну перерву (мережа, камера) можна зробити не більше {status.maxInterruptions} разів
          за спробу, без штрафу. Після відновлення питання підбираються наново.
        </li>
        <li>Репетитор під час іспиту недоступний.</li>
      </ul>

      <h2>Перевірка перед стартом</h2>
      <ul className="precheck" data-testid="precheck-items">
        {['Камера', 'Повноекранний режим', 'Освітлення', 'Згода на перевірку'].map((name) => (
          <li key={name}>
            <span>{name}</span>
            <span className="muted">Підключиться в наступному оновленні</span>
          </li>
        ))}
      </ul>
      {narrow && (
        <p className="error" role="alert" data-testid="desktop-only-note">
          Іспит проходять на комп’ютері. Відкрийте цю сторінку на ширшому екрані.
        </p>
      )}

      <h2>Ваші спроби</h2>
      <p data-testid="exam-attempts">
        Раунд {status.roundNo || 1}, спроба {status.attemptNo || 1} з {status.attemptsPerRound}.
        Залишилось спроб: {status.attemptsLeft}. Вузлів пройдено {status.nodes.passed} з{' '}
        {status.nodes.total}.
      </p>
      {status.history.length > 0 && (
        <ul data-testid="exam-history">
          {status.history.map((h) => (
            <li key={h.id}>
              Раунд {h.roundNo}, спроба {h.attemptNo}:{' '}
              {h.status === 'passed' ? 'складено' : 'не складено'}
              {h.scorePct !== null && ` (${Math.round(h.scorePct)} %)`}
            </li>
          ))}
        </ul>
      )}

      {status.blockedBy && !status.runningId && (
        <p className="error" role="status" data-testid="exam-blocked">
          {blockedText[status.blockedBy] ?? 'Іспит зараз недоступний.'}
          {status.blockedBy === 'exam_cooldown' &&
            pauseMinutes &&
            ` Приблизно ще ${pauseMinutes} хв.`}
          {status.blockedBy === 'exam_banned' &&
            status.ban?.until &&
            ` Обмеження діє до ${new Date(status.ban.until).toLocaleDateString('uk-UA')}.`}
        </p>
      )}
      {status.runningId && (
        <p>
          <Link href={`/exams/${status.runningId}`} data-testid="exam-continue">
            Продовжити іспит, що триває
          </Link>
        </p>
      )}
      {!status.runningId && status.canStart && (
        <>
          {resumable && (
            <p data-testid="exam-resumable">
              Попередню спробу перервано (перерв: {resumable.interruptions} з{' '}
              {status.maxInterruptions}). Питання буде підібрано наново; час, що залишився,
              зберігся.
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              data-testid="exam-agree"
            />
            Ознайомився(-лась) з правилами
          </label>
          <button type="button" onClick={start} disabled={!agreed || busy} data-testid="exam-start">
            {resumable ? 'Відновити іспит' : 'Почати іспит'}
          </button>
        </>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
