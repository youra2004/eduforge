import {
  CONSENT_VERSIONS,
  experimentSettings,
  getParticipation,
  LIKERT_LABELS,
  SURVEY_ITEMS,
} from '@eduforge/core';
import { ExperimentJoin } from '@/components/ExperimentJoin';
import { ExperimentModule } from '@/components/ExperimentModule';
import { SurveyForm } from '@/components/SurveyForm';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

const when = (d: Date) =>
  d.toLocaleString('uk-UA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Kyiv' });

export default async function ExperimentPage() {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const p = await getParticipation(getDb(), user, experimentSettings());

  if (!p) {
    return (
      <div className="card">
        <h1>Дослідження</h1>
        <p>
          Це частина магістерського дослідження: чи допомагає навчання за графом знань із
          підтвердженням розуміння та репетитором краще засвоювати матеріал. Ви пройдете два короткі
          модулі: в одному з повною платформою, в іншому — у вільному режимі, а також вхідні,
          підсумкові й відкладені тести та короткі анкети.
        </p>
        <ul>
          <li>
            Результати використовуються лише у знеособленому вигляді: замість імені й email — код.
          </li>
          <li>Камера не використовується.</li>
          <li>Участь добровільна, її можна припинити будь-коли без наслідків.</li>
        </ul>
        <ExperimentJoin consentVersion={CONSENT_VERSIONS.research} />
      </div>
    );
  }

  return (
    <div className="card wide">
      <h1>Дослідження</h1>
      <p>
        Ваш код учасника: <strong data-testid="participant-code">{p.code}</strong>{' '}
        <span className="hint">(лише він зʼявляється в даних дослідження)</span>
      </p>
      {p.reminders.length > 0 && (
        <p className="reminder" role="status" data-testid="delayed-reminder">
          Нагадування: настав час пройти відкладений тест (модуль {p.reminders.join(', ')}).
        </p>
      )}
      {p.modules.map((m) => (
        <ExperimentModule
          key={m.module}
          module={m.module}
          title={m.title}
          versionId={m.versionId}
          condition={m.condition}
          step={m.step}
          runningAssessmentId={m.runningAssessmentId}
          dueLabel={m.delayedDueAt ? when(m.delayedDueAt) : null}
          survey={<SurveyForm module={m.module} items={SURVEY_ITEMS} labels={LIKERT_LABELS} />}
        />
      ))}
    </div>
  );
}
