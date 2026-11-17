import { listStrikeQueue } from '@eduforge/core';
import Link from 'next/link';
import { StrikeReview } from '@/components/StrikeReview';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

const eventLabels: Record<string, string> = {
  fullscreen_exit: 'Вихід із повноекранного режиму',
  focus_lost: 'Втрата фокуса',
  devtools_open: 'Інструменти розробника',
  copy: 'Копіювання',
  paste: 'Вставлення',
  face_missing: 'Немає обличчя в кадрі',
  multiple_faces: 'Кілька облич у кадрі',
  head_turn: 'Поворот голови',
  face_mismatch: 'Обличчя не збігається з еталоном',
  second_person: 'Друга людина в кадрі',
  phone: 'Телефон у кадрі',
  gaze_away: 'Погляд убік',
  keystroke_paste: 'Текст зʼявився без друку',
  keystroke_too_fast: 'Надто швидкий друк',
  keystroke_too_uniform: 'Надто рівний ритм друку',
  reference_retaken: 'Повторне еталонне фото (перезавантаження)',
};

const statusLabels: Record<string, string> = {
  pending_review: 'Очікує рішення',
  appealed: 'Апеляція',
};

export default async function StrikesPage() {
  const admin = await requirePageRole('admin');
  const queue = await listStrikeQueue(getDb(), admin);
  return (
    <div className="card wide">
      <p>
        <Link href="/admin">← До адміністрування</Link>
      </p>
      <h1>Порушення на іспитах</h1>
      <p className="hint">
        Жорсткі події (вихід із повноекранного режиму, фокус, копіювання, devtools) карають
        автоматично й сюди потрапляють лише як апеляції. Підозри за зображенням і ритмом друку
        накопичуються в ризик-оцінці; покарання — лише після вашого підтвердження. Кадри
        зберігаються зашифрованими лише для спрацьованих подій і видаляються після закриття справи
        або через строк зберігання.
      </p>
      {queue.length === 0 ? (
        <p className="muted" data-testid="no-strikes">
          Справ, що чекають на рішення, немає.
        </p>
      ) : (
        <ul className="cases" data-testid="strike-queue">
          {queue.map((q) => (
            <li key={q.id} data-testid="strike-case" className="case">
              <h2>
                {q.displayName} <span className="muted">{q.email}</span>
              </h2>
              <p>
                {q.courseTitle} · <strong>{statusLabels[q.status] ?? q.status}</strong> ·
                ризик-оцінка <strong data-testid="case-risk">{Math.round(q.riskScore)}</strong>
              </p>
              {q.appealText && (
                <blockquote data-testid="appeal-text-view">{q.appealText}</blockquote>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Час</th>
                    <th>Подія</th>
                    <th>Вага</th>
                    <th>Кадр</th>
                  </tr>
                </thead>
                <tbody>
                  {q.events.map((e) => (
                    <tr key={e.id}>
                      <td>{e.ts.toLocaleTimeString('uk-UA')}</td>
                      <td>{eventLabels[e.type] ?? e.type}</td>
                      <td>{e.severity === 'hard' ? 'жорстка' : 'м’яка'}</td>
                      <td>
                        {e.evidenceId ? (
                          <img
                            src={`/api/admin/evidence/${e.evidenceId}`}
                            alt="Кадр події"
                            width={160}
                            data-testid="evidence-frame"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <StrikeReview strikeId={q.id} status={q.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
