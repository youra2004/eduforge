'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export interface BankQuestion {
  id: string;
  skillId: string;
  pool: 'node' | 'exam' | 'assessment';
  kind: 'mcq' | 'short' | 'open';
  promptMd: string;
  options: string[] | null;
  answerKey: { optionIndex?: number; accepted?: string[]; reference?: string };
  rubric: string | null;
  difficulty: number;
  guess: number;
  status: 'generated' | 'validated' | 'rejected' | 'retired';
  rejectionReason: string | null;
}

interface Skill {
  id: string;
  name: string;
}

const poolLabels = { node: 'Тест вузла', exam: 'Іспит', assessment: 'Експеримент' } as const;
const kindLabels = { mcq: 'Тест', short: 'Коротка відповідь', open: 'Відкрита відповідь' } as const;
const statusLabels = {
  generated: 'Очікує перевірки',
  validated: 'Перевірено',
  rejected: 'Відхилено',
  retired: 'Знято',
} as const;

interface ApiError {
  message?: string;
  issues?: { message: string }[];
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as ApiError | null;
  return [
    data?.message ?? 'Щось пішло не так. Спробуйте ще раз.',
    ...(data?.issues ?? []).map((i) => i.message),
  ];
}

const lines = (s: FormDataEntryValue | null) =>
  String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Turns the form into the API body. For mcq, one option per line and the number of the correct one. */
function toBody(kind: BankQuestion['kind'], data: FormData) {
  const base = {
    kind,
    skillId: String(data.get('skillId')),
    promptMd: String(data.get('promptMd')),
  };
  if (kind === 'mcq') {
    return {
      ...base,
      options: lines(data.get('options')),
      correctIndex: Number(data.get('correct')) - 1,
    };
  }
  if (kind === 'short') return { ...base, accepted: lines(data.get('accepted')) };
  return { ...base, reference: String(data.get('reference')), rubric: String(data.get('rubric')) };
}

function QuestionForm({
  nodeId,
  skills,
  question,
}: {
  nodeId: string;
  skills: Skill[];
  question?: BankQuestion;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<BankQuestion['kind']>(question?.kind ?? 'mcq');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setErrors([]);
    try {
      const body = toBody(kind, data);
      const failed = question
        ? await send(`/api/questions/${question.id}`, 'PATCH', body)
        : await send(`/api/nodes/${nodeId}/questions`, 'POST', { ...body, pool: data.get('pool') });
      if (failed) return setErrors(failed);
      if (!question) form.reset();
      router.refresh();
    } catch {
      setErrors(['Немає зʼєднання з сервером.']);
    } finally {
      setBusy(false);
    }
  }

  const key = question?.answerKey ?? {};
  return (
    <form
      onSubmit={submit}
      className="content-form"
      data-testid={question ? 'question-edit-form' : 'question-add-form'}
    >
      {!question && (
        <>
          <label>
            Пул
            <select name="pool" defaultValue="node">
              <option value="node">Тест вузла</option>
              <option value="exam">Іспит</option>
              <option value="assessment">Експеримент</option>
            </select>
          </label>
          <label>
            Тип питання
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as BankQuestion['kind'])}
            >
              <option value="mcq">Тест (одна правильна відповідь)</option>
              <option value="short">Коротка відповідь</option>
              <option value="open">Відкрита відповідь</option>
            </select>
          </label>
        </>
      )}
      <label>
        Навичка
        <select name="skillId" defaultValue={question?.skillId} required>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Питання
        <textarea name="promptMd" rows={3} required defaultValue={question?.promptMd} />
      </label>
      {kind === 'mcq' && (
        <>
          <label>
            Варіанти (кожен з нового рядка)
            <textarea
              name="options"
              rows={4}
              required
              defaultValue={question?.options?.join('\n')}
            />
          </label>
          <label>
            Номер правильного варіанта
            <input
              type="number"
              name="correct"
              min={1}
              max={6}
              required
              defaultValue={(key.optionIndex ?? 0) + 1}
            />
          </label>
        </>
      )}
      {kind === 'short' && (
        <label>
          Прийнятні відповіді (кожна з нового рядка)
          <textarea name="accepted" rows={2} required defaultValue={key.accepted?.join('\n')} />
        </label>
      )}
      {kind === 'open' && (
        <>
          <label>
            Еталонна відповідь
            <textarea name="reference" rows={3} required defaultValue={key.reference} />
          </label>
          <label>
            Рубрика оцінювання
            <textarea name="rubric" rows={3} required defaultValue={question?.rubric ?? ''} />
          </label>
        </>
      )}
      {question && (
        <p className="hint">Після збереження питання знову проходить автоматичну перевірку.</p>
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
          {question ? 'Зберегти' : 'Додати питання'}
        </button>
      </div>
    </form>
  );
}

