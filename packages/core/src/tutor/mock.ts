import type { LLMRequest } from '@eduforge/llm';
import { normalizeAnswer } from '../questions/grading';
import { MATERIAL_CLOSE, MATERIAL_OPEN, TUTOR_SECTION } from './prompts';

/** The one line after `marker` (the prompts put JSON values on a single line). */
const line = (prompt: string, marker: string) => {
  const start = prompt.indexOf(`${marker}\n`);
  return start < 0 ? '' : (prompt.slice(start + marker.length + 1).split('\n')[0] ?? '');
};

/** The text of the first material block, or null. Only what sits between the delimiters counts as material. */
const firstChunk = (prompt: string) => {
  const open = prompt.indexOf(MATERIAL_OPEN);
  if (open < 0) return null;
  const from = prompt.indexOf('\n', open) + 1;
  return prompt.slice(from, prompt.indexOf(MATERIAL_CLOSE, from)).trim();
};

/** Deterministic hints for tests and the demo: one fixed shape per level, built from the first retrieved chunk. */
function mockTutor(req: LLMRequest) {
  const level = Number(line(req.prompt, TUTOR_SECTION.level));
  const chunk = firstChunk(req.prompt);
  if (level === 1) {
    return {
      hint: 'Спробуйте розкласти завдання на частини: що в ньому дано, що треба знайти і яке поняття з матеріалу тут застосовується?',
    };
  }
  if (level === 2) {
    const start = chunk?.split(/\s+/).slice(0, 4).join(' ');
    return {
      hint: start
        ? `Зверніть увагу на фрагмент матеріалу, що починається словами «${start} …». Перечитайте його й подумайте, як він стосується питання.`
        : 'Перегляньте матеріал вузла й знайдіть частину, що стосується теми питання.',
    };
  }
  return {
    hint: 'Розгляньмо схожий приклад на інших даних: спершу визначте, що дано, потім яке правило з матеріалу тут працює, і зробіть висновок. Тепер повторіть ті самі кроки для свого завдання.',
  };
}

/** The guard on the Mock: the reply leaks when it contains the reference answer. */
function mockGuard(req: LLMRequest) {
  const key = JSON.parse(line(req.prompt, TUTOR_SECTION.key) || 'null') as string | null;
  const reply = JSON.parse(line(req.prompt, TUTOR_SECTION.reply) || '""') as string;
  const revealed = !!key && normalizeAnswer(reply).includes(normalizeAnswer(key));
  return {
    revealed,
    reason: revealed
      ? 'Mock: the reply contains the reference answer.'
      : 'Mock: no reference answer in the reply.',
  };
}

export const tutorMockResponders = { tutor: mockTutor, tutor_guard: mockGuard };
