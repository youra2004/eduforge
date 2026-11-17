import type { ReactNode } from 'react';
import Link from 'next/link';
import { roles } from '@eduforge/db';
import { unreadCount } from '@eduforge/core';
import { LogoutButton } from '@/components/LogoutButton';
import { roleLabels, rolePages } from '@/lib/messages';
import { getCurrentUser, getDb } from '@/lib/server';
import './globals.css';

export const metadata = { title: 'EduForge' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(getDb(), user) : 0;
  return (
    <html lang="uk">
      <body>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              EduForge
            </Link>
            {user && <Link href="/courses">Курси</Link>}
            {user && <Link href="/experiment">Дослідження</Link>}
            {user &&
              roles
                .filter((r) => user.roles.includes(r))
                .map((r) => (
                  <Link key={r} href={rolePages[r]}>
                    {roleLabels[r]}
                  </Link>
                ))}
          </nav>
          <div className="user">
            {user ? (
              <>
                <Link href="/notifications" data-testid="notifications-link">
                  Сповіщення{unread > 0 && <span className="count">{unread}</span>}
                </Link>
                <span>{user.displayName}</span>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login">Увійти</Link>
                <Link href="/register">Реєстрація</Link>
              </>
            )}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
