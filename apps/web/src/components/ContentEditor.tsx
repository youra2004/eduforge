'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export interface EditableItem {
  id: string;
  kind: 'markdown' | 'video';
  title: string;
  bodyMd: string | null;
  videoUrl: string | null;
  videoStorageKey: string | null;
  transcriptText: string | null;
  transcriptSource: 'author' | 'whisper' | null;
}

interface ApiError {
  message?: string;
  issues?: { message: string }[];
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as ApiError | null;
  return [
    data?.message ?? 'Щось пішло не так. Спробуйте ще раз.',
    ...(data?.issues ?? []).map((i) => i.message),
  ];
}

/** One form for adding or editing a content item. The kind of an existing item cannot change. */
function ItemForm({ nodeId, item }: { nodeId: string; item?: EditableItem }) {
  const router = useRouter();
  const [kind, setKind] = useState<'markdown' | 'video'>(item?.kind ?? 'markdown');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setErrors([]);
    try {
      let videoStorageKey = item?.videoStorageKey ?? null;
      const file = data.get('file');
      if (kind === 'video' && file instanceof File && file.size > 0) {
        const up = await fetch('/api/content/upload', {
          method: 'POST',
          headers: { 'content-type': 'video/mp4' },
          body: file,
        });
        const uploaded = (await up.json().catch(() => null)) as
          ({ key?: string } & ApiError) | null;
        if (!up.ok || !uploaded?.key) {
          setErrors([
            uploaded?.message ?? 'Не вдалося завантажити відео.',
            ...(uploaded?.issues ?? []).map((i) => i.message),
          ]);
          return;
        }
        videoStorageKey = uploaded.key;
      }
      const title = String(data.get('title') ?? '');
      const url = String(data.get('videoUrl') ?? '').trim();
      const fields =
        kind === 'markdown'
          ? { title, bodyMd: String(data.get('bodyMd') ?? '') }
          : {
              title,
              videoUrl: url === '' ? null : url,
              videoStorageKey,
              transcriptText: String(data.get('transcriptText') ?? ''),
            };
      const failed = item
        ? await send(`/api/content/${item.id}`, 'PATCH', fields)
        : await send(`/api/nodes/${nodeId}/content`, 'POST', { kind, ...fields });
      if (failed) {
        setErrors(failed);
        return;
      }
      if (!item) form.reset();
      router.refresh();
    } catch {
      setErrors(['Немає зʼєднання з сервером.']);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !confirm(`Видалити «${item.title}»?`)) return;
    setBusy(true);
    const failed = await send(`/api/content/${item.id}`, 'DELETE');
    setBusy(false);
    if (failed) setErrors(failed);
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className="content-form" data-testid={item ? 'edit-form' : 'add-form'}>
      {!item && (
        <label>
          Тип
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'markdown' | 'video')}
          >
            <option value="markdown">Текст</option>
            <option value="video">Відео</option>
          </select>
        </label>
      )}
      <label>
        Назва
        <input type="text" name="title" required maxLength={200} defaultValue={item?.title} />
      </label>
      {kind === 'markdown' ? (
        <label>
          Вміст (Markdown)
          <textarea name="bodyMd" rows={8} required defaultValue={item?.bodyMd ?? ''} />
        </label>
      ) : (
        <>
          <label>
            Посилання на відео
            <input
              type="text"
              name="videoUrl"
              placeholder="https://…"
              defaultValue={item?.videoUrl ?? ''}
            />
          </label>
          <label>
            Або файл mp4 {item?.videoStorageKey && '(вже завантажено; новий файл замінить його)'}
            <input type="file" name="file" accept="video/mp4" />
          </label>
          <label>
            Транскрипт
            <textarea name="transcriptText" rows={6} defaultValue={item?.transcriptText ?? ''} />
          </label>
          <p className="hint">
            Транскрипт обовʼязковий для публікації. Для завантаженого файлу залиште поле порожнім:
            його створить Whisper. Для відео за посиланням напишіть транскрипт самі.
          </p>
        </>
      )}
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {item ? 'Зберегти' : 'Додати'}
        </button>
        {item && (
          <button type="button" className="link" onClick={remove} disabled={busy}>
            Видалити
          </button>
        )}
      </div>
    </form>
  );
}

export function ContentEditor({ nodeId, items }: { nodeId: string; items: EditableItem[] }) {
  return (
    <section className="editor" data-testid="content-editor">
      <h2>Редагування матеріалів</h2>
      {items.map((item) => (
        <details key={item.id}>
          <summary>{item.title}</summary>
          <ItemForm nodeId={nodeId} item={item} />
        </details>
      ))}
      <h3>Додати матеріал</h3>
      <ItemForm nodeId={nodeId} />
    </section>
  );
}
