'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { roleLabels } from '@/lib/messages';

const allRoles = ['student', 'author', 'expert', 'admin'] as const;

export function RoleEditor({ userId, roles }: { userId: string; roles: string[] }) {
  const [current, setCurrent] = useState(roles);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(role: string, on: boolean) {
    const apply = (add: boolean) =>
      setCurrent((prev) =>
        add ? [...prev.filter((r) => r !== role), role] : prev.filter((r) => r !== role),
      );
    setBusy(true);
    setError(null);
    apply(on); // show the change at once; undone below if the server refuses
    const res = await fetch(`/api/admin/users/${userId}/roles/${role}`, {
      method: on ? 'PUT' : 'DELETE',
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(data?.message ?? 'Щось пішло не так. Спробуйте ще раз.');
      apply(!on);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      {allRoles.map((role) => (
        <label key={role}>
          <input
            type="checkbox"
            checked={current.includes(role)}
            disabled={busy}
            onChange={(e) => toggle(role, e.target.checked)}
          />
          {roleLabels[role]}
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
