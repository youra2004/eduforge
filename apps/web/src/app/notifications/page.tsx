import Link from 'next/link';
import { listNotifications } from '@eduforge/core';
import { MarkReadButton } from '@/components/MarkReadButton';
import { notificationText } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

function linkFor(type: string, p: Record<string, unknown>) {
  if (type === 'review_assigned' && p.reviewId) return `/expert/reviews/${p.reviewId}`;
  return p.versionId ? `/courses/${p.versionId}` : null;
}

export default async function NotificationsPage() {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const items = await listNotifications(getDb(), user);
  return (
    <div className="card">
      <h1>Сповіщення</h1>
      {items.length === 0 ? (
        <p className="muted">Сповіщень немає.</p>
      ) : (
        <>
          <ul className="notifications" data-testid="notifications">
            {items.map((n) => {
              const payload = n.payload as Record<string, unknown>;
              const href = linkFor(n.type, payload);
              return (
                <li key={n.id} className={n.readAt ? '' : 'unread'} data-testid="notification">
                  {notificationText(n.type, payload)} {href && <Link href={href}>Відкрити</Link>}
                  <span className="muted"> · {n.createdAt.toLocaleString('uk-UA')}</span>
                </li>
              );
            })}
          </ul>
          <MarkReadButton />
        </>
      )}
    </div>
  );
}
