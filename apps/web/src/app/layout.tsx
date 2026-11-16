import type { ReactNode } from 'react';
import Link from 'next/link';
import { roles } from '@eduforge/db';
import { LogoutButton } from '@/components/LogoutButton';
import { roleLabels, rolePages } from '@/lib/messages';
import { getCurrentUser } from '@/lib/server';
import './globals.css';

export const metadata = { title: 'EduForge' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="uk">
      <body>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              EduForge
            </Link>
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
