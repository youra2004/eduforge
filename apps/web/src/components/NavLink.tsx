'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A header link that marks the section the user is in. */
export function NavLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: ReactNode;
  testId?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className="navlink"
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
    >
      {children}
    </Link>
  );
}
