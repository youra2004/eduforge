'use client';

import { useState, type FormEvent } from 'react';
import { Mascot } from './Mascot';

interface ChatMessage {
  role: 'student' | 'tutor';
  content: string;
  hintLevel?: number;
  source?: 'llm' | 'static';
}

const levelNames = ['', 'навідне питання', 'вказівка на поняття', 'схожий приклад'];

/** The tutor's chat (F6). Hints only: the server picks the level, and the reply never carries an answer key. */
export function TutorChat({
  nodeId,
  questionId,
  studentAnswer,
  title = 'Репетитор',
}: {
  nodeId: string;
  /** A practice or failed-test question the student asks about; the tutor sees its text, never its key. */
  questionId?: string;
  studentAnswer?: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(message: string) {
    setBusy(true);
    setError(null);
    try {
      await ask(message);
    } catch {
      setError('Не вдалося зв’язатися із сервером. Спробуйте ще раз.');
    } finally {
      setBusy(false);
    }
  }

  async function ask(message: string) {
    const res = await fetch(`/api/nodes/${nodeId}/tutor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, sessionId, questionId, studentAnswer }),
    });
    const json = (await res.json().catch(() => null)) as {
      sessionId?: string;
      message?:
        ChatMessage['content'] | { content: string; hintLevel: number; source: 'llm' | 'static' };
    } | null;
    if (res.ok && json?.sessionId && typeof json.message === 'object') {
      const reply = json.message;
      setSessionId(json.sessionId);
      setMessages((m) => [
        ...m,
        { role: 'student', content: message },
        {
          role: 'tutor',
          content: reply.content,
          hintLevel: reply.hintLevel,
          source: reply.source,
        },
      ]);
      setText('');
    } else {
      setError(
        typeof json?.message === 'string' ? json.message : 'Щось пішло не так. Спробуйте ще раз.',
      );
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) void send(text.trim());
  }

  return (
    <section className="tutor" data-testid="tutor-chat">
      <h3>
        <Mascot mood={busy ? 'think' : 'happy'} size={40} />
        {title}
      </h3>
      <p className="hint">
        Репетитор дає лише підказки на основі пройденого матеріалу і не показує правильних
        відповідей.
      </p>
      <ol className="tutor-messages" data-testid="tutor-messages">
        {messages.map((m, i) => (
          <li key={i} className={m.role} data-testid={`tutor-${m.role}`}>
            {m.role === 'tutor' && <Mascot mood="happy" size={28} className="msg-avatar" />}
            <strong>{m.role === 'student' ? 'Ви' : 'Репетитор'}</strong>
            {m.role === 'tutor' && m.hintLevel && (
              <span className="muted" data-testid="hint-level">
                {' '}
                · підказка {m.hintLevel} з 3 ({levelNames[m.hintLevel]})
              </span>
            )}
            <p>{m.content}</p>
          </li>
        ))}
        {busy && (
          <li className="tutor typing" role="status" aria-label="Репетитор друкує">
            <i />
            <i />
            <i />
          </li>
        )}
      </ol>
      <form onSubmit={submit} className="tutor-form">
        <label>
          Ваше запитання
          <textarea
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="tutor-input"
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={busy || !text.trim()} data-testid="tutor-send">
            Запитати
          </button>
          {questionId && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => send('Допоможіть із цим питанням, будь ласка.')}
              data-testid="tutor-hint"
            >
              Потрібна підказка
            </button>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="error" data-testid="tutor-error">
          {error}
        </p>
      )}
    </section>
  );
}
