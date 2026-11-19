'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { sendJson } from '@/lib/client';
import { StrikeAppeal } from './StrikeAppeal';
import { PageHeader } from './ui';

export interface ExamStatusView {
  versionId: string;
  title: string;
  nodes: { total: number; passed: number };
  ban: { forever: boolean; until: string | null } | null;
  proctoringConsent: boolean;
  proctoringRequired: boolean;
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
export interface OwnStrike {
  id: string;
  reason: string;
  status: string;
  level: number;
  banUntil: string | null;
  courseTitle: string;
  canAppeal: boolean;
}

const strikeStatusLabels: Record<string, string> = {
  confirmed: 'підтверджено',
  appealed: 'апеляцію подано',
  overturned: 'скасовано після апеляції',
  dismissed: 'відхилено',
};

export function ExamPrecheck({
  status,
  serverNow,
  strikes = [],
}: {
  status: ExamStatusView;
  serverNow: string;
  strikes?: OwnStrike[];
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [consent, setConsent] = useState(status.proctoringConsent);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setNarrow(window.innerWidth < 900);
  }, []);

  async function start() {
    setBusy(true);
    setErrors([]);
    // The server refuses to start without the proctoring consent on record (F9-R1), so record it first.
    if (status.proctoringRequired && !status.proctoringConsent) {
      const given = await sendJson('/api/consents', 'POST', { kind: 'proctoring' });
      if (!given.ok) {
        setErrors(given.errors);
        setBusy(false);
        return;
      }
    }
    const res = await sendJson<{ exam: { id: string } }>(
      `/api/courses/versions/${status.versionId}/exam`,
      'POST',
    );
    // Demo mode: the scenario the mock checker plays rides along from the pre-check page (the server ignores it otherwise).
    const scenario = new URLSearchParams(window.location.search).get('proctor');
    if (res.ok && res.data) {
      router.push(
        `/exams/${res.data.exam.id}${scenario ? `?proctor=${encodeURIComponent(scenario)}` : ''}`,
      );
    } else {
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
      <PageHeader
        back={{ href: `/courses/${status.versionId}`, label: 'До курсу' }}
        title="Фінальний іспит"
        lead={status.title}
        mood="think"
      />

      <h2 style={{ marginTop: 0 }}>Правила</h2>
      <ul data-testid="exam-rules" className="rules">
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
        <li>
          <span>Комп’ютер із широким екраном</span>
          <span className={narrow ? 'error' : 'muted'}>
            {narrow ? 'Екран завузький' : 'Підходить'}
          </span>
        </li>
        <li>
          <span>Камера, освітлення, повноекранний режим</span>
          <span className="muted">Перевіряються перед першим питанням, за вашим кліком</span>
        </li>
        <li>
          <span>Згода на перевірку камерою</span>
          <span className={consent ? 'muted' : 'error'}>{consent ? 'Надано' : 'Потрібна'}</span>
        </li>
      </ul>
      <h2>Нагляд і чесність</h2>
      <p className="hint" data-testid="proctor-notice">
        Нагляд — це стримування й докази, а не гарантія: система не може виключити другий пристрій,
        віртуальну машину чи віддалений доступ. Вихід із повноекранного режиму, втрата фокуса понад
        кілька секунд, копіювання/вставлення й інструменти розробника зупиняють спробу й дають
        порушення (1-ше — 7 днів без іспитів, 2-ге — 30 днів, 3-тє — назавжди; навчання лишається
        доступним). Підозри за зображенням і за ритмом друку не карають автоматично: їх розглядає
        адміністратор. Відео не передається й не записується; раз на хвилину кадр надсилається на
        перевірку й одразу видаляється, зберігається лише кадр, що спричинив подію (30 днів,
        зашифрований). Рішення можна оскаржити.
      </p>
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
        <p
          className={status.blockedBy === 'exam_banned' ? 'error' : 'callout warn'}
          role="status"
          data-testid="exam-blocked"
        >
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
          <Link href={`/exams/${status.runningId}`} className="btn" data-testid="exam-continue">
            Продовжити іспит, що триває
          </Link>
        </p>
      )}
      {!status.runningId && status.canStart && (
        <div className="card start-card">
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
          {status.proctoringRequired && (
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                disabled={status.proctoringConsent}
                onChange={(e) => setConsent(e.target.checked)}
                data-testid="exam-consent"
              />
              Погоджуюсь, щоб камера й кадри перевірялися під час іспиту так, як описано вище
            </label>
          )}
          <button
            type="button"
            onClick={start}
            disabled={!agreed || (status.proctoringRequired && !consent) || busy}
            aria-busy={busy}
            data-testid="exam-start"
          >
            {resumable ? 'Відновити іспит' : 'Почати іспит'}
          </button>
        </div>
      )}
      {strikes.length > 0 && (
        <>
          <h2>Порушення й апеляція</h2>
          <ul data-testid="own-strikes">
            {strikes.map((x) => (
              <li key={x.id} data-testid="own-strike">
                {x.courseTitle}: порушення №{x.level} — {strikeStatusLabels[x.status] ?? x.status}
                {x.banUntil &&
                  ` (обмеження до ${new Date(x.banUntil).toLocaleDateString('uk-UA')})`}
                {x.canAppeal && <StrikeAppeal strikeId={x.id} onDone={() => router.refresh()} />}
              </li>
            ))}
          </ul>
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
