import Link from 'next/link';
import {
  experimentSettings,
  getOwnRecommendations,
  getParticipation,
  getProgress,
  getVersionGraph,
  isDemoUser,
  listEnrollments,
  listOwnCertificates,
} from '@eduforge/core';
import { Icon } from '@/components/icons';
import { EmptyState, PageHeader, Progress } from '@/components/ui';
import { recommendationKindLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Студент' };

export default async function Page() {
  const user = await requirePageRole('student');
  const mine = await listEnrollments(getDb(), user);
  const certs = await listOwnCertificates(getDb(), user);
  const tips = await getOwnRecommendations(getDb(), user);
  const demo = await isDemoUser(getDb(), user.id);
  const study = await getParticipation(getDb(), user, experimentSettings());

  // Where to continue: the first unfinished course, at the node being learned or the first open one.
  const unfinished = mine.find((c) => c.status !== 'completed');
  let next: { versionId: string; title: string; nodeId: string; nodeTitle: string } | null = null;
  if (unfinished) {
    const progress = await getProgress(getDb(), user, unfinished.versionId);
    const pick =
      progress?.find((p) => p.state === 'in_progress') ??
      progress?.find((p) => p.state === 'available');
    if (pick) {
      const graph = await getVersionGraph(getDb(), user, unfinished.versionId);
      const node = graph.nodes.find((n) => n.id === pick.nodeId);
      if (node) {
        next = {
          versionId: unfinished.versionId,
          title: unfinished.title,
          nodeId: node.id,
          nodeTitle: node.title,
        };
      }
    }
  }
  const nodesPassed = mine.reduce((sum, c) => sum + c.nodesPassed, 0);
  return (
    <div className="page">
      <PageHeader title="Студент" lead="Ваші курси, поради щодо навчання та сертифікати." />
      {demo && (
        <p className="demo-banner" data-testid="demo-banner">
          Демонстраційні дані: цей обліковий запис і його історія створені для показу, а не реальним
          студентом.
        </p>
      )}
      {study && study.reminders.length > 0 && (
        <p className="reminder" role="status" data-testid="delayed-reminder">
          Нагадування: настав час пройти відкладений тест.{' '}
          <Link href="/experiment">До дослідження</Link>
        </p>
      )}

      {mine.length > 0 && (
        <div className="tiles" data-testid="student-overview">
          {[
            { n: mine.length, what: 'курсів' },
            { n: nodesPassed, what: 'вузлів пройдено' },
            { n: certs.length, what: 'сертифікатів' },
          ].map((t) => (
            <div key={t.what} className="card tile">
              <span
                className="num count-up"
                style={{ '--n': t.n } as React.CSSProperties}
                role="img"
                aria-label={String(t.n)}
              />
              <span className="what">{t.what}</span>
            </div>
          ))}
        </div>
      )}

      {next && unfinished && (
        <div className="card continue" data-testid="continue-card">
          <div>
            <span className="meta">Продовжити навчання · {next.title}</span>
            <h2>{next.nodeTitle}</h2>
            <Progress
              value={unfinished.nodesPassed}
              total={unfinished.nodesTotal}
              label="пройдено"
            />
          </div>
          <Link href={`/courses/${next.versionId}/nodes/${next.nodeId}`} className="btn lg">
            Продовжити
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      )}

      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Мої курси</h2>
        </div>
        {mine.length === 0 ? (
          <EmptyState
            icon="book"
            title="Ви ще не записані на жоден курс"
            testId="no-enrollments"
            action={
              <Link href="/courses" className="btn">
                Обрати курс
              </Link>
            }
          >
            Оберіть його у розділі «Курси» й запишіться: граф відкриється одразу.
          </EmptyState>
        ) : (
          <div className="grid" data-testid="enrollments">
            {mine.map((c) => (
              <div key={c.versionId} className="card course-card">
                <div className="meta">
                  <span className={c.status === 'completed' ? 'badge ok' : 'badge accent'}>
                    {c.status === 'completed' ? 'Курс пройдено' : 'У процесі'}
                  </span>
                  <span>v{c.versionNo}</span>
                </div>
                <h3>
                  <Link
                    href={`/courses/${c.versionId}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {c.title}
                  </Link>
                </h3>
                <Progress value={c.nodesPassed} total={c.nodesTotal} label="пройдено" />
                <div className="foot">
                  <Link href={`/courses/${c.versionId}`}>
                    {c.status === 'completed' ? 'Граф курсу' : 'Продовжити'}
                  </Link>
                  {c.status === 'completed' ? (
                    <Link href={`/courses/${c.versionId}/exam`} data-testid="exam-link">
                      Іспит
                    </Link>
                  ) : (
                    <span className="hint">Іспит — після всіх вузлів</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Поради для вас</h2>
          {tips && <span className="hint">Складено {tips.createdAt.toLocaleString('uk-UA')}</span>}
        </div>
        {tips ? (
          <ul className="tips" data-testid="recommendations">
            {tips.items.map((t) => (
              <li key={t.title} className={`tip ${t.kind}`} data-testid="recommendation">
                <span className="badge">{recommendationKindLabels[t.kind]}</span>
                <strong>{t.title}</strong>
                <p>{t.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="message" title="Порад поки немає" testId="no-recommendations">
            Вони зʼявляються, коли у вас є історія навчання.
          </EmptyState>
        )}
      </section>

      {certs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Мої сертифікати</h2>
          </div>
          <ul className="cert-list" data-testid="my-certificates">
            {certs.map((c) => (
              <li key={c.id}>
                <span className="pillar-icon">
                  <Icon name="award" size={18} />
                </span>
                <div className="grow">
                  <Link href={`/verify/${c.id}`}>{c.title}</Link>
                  <div className="hint">
                    Видано {c.issuedAt.toLocaleDateString('uk-UA')}
                    {c.revoked && ' · відкликано'}
                  </div>
                </div>
                {c.revoked ? (
                  <span className="badge bad">Відкликано</span>
                ) : (
                  <span className="badge ok">Дійсний</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
