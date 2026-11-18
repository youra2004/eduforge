import type { ReactNode } from 'react';
import Link from 'next/link';
import '@fontsource-variable/inter';
import { roles } from '@eduforge/db';
import { unreadCount } from '@eduforge/core';
import { Icon } from '@/components/icons';
import { LogoutButton } from '@/components/LogoutButton';
import { NavLink } from '@/components/NavLink';
import { BrandMark } from '@/components/ui';
import { roleLabels, rolePages } from '@/lib/messages';
import { getCurrentUser, getDb } from '@/lib/server';
import './globals.css';

export const metadata = {
  title: { default: 'EduForge', template: '%s — EduForge' },
  description: 'Платформа навчання на основі графа знань.',
};

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(getDb(), user) : 0;
  return (
    <html lang="uk">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <nav aria-label="Основна навігація">
              <Link href="/" className="brand">
                <BrandMark />
                <span className="brand-word">EduForge</span>
              </Link>
              {user && <NavLink href="/courses">Курси</NavLink>}
              {user && <NavLink href="/experiment">Дослідження</NavLink>}
              {user &&
                roles
                  .filter((r) => user.roles.includes(r))
                  .map((r) => (
                    <NavLink key={r} href={rolePages[r]}>
                      {roleLabels[r]}
                    </NavLink>
                  ))}
            </nav>
            <div className="user">
              {user ? (
                <>
                  <NavLink href="/notifications" testId="notifications-link">
                    <Icon name="bell" size={16} />
                    <span className="navlink-label-long">Сповіщення</span>
                    {unread > 0 && <span className="count">{unread}</span>}
                  </NavLink>
                  <span className="avatar" aria-hidden>
                    {initials(user.displayName)}
                  </span>
                  <span className="user-name">{user.displayName}</span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <NavLink href="/login">Увійти</NavLink>
                  <Link href="/register" className="btn sm">
                    Реєстрація
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">EduForge — платформа навчання на основі графа знань</footer>
      </body>
    </html>
  );
}
