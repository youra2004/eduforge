import type { ReactNode } from 'react';

export const metadata = { title: 'EduForge' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
