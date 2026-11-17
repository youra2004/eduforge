'use client';

import { useState, type FormEvent } from 'react';
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
}: {
  question: StudentQuestion;
  busy: boolean;
  submitLabel: string;
  onSubmit: (answer: { optionIndex: number } | { text: string }) => void;
}) {
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');

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
            <label key={i} className="check">
              <input
                type="radio"
                name="option"
                checked={choice === i}
                onChange={() => setChoice(i)}
              />
              {option}
            </label>
          ))}
        </fieldset>
      ) : (
        <label>
          Ваша відповідь
          <textarea
            rows={question.kind === 'open' ? 5 : 2}
            value={text}
            onChange={(e) => setText(e.target.value)}
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
