'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Markdown } from './Markdown';

export interface StudentQuestion {
  id: string;
  kind: 'mcq' | 'short' | 'open';
  promptMd: string;
  options: string[] | null;
}

/** One question and its answer input; the parent decides what happens on submit. Never sees a key. */
export function QuestionForm({
  question,
  busy,
  submitLabel,
  onSubmit,
  initial,
  onChange,
}: {
  question: StudentQuestion;
  busy: boolean;
  submitLabel: string;
  onSubmit: (answer: { optionIndex: number } | { text: string }) => void;
  /** An answer saved earlier (the exam's autosave), shown again after a reload. */
  initial?: { optionIndex?: number; text?: string } | null;
  /** Called on every edit, for autosave. */
  onChange?: (answer: { optionIndex: number } | { text: string }) => void;
}) {
  const [choice, setChoice] = useState<number | null>(initial?.optionIndex ?? null);
  const [text, setText] = useState(initial?.text ?? '');

  // Keyboard: 1-9 pick an option, Enter sends the pick. Ignored while typing somewhere else.
  const mcq = question.kind === 'mcq';
  const count = question.options?.length ?? 0;
  useEffect(() => {
    if (!mcq) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      const typing =
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLInputElement && t.type !== 'radio' && t.type !== 'checkbox');
      if (typing || t.closest('[role="dialog"]')) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(count, 9)) {
        setChoice(n - 1);
        onChange?.({ optionIndex: n - 1 });
      } else if (
        e.key === 'Enter' &&
        choice !== null &&
        !busy &&
        !(t instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        onSubmit({ optionIndex: choice });
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mcq, count, choice, busy, onChange, onSubmit]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (question.kind === 'mcq') {
      if (choice !== null) onSubmit({ optionIndex: choice });
    } else onSubmit({ text });
  }

  return (
    <form onSubmit={submit} data-testid="question-form">
      <div className="markdown" data-testid="question-prompt">
        <Markdown>{question.promptMd}</Markdown>
      </div>
      {question.kind === 'mcq' ? (
        <fieldset className="options">
          <legend className="hint">Оберіть одну відповідь</legend>
          {question.options?.map((option, i) => (
            <div key={i} className="option-row">
              <label className="check">
                <input
                  type="radio"
                  name="option"
                  checked={choice === i}
                  onChange={() => {
                    setChoice(i);
                    onChange?.({ optionIndex: i });
                  }}
                />
                {option}
              </label>
              {i < 9 && (
                <span className="key" aria-hidden>
                  {i + 1}
                </span>
              )}
            </div>
          ))}
        </fieldset>
      ) : (
        <label>
          Ваша відповідь
          <textarea
            rows={question.kind === 'open' ? 5 : 2}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange?.({ text: e.target.value });
            }}
          />
        </label>
      )}
      <button
        type="submit"
        disabled={busy || (question.kind === 'mcq' ? choice === null : text.trim() === '')}
      >
        {submitLabel}
      </button>
    </form>
  );
}
