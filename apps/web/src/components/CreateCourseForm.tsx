'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { sendJson } from '@/lib/client';
import { levelLabels } from '@/lib/messages';

/** An author starts a course from scratch; the editor on the course page does the rest. */
export function CreateCourseForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const level = String(data.get('declaredLevel') ?? '');
    setBusy(true);
    setErrors([]);
    const res = await sendJson<{ versionId: string }>('/api/courses', 'POST', {
      title: String(data.get('title') ?? ''),
      slug: String(data.get('slug') ?? ''),
      description: String(data.get('description') ?? ''),
      ...(level ? { declaredLevel: level } : {}),
    });
    setBusy(false);
    if (!res.ok) return setErrors(res.errors);
    router.push(`/courses/${(res.data as { versionId: string }).versionId}`);
  }

  return (
    <form onSubmit={submit} data-testid="create-course-form">
      <label>
        Назва курсу
        <input type="text" name="title" required maxLength={200} />
      </label>
      <label>
        Адреса (slug: малі латинські літери, цифри, дефіси)
        <input type="text" name="slug" required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      </label>
      <label>
        Опис: чого навчить курс
        <textarea name="description" rows={3} maxLength={5000} />
      </label>
      <label>
        Заявлений рівень
        <select name="declaredLevel" defaultValue="">
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
      <div>
        <button type="submit" disabled={busy}>
          Створити курс
        </button>
      </div>
    </form>
  );
}
