'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { sendJson } from '@/lib/client';
import { levelLabels } from '@/lib/messages';

/** The title, description and declared level of an editable version (what the audit checks the content against). */
export function VersionDetailsForm({
  versionId,
  title,
  description,
  declaredLevel,
}: {
  versionId: string;
  title: string;
  description: string;
  declaredLevel: string | null;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const level = String(data.get('declaredLevel') ?? '');
    setBusy(true);
    setErrors([]);
    setSaved(false);
    const res = await sendJson(`/api/courses/versions/${versionId}`, 'PATCH', {
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      declaredLevel: level === '' ? null : level,
    });
    setBusy(false);
    if (!res.ok) return setErrors(res.errors);
    setSaved(true);
    router.refresh();
  }

  return (
    <details className="editor" data-testid="version-details">
      <summary>Назва, опис і рівень курсу</summary>
      <form onSubmit={submit}>
        <label>
          Назва
          <input type="text" name="title" defaultValue={title} required maxLength={200} />
        </label>
        <label>
          Опис: чого навчить курс (з ним звіряють матеріали під час аудиту)
          <textarea name="description" defaultValue={description} rows={3} maxLength={5000} />
        </label>
        <label>
          Заявлений рівень
          <select name="declaredLevel" defaultValue={declaredLevel ?? ''}>
            <option value="">не вказано</option>
            {Object.entries(levelLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {errors.length > 0 && (
          <ul role="alert" className="error">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        {saved && <p role="status">Збережено.</p>}
        <div>
          <button type="submit" disabled={busy}>
            Зберегти
          </button>
        </div>
      </form>
    </details>
  );
}
