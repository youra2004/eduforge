'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

// Shared by login and register: posts the form as JSON, shows the server's message on error.
export function AuthForm({
  endpoint,
  submitLabel,
  showName,
  children,
}: {
  endpoint: string;
  submitLabel: string;
  showName?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      email: form.get('email'),
      password: form.get('password'),
    };
    if (showName) {
      body.displayName = form.get('displayName');
      body.acceptTerms = form.get('acceptTerms') === 'on';
      body.acceptResearch = form.get('acceptResearch') === 'on';
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? 'Щось пішло не так. Спробуйте ще раз.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Немає зʼєднання з сервером.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {showName && (
        <label>
          Імʼя
          <input type="text" name="displayName" required maxLength={100} autoComplete="name" />
        </label>
      )}
      <label>
        Email
        <input type="email" name="email" required autoComplete="email" />
      </label>
      <label>
        Пароль
        <input
          type="password"
          name="password"
          required
          minLength={showName ? 8 : undefined}
          autoComplete={showName ? 'new-password' : 'current-password'}
        />
      </label>
      {children}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
