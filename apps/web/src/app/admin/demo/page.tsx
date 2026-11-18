import { demoSettings } from '@eduforge/core';
import { RunRecommendations } from '@/components/RunRecommendations';
import { PageHeader } from '@/components/ui';
import { requirePageRole } from '@/lib/pages';

export const dynamic = 'force-dynamic';

const pauseLabels = {
  node: 'Пауза після невдалого раунду тесту вузла',
  exam: 'Пауза після невдалого раунду іспиту',
  experiment: 'Очікування перед відкладеним тестом дослідження',
} as const;

function duration(seconds: number) {
  if (seconds >= 86400) return `${+(seconds / 86400).toFixed(2)} дн`;
  if (seconds >= 3600) return `${+(seconds / 3600).toFixed(2)} год`;
  if (seconds >= 60) return `${+(seconds / 60).toFixed(2)} хв`;
  return `${+seconds.toFixed(2)} с`;
}

export default async function DemoPage() {
  await requirePageRole('admin');
  const settings = demoSettings();
  return (
    <div className="page">
      <PageHeader
        back={{ href: '/admin', label: 'До адміністрування' }}
        title="Демо-режим і рекомендації"
      />
      <h2 style={{ marginTop: 0 }}>Масштаб часу</h2>
      <p data-testid="time-scale">
        TIME_SCALE = <strong>{settings.timeScale}</strong>
        {settings.timeScale === 1 ? ' (реальний час)' : ' (демо-режим)'}
      </p>
      <table data-testid="pauses">
        <thead>
          <tr>
            <th>Пауза</th>
            <th>У реальності</th>
            <th>Зараз</th>
          </tr>
        </thead>
        <tbody>
          {settings.pauses.map((p) => (
            <tr key={p.key} data-testid={`pause-${p.key}`}>
              <td>{pauseLabels[p.key]}</td>
              <td>{duration(p.realSeconds)}</td>
              <td data-testid={`pause-${p.key}-scaled`}>{duration(p.scaledSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Значення береться зі змінної середовища <code>TIME_SCALE</code>; щоб змінити його,
        перезапуште застосунок і воркер. Дані для показу створює <code>pnpm seed-demo</code>: усі
        такі записи позначені як демонстраційні.
      </p>
      <h2>Щоденні поради</h2>
      <p className="hint">
        Воркер раз на добу (у демо-режимі — раз на «добу» масштабованого часу) рахує метрики за 7 і
        30 днів і просить модель сформулювати до трьох порад. Якщо метрики не змінилися, нових порад
        не буде.
      </p>
      <RunRecommendations />
    </div>
  );
}
