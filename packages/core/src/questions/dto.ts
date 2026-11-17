import type { Question } from '@eduforge/db';

/**
 * What a student (and the tutor) may see of a question: an explicit allow-list, so a column added
 * to `questions` later is hidden by default. No answer key, rubric, difficulty, guess or slip (P6, F3-R7).
 */
export function toStudentQuestion(q: Pick<Question, 'id' | 'kind' | 'promptMd' | 'options'>) {
  return {
    id: q.id,
    kind: q.kind,
    promptMd: q.promptMd,
    options: q.kind === 'mcq' ? q.options : null,
  };
}
export type StudentQuestion = ReturnType<typeof toStudentQuestion>;

/** The full row, for the course's author, admins and experts only. */
export const toAuthorQuestion = (q: Question) => ({ ...q });
export type AuthorQuestion = ReturnType<typeof toAuthorQuestion>;
