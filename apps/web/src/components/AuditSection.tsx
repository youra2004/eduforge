import { type AuditView } from '@eduforge/core';
import {
  checklistLabels,
  failedStageLabels,
  feedbackLabels,
  levelLabels,
  reviewStatusLabels,
  versionStatusLabels,
} from '@/lib/messages';
import { AuditActions } from './AuditActions';
import { AutoRefresh } from './AutoRefresh';

/** What the author sees about the audit (F4-R7), and the buttons that move the version on. Thresholds and formulas are not shown. */
export function AuditSection({ view }: { view: AuditView }) {
  const s = view.summary;
  const exhausted =
    (view.status === 'draft' || view.status === 'changes_requested') && !view.canSubmit;
  return (
    <section className="audit" data-testid="audit-section">
      <h2>Аудит і публікація</h2>
      <p>
        Стан: <strong data-testid="version-status">{versionStatusLabels[view.status]}</strong> ·
        використано запусків аудиту: {view.attemptsUsed} з {view.attemptsMax}
      </p>

      {view.status === 'auditing' && (
        <p className="hint" role="status" data-testid="audit-running">
          Аудит триває: це займе хвилину. Сторінка оновиться сама.
          <AutoRefresh />
        </p>
      )}

      {s?.failedStage && (
        <div data-testid="audit-failure" className="audit-failure">
          <p className="error">{failedStageLabels[s.failedStage]}</p>
          {s.issues && s.issues.length > 0 && (
            <ul className="error">
              {s.issues.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          )}
          {s.mismatches && s.mismatches.length > 0 && (
            <ul className="error" data-testid="mismatches">
              {s.mismatches.map((m, k) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          )}
          {s.conformityFeedback && <p className="hint">{s.conformityFeedback}</p>}
          {s.uncoveredSkills && s.uncoveredSkills.length > 0 && (
            <ul className="error" data-testid="uncovered-skills">
              {s.uncoveredSkills.map((u) => (
                <li key={u.skillId}>
                  Навичка «{u.name}» не покрита матеріалами. {u.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.level && (
        <div className="score" data-testid="audit-score">
          <div className="score-rating">
            {view.rating !== null ? (
              <>
                <span className="rating-number" data-testid="audit-rating">
                  {view.rating}
                </span>
                <span className="muted">/ 10</span>
              </>
            ) : (
              <span data-testid="audit-rating-pending">Рейтинг 10 очікує на експерта</span>
            )}
          </div>
          <dl>
            <dt>Рівень</dt>
            <dd data-testid="audit-level">{levelLabels[view.level] ?? view.level}</dd>
            <dt>Складність</dt>
            <dd data-testid="audit-hardness">{view.hardness?.toFixed(2)}</dd>
          </dl>
          {s?.limitedByVolume && (
            <p className="hint" data-testid="volume-note">
              Оцінку обмежено обсягом курсу: більше вузлів і матеріалів дозволить отримати вищий
              рейтинг.
            </p>
          )}
        </div>
      )}

      {s?.feedback && (
        <dl className="feedback" data-testid="audit-feedback">
          {(Object.keys(feedbackLabels) as (keyof typeof feedbackLabels)[]).map((k) => (
            <div key={k}>
              <dt>{feedbackLabels[k]}</dt>
              <dd>{s.feedback![k]}</dd>
            </div>
          ))}
        </dl>
      )}

      {view.skills.some((k) => k.verified !== null) && (
        <table data-testid="skill-verification">
          <caption>Перевірка навичок</caption>
          <tbody>
            {view.skills.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{k.verified === null ? '—' : k.verified ? '✓ покрито' : '✗ не покрито'}</td>
                <td className="muted">{k.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view.status === 'expert_review' && (
        <div data-testid="expert-review-status" className="expert-status">
          <p>
            Курс — кандидат на найвищий рейтинг (10), тому його перевіряє експерт.{' '}
            {view.review
              ? reviewStatusLabels[view.review.status]
              : 'Очікуємо, поки адміністратор призначить експерта.'}
          </p>
          {view.review?.status === 'rejected' && view.review.checklist && (
            <div data-testid="review-checklist">
              <p className="error">Експерт відхилив рейтинг 10.</p>
              <ul>
                {Object.entries(view.review.checklist.items).map(([key, ok]) => (
                  <li key={key}>
                    {ok ? '✓' : '✗'} {checklistLabels[key as keyof typeof checklistLabels] ?? key}
                  </li>
                ))}
              </ul>
              {view.review.checklist.comment && (
                <blockquote>{view.review.checklist.comment}</blockquote>
              )}
            </div>
          )}
        </div>
      )}

      <AuditActions
        versionId={view.versionId}
        status={view.status}
        canSubmit={view.canSubmit}
        attemptsLeft={view.attemptsMax - view.attemptsUsed}
        awaitingChoice={view.awaitingChoice}
        exhausted={exhausted}
      />
    </section>
  );
}
