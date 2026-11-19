import type { ReactNode } from 'react';
import Link from 'next/link';
import '@fontsource-variable/inter';
import { roles } from '@eduforge/db';
import { unreadCount } from '@eduforge/core';
import { CommandPalette, type PaletteLink } from '@/components/CommandPalette';
import { Icon } from '@/components/icons';
import { LogoutButton } from '@/components/LogoutButton';
import { NavLink } from '@/components/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Toaster } from '@/components/Toaster';
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

// Applies the saved (or system) theme before the first paint, so there is no flash.
const themeScript = `try{var t=localStorage.getItem('theme');if(!t&&matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

const adminPages: PaletteLink[] = [
  { label: 'Сертифікати', href: '/admin/certificates', hint: 'Адміністратор' },
  { label: 'Порушення на іспитах', href: '/admin/strikes', hint: 'Адміністратор' },
  { label: 'Демо-режим і рекомендації', href: '/admin/demo', hint: 'Адміністратор' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(getDb(), user) : 0;
  const paletteLinks: PaletteLink[] = user
    ? [
        { label: 'Курси', href: '/courses' },
        { label: 'Дослідження', href: '/experiment' },
        { label: 'Сповіщення', href: '/notifications' },
        ...roles
          .filter((r) => user.roles.includes(r))
          .map((r) => ({ label: roleLabels[r], href: rolePages[r], hint: 'Розділ' })),
        ...(user.roles.includes('admin') ? adminPages : []),
      ]
    : [];
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
                  <CommandPalette links={paletteLinks} />
                  <ThemeToggle />
                  <NavLink href="/notifications" testId="notifications-link">
                    <Icon name="bell" size={16} />
                    <span className="navlink-label-long">Сповіщення</span>
                    {unread > 0 && <span className="count">{unread}</span>}
                  </NavLink>
                  <span className="avatar" title={user.displayName} aria-hidden>
                    {initials(user.displayName)}
                  </span>
                  <span className="user-name">{user.displayName}</span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <ThemeToggle />
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
        <Toaster />
        <footer className="site-footer">EduForge — платформа навчання на основі графа знань</footer>
      </body>
    </html>
  );
}