function QuestionRow({
  nodeId,
  skills,
  q,
  canEdit,
}: {
  nodeId: string;
  skills: Skill[];
  q: BankQuestion;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const skill = skills.find((s) => s.id === q.skillId)?.name ?? '—';

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setErrors([]);
    const failed = await send(`/api/questions/${q.id}/decision`, 'POST', { decision });
    setBusy(false);
    if (failed) setErrors(failed);
    else router.refresh();
  }

  const answer =
    q.kind === 'mcq'
      ? q.options?.[q.answerKey.optionIndex ?? -1]
      : q.kind === 'short'
        ? q.answerKey.accepted?.join(' / ')
        : q.answerKey.reference;

  return (
    <li className="question" data-testid="question" data-status={q.status}>
      <p>
        <span className={`badge ${q.status}`} data-testid="question-status">
          {statusLabels[q.status]}
        </span>{' '}
        <span className="muted">
          {kindLabels[q.kind]} · {skill} · складність {q.difficulty.toFixed(2)}
        </span>
      </p>
      <p>{q.promptMd}</p>
      {q.kind === 'mcq' && (
        <ol>
          {q.options?.map((o, i) => (
            <li key={i}>{i === q.answerKey.optionIndex ? <strong>{o}</strong> : o}</li>
          ))}
        </ol>
      )}
      {q.kind !== 'mcq' && <p className="hint">Відповідь: {answer}</p>}
      {q.rejectionReason && <p className="error">Причина відхилення: {q.rejectionReason}</p>}
      {canEdit && (
        <div className="actions">
          {q.status !== 'validated' && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => decide('approve')}
            >
              Схвалити
            </button>
          )}
          {q.status !== 'rejected' && (
            <button type="button" className="link" disabled={busy} onClick={() => decide('reject')}>
              Відхилити
            </button>
          )}
        </div>
      )}
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <details>
          <summary>Редагувати</summary>
          <QuestionForm nodeId={nodeId} skills={skills} question={q} />
        </details>
      )}
    </li>
  );
}

function GenerateButton({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const [pool, setPool] = useState<BankQuestion['pool']>('node');
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setErrors([]);
    setMessage(null);
    const res = await fetch(`/api/nodes/${nodeId}/questions/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pool }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      (ApiError & { alreadyQueued?: boolean }) | null;
    setBusy(false);
    if (!res?.ok) {
      return setErrors([
        data?.message ?? 'Немає зʼєднання з сервером.',
        ...(data?.issues ?? []).map((i) => i.message),
      ]);
    }
    setMessage(
      data?.alreadyQueued
        ? 'Генерація для цього пулу вже в черзі: повторний запит не потрібен.'
        : 'Генерацію запущено. Оновіть сторінку за хвилину: нові питання зʼявляться в списку.',
    );
    router.refresh();
  }

  return (
    <div className="actions">
      <label>
        Пул для генерації
        <select value={pool} onChange={(e) => setPool(e.target.value as BankQuestion['pool'])}>
          <option value="node">Тест вузла</option>
          <option value="exam">Іспит</option>
          <option value="assessment">Експеримент</option>
        </select>
      </label>
      <button type="button" onClick={generate} disabled={busy} data-testid="generate-questions">
        Згенерувати питання
      </button>
      {message && <span className="hint">{message}</span>}
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QuestionBank({
  nodeId,
  skills,
  questions,
  canEdit,
  need,
}: {
  nodeId: string;
  skills: Skill[];
  questions: BankQuestion[];
  canEdit: boolean;
  /** Validated questions wanted per skill in the node pool (F3-R6). */
  need: number;
}) {
  return (
    <section className="editor" data-testid="question-bank">
      <h2>Банк питань</h2>
      <table data-testid="pool-summary">
        <thead>
          <tr>
            <th>Навичка</th>
            <th>Перевірені питання в тесті вузла</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => {
            const have = questions.filter(
              (q) => q.skillId === s.id && q.pool === 'node' && q.status === 'validated',
            ).length;
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className={have < need ? 'error' : undefined}>
                  {have} з {need}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canEdit && <GenerateButton nodeId={nodeId} />}
      {(['node', 'exam', 'assessment'] as const).map((pool) => {
        const list = questions.filter((q) => q.pool === pool);
        return (
          <div key={pool}>
            <h3>
              {poolLabels[pool]} ({list.length})
            </h3>
            {list.length === 0 ? (
              <p className="muted">Питань ще немає.</p>
            ) : (
              <ul className="questions">
                {list.map((q) => (
                  <QuestionRow key={q.id} nodeId={nodeId} skills={skills} q={q} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {canEdit && (
        <>
          <h3>Додати питання вручну</h3>
          <QuestionForm nodeId={nodeId} skills={skills} />
        </>
      )}
    </section>
  );
}
